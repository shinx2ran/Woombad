/**
 * Check-in cepat (SPEC 7.4): a walk-in guest on a daily rate in three fields (name, nights, total paid). It writes
 * the same rows in the same order as the Sewa baru wizard (NewLeasePage.save): tenant (if new) -> lease -> first
 * invoice through LeaseActions.insertFromDraft -> rent payment -> invoice status. The wizard itself is untouched;
 * this is a short path into the same building blocks, so the same database rules and numbering apply.
 *
 * The same path books a planned stay (Rencana check-in, SPEC 7.7): saveStayBooking takes any period type, any start
 * date (a future start is a booking, "Dipesan") and an optional DP; saveQuickCheckIn is that call for a daily stay paid
 * in full or not at all.
 */
import { deriveInvoiceStatus, type InvoiceDraftInput, type InvoiceDraft } from '../../domain/billing'
import { periodBounds } from '../../domain/period'
import type { OrgRepo } from '../../lib/repo/types'
import { formatRupiah } from '../../lib/format'
import type { Invoice, Lease, Payment, PaymentMethod, PeriodType, Room, Tenant } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { ROOM_AVAILABILITY_LABEL, roomAvailability } from '../leases/leaseUtils'
import { EMPTY_TENANT_FORM, formToTenantPayload, validateTenantForm } from '../tenants/tenantUtils'

export interface QuickCheckInInput {
  room: Room
  /** first night */
  startDate: string
  nights: number
  /** what the guest pays for the whole stay */
  total: number
  /** true: paid in full now with `method`; false: the invoice stays open */
  paid: boolean
  method: PaymentMethod
  /** an existing tenant; when null a new tenant is created from name + phone */
  tenantId: string | null
  name: string
  /** optional: '' saves the tenant without a phone number ("HP nanti") */
  phone: string
}

export interface QuickCheckInPlan {
  /** last night (stored lease.end_date / period_end, SPEC 7.3) */
  end: string
  /** total / nights, rounded to the rupiah */
  pricePerNight: number
  /** set when pricePerNight x nights does not give the total back: the invoice keeps the agreed total */
  baseAmount: number | undefined
}

export function planQuickCheckIn(startDate: string, nights: number, total: number): QuickCheckInPlan | null {
  const plan = planStayBooking(startDate, 'daily', nights, total)
  return plan && { end: plan.end, pricePerNight: plan.pricePerPeriod, baseAmount: plan.baseAmount }
}

export interface StayBookingPlan {
  /** last night (stored lease.end_date / period_end, SPEC 7.3) */
  end: string
  /** total / quantity, rounded to the rupiah: the lease's price per night / week / month */
  pricePerPeriod: number
  /** set when pricePerPeriod x quantity does not give the total back: the invoice keeps the agreed total */
  baseAmount: number | undefined
}

/** Lease end, price per period and invoice base for `quantity` periods of `periodType` from `startDate` for `total`. */
export function planStayBooking(startDate: string, periodType: PeriodType, quantity: number, total: number): StayBookingPlan | null {
  if (!startDate || quantity < 1 || total <= 0) return null
  try {
    const { end } = periodBounds(startDate, periodType, 0, quantity)
    const pricePerPeriod = Math.round(total / quantity)
    return { end, pricePerPeriod, baseAmount: pricePerPeriod * quantity === total ? undefined : total }
  } catch {
    return null
  }
}

/** '= Rp 180.000 / malam', or '≈ Rp 116.667 / malam (total tetap Rp 350.000)' when the total does not split evenly. */
export function perNightText(plan: QuickCheckInPlan, total: number): string {
  return perPeriodText({ end: plan.end, pricePerPeriod: plan.pricePerNight, baseAmount: plan.baseAmount }, total, 'daily')
}

/** '= Rp 600.000 / minggu', or '≈ … / minggu (total tetap Rp X)' when the total does not split evenly. */
export function perPeriodText(plan: StayBookingPlan, total: number, periodType: PeriodType): string {
  const unit = PERIOD_UNIT_LABEL[periodType]
  return plan.baseAmount === undefined
    ? `= ${formatRupiah(plan.pricePerPeriod)} / ${unit}`
    : `≈ ${formatRupiah(plan.pricePerPeriod)} / ${unit} (total tetap ${formatRupiah(total)})`
}

export type QuickCheckInErrors = Partial<Record<'name' | 'phone' | 'startDate' | 'nights' | 'total' | 'room', string>>

export function validateQuickCheckIn(input: QuickCheckInInput, leases: Lease[]): QuickCheckInErrors {
  const errors: QuickCheckInErrors = {}
  if (!input.tenantId) {
    const tenantErrors = validateTenantForm({ ...EMPTY_TENANT_FORM, full_name: input.name, phone: input.phone, property_id: input.room.property_id })
    if (tenantErrors.full_name) errors.name = tenantErrors.full_name
    if (tenantErrors.phone) errors.phone = tenantErrors.phone
  }
  if (!input.startDate) errors.startDate = 'Tanggal check-in wajib diisi.'
  if (input.nights < 1) errors.nights = 'Minimal 1 malam.'
  if (input.total <= 0) errors.total = 'Isi total yang dibayar.'
  const plan = planQuickCheckIn(input.startDate, input.nights, input.total)
  if (plan) {
    const availability = roomAvailability(input.room, leases, input.startDate, plan.end)
    if (availability !== 'kosong') errors.room = `Kamar ${input.room.name} ${ROOM_AVAILABILITY_LABEL[availability].toLowerCase()} pada tanggal ini.`
  }
  return errors
}

/** Same-name tenants (spaces and case ignored), so a returning guest is not created twice. */
export function tenantsNamed(tenants: Tenant[], name: string): Tenant[] {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase()
  if (key.length < 2) return []
  return tenants.filter((t) => t.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === key)
}

/**
 * Which existing tenant the stay goes to: the one picked among the same-name tenants, or the only one when nothing was
 * picked; null for a new tenant. A pick made for an earlier spelling of the name no longer counts once the name changed.
 */
export function resolveTenantChoice(sameName: Tenant[], choice: string, newChoice: string): string | null {
  if (choice === newChoice) return null
  const picked = sameName.find((t) => t.id === choice)
  if (picked) return picked.id
  return sameName.length === 1 ? sameName[0].id : null
}

export interface QuickCheckInDeps {
  repo: OrgRepo
  insertFromDraft: (input: InvoiceDraftInput, notes: string | null) => Promise<{ invoice: Invoice; draft: InvoiceDraft }>
  canWriteInvoiceStatus: boolean
  /** every invoice of the org (numbering) */
  orgInvoices: Invoice[]
  /** payment date: today */
  todayISO: string
}

/** Thrown when some rows were already written, so the caller can avoid a duplicate on retry or show the lease. */
export class QuickCheckInError extends Error {
  readonly createdTenant: Tenant | null
  readonly lease: Lease | null
  constructor(message: string, createdTenant: Tenant | null, lease: Lease | null) {
    super(message)
    this.name = 'QuickCheckInError'
    this.createdTenant = createdTenant
    this.lease = lease
  }
}

export interface StayBookingInput {
  room: Room
  periodType: PeriodType
  /** first night; a future day books the room ("Dipesan") */
  startDate: string
  /** nights / weeks / months */
  quantity: number
  /** agreed total for the whole stay */
  total: number
  /** paid now: the whole total, a DP, or 0 */
  paidAmount: number
  method: PaymentMethod
  /** an existing tenant; when null a new tenant is created from name + phone */
  tenantId: string | null
  name: string
  /** optional: '' saves the tenant without a phone number ("HP nanti") */
  phone: string
  /** lease notes */
  notes: string | null
}

/**
 * Tenant (if new) -> lease (active, start = the check-in day) -> first invoice (insertFromDraft) -> rent payment for
 * `paidAmount` (marked 'DP' when below the total, as in the wizard) -> invoice status. Throws QuickCheckInError naming
 * what was already written.
 */
export async function saveStayBooking(input: StayBookingInput, deps: QuickCheckInDeps): Promise<{ lease: Lease; invoice: Invoice; tenantId: string; payment: Payment | null }> {
  const plan = planStayBooking(input.startDate, input.periodType, input.quantity, input.total)
  if (!plan) throw new Error(`Isi tanggal, jumlah ${PERIOD_UNIT_LABEL[input.periodType]}, dan total.`)
  const { repo } = deps
  let createdTenant: Tenant | null = null
  let lease: Lease | null = null
  try {
    let tenantId = input.tenantId
    if (!tenantId) {
      createdTenant = await repo.insert('tenants', formToTenantPayload({ ...EMPTY_TENANT_FORM, full_name: input.name, phone: input.phone, property_id: input.room.property_id }))
      tenantId = createdTenant.id
    }
    lease = await repo.insert('leases', {
      property_id: input.room.property_id,
      room_id: input.room.id,
      tenant_id: tenantId,
      period_type: input.periodType,
      price_per_period: plan.pricePerPeriod,
      deposit_amount: 0,
      start_date: input.startDate,
      end_date: plan.end,
      status: 'active',
      checkout_date: null,
      notes: input.notes?.trim() || null,
    })
    const { invoice } = await deps.insertFromDraft(
      { lease, addons: [], quantity: input.quantity, baseAmount: plan.baseAmount, existingInvoices: [], orgInvoices: deps.orgInvoices },
      null,
    )
    let payment: Payment | null = null
    if (input.paidAmount > 0) {
      const amount = Math.min(input.paidAmount, invoice.total_amount)
      payment = await repo.insert('payments', {
        property_id: input.room.property_id,
        invoice_id: invoice.id,
        lease_id: lease.id,
        amount,
        paid_at: deps.todayISO,
        method: input.method,
        kind: 'rent',
        notes: amount < invoice.total_amount ? 'DP' : null,
      })
      const status = deriveInvoiceStatus(invoice.total_amount, amount, invoice.status)
      if (status !== invoice.status && deps.canWriteInvoiceStatus) await repo.update('invoices', invoice.id, { status })
    }
    return { lease, invoice, tenantId, payment }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal menyimpan check-in.'
    throw new QuickCheckInError(msg, createdTenant, lease)
  }
}

export async function saveQuickCheckIn(input: QuickCheckInInput, deps: QuickCheckInDeps): Promise<{ lease: Lease; invoice: Invoice; tenantId: string }> {
  if (!planQuickCheckIn(input.startDate, input.nights, input.total)) throw new Error('Isi tanggal, jumlah malam, dan total.')
  const { lease, invoice, tenantId } = await saveStayBooking(
    {
      room: input.room,
      periodType: 'daily',
      startDate: input.startDate,
      quantity: input.nights,
      total: input.total,
      paidAmount: input.paid ? input.total : 0,
      method: input.method,
      tenantId: input.tenantId,
      name: input.name,
      phone: input.phone,
      notes: null,
    },
    deps,
  )
  return { lease, invoice, tenantId }
}
