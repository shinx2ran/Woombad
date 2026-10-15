/**
 * Check-in cepat (SPEC 7.4): a walk-in guest on a daily rate in three fields (name, nights, total paid). It writes
 * the same rows in the same order as the Sewa baru wizard (NewLeasePage.save): tenant (if new) -> lease -> first
 * invoice through LeaseActions.insertFromDraft -> rent payment -> invoice status. The wizard itself is untouched;
 * this is a short path into the same building blocks, so the same database rules and numbering apply.
 */
import { deriveInvoiceStatus, type InvoiceDraftInput, type InvoiceDraft } from '../../domain/billing'
import { periodBounds } from '../../domain/period'
import type { OrgRepo } from '../../lib/repo/types'
import { formatRupiah } from '../../lib/format'
import type { Invoice, Lease, PaymentMethod, Room, Tenant } from '../../types/db'
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
  if (!startDate || nights < 1 || total <= 0) return null
  try {
    const { end } = periodBounds(startDate, 'daily', 0, nights)
    const pricePerNight = Math.round(total / nights)
    return { end, pricePerNight, baseAmount: pricePerNight * nights === total ? undefined : total }
  } catch {
    return null
  }
}

/** '= Rp 180.000 / malam', or '≈ Rp 116.667 / malam (total tetap Rp 350.000)' when the total does not split evenly. */
export function perNightText(plan: QuickCheckInPlan, total: number): string {
  return plan.baseAmount === undefined
    ? `= ${formatRupiah(plan.pricePerNight)} / malam`
    : `≈ ${formatRupiah(plan.pricePerNight)} / malam (total tetap ${formatRupiah(total)})`
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

export async function saveQuickCheckIn(input: QuickCheckInInput, deps: QuickCheckInDeps): Promise<{ lease: Lease; invoice: Invoice; tenantId: string }> {
  const plan = planQuickCheckIn(input.startDate, input.nights, input.total)
  if (!plan) throw new Error('Isi tanggal, jumlah malam, dan total.')
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
      period_type: 'daily',
      price_per_period: plan.pricePerNight,
      deposit_amount: 0,
      start_date: input.startDate,
      end_date: plan.end,
      status: 'active',
      checkout_date: null,
      notes: null,
    })
    const { invoice } = await deps.insertFromDraft(
      { lease, addons: [], quantity: input.nights, baseAmount: plan.baseAmount, existingInvoices: [], orgInvoices: deps.orgInvoices },
      null,
    )
    if (input.paid) {
      const amount = Math.min(input.total, invoice.total_amount)
      await repo.insert('payments', {
        property_id: input.room.property_id,
        invoice_id: invoice.id,
        lease_id: lease.id,
        amount,
        paid_at: deps.todayISO,
        method: input.method,
        kind: 'rent',
        notes: null,
      })
      const status = deriveInvoiceStatus(invoice.total_amount, amount, invoice.status)
      if (status !== invoice.status && deps.canWriteInvoiceStatus) await repo.update('invoices', invoice.id, { status })
    }
    return { lease, invoice, tenantId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal menyimpan check-in.'
    throw new QuickCheckInError(msg, createdTenant, lease)
  }
}
