import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Lease, Payment } from '../../types/db'
import { outstandingFor } from '../../domain/billing'
import {
  closePartialInvoicePatch,
  closingInvoiceWrites,
  hasRentRefundFor,
  leaseDataChanged,
  rentRefundExpense,
  rentRefundsToRecord,
  unrecordedRentRefunds,
} from './leaseUtils'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const lease: Lease = {
  id: 'L1',
  ...ts,
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'active',
  checkout_date: null,
  notes: null,
}

const inv = (id: string, number: string, over: Partial<Invoice> = {}): Invoice => ({
  id,
  ...ts,
  property_id: 'P1',
  lease_id: 'L1',
  invoice_number: number,
  period_type: null,
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  quantity: 1,
  base_amount: 1_500_000,
  addons_amount: 0,
  extra_amount: 0,
  discount_amount: 0,
  total_amount: 1_500_000,
  due_date: '2026-10-01',
  status: 'partial',
  notes: null,
  ...over,
})

const rent = (invoiceId: string, amount: number): Payment => ({
  id: `pay-${invoiceId}-${amount}`,
  org_id: 'o',
  created_at: ts.created_at,
  property_id: 'P1',
  invoice_id: invoiceId,
  lease_id: 'L1',
  amount,
  paid_at: '2026-09-25',
  method: 'cash',
  kind: 'rent',
  notes: null,
  created_by: null,
})

const refundRow = (description: string, over: Partial<Expense> = {}): Expense => ({
  id: `exp-${description}`,
  ...ts,
  property_id: 'P1',
  lease_id: 'L1',
  category: 'rent_refund',
  amount: 300_000,
  expense_date: '2026-10-05',
  description,
  vendor: null,
  receipt_path: null,
  created_by: null,
  ...over,
})

describe('closePartialInvoicePatch', () => {
  it('refund closes the invoice at the paid amount instead of voiding it', () => {
    const invoice = inv('I1', 'INV-202610-0001', { discount_amount: 100_000, total_amount: 1_400_000, notes: 'Listrik: 50000' })
    const patch = closePartialInvoicePatch(invoice, 300_000, 'refund', 'sewa dibatalkan')
    expect(patch).toEqual({
      discount_amount: 1_200_000,
      total_amount: 300_000,
      status: 'paid',
      notes: 'Listrik: 50000\nDP dikembalikan (sewa dibatalkan)',
    })
    expect(patch.status).not.toBe('void')
    // nothing left to collect
    expect(outstandingFor({ ...invoice, ...patch }, [rent('I1', 300_000)])).toBe(0)
  })

  it('forfeit keeps the DP as revenue with its own note', () => {
    const patch = closePartialInvoicePatch(inv('I1', 'INV-1'), 500_000, 'forfeit', 'checkout')
    expect(patch).toEqual({ discount_amount: 1_000_000, total_amount: 500_000, status: 'paid', notes: 'Sisa dianggap hangus (checkout)' })
  })
})

describe('rent refund expenses', () => {
  it('rentRefundExpense names the invoice number and the lease', () => {
    expect(rentRefundExpense(lease, inv('I1', 'INV-202610-0001'), 300_000, '2026-10-05', 'checkout')).toEqual({
      property_id: 'P1',
      lease_id: 'L1',
      category: 'rent_refund',
      amount: 300_000,
      expense_date: '2026-10-05',
      description: 'Pengembalian DP tagihan INV-202610-0001 (checkout)',
      vendor: null,
      receipt_path: null,
    })
  })

  it('hasRentRefundFor matches the whole invoice number on the same lease only', () => {
    const rows = [refundRow('Pengembalian DP tagihan INV-202610-0001 (sewa dibatalkan)')]
    expect(hasRentRefundFor(rows, 'L1', 'INV-202610-0001')).toBe(true)
    expect(hasRentRefundFor(rows, 'L2', 'INV-202610-0001')).toBe(false)
    expect(hasRentRefundFor(rows, 'L1', 'INV-202610-000')).toBe(false)
    expect(hasRentRefundFor([refundRow('Pengembalian DP tagihan INV-202610-00012 (checkout)')], 'L1', 'INV-202610-0001')).toBe(false)
    expect(hasRentRefundFor([refundRow('Pengembalian DP tagihan INV-202610-0001 (checkout)', { category: 'deposit_refund' })], 'L1', 'INV-202610-0001')).toBe(false)
  })

  it('unrecordedRentRefunds finds an invoice closed by a refund whose expense is missing', () => {
    const closed = inv('I1', 'INV-1', { total_amount: 300_000, discount_amount: 1_200_000, status: 'paid', notes: 'DP dikembalikan (checkout)' })
    const forfeited = inv('I2', 'INV-2', { total_amount: 200_000, status: 'paid', notes: 'Sisa dianggap hangus (checkout)' })
    const otherLease = inv('I3', 'INV-3', { lease_id: 'L2', total_amount: 100_000, status: 'paid', notes: 'DP dikembalikan (checkout)' })
    const pays = [rent('I1', 300_000), rent('I2', 200_000), rent('I3', 100_000)]
    expect(unrecordedRentRefunds('L1', [closed, forfeited, otherLease], pays, [])).toEqual([{ invoice: closed, amount: 300_000 }])
    expect(unrecordedRentRefunds('L1', [closed], pays, [refundRow('Pengembalian DP tagihan INV-1 (checkout)')])).toEqual([])
    // a note typed in the middle of a line is not the marker
    expect(unrecordedRentRefunds('L1', [{ ...closed, notes: 'kata penyewa: DP dikembalikan (nanti)' }], pays, [])).toEqual([])
  })

  it('rentRefundsToRecord never records the same invoice twice', () => {
    const now = inv('I1', 'INV-1')
    const earlier = inv('I2', 'INV-2', { total_amount: 400_000, status: 'paid', notes: 'DP dikembalikan (checkout)' })
    const pays = [rent('I1', 300_000), rent('I2', 400_000)]
    // refunded now + one an interrupted attempt closed earlier
    expect(rentRefundsToRecord('L1', [now], [now, earlier], pays, []).map((r) => [r.invoice.id, r.amount])).toEqual([
      ['I1', 300_000],
      ['I2', 400_000],
    ])
    // the invoice list already shows I1 closed (fresh data after the close): still one entry
    const closedNow = { ...now, total_amount: 300_000, status: 'paid' as const, notes: 'DP dikembalikan (checkout)' }
    expect(rentRefundsToRecord('L1', [now], [closedNow], pays, [])).toHaveLength(1)
    // a refund already recorded (e.g. by a failed attempt) is not inserted again
    expect(rentRefundsToRecord('L1', [now], [now], pays, [refundRow('Pengembalian DP tagihan INV-1 (checkout)')])).toEqual([])
  })
})

describe('closingInvoiceWrites', () => {
  const unpaid = inv('I0', 'INV-0', { status: 'unpaid' })
  const dp = inv('I1', 'INV-1')
  const pays = [rent('I1', 300_000)]

  it('closes part-paid invoices before any void, so a refused close leaves the voids undone', () => {
    const writes = closingInvoiceWrites([unpaid], [dp], [unpaid, dp], pays, { I1: 'refund' }, 'sewa dibatalkan')
    expect(writes.map((w) => [w.id, w.patch.status])).toEqual([
      ['I1', 'paid'],
      ['I0', 'void'],
    ])
  })

  it('builds the close from the fresh row: what another device changed is kept and the total still adds up', () => {
    const fresh = { ...dp, extra_amount: 50_000, total_amount: 1_550_000, notes: 'Listrik: 50000' }
    const [close] = closingInvoiceWrites([], [dp], [fresh], pays, { I1: 'forfeit' }, 'checkout')
    expect(close.patch).toEqual({ discount_amount: 1_250_000, total_amount: 300_000, status: 'paid', notes: 'Listrik: 50000\nSisa dianggap hangus (checkout)' })
    const row = { ...fresh, ...close.patch }
    expect(row.base_amount + row.addons_amount + row.extra_amount - row.discount_amount).toBe(row.total_amount)
  })

  it('skips rows an earlier attempt already closed or voided', () => {
    const closed = { ...dp, total_amount: 300_000, discount_amount: 1_200_000, status: 'paid' as const, notes: 'DP dikembalikan (sewa dibatalkan)' }
    expect(closingInvoiceWrites([unpaid], [dp], [{ ...unpaid, status: 'void' }, closed], pays, { I1: 'refund' }, 'sewa dibatalkan')).toEqual([])
  })
})

describe('leaseDataChanged', () => {
  const dp = inv('I1', 'INV-1')
  const jan = inv('I2', 'INV-2', { status: 'unpaid' })
  const paidBefore = inv('I0', 'INV-0', { status: 'paid' })
  const screen = { invoices: [paidBefore, dp, jan], payments: [rent('I0', 1_500_000), rent('I1', 300_000)] }
  const changed = (touched: Invoice[], freshInvoices: Invoice[], freshPayments: Payment[]) =>
    leaseDataChanged('L1', screen.invoices, screen.payments, touched, freshInvoices, freshPayments)

  it('nothing changed -> false (payments of untouched invoices are not needed)', () => {
    expect(changed([dp, jan], [paidBefore, dp, jan], [rent('I1', 300_000)])).toBe(false)
  })

  it('a payment added to or removed from a touched invoice -> true', () => {
    expect(changed([dp, jan], [paidBefore, dp, jan], [rent('I1', 300_000), rent('I1', 100_000)])).toBe(true)
    expect(changed([dp, jan], [paidBefore, dp, jan], [rent('I1', 300_000), rent('I2', 100_000)])).toBe(true)
    expect(changed([dp, jan], [paidBefore, dp, jan], [])).toBe(true)
  })

  it('a touched invoice deleted, or a new live invoice the screen does not show -> true', () => {
    expect(changed([dp, jan], [paidBefore, dp], [rent('I1', 300_000)])).toBe(true)
    expect(changed([dp, jan], [paidBefore, dp, jan, inv('I9', 'INV-9', { status: 'unpaid' })], [rent('I1', 300_000)])).toBe(true)
    // a new invoice that is already void, or one of another lease, does not matter
    expect(changed([dp, jan], [paidBefore, dp, jan, inv('I9', 'INV-9', { status: 'void' }), inv('I8', 'INV-8', { lease_id: 'L2' })], [rent('I1', 300_000)])).toBe(false)
  })

  it("rows this device's interrupted attempt already voided/closed -> false (the retry finishes the job)", () => {
    const closed = { ...dp, total_amount: 300_000, status: 'paid' as const, notes: 'DP dikembalikan (checkout)' }
    expect(changed([dp, jan], [paidBefore, closed, { ...jan, status: 'void' }], [rent('I1', 300_000)])).toBe(false)
  })
})
