/**
 * Multi-step writes of the leases module. Every function performs its repo calls sequentially, keeps the
 * derived data consistent (SPEC 2b: invoices.status via deriveInvoiceStatus, leases.end_date on issue/void)
 * and invalidates the affected tables at the end. Money/date rules are delegated to src/domain.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { AddonBilling, Invoice, Lease, LeaseAddon, Payment, PaymentMethod, PeriodType, Room } from '../../types/db'
import {
  buildInvoiceDraft,
  deriveInvoiceStatus,
  latestCoveredThrough,
  paidAmountFor,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '../../domain/billing'
import { formatRupiah } from '../../lib/format'
import {
  addonAmountUpdates,
  allocateAcrossInvoices,
  appendMoveNote,
  cancelledLeaseEndDate,
  extensionLeasePatch,
  futureInvoicesAtCheckout,
  invoiceInsertFromDraft,
  invoicesToPinType,
  openInvoicesSorted,
  type DepositSettlement,
} from './leaseUtils'

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

export type PartialDecision = 'refund' | 'forfeit'

export interface CheckoutInput {
  lease: Lease
  checkoutDate: string
  invoices: Invoice[]
  payments: Payment[]
  settlement: DepositSettlement
  /** decision per partially-paid invoice whose period starts after the checkout date (see futureInvoicesAtCheckout) */
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

function minISO(a: string, b: string): string {
  return a <= b ? a : b
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

    async function updateInvoice(invoice: Invoice, payments: Payment[], patch: { extra_amount: number; discount_amount: number; notes: string | null }): Promise<void> {
      if (!canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      if (patch.extra_amount < 0 || patch.discount_amount < 0) throw new Error('Nilai tidak boleh negatif.')
      const total = invoice.base_amount + invoice.addons_amount + patch.extra_amount - patch.discount_amount
      if (total < 0) throw new Error('Diskon melebihi jumlah tagihan.')
      const paid = paidAmountFor(invoice.id, payments)
      if (total < paid) throw new Error(`Total tagihan tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paid)}).`)
      await repo.update('invoices', invoice.id, {
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
      await repo.remove('invoices', invoice.id)
      await shrinkLeaseEnd(lease, leaseInvoices.filter((i) => i.id !== invoice.id))
      await invalidate('invoices', 'leases')
    }

    async function deletePayment(payment: Payment): Promise<void> {
      if (!isAdmin) throw new Error('Hanya pemilik/admin yang dapat menghapus pembayaran.')
      await repo.remove('payments', payment.id)
      if (payment.invoice_id) await syncInvoiceStatus(payment.invoice_id)
      await invalidate('payments', 'invoices')
    }

    async function settleDeposit(lease: Lease, s: DepositSettlement, dateISO: string, openInvoices: Invoice[], payments: Payment[]): Promise<void> {
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
      if (s.rent > 0) {
        const allocations = allocateAcrossInvoices(s.rent, openInvoices, payments)
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
     * Close a partially-paid invoice that will never be owed in full (SPEC 2b.4; also used for invoices after the
     * checkout date): 'refund' = expense rent_refund (+ lease_id) for the paid part and void the invoice;
     * 'forfeit' = the remaining amount becomes discount, total = paid, status paid (the DP stays revenue).
     */
    async function resolvePartialInvoice(lease: Lease, inv: Invoice, paid: number, decision: PartialDecision | undefined, dateISO: string, reason: string): Promise<void> {
      if (!decision) throw new Error(`Pilih penyelesaian untuk tagihan ${inv.invoice_number}.`)
      if (decision === 'refund') {
        await repo.insert('expenses', {
          property_id: lease.property_id,
          lease_id: lease.id,
          category: 'rent_refund',
          amount: paid,
          expense_date: dateISO,
          description: `Pengembalian DP tagihan ${inv.invoice_number} (${reason})`,
          vendor: null,
          receipt_path: null,
        })
        await repo.update('invoices', inv.id, { status: 'void' })
      } else {
        const remaining = inv.total_amount - paid
        await repo.update('invoices', inv.id, {
          discount_amount: inv.discount_amount + remaining,
          total_amount: paid,
          status: 'paid',
          notes: [inv.notes, `Sisa dianggap hangus (${reason})`].filter(Boolean).join('\n'),
        })
      }
    }

    /**
     * SPEC 2b.5. Invoices whose period starts after the checkout date: unpaid -> void; partially paid -> the
     * caller's decision (refund / forfeit) so no receivable survives on an ended lease; fully paid are left as
     * they are. Invoices up to the checkout date stay receivable and may absorb the deposit (settlement.rent).
     */
    async function checkout(input: CheckoutInput): Promise<void> {
      const { lease, checkoutDate, invoices, payments, settlement, partialDecisions } = input
      if (!checkoutDate) throw new Error('Tanggal checkout wajib diisi.')
      if (checkoutDate < lease.start_date) throw new Error('Tanggal checkout tidak boleh sebelum tanggal mulai sewa.')
      const future = futureInvoicesAtCheckout(lease.id, invoices, payments, checkoutDate)
      if ((future.toVoid.length > 0 || future.partial.length > 0) && !canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      for (const inv of future.partial) {
        if (!partialDecisions[inv.id]) throw new Error(`Pilih penyelesaian untuk tagihan ${inv.invoice_number}.`)
      }
      for (const inv of future.toVoid) await repo.update('invoices', inv.id, { status: 'void' })
      for (const inv of future.partial) await resolvePartialInvoice(lease, inv, paidAmountFor(inv.id, payments), partialDecisions[inv.id], checkoutDate, 'checkout')
      const closedIds = new Set([...future.toVoid, ...future.partial].map((i) => i.id))
      const open = openInvoicesSorted(lease.id, invoices, payments).filter((i) => !closedIds.has(i.id))
      await settleDeposit(lease, settlement, checkoutDate, open, payments)
      await repo.update('leases', lease.id, {
        status: 'ended',
        checkout_date: checkoutDate,
        end_date: minISO(lease.end_date, checkoutDate),
      })
      await invalidate('leases', 'invoices', 'payments', 'expenses')
    }

    async function cancelLease(input: CancelInput): Promise<void> {
      const { lease, invoices, payments, partialDecisions, settlement, dateISO } = input
      if (!dateISO) throw new Error('Tanggal pembatalan wajib diisi.')
      const touchesInvoices = invoices.some((inv) => inv.lease_id === lease.id && inv.status !== 'void' && paidAmountFor(inv.id, payments) < inv.total_amount)
      if (touchesInvoices && !canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      for (const inv of invoices) {
        if (inv.lease_id !== lease.id || inv.status === 'void') continue
        const paid = paidAmountFor(inv.id, payments)
        if (paid === 0) {
          await repo.update('invoices', inv.id, { status: 'void' })
        } else if (paid < inv.total_amount) {
          await resolvePartialInvoice(lease, inv, paid, partialDecisions[inv.id], dateISO, 'sewa dibatalkan')
        }
      }
      await settleDeposit(lease, settlement, dateISO, [], payments)
      // end_date never drops below start_date (DB check constraint) when a lease that has not started is cancelled.
      await repo.update('leases', lease.id, { status: 'cancelled', end_date: cancelledLeaseEndDate(lease, dateISO) })
      await invalidate('leases', 'invoices', 'payments', 'expenses')
    }

    async function moveRoom(lease: Lease, fromRoom: Room | undefined, toRoom: Room, newPrice: number | null, dateISO: string): Promise<void> {
      const priceChanged = newPrice !== null && newPrice !== lease.price_per_period
      if (priceChanged && !canEditLeaseTerms) throw new Error(STAFF_TERMS_ERROR)
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
      await repo.remove('lease_addons', addon.id)
      await invalidate('lease_addons')
    }

    async function updateLeaseNotes(lease: Lease, notes: string | null): Promise<void> {
      await repo.update('leases', lease.id, { notes })
      await invalidate('leases')
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
      deletePayment,
      checkout,
      cancelLease,
      moveRoom,
      addAddon,
      removeAddon,
      updateLeaseNotes,
    }
  }, [repo, role, invalidate])
}

export type LeaseActions = ReturnType<typeof useLeaseActions>
