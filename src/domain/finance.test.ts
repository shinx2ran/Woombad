import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Payment, Property } from '../types/db'
import {
  cashflowSeries,
  comparePeriods,
  expensesByCategory,
  matchesProperty,
  operatingExpensesInRange,
  outstandingInvoices,
  profitByProperty,
  revenueByMethod,
  revenueInRange,
  summarizeFinance,
  type FinanceSummary,
} from './finance'

// ---------- fixtures ----------

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId('pay'),
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    property_id: 'kos-a',
    invoice_id: 'inv-1',
    lease_id: 'lease-1',
    amount: 1_000_000,
    paid_at: '2026-03-10',
    method: 'cash',
    kind: 'rent',
    notes: null,
    created_by: null,
    ...overrides,
  }
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: nextId('exp'),
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'kos-a',
    lease_id: null,
    category: 'wages',
    amount: 500_000,
    expense_date: '2026-03-15',
    description: 'Gaji penjaga',
    vendor: null,
    receipt_path: null,
    created_by: null,
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: nextId('inv'),
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'kos-a',
    lease_id: 'lease-1',
    invoice_number: 'INV-001',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    quantity: 1,
    base_amount: 1_000_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_000_000,
    due_date: '2026-03-01',
    status: 'unpaid',
    notes: null,
    ...overrides,
  }
}

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'kos-a',
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: 'Kos A',
    address: null,
    notes: null,
    payment_info: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    revenue: 0,
    expenses: 0,
    netProfit: 0,
    margin: null,
    depositsReceived: 0,
    depositRefunds: 0,
    billed: 0,
    collected: 0,
    collectionRate: null,
    outstanding: 0,
    paymentCount: 0,
    expenseCount: 0,
    ...overrides,
  }
}

const MARCH = { start: '2026-03-01', end: '2026-03-31' }

// ---------- tests ----------

describe('matchesProperty', () => {
  it('undefined filter includes everything, including shared rows', () => {
    expect(matchesProperty('kos-a')).toBe(true)
    expect(matchesProperty(null)).toBe(true)
  })
  it('explicit filter excludes shared rows and non-listed properties', () => {
    expect(matchesProperty('kos-a', ['kos-a'])).toBe(true)
    expect(matchesProperty('kos-b', ['kos-a'])).toBe(false)
    expect(matchesProperty(null, ['kos-a'])).toBe(false)
  })
  it('empty filter matches nothing', () => {
    expect(matchesProperty('kos-a', [])).toBe(false)
    expect(matchesProperty(null, [])).toBe(false)
  })
})

describe('revenueInRange', () => {
  it('returns 0 for empty input', () => {
    expect(revenueInRange([], MARCH)).toBe(0)
  })
  it('sums rent and other but never deposits', () => {
    const payments = [
      makePayment({ kind: 'rent', amount: 1_000_000 }),
      makePayment({ kind: 'other', amount: 50_000, invoice_id: null }),
      makePayment({ kind: 'deposit', amount: 500_000, invoice_id: null }),
    ]
    expect(revenueInRange(payments, MARCH)).toBe(1_050_000)
  })
  it('range boundaries are inclusive', () => {
    const payments = [
      makePayment({ paid_at: '2026-02-28', amount: 1 }),
      makePayment({ paid_at: '2026-03-01', amount: 10 }),
      makePayment({ paid_at: '2026-03-31', amount: 100 }),
      makePayment({ paid_at: '2026-04-01', amount: 1000 }),
    ]
    expect(revenueInRange(payments, MARCH)).toBe(110)
  })
  it('applies property filter; empty list matches nothing', () => {
    const payments = [makePayment({ property_id: 'kos-a', amount: 100 }), makePayment({ property_id: 'kos-b', amount: 200 })]
    expect(revenueInRange(payments, MARCH, ['kos-b'])).toBe(200)
    expect(revenueInRange(payments, MARCH, ['kos-a', 'kos-b'])).toBe(300)
    expect(revenueInRange(payments, MARCH, [])).toBe(0)
  })
})

describe('operatingExpensesInRange', () => {
  it('returns 0 for empty input', () => {
    expect(operatingExpensesInRange([], MARCH)).toBe(0)
  })
  it('excludes deposit_refund', () => {
    const expenses = [
      makeExpense({ category: 'wages', amount: 500_000 }),
      makeExpense({ category: 'maintenance', amount: 200_000 }),
      makeExpense({ category: 'deposit_refund', amount: 1_000_000 }),
    ]
    expect(operatingExpensesInRange(expenses, MARCH)).toBe(700_000)
  })
  it('includes shared expenses only when there is no property filter', () => {
    const expenses = [
      makeExpense({ property_id: 'kos-a', amount: 100 }),
      makeExpense({ property_id: null, amount: 1000 }),
    ]
    expect(operatingExpensesInRange(expenses, MARCH)).toBe(1100)
    expect(operatingExpensesInRange(expenses, MARCH, ['kos-a'])).toBe(100)
    expect(operatingExpensesInRange(expenses, MARCH, [])).toBe(0)
  })
  it('range boundaries are inclusive', () => {
    const expenses = [
      makeExpense({ expense_date: '2026-02-28', amount: 1 }),
      makeExpense({ expense_date: '2026-03-01', amount: 10 }),
      makeExpense({ expense_date: '2026-03-31', amount: 100 }),
      makeExpense({ expense_date: '2026-04-01', amount: 1000 }),
    ]
    expect(operatingExpensesInRange(expenses, MARCH)).toBe(110)
  })
})

describe('summarizeFinance', () => {
  it('all zeros / nulls with empty inputs', () => {
    expect(summarizeFinance([], [], [], MARCH)).toEqual(makeSummary())
  })

  it('computes a full summary with concrete numbers', () => {
    const invoices = [
      makeInvoice({ id: 'inv-1', total_amount: 1_000_000, due_date: '2026-03-01', status: 'paid' }),
      makeInvoice({ id: 'inv-2', total_amount: 800_000, due_date: '2026-03-15', status: 'partial' }),
      makeInvoice({ id: 'inv-void', total_amount: 5_000_000, due_date: '2026-03-20', status: 'void' }),
      makeInvoice({ id: 'inv-old', total_amount: 600_000, due_date: '2026-02-01', status: 'unpaid' }),
      makeInvoice({ id: 'inv-future', total_amount: 900_000, due_date: '2026-04-01', status: 'unpaid' }),
    ]
    const payments = [
      makePayment({ invoice_id: 'inv-1', amount: 1_000_000, paid_at: '2026-03-01' }),
      makePayment({ invoice_id: 'inv-2', amount: 300_000, paid_at: '2026-03-16' }),
      makePayment({ kind: 'other', invoice_id: null, amount: 50_000, paid_at: '2026-03-20' }),
      makePayment({ kind: 'deposit', invoice_id: null, amount: 500_000, paid_at: '2026-03-01' }),
      makePayment({ kind: 'deposit', invoice_id: null, amount: 999, paid_at: '2026-02-01' }), // outside range
    ]
    const expenses = [
      makeExpense({ category: 'wages', amount: 400_000, expense_date: '2026-03-05' }),
      makeExpense({ category: 'utilities', amount: 150_000, expense_date: '2026-03-31' }),
      makeExpense({ category: 'deposit_refund', amount: 250_000, expense_date: '2026-03-10' }),
      makeExpense({ category: 'wages', amount: 777, expense_date: '2026-04-01' }), // outside range
    ]
    const s = summarizeFinance(payments, expenses, invoices, MARCH)
    expect(s.revenue).toBe(1_350_000)
    expect(s.expenses).toBe(550_000)
    expect(s.netProfit).toBe(800_000)
    expect(s.margin).toBeCloseTo(800_000 / 1_350_000)
    expect(s.depositsReceived).toBe(500_000)
    expect(s.depositRefunds).toBe(250_000)
    expect(s.billed).toBe(1_800_000) // void excluded, old & future out of range
    expect(s.collected).toBe(1_300_000) // rent with invoice_id only
    expect(s.collectionRate).toBeCloseTo(1_300_000 / 1_800_000)
    // outstanding: inv-2 (800k - 300k) + inv-old (600k); inv-future due after range.end excluded; void excluded
    expect(s.outstanding).toBe(1_100_000)
    expect(s.paymentCount).toBe(3)
    expect(s.expenseCount).toBe(2)
  })

  it('collectionRate stays within 0..1 when old invoices are paid in range (collected is over the billed set)', () => {
    const invoices = [
      makeInvoice({ id: 'inv-old', total_amount: 1_000_000, due_date: '2026-02-01', status: 'paid' }),
      makeInvoice({ id: 'inv-now', total_amount: 500_000, due_date: '2026-03-01', status: 'paid' }),
    ]
    const payments = [
      makePayment({ invoice_id: 'inv-old', amount: 1_000_000, paid_at: '2026-03-02' }),
      makePayment({ invoice_id: 'inv-now', amount: 500_000, paid_at: '2026-03-02' }),
    ]
    const s = summarizeFinance(payments, [], invoices, MARCH)
    expect(s.billed).toBe(500_000)
    expect(s.collected).toBe(500_000)
    expect(s.collectionRate).toBe(1)
    // the late payment on the old invoice is still revenue (cash basis)
    expect(s.revenue).toBe(1_500_000)
  })

  it('collected/collectionRate definition differs from SPEC 2a (can exceed 1, uses payment date instead of billed set)', () => {
    const invoices = [
      makeInvoice({ id: 'A', total_amount: 100, due_date: '2026-03-01', status: 'partial' }),
      makeInvoice({ id: 'B', total_amount: 100, due_date: '2026-02-01', status: 'paid' }),
    ]
    const payments = [
      makePayment({ invoice_id: 'A', amount: 40, paid_at: '2026-03-05' }),
      makePayment({ invoice_id: 'B', amount: 100, paid_at: '2026-03-06' }),
    ]
    const s = summarizeFinance(payments, [], invoices, MARCH)
    expect(s.billed).toBe(100)
    expect(s.collected).toBe(40)
    expect(s.collectionRate).toBeCloseTo(0.4)
  })

  it('collected caps each invoice at its total and counts payments made outside the range', () => {
    const invoices = [
      makeInvoice({ id: 'over', total_amount: 100, due_date: '2026-03-01', status: 'paid' }),
      makeInvoice({ id: 'late', total_amount: 200, due_date: '2026-03-10', status: 'paid' }),
      makeInvoice({ id: 'none', total_amount: 300, due_date: '2026-03-20', status: 'unpaid' }),
    ]
    const payments = [
      makePayment({ invoice_id: 'over', amount: 150, paid_at: '2026-03-01' }), // over-paid: counts 100
      makePayment({ invoice_id: 'late', amount: 200, paid_at: '2026-04-15' }), // paid after range: still collected for March billing
      makePayment({ invoice_id: 'none', kind: 'other', amount: 999, paid_at: '2026-03-21' }), // not a rent payment: ignored
    ]
    const s = summarizeFinance(payments, [], invoices, MARCH)
    expect(s.billed).toBe(600)
    expect(s.collected).toBe(300)
    expect(s.collectionRate).toBeCloseTo(0.5)
  })

  it('void invoices are excluded from billed and outstanding', () => {
    const invoices = [makeInvoice({ status: 'void', total_amount: 1_000_000, due_date: '2026-03-10' })]
    const s = summarizeFinance([], [], invoices, MARCH)
    expect(s.billed).toBe(0)
    expect(s.outstanding).toBe(0)
    expect(s.collectionRate).toBeNull()
  })

  it('margin is null when revenue is 0 even with expenses', () => {
    const s = summarizeFinance([], [makeExpense({ amount: 100 })], [], MARCH)
    expect(s.revenue).toBe(0)
    expect(s.netProfit).toBe(-100)
    expect(s.margin).toBeNull()
  })

  it('property filter excludes shared expenses and other kos invoices', () => {
    const invoices = [
      makeInvoice({ id: 'a', property_id: 'kos-a', total_amount: 100, due_date: '2026-03-01' }),
      makeInvoice({ id: 'b', property_id: 'kos-b', total_amount: 1000, due_date: '2026-03-01' }),
    ]
    const payments = [
      makePayment({ property_id: 'kos-a', invoice_id: 'a', amount: 40 }),
      makePayment({ property_id: 'kos-b', invoice_id: 'b', amount: 400 }),
    ]
    const expenses = [
      makeExpense({ property_id: 'kos-a', amount: 10 }),
      makeExpense({ property_id: null, amount: 5000 }),
    ]
    const s = summarizeFinance(payments, expenses, invoices, MARCH, ['kos-a'])
    expect(s.revenue).toBe(40)
    expect(s.expenses).toBe(10)
    expect(s.billed).toBe(100)
    expect(s.collected).toBe(40)
    expect(s.outstanding).toBe(60)
    expect(s.paymentCount).toBe(1)
    expect(s.expenseCount).toBe(1)

    const all = summarizeFinance(payments, expenses, invoices, MARCH)
    expect(all.expenses).toBe(5010)
    expect(all.outstanding).toBe(660)
  })

  it('outstanding counts invoices due on range.end inclusive and never goes negative', () => {
    const invoices = [
      makeInvoice({ id: 'edge', total_amount: 100, due_date: '2026-03-31', status: 'unpaid' }),
      makeInvoice({ id: 'over', total_amount: 100, due_date: '2026-03-01', status: 'partial' }),
    ]
    const payments = [makePayment({ invoice_id: 'over', amount: 150, paid_at: '2026-01-01' })]
    expect(summarizeFinance(payments, [], invoices, MARCH).outstanding).toBe(100)
  })

  it('outstanding/outstandingInvoices trust invoices.status instead of deriving from payments (SPEC 2a Piutang)', () => {
    const invoices = [makeInvoice({ id: 'stale', total_amount: 100, due_date: '2026-03-01', status: 'paid' })]
    const payments = [makePayment({ invoice_id: 'stale', amount: 40, paid_at: '2026-03-02' })]
    expect(summarizeFinance(payments, [], invoices, MARCH).outstanding).toBe(60)
    const items = outstandingInvoices(invoices, payments, '2026-03-15')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ paid: 40, outstanding: 60, daysOverdue: 14 })

    // the reverse: a stale 'unpaid' flag on a fully paid invoice owes nothing
    const settled = [makeInvoice({ id: 'settled', total_amount: 100, due_date: '2026-03-01', status: 'unpaid' })]
    const full = [makePayment({ invoice_id: 'settled', amount: 100, paid_at: '2026-03-02' })]
    expect(summarizeFinance(full, [], settled, MARCH).outstanding).toBe(0)
    expect(outstandingInvoices(settled, full, '2026-03-15')).toEqual([])

    // void stays excluded even with no payments
    const voided = [makeInvoice({ id: 'v', total_amount: 100, due_date: '2026-03-01', status: 'void' })]
    expect(summarizeFinance([], [], voided, MARCH).outstanding).toBe(0)
    expect(outstandingInvoices(voided, [], '2026-03-15')).toEqual([])
  })
})

describe('cashflowSeries', () => {
  it('returns empty for an inverted range', () => {
    expect(cashflowSeries([], [], { start: '2026-03-31', end: '2026-03-01' }, 'month')).toEqual([])
  })

  it('zero-fills months with no data and computes net', () => {
    const range = { start: '2026-01-01', end: '2026-04-30' }
    const payments = [
      makePayment({ paid_at: '2026-01-15', amount: 1_000_000 }),
      makePayment({ paid_at: '2026-03-02', amount: 2_000_000 }),
      makePayment({ paid_at: '2026-03-30', amount: 500_000, kind: 'deposit' }), // excluded
    ]
    const expenses = [
      makeExpense({ expense_date: '2026-03-10', amount: 300_000 }),
      makeExpense({ expense_date: '2026-04-30', amount: 100_000 }),
      makeExpense({ expense_date: '2026-04-15', amount: 999, category: 'deposit_refund' }), // excluded
    ]
    const series = cashflowSeries(payments, expenses, range, 'month')
    expect(series.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(series[0]).toEqual({ key: '2026-01', label: 'Jan 2026', revenue: 1_000_000, expenses: 0, net: 1_000_000 })
    expect(series[1]).toEqual({ key: '2026-02', label: 'Feb 2026', revenue: 0, expenses: 0, net: 0 })
    expect(series[2]).toEqual({ key: '2026-03', label: 'Mar 2026', revenue: 2_000_000, expenses: 300_000, net: 1_700_000 })
    expect(series[3]).toEqual({ key: '2026-04', label: 'Apr 2026', revenue: 0, expenses: 100_000, net: -100_000 })
  })

  it('daily granularity with inclusive boundaries', () => {
    const range = { start: '2026-03-01', end: '2026-03-03' }
    const payments = [
      makePayment({ paid_at: '2026-02-28', amount: 1 }),
      makePayment({ paid_at: '2026-03-01', amount: 10 }),
      makePayment({ paid_at: '2026-03-03', amount: 100 }),
      makePayment({ paid_at: '2026-03-04', amount: 1000 }),
    ]
    const series = cashflowSeries(payments, [], range, 'day')
    expect(series.map((p) => [p.key, p.revenue])).toEqual([
      ['2026-03-01', 10],
      ['2026-03-02', 0],
      ['2026-03-03', 100],
    ])
  })

  it('respects the property filter', () => {
    const payments = [makePayment({ property_id: 'kos-a', amount: 100 }), makePayment({ property_id: 'kos-b', amount: 200 })]
    const expenses = [makeExpense({ property_id: null, amount: 50 })]
    const series = cashflowSeries(payments, expenses, MARCH, 'month', ['kos-a'])
    expect(series).toHaveLength(1)
    expect(series[0]?.revenue).toBe(100)
    expect(series[0]?.expenses).toBe(0)
  })
})

describe('expensesByCategory', () => {
  it('empty input gives empty array', () => {
    expect(expensesByCategory([], MARCH)).toEqual([])
  })
  it('groups, labels, sorts descending and computes share; excludes deposit_refund', () => {
    const expenses = [
      makeExpense({ category: 'wages', amount: 300 }),
      makeExpense({ category: 'wages', amount: 200 }),
      makeExpense({ category: 'utilities', amount: 400 }),
      makeExpense({ category: 'supplies', amount: 100 }),
      makeExpense({ category: 'deposit_refund', amount: 10_000 }),
      makeExpense({ category: 'marketing', amount: 50, expense_date: '2026-05-01' }), // out of range
    ]
    const rows = expensesByCategory(expenses, MARCH)
    expect(rows.map((r) => r.category)).toEqual(['wages', 'utilities', 'supplies'])
    expect(rows[0]).toEqual({ category: 'wages', label: 'Gaji & Upah', amount: 500, share: 0.5 })
    expect(rows[1]).toEqual({ category: 'utilities', label: 'Listrik, Air & Internet', amount: 400, share: 0.4 })
    expect(rows[2]).toEqual({ category: 'supplies', label: 'Perlengkapan & Kebersihan', amount: 100, share: 0.1 })
  })
  it('excludes zero categories', () => {
    const rows = expensesByCategory([makeExpense({ category: 'tax', amount: 0 }), makeExpense({ category: 'other', amount: 7 })], MARCH)
    expect(rows.map((r) => r.category)).toEqual(['other'])
    expect(rows[0]?.share).toBe(1)
  })
  it('property filter drops shared expenses', () => {
    const expenses = [makeExpense({ property_id: null, category: 'wages', amount: 100 }), makeExpense({ property_id: 'kos-a', category: 'tax', amount: 10 })]
    expect(expensesByCategory(expenses, MARCH, ['kos-a']).map((r) => r.category)).toEqual(['tax'])
  })
})

describe('profitByProperty', () => {
  const properties = [makeProperty({ id: 'kos-a', name: 'Kos A' }), makeProperty({ id: 'kos-b', name: 'Kos B' })]

  it('one row per property with zeros when there is no data, in given order', () => {
    expect(profitByProperty([], [], properties, MARCH)).toEqual([
      { propertyId: 'kos-a', name: 'Kos A', revenue: 0, expenses: 0, net: 0 },
      { propertyId: 'kos-b', name: 'Kos B', revenue: 0, expenses: 0, net: 0 },
    ])
  })
  it('no properties gives empty array (and shared row only if shared expenses exist)', () => {
    expect(profitByProperty([], [], [], MARCH)).toEqual([])
    expect(profitByProperty([], [makeExpense({ property_id: null, amount: 5 })], [], MARCH)).toEqual([
      { propertyId: 'shared', name: 'Bersama', revenue: 0, expenses: 5, net: -5 },
    ])
  })
  it('attributes revenue and expenses per property and appends a Bersama row', () => {
    const payments = [
      makePayment({ property_id: 'kos-a', amount: 1_000 }),
      makePayment({ property_id: 'kos-b', amount: 2_000 }),
      makePayment({ property_id: 'kos-b', amount: 300, kind: 'other', invoice_id: null }),
      makePayment({ property_id: 'kos-b', amount: 9_999, kind: 'deposit', invoice_id: null }),
      makePayment({ property_id: 'kos-a', amount: 9_999, paid_at: '2026-04-01' }),
    ]
    const expenses = [
      makeExpense({ property_id: 'kos-a', amount: 400 }),
      makeExpense({ property_id: null, amount: 250 }),
      makeExpense({ property_id: null, amount: 50 }),
      makeExpense({ property_id: null, amount: 9_999, category: 'deposit_refund' }),
    ]
    expect(profitByProperty(payments, expenses, properties, MARCH)).toEqual([
      { propertyId: 'kos-a', name: 'Kos A', revenue: 1_000, expenses: 400, net: 600 },
      { propertyId: 'kos-b', name: 'Kos B', revenue: 2_300, expenses: 0, net: 2_300 },
      { propertyId: 'shared', name: 'Bersama', revenue: 0, expenses: 300, net: -300 },
    ])
  })
  it('omits the Bersama row when shared expenses are 0', () => {
    const rows = profitByProperty([], [makeExpense({ property_id: 'kos-a', amount: 1 })], properties, MARCH)
    expect(rows.map((r) => r.propertyId)).toEqual(['kos-a', 'kos-b'])
  })
})

describe('revenueByMethod', () => {
  it('empty input gives empty array', () => {
    expect(revenueByMethod([], MARCH)).toEqual([])
  })
  it('groups by method, labels, counts, sorts descending, drops deposits and zero amounts', () => {
    const payments = [
      makePayment({ method: 'cash', amount: 100 }),
      makePayment({ method: 'cash', amount: 150 }),
      makePayment({ method: 'transfer', amount: 400 }),
      makePayment({ method: 'qris', amount: 0 }),
      makePayment({ method: 'other', amount: 5000, kind: 'deposit', invoice_id: null }),
    ]
    expect(revenueByMethod(payments, MARCH)).toEqual([
      { method: 'transfer', label: 'Transfer', amount: 400, count: 1 },
      { method: 'cash', label: 'Tunai', amount: 250, count: 2 },
    ])
  })
  it('applies the property filter', () => {
    const payments = [makePayment({ property_id: 'kos-a', method: 'cash', amount: 1 }), makePayment({ property_id: 'kos-b', method: 'qris', amount: 2 })]
    expect(revenueByMethod(payments, MARCH, ['kos-b']).map((r) => r.method)).toEqual(['qris'])
  })
})

describe('outstandingInvoices', () => {
  it('empty input gives empty array', () => {
    expect(outstandingInvoices([], [], '2026-03-15')).toEqual([])
  })
  it('includes only invoices with money owed, computes paid/outstanding/daysOverdue and sorts', () => {
    const invoices = [
      makeInvoice({ id: 'paid', status: 'paid', due_date: '2026-01-01', total_amount: 1000 }),
      makeInvoice({ id: 'void', status: 'void', due_date: '2026-01-01' }),
      makeInvoice({ id: 'b', invoice_number: 'INV-010', status: 'unpaid', due_date: '2026-03-10', total_amount: 500 }),
      makeInvoice({ id: 'a', invoice_number: 'INV-002', status: 'partial', due_date: '2026-03-10', total_amount: 1000 }),
      makeInvoice({ id: 'future', invoice_number: 'INV-020', status: 'unpaid', due_date: '2026-03-20', total_amount: 300 }),
      makeInvoice({ id: 'old', invoice_number: 'INV-001', status: 'unpaid', due_date: '2026-02-01', total_amount: 200 }),
    ]
    const payments = [
      makePayment({ invoice_id: 'a', amount: 400 }),
      makePayment({ invoice_id: 'paid', amount: 1000 }),
    ]
    const items = outstandingInvoices(invoices, payments, '2026-03-15')
    expect(items.map((i) => i.invoice.id)).toEqual(['old', 'a', 'b', 'future'])
    expect(items[0]).toMatchObject({ paid: 0, outstanding: 200, daysOverdue: 42 })
    expect(items[1]).toMatchObject({ paid: 400, outstanding: 600, daysOverdue: 5 })
    expect(items[2]).toMatchObject({ paid: 0, outstanding: 500, daysOverdue: 5 })
    expect(items[3]).toMatchObject({ paid: 0, outstanding: 300, daysOverdue: -5 })
  })
  it('daysOverdue is 0 when due today', () => {
    const items = outstandingInvoices([makeInvoice({ due_date: '2026-03-15' })], [], '2026-03-15')
    expect(items[0]?.daysOverdue).toBe(0)
  })
  it('applies the property filter', () => {
    const invoices = [makeInvoice({ id: 'a', property_id: 'kos-a' }), makeInvoice({ id: 'b', property_id: 'kos-b' })]
    expect(outstandingInvoices(invoices, [], '2026-03-15', ['kos-b']).map((i) => i.invoice.id)).toEqual(['b'])
    expect(outstandingInvoices(invoices, [], '2026-03-15', [])).toEqual([])
  })
})

describe('comparePeriods', () => {
  it('computes deltas and percentages', () => {
    const current = makeSummary({ revenue: 1_200, expenses: 300, netProfit: 900 })
    const previous = makeSummary({ revenue: 1_000, expenses: 400, netProfit: 600 })
    expect(comparePeriods(current, previous)).toEqual({
      revenueDelta: 200,
      revenuePct: 0.2,
      expensesDelta: -100,
      expensesPct: -0.25,
      netDelta: 300,
    })
  })
  it('pct is null when previous is 0', () => {
    const current = makeSummary({ revenue: 500, expenses: 100, netProfit: 400 })
    const previous = makeSummary()
    expect(comparePeriods(current, previous)).toEqual({
      revenueDelta: 500,
      revenuePct: null,
      expensesDelta: 100,
      expensesPct: null,
      netDelta: 400,
    })
  })
  it('both empty gives zero deltas and null pcts', () => {
    expect(comparePeriods(makeSummary(), makeSummary())).toEqual({
      revenueDelta: 0,
      revenuePct: null,
      expensesDelta: 0,
      expensesPct: null,
      netDelta: 0,
    })
  })
})
