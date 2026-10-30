/**
 * Multi-step writes of the leases module. Every function performs its repo calls sequentially, keeps the
 * derived data consistent (SPEC 2b: invoices.status via deriveInvoiceStatus, leases.end_date on issue/void)
 * and invalidates the affected tables at the end. Money/date rules are delegated to src/domain.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { AddonBilling, Invoice, Lease, LeaseAddon, OrgTableName, Payment, PaymentMethod, PeriodType, Room, Tenant } from '../../types/db'
import {
  buildInvoiceDraft,
  deriveInvoiceStatus,
  latestCoveredThrough,
  paidAmountFor,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '../../domain/billing'
import { formatCheckout, formatDate, formatRupiah, todayISO } from '../../lib/format'
import { guardedNights, overlappingLease } from '../../domain/occupancy'
import { normalizePlate } from '../../domain/plate'
import {
  LEASE_DATA_CHANGED_MESSAGE,
  PLANNED_CHECKOUT_INACTIVE_MESSAGE,
  ROOM_AVAILABILITY_LABEL,
  addonAmountUpdates,
  allocateAcrossInvoices,
  appendMoveNote,
  cancelledLeaseEndDate,
  closingInvoiceWrites,
  extensionLeasePatch,
  futureInvoicesAtCheckout,
  invoiceInsertFromDraft,
  invoicesToPinType,
  leaseDataChanged,
  openInvoicesSorted,
  plannedCheckoutBookedMessage,
  plannedCheckoutError,
  plannedCheckoutHeldNights,
  rentRefundExpense,
  rentRefundsToRecord,
  roomAvailability,
  unrecordedRentRefunds,
  type Allocation,
  type DepositSettlement,
  type InvoiceWrite,
  type PartialDecision,
} from './leaseUtils'
import { validatePaymentEdit, type PaymentEditContext, type PaymentEditPatch } from './paymentEdit'
import { REDATE_INACTIVE_MESSAGE, REDATE_STAFF_MESSAGE, planLeaseRedate, redateDataChanged, redateNoteLine, type LeaseRedatePlan } from './redate'
import { StaleWriteError } from '../../lib/repo/types'

export type { PartialDecision } from './leaseUtils'

/** SPEC 7.6 Ubah tanggal mulai sewa */
export interface RedateLeaseActionInput {
  lease: Lease
  /** the lease's invoices this screen planned (and previewed) from */
  invoices: Invoice[]
  newStart: string
  /** 'Alasan' (optional), appended to the note line */
  reason?: string | null
  /** to name the tenant of a colliding lease */
  tenants?: Pick<Tenant, 'id' | 'full_name'>[]
  /** the day written in the note; default today */
  today?: string
}

export interface IssueInvoiceInput {
  lease: Lease
  addons: LeaseAddon[]
  quantity: number
  periodEnd?: string
  baseAmount?: number
  /** period type for this invoice (SPEC 5.2); default the lease's */
  periodType?: PeriodType
  /** agreed price per period for this invoice (SPEC 5.4); always pass it when periodType differs */
  pricePerPeriod?: number
  /** 'Jadikan jenis/harga tetap sewa ini': copy type/price to the lease and append a note */
  makePermanent?: boolean
  /** add-ons amount override for this invoice (permanentSwitchAddonsAmount when the new type is made permanent) */
  addonsAmount?: number
  /**
   * new per_period add-on amounts by id, expressed per NEW unit; written to lease_addons only when the type
   * switch is made permanent (see rescaledAddonDefaults)
   */
  addonAmounts?: Record<string, number>
  extraAmount?: number
  discountAmount?: number
  notes: string | null
  /** invoices of this lease */
  existingInvoices: Invoice[]
  /** every invoice of the org (numbering) */
  orgInvoices: Invoice[]
}

export interface RentPaymentInput {
  invoice: Invoice
  lease: Lease
  payments: Payment[]
  amount: number
  method: PaymentMethod
  paidAt: string
  notes: string | null
  /** amount < outstanding: add the difference as discount so the invoice becomes paid (SPEC 2b.7) */
  settleWithDiscount?: boolean
  /** amount > outstanding: record the excess as a kind='other' income (SPEC 2b.7) */
  excessAsOther?: boolean
}

export interface RentPaymentResult {
  payment: Payment
  /** outstanding after this payment (0 = lunas) */
  remaining: number
  excessRecorded: number
}

export interface CheckoutInput {
  lease: Lease
  checkoutDate: string
  invoices: Invoice[]
  payments: Payment[]
  settlement: DepositSettlement
  /** decision per partially-paid invoice whose period starts on or after the checkout date (see futureInvoicesAtCheckout) */
  partialDecisions: Record<string, PartialDecision>
}

export interface CancelInput {
  lease: Lease
  invoices: Invoice[]
  payments: Payment[]
  /** decision per partial invoice id */
  partialDecisions: Record<string, PartialDecision>
  settlement: DepositSettlement
  dateISO: string
}

export function useLeaseActions() {
  const { repo, role } = useOrg()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'
    // In Supabase mode a trigger maintains invoices.status and staff cannot update invoices (RLS);
    // in demo mode the UI must persist the derived status itself (SPEC section 3).
    const canWriteInvoiceStatus = repo.mode === 'local' || isAdmin
    // Staff may never edit/void invoices or delete payments (SPEC 3, 6.2); the UI hides those actions and the
    // actions refuse them before any write, so a multi-step action never stops half-way.
    const canEditInvoices = isAdmin
    // Staff may extend, check out and move rooms, but never change a lease's price, deposit or type (SPEC 6.2).
    const canEditLeaseTerms = isAdmin
    const STAFF_INVOICE_ERROR = 'Hanya pemilik/admin yang dapat mengubah tagihan.'
    const STAFF_TERMS_ERROR = 'Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.'

    async function syncInvoiceStatus(invoiceId: string): Promise<void> {
      const inv = await repo.get('invoices', invoiceId)
      if (!inv) return
      const pays = await repo.list('payments', { where: { invoice_id: invoiceId } })
      const status = deriveInvoiceStatus(inv.total_amount, paidAmountFor(invoiceId, pays), inv.status)
      if (status !== inv.status && canWriteInvoiceStatus) await repo.update('invoices', invoiceId, { status })
    }

    /**
     * The amounts of an invoice this screen computed from must still be the stored ones: the database requires
     * total = base + add-on + extra − discount, and since the rent of an invoice can be corrected (SPEC 7.5) another
     * device may have changed it after this screen loaded. Refuse with the usual message instead of a raw DB error.
     */
    async function assertInvoiceUnchanged(invoice: Invoice): Promise<void> {
      const fresh = await repo.get('invoices', invoice.id)
      const same =
        fresh &&
        fresh.base_amount === invoice.base_amount &&
        fresh.addons_amount === invoice.addons_amount &&
        fresh.extra_amount === invoice.extra_amount &&
        fresh.discount_amount === invoice.discount_amount &&
        fresh.total_amount === invoice.total_amount
      if (!same) {
        await invalidate('invoices', 'payments')
        throw new Error(LEASE_DATA_CHANGED_MESSAGE)
      }
    }

    /**
     * SPEC 7.6: a start-date correction (redateLease) on another device moves every period of the lease. A bill, check-out
     * or cancel computed from the old schedule would leave nights unbilled or void the wrong invoice, so the stored start
     * must still be the one this screen planned from. Only that correction (or an admin editing start_date directly)
     * moves it, so every other flow behaves as before.
     */
    async function leaseStartMoved(lease: Lease): Promise<boolean> {
      const fresh = await repo.get('leases', lease.id)
      return !!fresh && fresh.start_date !== lease.start_date
    }

    /**
     * SPEC 7.7: the database refuses an extension that runs into another booking of the room (leases_overlap_guard). Check
     * the same rule on fresh rows BEFORE the invoice is written, so a refused extension leaves no invoice behind, and name
     * the booking in the way. Only an extension the guard would refuse is stopped here.
     */
    async function assertExtensionFree(input: IssueInvoiceInput): Promise<void> {
      let draft: InvoiceDraft
      try {
        draft = buildInvoiceDraft({
          lease: input.lease,
          addons: input.addons,
          quantity: input.quantity,
          periodEnd: input.periodEnd,
          baseAmount: input.baseAmount,
          periodType: input.periodType,
          pricePerPeriod: input.pricePerPeriod,
          addonsAmount: input.addonsAmount,
          extraAmount: input.extraAmount,
          discountAmount: input.discountAmount,
          existingInvoices: input.existingInvoices,
          orgInvoices: input.orgInvoices,
        })
      } catch {
        return // the write itself reports the problem
      }
      const nights = guardedNights(input.lease, { ...input.lease, end_date: draft.new_lease_end_date }, todayISO())
      if (!nights) return
      const roomLeases = await repo.list('leases', { where: { room_id: input.lease.room_id } })
      const other = overlappingLease(roomLeases, input.lease.room_id, nights.from, nights.to, input.lease.id)
      if (!other) return
      const tenant = await repo.get('tenants', other.tenant_id).catch(() => null)
      await invalidate('leases')
      throw new Error(
        `Kamar ini sudah ${other.start_date > todayISO() ? 'dipesan' : 'ditempati'} ${tenant?.full_name ?? 'penyewa lain'} mulai ${formatDate(other.start_date)}, ` +
          `jadi sewa ini tidak bisa diperpanjang sampai ${formatCheckout(draft.new_lease_end_date)}. Perpendek perpanjangan atau pindahkan salah satu ke kamar lain.`,
      )
    }

    /** Insert an invoice from a draft; on a duplicate number (two devices) rebuild with fresh numbering (SPEC 2b.11). */
    async function insertFromDraft(input: InvoiceDraftInput, notes: string | null): Promise<{ invoice: Invoice; draft: InvoiceDraft }> {
      let orgInvoices = input.orgInvoices ?? input.existingInvoices
      for (let attempt = 0; ; attempt++) {
        const draft = buildInvoiceDraft({ ...input, orgInvoices })
        try {
          // period_type = the draft's effective type (SPEC 5.2), not necessarily the lease's.
          const invoice = await repo.insert('invoices', invoiceInsertFromDraft(input.lease, draft, notes))
          return { invoice, draft }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt < 2 && /Nomor tagihan sudah dipakai/i.test(msg)) {
            orgInvoices = await repo.list('invoices')
            continue
          }
          throw err
        }
      }
    }

    async function issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
      if (input.makePermanent && !canEditLeaseTerms) {
        const type = input.periodType ?? input.lease.period_type
        const price = input.pricePerPeriod ?? input.lease.price_per_period
        if (type !== input.lease.period_type || price !== input.lease.price_per_period) throw new Error(STAFF_TERMS_ERROR)
      }
      const typeSwitch = (input.makePermanent ?? false) && input.periodType !== undefined && input.periodType !== input.lease.period_type
      if (typeSwitch && !canWriteInvoiceStatus && invoicesToPinType(input.lease, input.existingInvoices, input.periodType).length > 0) {
        throw new Error('Hanya pemilik/admin yang dapat mengganti jenis sewa secara tetap (tagihan lama perlu ditandai jenisnya).')
      }
      if (await leaseStartMoved(input.lease)) {
        await invalidate('invoices', 'leases', 'lease_addons')
        throw new Error(LEASE_DATA_CHANGED_MESSAGE)
      }
      await assertExtensionFree(input)
      const { invoice, draft } = await insertFromDraft(
        {
          lease: input.lease,
          addons: input.addons,
          quantity: input.quantity,
          periodEnd: input.periodEnd,
          baseAmount: input.baseAmount,
          periodType: input.periodType,
          pricePerPeriod: input.pricePerPeriod,
          addonsAmount: input.addonsAmount,
          extraAmount: input.extraAmount,
          discountAmount: input.discountAmount,
          existingInvoices: input.existingInvoices,
          orgInvoices: input.orgInvoices,
        },
        input.notes,
      )
      // end_date follows the new invoice (SPEC 2b.10); a type/price switch made permanent updates the lease
      // terms and leaves a note (SPEC 5.2).
      const patch = extensionLeasePatch(input.lease, draft, input.makePermanent ?? false)
      if (patch) {
        try {
          if (patch.period_type !== undefined && patch.period_type !== input.lease.period_type) {
            // Old invoices storing null mean "the lease's type at the time": pin them before the lease changes.
            for (const inv of invoicesToPinType(input.lease, input.existingInvoices, patch.period_type)) {
              await repo.update('invoices', inv.id, { period_type: input.lease.period_type })
            }
          }
          await repo.update('leases', input.lease.id, patch)
          if (patch.period_type !== undefined && patch.period_type !== input.lease.period_type && input.addonAmounts) {
            // Per-period add-ons follow the new unit, so the next invoices bill them per new period.
            for (const u of addonAmountUpdates(input.addons, input.addonAmounts)) {
              await repo.update('lease_addons', u.id, { amount: u.amount })
            }
          }
        } catch (err) {
          await invalidate('invoices', 'leases', 'lease_addons')
          const detail = err instanceof Error ? err.message : 'kesalahan tak dikenal'
          throw new Error(`Tagihan ${invoice.invoice_number} sudah dibuat, tetapi data sewa gagal diperbarui: ${detail}`)
        }
      }
      await invalidate('invoices', 'leases', 'lease_addons')
      return invoice
    }

    async function recordRentPayment(input: RentPaymentInput): Promise<RentPaymentResult> {
      const { invoice, lease } = input
      if (invoice.status === 'void') throw new Error('Tagihan sudah dibatalkan.')
      if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Jumlah pembayaran harus lebih dari 0.')
      const paid = paidAmountFor(invoice.id, input.payments)
      let total = invoice.total_amount
      let outstanding = Math.max(0, total - paid)
      if (outstanding <= 0) throw new Error('Tagihan ini sudah lunas.')

      let rentAmount = input.amount
      let excess = 0
      if (input.amount < outstanding && input.settleWithDiscount) {
        if (!canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
        await assertInvoiceUnchanged(invoice)
        const diff = outstanding - input.amount
        total = total - diff
        await repo.update('invoices', invoice.id, {
          discount_amount: invoice.discount_amount + diff,
          total_amount: total,
        })
        outstanding = input.amount
      } else if (input.amount > outstanding) {
        if (!input.excessAsOther) throw new Error(`Jumlah melebihi sisa tagihan (${formatRupiah(outstanding)}).`)
        excess = input.amount - outstanding
        rentAmount = outstanding
      }

      const payment = await repo.insert('payments', {
        property_id: invoice.property_id,
        invoice_id: invoice.id,
        lease_id: lease.id,
        amount: rentAmount,
        paid_at: input.paidAt,
        method: input.method,
        kind: 'rent',
        notes: input.notes,
      })
      if (excess > 0) {
        await repo.insert('payments', {
          property_id: invoice.property_id,
          invoice_id: null,
          lease_id: lease.id,
          amount: excess,
          paid_at: input.paidAt,
          method: input.method,
          kind: 'other',
          notes: `Kelebihan pembayaran ${invoice.invoice_number}${input.notes ? ` – ${input.notes}` : ''}`,
        })
      }
      await syncInvoiceStatus(invoice.id)
      await invalidate('payments', 'invoices')
      return { payment, remaining: Math.max(0, outstanding - rentAmount), excessRecorded: excess }
    }

    async function recordDeposit(lease: Lease, amount: number, method: PaymentMethod, paidAt: string, notes: string | null): Promise<Payment> {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Jumlah harus lebih dari 0.')
      const payment = await repo.insert('payments', {
        property_id: lease.property_id,
        invoice_id: null,
        lease_id: lease.id,
        amount,
        paid_at: paidAt,
        method,
        kind: 'deposit',
        notes,
      })
      await invalidate('payments')
      return payment
    }

    /** `base_amount` (harga sewa of this invoice, SPEC 7.5) is optional: left out, the stored one stays. */
    async function updateInvoice(
      invoice: Invoice,
      payments: Payment[],
      patch: { extra_amount: number; discount_amount: number; notes: string | null; base_amount?: number },
    ): Promise<void> {
      if (!canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      const base = patch.base_amount ?? invoice.base_amount
      if (patch.extra_amount < 0 || patch.discount_amount < 0 || base < 0) throw new Error('Nilai tidak boleh negatif.')
      const total = base + invoice.addons_amount + patch.extra_amount - patch.discount_amount
      if (total < 0) throw new Error('Diskon melebihi jumlah tagihan.')
      const paid = paidAmountFor(invoice.id, payments)
      if (total < paid) throw new Error(`Total tagihan tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paid)}).`)
      await assertInvoiceUnchanged(invoice)
      await repo.update('invoices', invoice.id, {
        ...(base !== invoice.base_amount ? { base_amount: base } : {}),
        extra_amount: patch.extra_amount,
        discount_amount: patch.discount_amount,
        total_amount: total,
        notes: patch.notes,
        status: deriveInvoiceStatus(total, paid, invoice.status),
      })
      await invalidate('invoices')
    }

    /** After an invoice leaves the schedule, pull end_date back to the latest remaining period_end (never before start). */
    async function shrinkLeaseEnd(lease: Lease, remaining: Invoice[]): Promise<void> {
      if (lease.status !== 'active') return
      const covered = latestCoveredThrough(remaining)
      if (covered !== null && covered < lease.end_date) await repo.update('leases', lease.id, { end_date: covered })
    }

    /** Delete one row; when the delete is refused or finds nothing, refresh the table so the screen shows the truth. */
    async function removeRow(table: OrgTableName, id: string): Promise<void> {
      try {
        await repo.remove(table, id)
      } catch (err) {
        await invalidate(table)
        throw err
      }
    }

    async function voidInvoice(invoice: Invoice, lease: Lease, leaseInvoices: Invoice[], payments: Payment[]): Promise<void> {
      if (!canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      if (paidAmountFor(invoice.id, payments) > 0) throw new Error('Tagihan sudah memiliki pembayaran. Hapus pembayaran dulu atau kecilkan total lewat diskon.')
      await repo.update('invoices', invoice.id, { status: 'void' })
      await shrinkLeaseEnd(lease, leaseInvoices.filter((i) => i.id !== invoice.id))
      await invalidate('invoices', 'leases')
    }

    async function deleteInvoice(invoice: Invoice, lease: Lease, leaseInvoices: Invoice[], payments: Payment[]): Promise<void> {
      if (!canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      if (paidAmountFor(invoice.id, payments) > 0) throw new Error('Tagihan sudah memiliki pembayaran dan tidak dapat dihapus.')
      await removeRow('invoices', invoice.id)
      await shrinkLeaseEnd(lease, leaseInvoices.filter((i) => i.id !== invoice.id))
      await invalidate('invoices', 'leases')
    }

    /** SPEC 7.5: correct a payment's amount, date, method or note (owner/admin); the invoice status follows. */
    async function updatePayment(payment: Payment, patch: PaymentEditPatch, ctx: PaymentEditContext): Promise<void> {
      if (!isAdmin) throw new Error('Hanya pemilik/admin yang dapat mengubah pembayaran.')
      const error = validatePaymentEdit(payment, patch, ctx)
      if (error) throw new Error(error)
      await repo.update('payments', payment.id, { amount: patch.amount, paid_at: patch.paid_at, method: patch.method, notes: patch.notes })
      if (payment.invoice_id) await syncInvoiceStatus(payment.invoice_id)
      await invalidate('payments', 'invoices')
    }

    async function deletePayment(payment: Payment): Promise<void> {
      if (!isAdmin) throw new Error('Hanya pemilik/admin yang dapat menghapus pembayaran.')
      await removeRow('payments', payment.id)
      if (payment.invoice_id) await syncInvoiceStatus(payment.invoice_id)
      await invalidate('payments', 'invoices')
    }

    /** `allocations` = settlement.rent spread over open invoices (allocateAcrossInvoices), computed before any write. */
    async function settleDeposit(lease: Lease, s: DepositSettlement, dateISO: string, allocations: Allocation[]): Promise<void> {
      if (s.refund > 0) {
        await repo.insert('expenses', {
          property_id: lease.property_id,
          lease_id: lease.id,
          category: 'deposit_refund',
          amount: s.refund,
          expense_date: dateISO,
          description: 'Pengembalian uang jaminan',
          vendor: null,
          receipt_path: null,
        })
      }
      for (const a of allocations) {
        await repo.insert('payments', {
          property_id: a.invoice.property_id,
          invoice_id: a.invoice.id,
          lease_id: lease.id,
          amount: a.amount,
          paid_at: dateISO,
          method: 'deposit',
          kind: 'rent',
          notes: 'Potong jaminan untuk sewa',
        })
        await syncInvoiceStatus(a.invoice.id)
      }
      if (s.damage > 0) {
        await repo.insert('payments', {
          property_id: lease.property_id,
          invoice_id: null,
          lease_id: lease.id,
          amount: s.damage,
          paid_at: dateISO,
          method: 'deposit',
          kind: 'other',
          notes: `Potongan jaminan: ${s.damageNotes.trim()}`,
        })
      }
    }

    /**
     * Re-read the lease's invoices and the payments of the touched ones right before a checkout/cancel writes. When
     * another device changed them since the screen loaded, nothing is written (leaseDataChanged, or the start date was
     * corrected meanwhile: leaseStartMoved); otherwise the fresh invoice rows are returned for the patches.
     */
    async function freshLeaseInvoices(lease: Lease, invoices: Invoice[], payments: Payment[], touched: Invoice[]): Promise<Invoice[]> {
      if (await leaseStartMoved(lease)) throw new Error(LEASE_DATA_CHANGED_MESSAGE)
      const fresh = await repo.list('invoices', { where: { lease_id: lease.id } })
      const ids = [...new Set(touched.map((i) => i.id))]
      const freshPayments = ids.length > 0 ? await repo.list('payments', { where: { invoice_id: ids } }) : []
      if (leaseDataChanged(lease.id, invoices, payments, touched, fresh, freshPayments)) throw new Error(LEASE_DATA_CHANGED_MESSAGE)
      return fresh
    }

    /**
     * Invoice writes of a checkout/cancel (closingInvoiceWrites: closes, then voids), all of them before any expense
     * or payment insert. A partially paid invoice is closed per decision, never voided (SPEC 2b.4).
     */
    async function closeInvoices(writes: InvoiceWrite[]): Promise<void> {
      for (const w of writes) await repo.update('invoices', w.id, w.patch)
    }

    /**
     * 'refund': one rent_refund expense (+ lease_id) per refunded invoice. Existing refunds are read fresh, so a
     * retry after a failure never records one twice and still records one an earlier attempt missed.
     */
    async function recordRentRefunds(lease: Lease, refundedNow: Invoice[], invoices: Invoice[], payments: Payment[], dateISO: string, reason: string): Promise<void> {
      if (rentRefundsToRecord(lease.id, refundedNow, invoices, payments, []).length === 0) return
      const existing = await repo.list('expenses', { where: { lease_id: lease.id, category: 'rent_refund' } })
      for (const r of rentRefundsToRecord(lease.id, refundedNow, invoices, payments, existing)) {
        await repo.insert('expenses', rentRefundExpense(lease, r.invoice, r.amount, dateISO, reason))
      }
    }

    function requireDecisions(partial: Invoice[], decisions: Record<string, PartialDecision>): void {
      for (const inv of partial) {
        if (!decisions[inv.id]) throw new Error(`Pilih penyelesaian untuk tagihan ${inv.invoice_number}.`)
      }
    }

    /** Invoices already closed by a refund ('DP dikembalikan'): recordRentRefunds may still record theirs. */
    function refundNoted(lease: Lease, invoices: Invoice[], payments: Payment[]): Invoice[] {
      return unrecordedRentRefunds(lease.id, invoices, payments, []).map((r) => r.invoice)
    }

    /**
     * SPEC 2b.5 + 7.3. Invoices whose period starts on or after the checkout date (the day the tenant leaves, so
     * that night is not theirs): unpaid -> void; partially paid -> the caller's decision (refund / forfeit) so no
     * receivable survives on an ended lease; fully paid are left as they are. Invoices starting before the checkout
     * date stay receivable and may absorb the deposit (settlement.rent). Everything is checked before the first write.
     * end_date = the last night: min(end_date, checkout_date - 1), never before start_date (cancelledLeaseEndDate);
     * screens show an ended lease's checkout_date itself.
     */
    async function checkout(input: CheckoutInput): Promise<void> {
      const { lease, checkoutDate, invoices, payments, settlement, partialDecisions } = input
      if (!checkoutDate) throw new Error('Tanggal checkout wajib diisi.')
      if (checkoutDate < lease.start_date) throw new Error('Tanggal checkout tidak boleh sebelum tanggal mulai sewa.')
      const future = futureInvoicesAtCheckout(lease.id, invoices, payments, checkoutDate)
      if ((future.toVoid.length > 0 || future.partial.length > 0) && !canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      requireDecisions(future.partial, partialDecisions)
      const closedIds = new Set([...future.toVoid, ...future.partial].map((i) => i.id))
      const open = openInvoicesSorted(lease.id, invoices, payments).filter((i) => !closedIds.has(i.id))
      const allocations = settlement.rent > 0 ? allocateAcrossInvoices(settlement.rent, open, payments) : []
      const refunded = future.partial.filter((inv) => partialDecisions[inv.id] === 'refund')
      const touched = [...future.toVoid, ...future.partial, ...allocations.map((a) => a.invoice), ...refundNoted(lease, invoices, payments)]
      try {
        const fresh = await freshLeaseInvoices(lease, invoices, payments, touched)
        await closeInvoices(closingInvoiceWrites(future.toVoid, future.partial, fresh, payments, partialDecisions, 'checkout'))
        await recordRentRefunds(lease, refunded, invoices, payments, checkoutDate, 'checkout')
        await settleDeposit(lease, settlement, checkoutDate, allocations)
        await repo.update('leases', lease.id, {
          status: 'ended',
          checkout_date: checkoutDate,
          end_date: cancelledLeaseEndDate(lease, checkoutDate),
        })
      } finally {
        // also after a failure, so the screen shows what was saved
        await invalidate('leases', 'invoices', 'payments', 'expenses')
      }
    }

    /** SPEC 2b.4: void unpaid invoices, close partial ones per decision, settle the deposit, status cancelled. */
    async function cancelLease(input: CancelInput): Promise<void> {
      const { lease, invoices, payments, partialDecisions, settlement, dateISO } = input
      if (!dateISO) throw new Error('Tanggal pembatalan wajib diisi.')
      const live = invoices.filter((inv) => inv.lease_id === lease.id && inv.status !== 'void')
      const unpaid = live.filter((inv) => paidAmountFor(inv.id, payments) === 0)
      const partial = live.filter((inv) => {
        const paid = paidAmountFor(inv.id, payments)
        return paid > 0 && paid < inv.total_amount
      })
      if ((unpaid.length > 0 || partial.length > 0) && !canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      requireDecisions(partial, partialDecisions)
      // nothing stays open on a cancelled lease: deposit for rent is refused here, before any write
      const allocations = settlement.rent > 0 ? allocateAcrossInvoices(settlement.rent, [], payments) : []
      const refunded = partial.filter((inv) => partialDecisions[inv.id] === 'refund')
      const touched = [...unpaid, ...partial, ...refundNoted(lease, invoices, payments)]
      try {
        const fresh = await freshLeaseInvoices(lease, invoices, payments, touched)
        await closeInvoices(closingInvoiceWrites(unpaid, partial, fresh, payments, partialDecisions, 'sewa dibatalkan'))
        await recordRentRefunds(lease, refunded, invoices, payments, dateISO, 'sewa dibatalkan')
        await settleDeposit(lease, settlement, dateISO, allocations)
        // the cancel date is a check-out day: end_date = the night before, never below start_date (DB check constraint)
        await repo.update('leases', lease.id, { status: 'cancelled', end_date: cancelledLeaseEndDate(lease, dateISO) })
      } finally {
        await invalidate('leases', 'invoices', 'payments', 'expenses')
      }
    }

    async function moveRoom(lease: Lease, fromRoom: Room | undefined, toRoom: Room, newPrice: number | null, dateISO: string): Promise<void> {
      const priceChanged = newPrice !== null && newPrice !== lease.price_per_period
      if (priceChanged && !canEditLeaseTerms) throw new Error(STAFF_TERMS_ERROR)
      // the dialog's check (roomAvailability) again on fresh rows: another phone may have booked or filled the room since
      // the screen was read, and the database guard does not check room moves (SPEC 2b.9, 7.7)
      const target = (await repo.get('rooms', toRoom.id)) ?? toRoom
      const targetLeases = await repo.list('leases', { where: { room_id: toRoom.id } })
      const availability = roomAvailability(target, targetLeases, dateISO, lease.end_date >= dateISO ? lease.end_date : dateISO, lease.id)
      if (availability !== 'kosong') {
        await invalidate('leases', 'rooms')
        throw new Error(`Kamar ${toRoom.name} sudah tidak kosong (${ROOM_AVAILABILITY_LABEL[availability]}). Datanya baru saja berubah di HP lain: muat ulang lalu pilih kamar lain.`)
      }
      await repo.update('leases', lease.id, {
        room_id: toRoom.id,
        // only sent when it changes: staff may move rooms but the database refuses any price change by them
        ...(priceChanged ? { price_per_period: newPrice } : {}),
        notes: appendMoveNote(lease.notes, fromRoom?.name ?? '?', toRoom.name, dateISO),
      })
      await invalidate('leases')
    }

    async function addAddon(lease: Lease, name: string, amount: number, billing: AddonBilling): Promise<void> {
      if (!name.trim()) throw new Error('Nama add-on wajib diisi.')
      await repo.insert('lease_addons', { lease_id: lease.id, name: name.trim(), amount, billing })
      await invalidate('lease_addons')
    }

    async function removeAddon(addon: LeaseAddon): Promise<void> {
      await removeRow('lease_addons', addon.id)
      await invalidate('lease_addons')
    }

    async function updateLeaseNotes(lease: Lease, notes: string | null): Promise<void> {
      await repo.update('leases', lease.id, { notes })
      await invalidate('leases')
    }

    /**
     * SPEC 7.11 Nomor kendaraan: set the tenant's plate(s) on this lease as typed (stored as normalizePlate writes them),
     * or clear them ('' / null). Front-desk work, so staff may do it; not a lease term (leases_terms_guard ignores it).
     */
    async function setVehiclePlate(lease: Lease, plate: string | null): Promise<Lease> {
      try {
        return await repo.update('leases', lease.id, { vehicle_plate: normalizePlate(plate) })
      } finally {
        // also after a refusal, so the screen shows what is stored now
        await invalidate('leases')
      }
    }

    /**
     * SPEC 7.8 Rencana keluar: record the CHECK-OUT day the tenant said he will leave (`checkoutDay`), or clear the plan
     * (null). Front-desk work, so staff may do it; it is not a lease term: billing, end_date, the room and the price stay
     * as they are, and the checkout itself is still recorded when he leaves. The lease is read fresh first: one that was
     * checked out or cancelled on another device meanwhile is refused, and the day must be after its (fresh) start.
     * Cancelling the plan or moving it later gives nights after his billed period back to him: when another booking of
     * the room (made because the plan freed it) takes one of them, it is refused before writing, naming that booking —
     * neither LocalRepo nor the database guard watch this column.
     */
    async function setPlannedCheckout(lease: Lease, checkoutDay: string | null): Promise<Lease> {
      try {
        const fresh = await repo.get('leases', lease.id)
        if (!fresh) throw new Error('Sewa tidak ditemukan.')
        if (fresh.status !== 'active') throw new Error(PLANNED_CHECKOUT_INACTIVE_MESSAGE)
        const error = checkoutDay === null ? null : plannedCheckoutError(fresh, checkoutDay)
        if (error) throw new Error(error)
        const today = todayISO()
        const nights = plannedCheckoutHeldNights(fresh, checkoutDay, today)
        if (nights) {
          // earliest first, so the refusal names the first booking in the way (and the latest day that still works)
          const roomLeases = (await repo.list('leases', { where: { room_id: fresh.room_id } })).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))
          const other = overlappingLease(roomLeases, fresh.room_id, nights.from, nights.to, fresh.id)
          if (other) {
            const tenant = await repo.get('tenants', other.tenant_id).catch(() => null)
            const room = await repo.get('rooms', fresh.room_id).catch(() => null)
            throw new Error(plannedCheckoutBookedMessage(room?.name ?? null, other, tenant?.full_name ?? null, checkoutDay, nights.from, today))
          }
        }
        return await repo.update('leases', lease.id, { planned_checkout_date: checkoutDay })
      } finally {
        // also after a refusal, so the screen shows what is stored now
        await invalidate('leases')
      }
    }

    /**
     * SPEC 7.6: move an active lease (reservations included) and every one of its invoices to the right start date.
     * Staff and ended/cancelled leases are refused before any read or write. The lease, its invoices and the room's
     * leases are read fresh; when they no longer match what the dialog previewed (redateDataChanged) nothing is written.
     * The plan is rebuilt from the fresh rows (planLeaseRedate) and written in ONE operation (repo.redateLease: the
     * redate_lease RPC online, one LocalRepo write in Mode Demo), which refuses again when the start or the invoice list
     * changed in between. Payments, amounts, numbers and statuses are never touched.
     */
    async function redateLease(input: RedateLeaseActionInput): Promise<LeaseRedatePlan> {
      if (!canEditLeaseTerms) throw new Error(REDATE_STAFF_MESSAGE)
      if (input.lease.status !== 'active') throw new Error(REDATE_INACTIVE_MESSAGE)
      try {
        const fresh = await repo.get('leases', input.lease.id)
        const freshInvoices = await repo.list('invoices', { where: { lease_id: input.lease.id } })
        if (!fresh || redateDataChanged(input.lease, input.invoices, fresh, freshInvoices)) throw new Error(LEASE_DATA_CHANGED_MESSAGE)
        const roomLeases = await repo.list('leases', { where: { room_id: fresh.room_id } })
        const plan = planLeaseRedate(fresh, freshInvoices, input.newStart, { leases: roomLeases, tenants: input.tenants })
        if (plan.error) throw new Error(plan.error)
        await repo.redateLease({
          leaseId: fresh.id,
          expectedStart: fresh.start_date,
          newStart: plan.lease.start_date,
          newEnd: plan.lease.end_date,
          invoices: plan.patches,
          note: redateNoteLine(fresh.start_date, plan.lease.start_date, input.today ?? todayISO(), input.reason),
        })
        return plan
      } catch (err) {
        if (err instanceof StaleWriteError) throw new Error(LEASE_DATA_CHANGED_MESSAGE)
        throw err
      } finally {
        // also after a refusal, so the screen shows what is stored now
        await invalidate('leases', 'invoices')
      }
    }

    return {
      isAdmin,
      canWriteInvoiceStatus,
      canEditInvoices,
      canEditLeaseTerms,
      syncInvoiceStatus,
      insertFromDraft,
      issueInvoice,
      recordRentPayment,
      recordDeposit,
      updateInvoice,
      voidInvoice,
      deleteInvoice,
      updatePayment,
      deletePayment,
      checkout,
      cancelLease,
      moveRoom,
      addAddon,
      removeAddon,
      updateLeaseNotes,
      setVehiclePlate,
      setPlannedCheckout,
      redateLease,
    }
  }, [repo, role, invalidate])
}

export type LeaseActions = ReturnType<typeof useLeaseActions>
