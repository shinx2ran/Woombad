/**
 * Multi-step writes of the leases module. Every function performs its repo calls sequentially, keeps the
 * derived data consistent (SPEC 2b: invoices.status via deriveInvoiceStatus, leases.end_date on issue/void)
 * and invalidates the affected tables at the end. Money/date rules are delegated to src/domain.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { AddonBilling, Invoice, Lease, LeaseAddon, Payment, PaymentMethod, Room } from '../../types/db'
import {
  buildInvoiceDraft,
  deriveInvoiceStatus,
  latestCoveredThrough,
  paidAmountFor,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '../../domain/billing'
import { formatRupiah } from '../../lib/format'
import { allocateAcrossInvoices, appendMoveNote, openInvoicesSorted, type DepositSettlement } from './leaseUtils'

export interface IssueInvoiceInput {
  lease: Lease
  addons: LeaseAddon[]
  quantity: number
  periodEnd?: string
  baseAmount?: number
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
}

export type PartialDecision = 'refund' | 'forfeit'

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
    // In Supabase mode a trigger maintains invoices.status and staff cannot update invoices (RLS);
    // in demo mode the UI must persist the derived status itself (SPEC section 3).
    const canWriteInvoiceStatus = repo.mode === 'local' || role !== 'staff'
    // Staff may never edit/void invoices (SPEC section 3); the UI hides those actions and the actions refuse them.
    const canEditInvoices = role !== 'staff'
    const STAFF_INVOICE_ERROR = 'Hanya admin yang boleh mengubah tagihan.'

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
          const invoice = await repo.insert('invoices', {
            property_id: input.lease.property_id,
            lease_id: input.lease.id,
            invoice_number: draft.invoice_number,
            period_start: draft.period_start,
            period_end: draft.period_end,
            quantity: draft.quantity,
            base_amount: draft.base_amount,
            addons_amount: draft.addons_amount,
            extra_amount: draft.extra_amount,
            discount_amount: draft.discount_amount,
            total_amount: draft.total_amount,
            due_date: draft.due_date,
            status: deriveInvoiceStatus(draft.total_amount, 0, 'unpaid'),
            notes,
          })
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
      const { invoice, draft } = await insertFromDraft(
        {
          lease: input.lease,
          addons: input.addons,
          quantity: input.quantity,
          periodEnd: input.periodEnd,
          baseAmount: input.baseAmount,
          extraAmount: input.extraAmount,
          discountAmount: input.discountAmount,
          existingInvoices: input.existingInvoices,
          orgInvoices: input.orgInvoices,
        },
        input.notes,
      )
      if (draft.new_lease_end_date !== input.lease.end_date) {
        await repo.update('leases', input.lease.id, { end_date: draft.new_lease_end_date })
      }
      await invalidate('invoices', 'leases')
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
      if (paidAmountFor(invoice.id, payments) > 0) throw new Error('Tagihan sudah memiliki pembayaran dan tidak dapat dihapus.')
      await repo.remove('invoices', invoice.id)
      await shrinkLeaseEnd(lease, leaseInvoices.filter((i) => i.id !== invoice.id))
      await invalidate('invoices', 'leases')
    }

    async function deletePayment(payment: Payment): Promise<void> {
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

    /** Unpaid (no payment at all) invoices of the lease that start after the checkout date (SPEC 2b.5). */
    function invoicesToVoidAtCheckout(lease: Lease, invoices: Invoice[], payments: Payment[], checkoutDate: string): Invoice[] {
      return invoices.filter(
        (inv) => inv.lease_id === lease.id && inv.status !== 'void' && inv.period_start > checkoutDate && paidAmountFor(inv.id, payments) === 0,
      )
    }

    async function checkout(input: CheckoutInput): Promise<void> {
      const { lease, checkoutDate, invoices, payments, settlement } = input
      const toVoid = invoicesToVoidAtCheckout(lease, invoices, payments, checkoutDate)
      if (toVoid.length > 0 && !canEditInvoices) throw new Error(STAFF_INVOICE_ERROR)
      for (const inv of toVoid) await repo.update('invoices', inv.id, { status: 'void' })
      const voidIds = new Set(toVoid.map((i) => i.id))
      const open = openInvoicesSorted(lease.id, invoices, payments).filter((i) => !voidIds.has(i.id))
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
      for (const inv of invoices) {
        if (inv.lease_id !== lease.id || inv.status === 'void') continue
        const paid = paidAmountFor(inv.id, payments)
        if (paid === 0) {
          await repo.update('invoices', inv.id, { status: 'void' })
        } else if (paid < inv.total_amount) {
          const decision = partialDecisions[inv.id]
          if (!decision) throw new Error(`Pilih penyelesaian untuk tagihan ${inv.invoice_number}.`)
          if (decision === 'refund') {
            await repo.insert('expenses', {
              property_id: lease.property_id,
              lease_id: lease.id,
              category: 'rent_refund',
              amount: paid,
              expense_date: dateISO,
              description: `Pengembalian DP tagihan ${inv.invoice_number} (sewa dibatalkan)`,
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
              notes: [inv.notes, 'Sisa dianggap hangus (sewa dibatalkan)'].filter(Boolean).join('\n'),
            })
          }
        }
      }
      await settleDeposit(lease, settlement, dateISO, [], payments)
      await repo.update('leases', lease.id, { status: 'cancelled', end_date: minISO(lease.end_date, dateISO) })
      await invalidate('leases', 'invoices', 'payments', 'expenses')
    }

    async function moveRoom(lease: Lease, fromRoom: Room | undefined, toRoom: Room, newPrice: number | null, dateISO: string): Promise<void> {
      await repo.update('leases', lease.id, {
        room_id: toRoom.id,
        price_per_period: newPrice ?? lease.price_per_period,
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
      canWriteInvoiceStatus,
      canEditInvoices,
      syncInvoiceStatus,
      insertFromDraft,
      issueInvoice,
      recordRentPayment,
      recordDeposit,
      updateInvoice,
      voidInvoice,
      deleteInvoice,
      deletePayment,
      invoicesToVoidAtCheckout,
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
