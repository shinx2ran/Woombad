import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Lease, Payment } from '../../types/db'
import { isSamePayment, paymentEditLocks, validatePaymentEdit, type PaymentEditPatch } from './paymentEdit'

const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const invoice: Invoice = {
  id: 'i1', property_id: 'p1', lease_id: 'l1', invoice_number: 'INV-1', period_type: null, period_start: '2026-10-01', period_end: '2026-10-31',
  quantity: 1, base_amount: 1_500_000, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: 1_500_000, due_date: '2026-10-01',
  status: 'partial', notes: null, ...ts,
}
const lease: Lease = {
  id: 'l1', property_id: 'p1', room_id: 'r1', tenant_id: 't1', period_type: 'monthly', price_per_period: 1_500_000, deposit_amount: 1_000_000,
  start_date: '2026-10-01', end_date: '2026-10-31', status: 'active', checkout_date: null, notes: null, ...ts,
}
const pay = (over: Partial<Payment>): Payment => ({
  id: 'pay1', property_id: 'p1', invoice_id: 'i1', lease_id: 'l1', amount: 500_000, paid_at: '2026-10-02', method: 'transfer', kind: 'rent',
  notes: null, created_by: null, org_id: 'org', created_at: ts.created_at, ...over,
})
const patch = (p: Payment, over: Partial<PaymentEditPatch> = {}): PaymentEditPatch => ({ amount: p.amount, paid_at: p.paid_at, method: p.method, notes: p.notes, ...over })

describe('validatePaymentEdit (SPEC 7.5)', () => {
  const dp = pay({})
  const other = pay({ id: 'pay2', amount: 300_000 })
  const ctx = { invoice, payments: [dp, other], lease, expenses: [] as Expense[] }

  it('a rent payment may grow up to what the invoice still owes without it', () => {
    // 1.500.000 - 300.000 (the other payment) = 1.200.000
    expect(validatePaymentEdit(dp, patch(dp, { amount: 1_200_000 }), ctx)).toBeNull()
    expect(validatePaymentEdit(dp, patch(dp, { amount: 1_200_001 }), ctx)).toBe('Jumlah melebihi sisa tagihan INV-1 (Rp 1.200.000).')
    expect(validatePaymentEdit(dp, patch(dp, { amount: 0 }), ctx)).toBe('Jumlah pembayaran harus lebih dari 0.')
    expect(validatePaymentEdit(dp, patch(dp, { paid_at: '' }), ctx)).toBe('Isi tanggal bayar.')
  })

  it('date, method and note can change; switching to "potong jaminan" cannot', () => {
    expect(validatePaymentEdit(dp, patch(dp, { paid_at: '2026-10-05', method: 'cash', notes: 'koreksi' }), ctx)).toBeNull()
    expect(validatePaymentEdit(dp, patch(dp, { method: 'deposit' }), ctx)).toMatch(/Potong jaminan dicatat lewat Bayar/)
  })

  it('a payment taken from the deposit keeps its amount and method', () => {
    const fromDeposit = pay({ id: 'pay3', method: 'deposit' })
    expect(paymentEditLocks(fromDeposit)).toEqual({ amount: true, method: true })
    expect(paymentEditLocks(dp)).toEqual({ amount: false, method: false })
    const c = { ...ctx, payments: [fromDeposit] }
    expect(validatePaymentEdit(fromDeposit, patch(fromDeposit, { paid_at: '2026-10-09' }), c)).toBeNull()
    expect(validatePaymentEdit(fromDeposit, patch(fromDeposit, { amount: 400_000 }), c)).toMatch(/hapus lalu catat ulang/)
    expect(validatePaymentEdit(fromDeposit, patch(fromDeposit, { method: 'cash' }), c)).toMatch(/hapus lalu catat ulang/)
  })

  it('a deposit received cannot drop below what was already taken from it or returned', () => {
    const received = pay({ id: 'dep', invoice_id: null, kind: 'deposit', method: 'cash', amount: 1_000_000 })
    const usedForRent = pay({ id: 'use', method: 'deposit', amount: 600_000 })
    const c = { invoice: null, payments: [received, usedForRent], lease, expenses: [] as Expense[] }
    expect(validatePaymentEdit(received, patch(received, { amount: 600_000 }), c)).toBeNull()
    expect(validatePaymentEdit(received, patch(received, { amount: 500_000 }), c)).toBe('Jaminan yang sudah dipakai/dikembalikan (Rp 600.000) lebih besar dari jumlah ini.')
  })

  it('knows when nothing changed', () => {
    expect(isSamePayment(dp, patch(dp))).toBe(true)
    expect(isSamePayment(dp, patch(dp, { notes: '' === '' ? null : 'x' }))).toBe(true)
    expect(isSamePayment(dp, patch(dp, { amount: 1 }))).toBe(false)
  })
})
