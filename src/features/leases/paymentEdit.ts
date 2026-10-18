/**
 * Ubah pembayaran (SPEC 7.5): correct the amount, date, method or note of a payment that was recorded by mistake.
 * Owner/admin only (the database allows payment updates for admins only). The invoice it pays, and whether it is
 * rent, deposit or other income, stay as they are: a payment on the wrong invoice is deleted and recorded again.
 */
import { depositBalance, outstandingFor } from '../../domain/billing'
import { formatRupiah } from '../../lib/format'
import type { Expense, Invoice, Lease, Payment, PaymentMethod } from '../../types/db'

export interface PaymentEditPatch {
  amount: number
  paid_at: string
  method: PaymentMethod
  notes: string | null
}

/**
 * A rent payment taken from the deposit ("potong jaminan", method 'deposit') moves money between the deposit and
 * the invoice: its amount and method are locked here (delete and record again), only date and note can change.
 */
export function paymentEditLocks(payment: Pick<Payment, 'method'>): { amount: boolean; method: boolean } {
  const fromDeposit = payment.method === 'deposit'
  return { amount: fromDeposit, method: fromDeposit }
}

export interface PaymentEditContext {
  /** the invoice the payment pays (rent), else null */
  invoice: Invoice | null
  /** all payments of the org or lease (the edited one included, as stored) */
  payments: Payment[]
  /** the lease, for deposit payments */
  lease: Lease | null
  expenses: Expense[]
}

export function validatePaymentEdit(payment: Payment, patch: PaymentEditPatch, ctx: PaymentEditContext): string | null {
  if (!Number.isInteger(patch.amount) || patch.amount <= 0) return 'Jumlah pembayaran harus lebih dari 0.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.paid_at)) return 'Isi tanggal bayar.'
  const locks = paymentEditLocks(payment)
  if (locks.amount && patch.amount !== payment.amount) return 'Pembayaran dari jaminan tidak bisa diubah jumlahnya: hapus lalu catat ulang.'
  if (locks.method && patch.method !== payment.method) return 'Metode pembayaran dari jaminan tidak bisa diubah: hapus lalu catat ulang.'
  if (!locks.method && patch.method === 'deposit') return 'Potong jaminan dicatat lewat Bayar, bukan dengan mengubah pembayaran.'

  // the edited payment counts with its new amount in every total below
  const others = ctx.payments.filter((p) => p.id !== payment.id)
  if (payment.kind === 'rent' && ctx.invoice) {
    const room = outstandingFor(ctx.invoice, others)
    if (patch.amount > room) return `Jumlah melebihi sisa tagihan ${ctx.invoice.invoice_number} (${formatRupiah(room)}).`
  }
  if (payment.kind === 'deposit' && ctx.lease) {
    const after = depositBalance(ctx.lease, [...others, { ...payment, amount: patch.amount }], ctx.expenses)
    if (after.held < 0) {
      const used = after.applied + after.returned
      return `Jaminan yang sudah dipakai/dikembalikan (${formatRupiah(used)}) lebih besar dari jumlah ini.`
    }
  }
  return null
}

/** True when nothing would change (Simpan stays off). */
export function isSamePayment(payment: Payment, patch: PaymentEditPatch): boolean {
  return patch.amount === payment.amount && patch.paid_at === payment.paid_at && patch.method === payment.method && (patch.notes ?? null) === (payment.notes ?? null)
}
