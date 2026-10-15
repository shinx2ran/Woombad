import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Lease, LeaseAddon, Payment } from '../types/db'
import {
  WARN_OFF_SCHEDULE,
  WARN_PERIOD_TYPE_CHANGED,
  WARN_PRICE_NOT_SET,
  addonPeriodQuantity,
  addonUnitWarning,
  billedPeriodCount,
  buildInvoiceDraft,
  chainAnchor,
  computeAddonsAmount,
  depositBalance,
  deriveInvoiceStatus,
  formatExtraBreakdown,
  invoiceNumber,
  invoicePeriodType,
  invoiceUnitLabel,
  nextDueSortKey,
  nextInvoiceSequence,
  nextPeriodBounds,
  nextPeriodStart,
  outstandingFor,
  paidAmountFor,
  parseExtraBreakdown,
  summarizeLeaseBilling,
  validateRentPayment,
} from './billing'

// ---------- fixtures ----------

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'prop-1',
    room_id: 'room-1',
    tenant_id: 'tenant-1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 500_000,
    start_date: '2026-01-31',
    end_date: '2026-02-27',
    status: 'active',
    checkout_date: null,
    notes: null,
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const base = {
    id: nextId('inv'),
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'prop-1',
    lease_id: 'lease-1',
    invoice_number: 'INV-202601-0001',
    period_type: null,
    period_start: '2026-01-31',
    period_end: '2026-02-27',
    quantity: 1,
    base_amount: 1_500_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_500_000,
    due_date: '2026-01-31',
    status: 'unpaid' as const,
    notes: null,
  }
  const merged: Invoice = { ...base, ...overrides }
  if (overrides.due_date === undefined && overrides.period_start !== undefined) merged.due_date = overrides.period_start
  return merged
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId('pay'),
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    property_id: 'prop-1',
    invoice_id: null,
    lease_id: 'lease-1',
    amount: 0,
    paid_at: '2026-01-31',
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
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'prop-1',
    lease_id: null,
    category: 'other',
    amount: 0,
    expense_date: '2026-03-01',
    description: '',
    vendor: null,
    receipt_path: null,
    created_by: null,
    ...overrides,
  }
}

function makeAddon(overrides: Partial<LeaseAddon> = {}): LeaseAddon {
  return {
    id: nextId('addon'),
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    lease_id: 'lease-1',
    name: 'Kasur tambahan',
    amount: 200_000,
    billing: 'per_period',
    ...overrides,
  }
}

// ---------- billedPeriodCount ----------

describe('billedPeriodCount', () => {
  const lease = makeLease({ start_date: '2026-01-31' })

  it('returns 0 when there are no non-void invoices', () => {
    expect(billedPeriodCount(lease, [])).toBe(0)
    expect(billedPeriodCount(lease, [makeInvoice({ status: 'void' })])).toBe(0)
  })

  it('sums quantities for contiguous anchored invoices (unsorted input)', () => {
    const invoices = [
      makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-30', quantity: 1 }),
      makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', quantity: 1 }),
      makeInvoice({ period_start: '2026-03-31', period_end: '2026-06-29', quantity: 3 }),
    ]
    expect(billedPeriodCount(lease, invoices)).toBe(5)
  })

  it('ignores void invoices when checking contiguity', () => {
    const invoices = [
      makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' }),
      makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-30', status: 'void' }),
      makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-30', status: 'paid' }),
    ]
    expect(billedPeriodCount(lease, invoices)).toBe(2)
  })

  it('returns null when the first invoice does not start on lease.start_date', () => {
    expect(billedPeriodCount(lease, [makeInvoice({ period_start: '2026-02-01', period_end: '2026-02-28' })])).toBeNull()
    expect(billedPeriodCount(lease, [makeInvoice({ period_start: '2026-01-30', period_end: '2026-02-27' })])).toBeNull()
  })

  it('returns null on a gap', () => {
    const invoices = [
      makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' }),
      makeInvoice({ period_start: '2026-03-01', period_end: '2026-03-31' }),
    ]
    expect(billedPeriodCount(lease, invoices)).toBeNull()
  })

  it('returns null on an overlap', () => {
    const invoices = [
      makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' }),
      makeInvoice({ period_start: '2026-02-27', period_end: '2026-03-30' }),
    ]
    expect(billedPeriodCount(lease, invoices)).toBeNull()
  })

  it('finding: contiguous start but off-schedule period_end (manual periodStart override) is not anchored', () => {
    const inv1 = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    // user typed the "obvious" next day; unanchored end is 2026-03-27 (anchored would be 2026-03-30)
    const draft2 = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [inv1], periodStart: '2026-02-28' })
    expect(draft2.period_end).toBe('2026-03-27')
    const inv2 = makeInvoice({ period_start: draft2.period_start, period_end: draft2.period_end })
    expect(billedPeriodCount(lease, [inv1, inv2])).toBeNull()
    // an end that is too long is rejected as well
    expect(billedPeriodCount(lease, [makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-28' })])).toBeNull()
    // a first invoice with a quantity that does not match its end is rejected too
    expect(billedPeriodCount(lease, [makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', quantity: 2 })])).toBeNull()
  })

  it('scenario: Jan-31 lease, invoice2 with manual periodStart 02-28 -> null, next invoice starts 03-28 (no 28-30 Mar hole)', () => {
    const inv1 = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const draft2 = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [inv1], periodStart: '2026-02-28' })
    expect(draft2.period_end).toBe('2026-03-27')
    expect(draft2.warnings).toEqual([WARN_OFF_SCHEDULE])
    const inv2 = makeInvoice({ period_start: draft2.period_start, period_end: draft2.period_end })
    expect(billedPeriodCount(lease, [inv1, inv2])).toBeNull()
    expect(nextPeriodBounds(lease, [inv1, inv2], 1)).toEqual({ period_start: '2026-03-28', period_end: '2026-04-27' })
  })

  it('a pro-rata (periodEnd) invoice sitting exactly on the grid still counts as anchored', () => {
    const inv1 = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' })
    expect(billedPeriodCount(lease, [inv1])).toBe(1)
    const short = makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-13' })
    expect(billedPeriodCount(lease, [inv1, short])).toBeNull()
  })
})

// ---------- nextPeriodBounds / nextPeriodStart ----------

describe('nextPeriodBounds', () => {
  it('first period of a monthly lease starting Jan 31 (non-leap year)', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    expect(nextPeriodBounds(lease, [], 1)).toEqual({ period_start: '2026-01-31', period_end: '2026-02-27' })
    expect(nextPeriodStart(lease, [])).toBe('2026-01-31')
  })

  it('anchors on the lease start across Feb/Mar/Apr without drift (leap year 2024)', () => {
    const lease = makeLease({ start_date: '2024-01-31' })
    const first = makeInvoice({ period_start: '2024-01-31', period_end: '2024-02-28' })
    expect(nextPeriodBounds(lease, [first], 1)).toEqual({ period_start: '2024-02-29', period_end: '2024-03-30' })

    const second = makeInvoice({ period_start: '2024-02-29', period_end: '2024-03-30' })
    expect(nextPeriodBounds(lease, [first, second], 1)).toEqual({ period_start: '2024-03-31', period_end: '2024-04-29' })

    const third = makeInvoice({ period_start: '2024-03-31', period_end: '2024-04-29' })
    expect(nextPeriodBounds(lease, [first, second, third], 1)).toEqual({ period_start: '2024-04-30', period_end: '2024-05-30' })
    expect(nextPeriodStart(lease, [first, second, third])).toBe('2024-04-30')
  })

  it('anchors across Feb in a non-leap year', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' })
    expect(nextPeriodBounds(lease, [first], 1)).toEqual({ period_start: '2026-02-28', period_end: '2026-03-30' })
    const second = makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-30' })
    expect(nextPeriodBounds(lease, [first, second], 1)).toEqual({ period_start: '2026-03-31', period_end: '2026-04-29' })
  })

  it('handles quantity 3 anchored on Jan 31', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    expect(nextPeriodBounds(lease, [], 3)).toEqual({ period_start: '2026-01-31', period_end: '2026-04-29' })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-04-29', quantity: 3 })
    // 3 periods already billed -> next anchor index 3 = 2026-04-30, ends day before 2026-05-31
    expect(nextPeriodBounds(lease, [first], 1)).toEqual({ period_start: '2026-04-30', period_end: '2026-05-30' })
  })

  it('falls back to latest period_end + 1 when invoices are not contiguous', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    const manual = makeInvoice({ period_start: '2026-02-01', period_end: '2026-02-28' })
    expect(billedPeriodCount(lease, [manual])).toBeNull()
    expect(nextPeriodBounds(lease, [manual], 1)).toEqual({ period_start: '2026-03-01', period_end: '2026-03-31' })
    expect(nextPeriodBounds(lease, [manual], 2)).toEqual({ period_start: '2026-03-01', period_end: '2026-04-30' })
  })

  it('fallback uses the latest non-void period_end, ignoring void ones', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    const invoices = [
      makeInvoice({ period_start: '2026-02-01', period_end: '2026-02-28' }),
      makeInvoice({ period_start: '2026-03-01', period_end: '2026-03-31', status: 'void' }),
    ]
    expect(nextPeriodBounds(lease, invoices, 1).period_start).toBe('2026-03-01')
  })

  it('works for daily and weekly leases', () => {
    const daily = makeLease({ period_type: 'daily', start_date: '2026-03-01', end_date: '2026-03-03' })
    expect(nextPeriodBounds(daily, [], 3)).toEqual({ period_start: '2026-03-01', period_end: '2026-03-03' })
    const d1 = makeInvoice({ period_start: '2026-03-01', period_end: '2026-03-03', quantity: 3 })
    expect(nextPeriodBounds(daily, [d1], 2)).toEqual({ period_start: '2026-03-04', period_end: '2026-03-05' })

    const weekly = makeLease({ period_type: 'weekly', start_date: '2026-03-02', end_date: '2026-03-08' })
    expect(nextPeriodBounds(weekly, [], 1)).toEqual({ period_start: '2026-03-02', period_end: '2026-03-08' })
    const w1 = makeInvoice({ period_start: '2026-03-02', period_end: '2026-03-15', quantity: 2 })
    expect(nextPeriodBounds(weekly, [w1], 1)).toEqual({ period_start: '2026-03-16', period_end: '2026-03-22' })
  })

  it('rejects quantity < 1', () => {
    expect(() => nextPeriodBounds(makeLease(), [], 0)).toThrow('Jumlah periode minimal 1')
  })

  it('finding: after a manual periodStart override the next auto invoice starts the day after, leaving no gap', () => {
    const lease = makeLease({ start_date: '2026-01-31', end_date: '2026-02-27' })
    const inv1 = makeInvoice({ id: 'a', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const draft2 = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [inv1], periodStart: '2026-02-28' })
    const inv2 = makeInvoice({ id: 'b', period_start: draft2.period_start, period_end: draft2.period_end, status: 'paid' })
    expect(inv2.period_end).toBe('2026-03-27')

    // previously 2026-03-31..2026-04-29 (anchored), skipping 28-30 Mar
    expect(nextPeriodBounds(lease, [inv1, inv2], 1)).toEqual({ period_start: '2026-03-28', period_end: '2026-04-27' })
    const draft3 = buildInvoiceDraft({ lease: makeLease({ ...lease, end_date: inv2.period_end }), addons: [], quantity: 1, existingInvoices: [inv1, inv2] })
    expect(draft3.period_start).toBe('2026-03-28')
    expect(draft3.due_date).toBe('2026-03-28')

    // dashboard and next invoice agree on the next due date
    const s = summarizeLeaseBilling(makeLease({ ...lease, end_date: inv2.period_end }), [inv1, inv2], [], '2026-03-20')
    expect(s.nextDueDate).toBe('2026-03-28')
  })
})

// ---------- computeAddonsAmount ----------

describe('computeAddonsAmount', () => {
  const perPeriod = makeAddon({ amount: 200_000, billing: 'per_period' })
  const oneTime = makeAddon({ name: 'Kunci duplikat', amount: 50_000, billing: 'one_time' })

  it('multiplies per_period addons by quantity', () => {
    expect(computeAddonsAmount([perPeriod], 3, false)).toBe(600_000)
    expect(computeAddonsAmount([perPeriod], 1, true)).toBe(200_000)
  })

  it('adds one_time addons only on the first invoice', () => {
    expect(computeAddonsAmount([perPeriod, oneTime], 1, true)).toBe(250_000)
    expect(computeAddonsAmount([perPeriod, oneTime], 1, false)).toBe(200_000)
    expect(computeAddonsAmount([oneTime], 3, true)).toBe(50_000)
    expect(computeAddonsAmount([oneTime], 3, false)).toBe(0)
  })

  it('allows negative addons but floors the result at 0', () => {
    const discountLike = makeAddon({ name: 'Diskon teman', amount: -100_000, billing: 'per_period' })
    expect(computeAddonsAmount([perPeriod, discountLike], 2, false)).toBe(200_000)
    expect(computeAddonsAmount([discountLike], 2, false)).toBe(0)
    expect(computeAddonsAmount([makeAddon({ amount: -1, billing: 'one_time' })], 1, true)).toBe(0)
  })

  it('returns 0 with no addons', () => {
    expect(computeAddonsAmount([], 5, true)).toBe(0)
  })
})

// ---------- numbering ----------

describe('invoiceNumber / nextInvoiceSequence', () => {
  it('formats INV-YYYYMM-NNNN', () => {
    expect(invoiceNumber('2026-03-15', 7)).toBe('INV-202603-0007')
    expect(invoiceNumber('2024-12-01', 1234)).toBe('INV-202412-1234')
    expect(invoiceNumber('2026-01-31', 10000)).toBe('INV-202601-10000')
  })

  it('returns max(sequence) + 1 parsed from invoice_number for the same YYYYMM (including void) across leases', () => {
    const org = [
      makeInvoice({ lease_id: 'a', invoice_number: 'INV-202603-0001', period_start: '2026-03-01', period_end: '2026-03-31' }),
      makeInvoice({ lease_id: 'b', invoice_number: 'INV-202603-0007', period_start: '2026-03-15', period_end: '2026-04-14', status: 'void' }),
      makeInvoice({ lease_id: 'c', invoice_number: 'INV-202602-0003', period_start: '2026-02-28', period_end: '2026-03-27' }),
      makeInvoice({ lease_id: 'd', invoice_number: 'INV-202503-0009', period_start: '2025-03-10', period_end: '2025-04-09' }),
    ]
    expect(nextInvoiceSequence('2026-03-20', org)).toBe(8)
    expect(nextInvoiceSequence('2026-02-01', org)).toBe(4)
    expect(nextInvoiceSequence('2026-04-01', org)).toBe(1)
    expect(nextInvoiceSequence('2026-04-01', [])).toBe(1)
  })

  it('uses the number, not period_start, and ignores numbers in other formats', () => {
    const org = [
      // period in March but numbered in February (manually renumbered): counts for February
      makeInvoice({ invoice_number: 'INV-202602-0012', period_start: '2026-03-01', period_end: '2026-03-31' }),
      makeInvoice({ invoice_number: 'LEGACY-42', period_start: '2026-03-01', period_end: '2026-03-31' }),
      makeInvoice({ invoice_number: 'INV-202603-10000', period_start: '2026-03-05', period_end: '2026-04-04' }),
    ]
    expect(nextInvoiceSequence('2026-02-15', org)).toBe(13)
    expect(nextInvoiceSequence('2026-03-15', org)).toBe(10001)
    expect(invoiceNumber('2026-03-15', nextInvoiceSequence('2026-03-15', org))).toBe('INV-202603-10001')
  })

  it('fills a hole left by a hard-deleted invoice only when it was the max', () => {
    const org = [
      makeInvoice({ invoice_number: 'INV-202603-0001' }),
      // INV-202603-0002 was hard-deleted
      makeInvoice({ invoice_number: 'INV-202603-0003' }),
    ]
    expect(nextInvoiceSequence('2026-03-01', org)).toBe(4)
    expect(nextInvoiceSequence('2026-03-01', [org[0]])).toBe(2)
  })
})

// ---------- buildInvoiceDraft ----------

describe('buildInvoiceDraft', () => {
  const lease = makeLease({ start_date: '2026-01-31', end_date: '2026-02-27', price_per_period: 1_500_000 })
  const perPeriod = makeAddon({ amount: 200_000, billing: 'per_period' })
  const oneTime = makeAddon({ name: 'Kunci', amount: 50_000, billing: 'one_time' })

  it('builds the first invoice with anchored bounds, one_time addon and numbering', () => {
    const draft = buildInvoiceDraft({ lease, addons: [perPeriod, oneTime], quantity: 1, existingInvoices: [] })
    expect(draft).toEqual({
      period_type: 'monthly',
      period_start: '2026-01-31',
      period_end: '2026-02-27',
      quantity: 1,
      price_per_period: 1_500_000,
      base_amount: 1_500_000,
      addons_amount: 250_000,
      extra_amount: 0,
      discount_amount: 0,
      total_amount: 1_750_000,
      due_date: '2026-01-31',
      invoice_number: 'INV-202601-0001',
      new_lease_end_date: '2026-02-27',
      warnings: [],
    })
  })

  it('second invoice: no one_time addon, anchored start, extends lease end_date', () => {
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const draft = buildInvoiceDraft({ lease, addons: [perPeriod, oneTime], quantity: 1, existingInvoices: [first] })
    expect(draft.period_start).toBe('2026-02-28')
    expect(draft.period_end).toBe('2026-03-30')
    expect(draft.addons_amount).toBe(200_000)
    expect(draft.total_amount).toBe(1_700_000)
    expect(draft.due_date).toBe('2026-02-28')
    expect(draft.new_lease_end_date).toBe('2026-03-30')
    expect(draft.invoice_number).toBe('INV-202602-0001')
  })

  it('a voided first invoice does not count: the re-issued one is first again', () => {
    const voided = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'void' })
    const draft = buildInvoiceDraft({ lease, addons: [oneTime], quantity: 1, existingInvoices: [voided] })
    expect(draft.period_start).toBe('2026-01-31')
    expect(draft.addons_amount).toBe(50_000)
    // numbering still counts the void invoice, so the number is never reused
    expect(draft.invoice_number).toBe('INV-202601-0002')
  })

  it('quantity 3 multiplies base and per_period addons', () => {
    const draft = buildInvoiceDraft({ lease, addons: [perPeriod, oneTime], quantity: 3, existingInvoices: [] })
    expect(draft.period_start).toBe('2026-01-31')
    expect(draft.period_end).toBe('2026-04-29')
    expect(draft.base_amount).toBe(4_500_000)
    expect(draft.addons_amount).toBe(650_000)
    expect(draft.total_amount).toBe(5_150_000)
    expect(draft.new_lease_end_date).toBe('2026-04-29')
  })

  it('applies extra and discount', () => {
    const draft = buildInvoiceDraft({
      lease,
      addons: [],
      quantity: 1,
      existingInvoices: [],
      extraAmount: 100_000,
      discountAmount: 250_000,
    })
    expect(draft.extra_amount).toBe(100_000)
    expect(draft.discount_amount).toBe(250_000)
    expect(draft.total_amount).toBe(1_350_000)
  })

  it('a discount equal to the total gives a free period (total 0 -> paid); larger throws', () => {
    const free = buildInvoiceDraft({ lease, addons: [perPeriod], quantity: 1, existingInvoices: [], discountAmount: 1_700_000 })
    expect(free.total_amount).toBe(0)
    expect(deriveInvoiceStatus(free.total_amount, 0, 'unpaid')).toBe('paid')

    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], discountAmount: 1_500_001 })).toThrow(
      'Diskon melebihi jumlah tagihan.',
    )
    expect(() =>
      buildInvoiceDraft({ lease, addons: [perPeriod], quantity: 1, existingInvoices: [], extraAmount: 50_000, discountAmount: 1_750_001 }),
    ).toThrow('Diskon melebihi jumlah tagihan.')
  })

  it('rejects negative extra, discount and baseAmount', () => {
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], extraAmount: -1 })).toThrow('Nilai tidak boleh negatif.')
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], discountAmount: -50_000 })).toThrow(
      'Nilai tidak boleh negatif.',
    )
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], baseAmount: -1 })).toThrow('Nilai tidak boleh negatif.')
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], extraAmount: Number.NaN })).toThrow(
      'Nilai tidak boleh negatif.',
    )
  })

  it('baseAmount overrides quantity * price_per_period (0 allowed)', () => {
    const draft = buildInvoiceDraft({ lease, addons: [perPeriod], quantity: 2, existingInvoices: [], baseAmount: 2_500_000 })
    expect(draft.base_amount).toBe(2_500_000)
    expect(draft.addons_amount).toBe(400_000)
    expect(draft.total_amount).toBe(2_900_000)
    expect(draft.warnings).toEqual([])

    const zero = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], baseAmount: 0 })
    expect(zero.base_amount).toBe(0)
    expect(zero.total_amount).toBe(0)
  })

  describe('periodEnd (pro-rata / partial extension)', () => {
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })

    it('"tambah 2 minggu saja": start from the anchored next start, end = periodEnd, quantity forced to 1', () => {
      const draft = buildInvoiceDraft({
        lease,
        addons: [perPeriod, oneTime],
        quantity: 3,
        existingInvoices: [first],
        periodEnd: '2026-03-13',
        baseAmount: 700_000,
      })
      expect(draft.period_start).toBe('2026-02-28')
      expect(draft.period_end).toBe('2026-03-13')
      expect(draft.quantity).toBe(1)
      expect(draft.base_amount).toBe(700_000)
      // per_period addon counts once (quantity 1), one_time not on a second invoice
      expect(draft.addons_amount).toBe(200_000)
      expect(draft.total_amount).toBe(900_000)
      expect(draft.due_date).toBe('2026-02-28')
      expect(draft.new_lease_end_date).toBe('2026-03-13')
      expect(draft.invoice_number).toBe('INV-202602-0001')
      expect(draft.warnings).toEqual([WARN_OFF_SCHEDULE])
    })

    it('default base is 1 x price_per_period when baseAmount is omitted', () => {
      const draft = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodEnd: '2026-03-13' })
      expect(draft.base_amount).toBe(1_500_000)
    })

    it('periodStart + periodEnd together', () => {
      const draft = buildInvoiceDraft({
        lease,
        addons: [],
        quantity: 1,
        existingInvoices: [first],
        periodStart: '2026-03-01',
        periodEnd: '2026-03-10',
        baseAmount: 500_000,
      })
      expect(draft.period_start).toBe('2026-03-01')
      expect(draft.period_end).toBe('2026-03-10')
      expect(draft.total_amount).toBe(500_000)
      expect(draft.warnings).toEqual([WARN_OFF_SCHEDULE])
    })

    it('periodEnd equal to the start is a one-day invoice; earlier than the start throws', () => {
      const oneDay = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodEnd: '2026-02-28', baseAmount: 50_000 })
      expect(oneDay.period_start).toBe('2026-02-28')
      expect(oneDay.period_end).toBe('2026-02-28')
      expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodEnd: '2026-02-27' })).toThrow(
        'Tanggal akhir harus setelah tanggal mulai.',
      )
      expect(() =>
        buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], periodStart: '2026-03-10', periodEnd: '2026-03-01' }),
      ).toThrow('Tanggal akhir harus setelah tanggal mulai.')
    })

    it('a periodEnd that lands exactly on the anchored end produces no warning', () => {
      const draft = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodEnd: '2026-03-30' })
      expect(draft.period_start).toBe('2026-02-28')
      expect(draft.period_end).toBe('2026-03-30')
      expect(draft.warnings).toEqual([])
    })

    it('quantity is ignored when periodEnd is given (even 0)', () => {
      const draft = buildInvoiceDraft({ lease, addons: [], quantity: 0, existingInvoices: [first], periodEnd: '2026-03-13', baseAmount: 700_000 })
      expect(draft.quantity).toBe(1)
    })

    it('after a pro-rata invoice the next auto invoice continues from its end', () => {
      const draft = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodEnd: '2026-03-13', baseAmount: 700_000 })
      const proRata = makeInvoice({ period_start: draft.period_start, period_end: draft.period_end, status: 'paid' })
      const next = buildInvoiceDraft({ lease: makeLease({ ...lease, end_date: '2026-03-13' }), addons: [], quantity: 1, existingInvoices: [first, proRata] })
      expect(next.period_start).toBe('2026-03-14')
      expect(next.period_end).toBe('2026-04-13')
      expect(next.warnings).toEqual([])
    })
  })

  it('warns when a manual periodStart leaves the anchored grid, not when it matches it', () => {
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const onGrid = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [first], periodStart: '2026-02-28' })
    // start matches but the unanchored end (03-27) does not
    expect(onGrid.warnings).toEqual([WARN_OFF_SCHEDULE])
    const exact = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], periodStart: '2026-01-31' })
    expect(exact.warnings).toEqual([])
    const off = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], periodStart: '2026-02-01' })
    expect(off.warnings).toEqual([WARN_OFF_SCHEDULE])
  })

  it('negative addons reduce the total but addons never go below 0', () => {
    const neg = makeAddon({ amount: -2_000_000, billing: 'per_period' })
    const draft = buildInvoiceDraft({ lease, addons: [neg], quantity: 1, existingInvoices: [] })
    expect(draft.addons_amount).toBe(0)
    expect(draft.total_amount).toBe(1_500_000)
  })

  it('uses the manual periodStart override with periodEnd', () => {
    const draft = buildInvoiceDraft({ lease, addons: [], quantity: 2, existingInvoices: [], periodStart: '2026-03-05' })
    expect(draft.period_start).toBe('2026-03-05')
    expect(draft.period_end).toBe('2026-05-04')
    expect(draft.due_date).toBe('2026-03-05')
    expect(draft.invoice_number).toBe('INV-202603-0001')
    expect(draft.new_lease_end_date).toBe('2026-05-04')
  })

  it('keeps lease end_date when the invoice ends earlier', () => {
    const longLease = makeLease({ start_date: '2026-01-31', end_date: '2026-12-31' })
    const draft = buildInvoiceDraft({ lease: longLease, addons: [], quantity: 1, existingInvoices: [] })
    expect(draft.new_lease_end_date).toBe('2026-12-31')
  })

  it('numbers from orgInvoices when given, else from existingInvoices', () => {
    const org = [
      makeInvoice({ lease_id: 'other-1', invoice_number: 'INV-202601-0001', period_start: '2026-01-05', period_end: '2026-02-04' }),
      makeInvoice({ lease_id: 'other-2', invoice_number: 'INV-202601-0002', period_start: '2026-01-10', period_end: '2026-02-09' }),
    ]
    const withOrg = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], orgInvoices: org })
    expect(withOrg.invoice_number).toBe('INV-202601-0003')
    const withoutOrg = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [] })
    expect(withoutOrg.invoice_number).toBe('INV-202601-0001')
  })

  it('rejects quantity < 1 or non-integer with an Indonesian message', () => {
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 0, existingInvoices: [] })).toThrow('Jumlah periode minimal 1')
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: -2, existingInvoices: [] })).toThrow('Jumlah periode minimal 1')
    expect(() => buildInvoiceDraft({ lease, addons: [], quantity: 1.5, existingInvoices: [] })).toThrow('Jumlah periode minimal 1')
  })

  it('daily lease: 3 nights from Mar 1', () => {
    const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-03-01', end_date: '2026-03-01' })
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 3, existingInvoices: [] })
    expect(draft.period_end).toBe('2026-03-03')
    expect(draft.base_amount).toBe(300_000)
    expect(draft.new_lease_end_date).toBe('2026-03-03')
  })
})

// ---------- payments ----------

describe('paidAmountFor / outstandingFor', () => {
  const invoice = makeInvoice({ id: 'inv-x', total_amount: 1_500_000 })

  it('sums only rent payments for the invoice', () => {
    const payments = [
      makePayment({ invoice_id: 'inv-x', amount: 500_000, kind: 'rent' }),
      makePayment({ invoice_id: 'inv-x', amount: 300_000, kind: 'rent' }),
      makePayment({ invoice_id: 'inv-x', amount: 500_000, kind: 'deposit' }),
      makePayment({ invoice_id: 'inv-y', amount: 1_000_000, kind: 'rent' }),
      makePayment({ invoice_id: null, amount: 1_000_000, kind: 'other' }),
    ]
    expect(paidAmountFor('inv-x', payments)).toBe(800_000)
    expect(outstandingFor(invoice, payments)).toBe(700_000)
  })

  it('returns 0 with no matching payments and floors outstanding at 0', () => {
    expect(paidAmountFor('inv-x', [])).toBe(0)
    expect(outstandingFor(invoice, [])).toBe(1_500_000)
    expect(outstandingFor(invoice, [makePayment({ invoice_id: 'inv-x', amount: 2_000_000 })])).toBe(0)
  })

  it('a void invoice has nothing outstanding', () => {
    expect(outstandingFor(makeInvoice({ id: 'inv-v', status: 'void', total_amount: 1_000_000 }), [])).toBe(0)
  })
})

describe('deriveInvoiceStatus', () => {
  it('void is sticky', () => {
    expect(deriveInvoiceStatus(1_000_000, 1_000_000, 'void')).toBe('void')
    expect(deriveInvoiceStatus(1_000_000, 0, 'void')).toBe('void')
  })
  it('zero or negative total is paid', () => {
    expect(deriveInvoiceStatus(0, 0, 'unpaid')).toBe('paid')
    expect(deriveInvoiceStatus(-5, 0, 'partial')).toBe('paid')
  })
  it('paid / partial / unpaid thresholds', () => {
    expect(deriveInvoiceStatus(1_000_000, 1_000_000, 'unpaid')).toBe('paid')
    expect(deriveInvoiceStatus(1_000_000, 1_200_000, 'partial')).toBe('paid')
    expect(deriveInvoiceStatus(1_000_000, 999_999, 'unpaid')).toBe('partial')
    expect(deriveInvoiceStatus(1_000_000, 1, 'paid')).toBe('partial')
    expect(deriveInvoiceStatus(1_000_000, 0, 'paid')).toBe('unpaid')
  })
  it('partial payments summing to exactly total -> paid', () => {
    const payments = [
      makePayment({ invoice_id: 'inv-x', amount: 600_000 }),
      makePayment({ invoice_id: 'inv-x', amount: 400_000 }),
    ]
    const paid = paidAmountFor('inv-x', payments)
    expect(deriveInvoiceStatus(1_000_000, paid, 'partial')).toBe('paid')
  })
})

// ---------- summarizeLeaseBilling ----------

describe('summarizeLeaseBilling', () => {
  // Realistic shape: end_date equals the latest invoice's period_end (the app extends it on each invoice).
  const lease = makeLease({ id: 'lease-1', start_date: '2026-01-31', end_date: '2026-02-27' })

  it('nothing billed yet, start far away -> unbilled, nextDueDate = start_date', () => {
    const s = summarizeLeaseBilling(lease, [], [], '2026-01-10')
    expect(s).toEqual({
      leaseId: 'lease-1',
      coveredThrough: null,
      paidThrough: null,
      outstanding: 0,
      nextDueDate: '2026-01-31',
      daysUntilDue: 21,
      state: 'unbilled',
    })
  })

  it('nothing billed and start within dueSoonDays -> due_soon; within grace -> due_soon; past grace -> overdue', () => {
    expect(summarizeLeaseBilling(lease, [], [], '2026-01-29').state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease, [], [], '2026-01-31').state).toBe('due_soon')
    const inGrace = summarizeLeaseBilling(lease, [], [], '2026-02-02')
    expect(inGrace.state).toBe('due_soon')
    expect(inGrace.daysUntilDue).toBe(-2)
    const late = summarizeLeaseBilling(lease, [], [], '2026-02-04')
    expect(late.state).toBe('overdue')
    expect(late.daysUntilDue).toBe(-4)
  })

  it('graceDays: day -2 due_soon, day -3 due_soon, day -4 overdue; graceDays 0 -> day -1 overdue', () => {
    const inv = makeInvoice({ id: 'inv-1', period_start: '2026-01-31', period_end: '2026-02-27', total_amount: 1_500_000 })
    expect(summarizeLeaseBilling(lease, [inv], [], '2026-02-02').state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease, [inv], [], '2026-02-03').state).toBe('due_soon')
    const day4 = summarizeLeaseBilling(lease, [inv], [], '2026-02-04')
    expect(day4.daysUntilDue).toBe(-4)
    expect(day4.state).toBe('overdue')
    expect(day4.outstanding).toBe(1_500_000)

    const strict = summarizeLeaseBilling(lease, [inv], [], '2026-02-01', 3, 0)
    expect(strict.daysUntilDue).toBe(-1)
    expect(strict.state).toBe('overdue')
    expect(summarizeLeaseBilling(lease, [inv], [], '2026-01-31', 3, 0).state).toBe('due_soon')

    // a longer grace keeps the lease due_soon longer; daysUntilDue stays raw
    const lenient = summarizeLeaseBilling(lease, [inv], [], '2026-02-07', 3, 7)
    expect(lenient.daysUntilDue).toBe(-7)
    expect(lenient.state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease, [inv], [], '2026-02-08', 3, 7).state).toBe('overdue')
  })

  it('unpaid invoice past due -> overdue with outstanding = total', () => {
    const inv = makeInvoice({ id: 'inv-1', period_start: '2026-01-31', period_end: '2026-02-27', total_amount: 1_500_000 })
    const s = summarizeLeaseBilling(lease, [inv], [], '2026-02-05')
    expect(s.coveredThrough).toBe('2026-02-27')
    expect(s.paidThrough).toBeNull()
    expect(s.outstanding).toBe(1_500_000)
    expect(s.nextDueDate).toBe('2026-01-31')
    expect(s.daysUntilDue).toBe(-5)
    expect(s.state).toBe('overdue')
  })

  it('finding: a zero-total free period stored as unpaid is settled, not overdue', () => {
    const draft = buildInvoiceDraft({
      lease,
      addons: [],
      quantity: 1,
      discountAmount: 1_500_000,
      existingInvoices: [],
    })
    expect(draft.total_amount).toBe(0)
    const inv = makeInvoice({ id: 'inv-free', ...draft, status: 'unpaid' })
    const s = summarizeLeaseBilling(lease, [inv], [], '2026-02-10')
    expect(s.outstanding).toBe(0)
    expect(s.paidThrough).toBe('2026-02-27')
    expect(s.nextDueDate).toBe('2026-02-28')
    expect(s.daysUntilDue).toBe(18)
    expect(s.state).toBe('ok')
  })

  it('finding: a partial invoice whose rent payments reach the total is settled even if status lags', () => {
    const inv = makeInvoice({ id: 'inv-1', period_start: '2026-01-31', period_end: '2026-02-27', status: 'partial' })
    const payments = [
      makePayment({ invoice_id: 'inv-1', amount: 1_000_000, kind: 'rent', paid_at: '2026-01-31' }),
      makePayment({ invoice_id: 'inv-1', amount: 500_000, kind: 'rent', method: 'deposit', paid_at: '2026-02-05' }),
    ]
    const s = summarizeLeaseBilling(lease, [inv], payments, '2026-02-10')
    expect(s.outstanding).toBe(0)
    expect(s.paidThrough).toBe('2026-02-27')
    expect(s.nextDueDate).toBe('2026-02-28')
    expect(s.state).toBe('ok')
    // one Rupiah short -> still open and overdue (grace elapsed)
    const short = [makePayment({ invoice_id: 'inv-1', amount: 1_499_999, kind: 'rent' })]
    const t = summarizeLeaseBilling(lease, [inv], short, '2026-02-10')
    expect(t.outstanding).toBe(1)
    expect(t.paidThrough).toBeNull()
    expect(t.state).toBe('overdue')
  })

  it('partial invoice: outstanding = total - rent paid, deposits ignored', () => {
    const inv = makeInvoice({ id: 'inv-1', period_start: '2026-01-31', period_end: '2026-02-27', status: 'partial' })
    const payments = [
      makePayment({ invoice_id: 'inv-1', amount: 500_000, kind: 'rent' }),
      makePayment({ invoice_id: null, amount: 500_000, kind: 'deposit' }),
    ]
    const s = summarizeLeaseBilling(lease, [inv], payments, '2026-01-31')
    expect(s.outstanding).toBe(1_000_000)
    expect(s.nextDueDate).toBe('2026-01-31')
    expect(s.daysUntilDue).toBe(0)
    expect(s.state).toBe('due_soon')
  })

  it('earliest open due_date wins over coveredThrough', () => {
    const invoices = [
      makeInvoice({ id: 'a', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' }),
      makeInvoice({ id: 'b', period_start: '2026-02-28', period_end: '2026-03-30', status: 'unpaid' }),
      makeInvoice({ id: 'c', period_start: '2026-03-31', period_end: '2026-04-29', status: 'unpaid' }),
    ]
    const s = summarizeLeaseBilling(lease, invoices, [], '2026-03-01')
    expect(s.coveredThrough).toBe('2026-04-29')
    expect(s.paidThrough).toBe('2026-02-27')
    expect(s.outstanding).toBe(3_000_000)
    expect(s.nextDueDate).toBe('2026-02-28')
    expect(s.daysUntilDue).toBe(-1)
    expect(s.state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease, invoices, [], '2026-03-04').state).toBe('overdue')
  })

  it('all paid: nextDueDate = coveredThrough + 1; ok when far, due_soon when close, overdue when passed', () => {
    const inv = makeInvoice({ id: 'inv-1', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const ok = summarizeLeaseBilling(lease, [inv], [], '2026-02-10')
    expect(ok.paidThrough).toBe('2026-02-27')
    expect(ok.outstanding).toBe(0)
    expect(ok.nextDueDate).toBe('2026-02-28')
    expect(ok.daysUntilDue).toBe(18)
    expect(ok.state).toBe('ok')

    const soon = summarizeLeaseBilling(lease, [inv], [], '2026-02-25')
    expect(soon.daysUntilDue).toBe(3)
    expect(soon.state).toBe('due_soon')

    const custom = summarizeLeaseBilling(lease, [inv], [], '2026-02-25', 2)
    expect(custom.state).toBe('ok')

    const grace = summarizeLeaseBilling(lease, [inv], [], '2026-03-02')
    expect(grace.daysUntilDue).toBe(-2)
    expect(grace.state).toBe('due_soon')

    const late = summarizeLeaseBilling(lease, [inv], [], '2026-03-04')
    expect(late.daysUntilDue).toBe(-4)
    expect(late.state).toBe('overdue')
  })

  it('void invoices are excluded from coveredThrough, paidThrough and outstanding', () => {
    const invoices = [
      makeInvoice({ id: 'a', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' }),
      makeInvoice({ id: 'b', period_start: '2026-02-28', period_end: '2026-03-30', status: 'void' }),
    ]
    const s = summarizeLeaseBilling(lease, invoices, [], '2026-02-10')
    expect(s.coveredThrough).toBe('2026-02-27')
    expect(s.paidThrough).toBe('2026-02-27')
    expect(s.outstanding).toBe(0)
    expect(s.nextDueDate).toBe('2026-02-28')

    const onlyVoid = summarizeLeaseBilling(lease, [invoices[1]], [], '2026-01-10')
    expect(onlyVoid.coveredThrough).toBeNull()
    expect(onlyVoid.nextDueDate).toBe('2026-01-31')
    expect(onlyVoid.state).toBe('unbilled')
  })

  it('ignores invoices of other leases', () => {
    const other = makeInvoice({ id: 'z', lease_id: 'lease-other', period_start: '2026-01-31', period_end: '2026-02-27' })
    const s = summarizeLeaseBilling(lease, [other], [], '2026-02-05')
    expect(s.coveredThrough).toBeNull()
    expect(s.outstanding).toBe(0)
  })

  it('inactive lease -> inactive regardless of outstanding', () => {
    const ended = makeLease({ id: 'lease-1', status: 'ended', end_date: '2026-02-27' })
    const inv = makeInvoice({ id: 'inv-1', status: 'unpaid' })
    const s = summarizeLeaseBilling(ended, [inv], [], '2026-03-10')
    expect(s.state).toBe('inactive')
    expect(s.outstanding).toBe(1_500_000)
    expect(summarizeLeaseBilling(makeLease({ status: 'cancelled' }), [], [], '2026-01-10').state).toBe('inactive')
  })

  it('daily lease at its end_date, fully paid: due_soon on the last night, overdue after, inactive once checked out', () => {
    const daily = makeLease({ id: 'lease-1', period_type: 'daily', start_date: '2026-03-01', end_date: '2026-03-03' })
    const inv = makeInvoice({
      id: 'd1',
      period_start: '2026-03-01',
      period_end: '2026-03-03',
      quantity: 3,
      total_amount: 300_000,
      status: 'paid',
    })
    // end_date is not consulted: the tenant is still 'active', so the next night is about to fall due
    const s = summarizeLeaseBilling(daily, [inv], [], '2026-03-03')
    expect(s.nextDueDate).toBe('2026-03-04')
    expect(s.daysUntilDue).toBe(1)
    expect(s.state).toBe('due_soon')
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-02-28').state).toBe('ok')
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-03-10').state).toBe('overdue')
    // the stay is closed by checkout, not by end_date
    const ended = makeLease({ ...daily, status: 'ended', checkout_date: '2026-03-04' })
    expect(summarizeLeaseBilling(ended, [inv], [], '2026-03-10').state).toBe('inactive')
  })

  it('finding: fully-paid rolling lease becomes due_soon/overdue even though end_date == coveredThrough', () => {
    const start = makeLease({ id: 'lease-1', start_date: '2026-01-31', end_date: '2026-01-31' })
    const draft1 = buildInvoiceDraft({ lease: start, addons: [], quantity: 1, existingInvoices: [] })
    const inv1 = makeInvoice({ id: 'i1', period_start: draft1.period_start, period_end: draft1.period_end, status: 'paid' })
    const lease1 = makeLease({ ...start, end_date: draft1.new_lease_end_date })
    expect(lease1.end_date).toBe('2026-02-27')

    const far = summarizeLeaseBilling(lease1, [inv1], [], '2026-02-10')
    expect(far.nextDueDate).toBe('2026-02-28')
    expect(far.state).toBe('ok')

    const soon = summarizeLeaseBilling(lease1, [inv1], [], '2026-02-26')
    expect(soon.daysUntilDue).toBe(2)
    expect(soon.state).toBe('due_soon')

    const late = summarizeLeaseBilling(lease1, [inv1], [], '2026-03-09')
    expect(late.daysUntilDue).toBe(-9)
    expect(late.state).toBe('overdue')

    // second invoice issued and paid: end_date extended to 2026-03-30, the cycle repeats
    const draft2 = buildInvoiceDraft({ lease: lease1, addons: [], quantity: 1, existingInvoices: [inv1] })
    const inv2 = makeInvoice({ id: 'i2', period_start: draft2.period_start, period_end: draft2.period_end, status: 'paid' })
    const lease2 = makeLease({ ...lease1, end_date: draft2.new_lease_end_date })
    expect(lease2.end_date).toBe('2026-03-30')
    const s2 = summarizeLeaseBilling(lease2, [inv1, inv2], [], '2026-03-29')
    expect(s2.nextDueDate).toBe('2026-03-31')
    expect(s2.daysUntilDue).toBe(2)
    expect(s2.state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease2, [inv1, inv2], [], '2026-03-15').state).toBe('ok')
  })

  it('lease ending before next period but with an open invoice is still overdue once grace has passed', () => {
    const daily = makeLease({ id: 'lease-1', period_type: 'daily', start_date: '2026-03-01', end_date: '2026-03-03' })
    const inv = makeInvoice({ id: 'd1', period_start: '2026-03-01', period_end: '2026-03-03', quantity: 3, total_amount: 300_000 })
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-03-03').state).toBe('due_soon')
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-03-03', 3, 0).state).toBe('overdue')
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-03-05').state).toBe('overdue')
  })
})

// ---------- depositBalance ----------

describe('depositBalance', () => {
  const lease = makeLease({ id: 'lease-1', deposit_amount: 500_000 })

  it('nothing received yet', () => {
    expect(depositBalance(lease, [], [])).toEqual({ agreed: 500_000, received: 0, applied: 0, returned: 0, held: 0, shortfall: 500_000 })
  })

  it('sums deposit payments for the lease only; cash rent never counts', () => {
    const payments = [
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 300_000 }),
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 100_000, method: 'transfer' }),
      makePayment({ lease_id: 'lease-1', kind: 'rent', amount: 1_500_000, invoice_id: 'inv-1' }),
      makePayment({ lease_id: 'lease-2', kind: 'deposit', amount: 500_000 }),
    ]
    expect(depositBalance(lease, payments, [])).toEqual({
      agreed: 500_000,
      received: 400_000,
      applied: 0,
      returned: 0,
      held: 400_000,
      shortfall: 100_000,
    })
  })

  it('applied = rent/other payments with method deposit (potong jaminan); returned = deposit_refund expenses', () => {
    const payments = [
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 500_000, method: 'cash' }),
      // last month's rent taken from the deposit
      makePayment({ lease_id: 'lease-1', kind: 'rent', amount: 200_000, method: 'deposit', invoice_id: 'inv-9' }),
      // damage deduction
      makePayment({ lease_id: 'lease-1', kind: 'other', amount: 50_000, method: 'deposit', notes: 'Potongan jaminan: kunci hilang' }),
      // other lease's deduction must not count
      makePayment({ lease_id: 'lease-2', kind: 'rent', amount: 999_000, method: 'deposit', invoice_id: 'inv-z' }),
    ]
    const expenses = [
      makeExpense({ lease_id: 'lease-1', category: 'deposit_refund', amount: 200_000, expense_date: '2026-03-31' }),
      // rent refund is not a deposit return
      makeExpense({ lease_id: 'lease-1', category: 'rent_refund', amount: 100_000 }),
      // refund for another lease / no lease
      makeExpense({ lease_id: 'lease-2', category: 'deposit_refund', amount: 500_000 }),
      makeExpense({ lease_id: null, category: 'deposit_refund', amount: 500_000 }),
    ]
    expect(depositBalance(lease, payments, expenses)).toEqual({
      agreed: 500_000,
      received: 500_000,
      applied: 250_000,
      returned: 200_000,
      held: 50_000,
      shortfall: 0,
    })
  })

  it('held goes negative when more was applied/returned than received (not clamped); shortfall never negative', () => {
    const payments = [
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 600_000 }),
      makePayment({ lease_id: 'lease-1', kind: 'rent', amount: 300_000, method: 'deposit', invoice_id: 'inv-9' }),
    ]
    const expenses = [makeExpense({ lease_id: 'lease-1', category: 'deposit_refund', amount: 450_000 })]
    expect(depositBalance(lease, payments, expenses)).toEqual({
      agreed: 500_000,
      received: 600_000,
      applied: 300_000,
      returned: 450_000,
      held: -150_000,
      shortfall: 0,
    })
  })

  it('finding: a kind=deposit payment with method=deposit counts as received only (matches finance.depositsHeld)', () => {
    const payments = [makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 500_000, method: 'deposit' })]
    const b = depositBalance(lease, payments, [])
    expect(b.received).toBe(500_000)
    expect(b.applied).toBe(0)
    expect(b.held).toBe(500_000)
    expect(b.shortfall).toBe(0)
  })
})

// ---------- validateRentPayment ----------

describe('validateRentPayment', () => {
  const invoice = makeInvoice({ id: 'inv-1', total_amount: 1_500_000 })

  it('rejects non-positive amounts', () => {
    expect(validateRentPayment(invoice, [], 0)).toBe('Jumlah pembayaran harus lebih dari 0.')
    expect(validateRentPayment(invoice, [], -100)).toBe('Jumlah pembayaran harus lebih dari 0.')
    expect(validateRentPayment(invoice, [], Number.NaN)).toBe('Jumlah pembayaran harus lebih dari 0.')
  })

  it('rejects void invoices', () => {
    expect(validateRentPayment(makeInvoice({ status: 'void' }), [], 100_000)).toBe('Tagihan sudah dibatalkan.')
  })

  it('rejects already settled invoices', () => {
    const payments = [makePayment({ invoice_id: 'inv-1', amount: 1_500_000 })]
    expect(validateRentPayment(invoice, payments, 1)).toBe('Tagihan ini sudah lunas.')
    expect(validateRentPayment(makeInvoice({ total_amount: 0 }), [], 1)).toBe('Tagihan ini sudah lunas.')
  })

  it('rejects overpayment with the remaining amount formatted', () => {
    const payments = [makePayment({ invoice_id: 'inv-1', amount: 500_000 })]
    expect(validateRentPayment(invoice, payments, 1_000_001)).toBe('Jumlah melebihi sisa tagihan (Rp 1.000.000).')
    expect(validateRentPayment(invoice, [], 1_500_001)).toBe('Jumlah melebihi sisa tagihan (Rp 1.500.000).')
  })

  it('deposit payments do not reduce the rent outstanding', () => {
    const payments = [makePayment({ invoice_id: 'inv-1', amount: 1_500_000, kind: 'deposit' })]
    expect(validateRentPayment(invoice, payments, 1_500_000)).toBeNull()
    expect(validateRentPayment(invoice, payments, 1_500_001)).toBe('Jumlah melebihi sisa tagihan (Rp 1.500.000).')
  })

  it('accepts a DP and the exact remainder', () => {
    expect(validateRentPayment(invoice, [], 500_000)).toBeNull()
    const payments = [makePayment({ invoice_id: 'inv-1', amount: 500_000 })]
    expect(validateRentPayment(invoice, payments, 1_000_000)).toBeNull()
  })

  it('method deposit: rejects amounts above the held deposit, after the existing checks', () => {
    expect(validateRentPayment(invoice, [], 500_001, { method: 'deposit', depositHeld: 500_000 })).toBe('Jaminan yang dipegang hanya Rp 500.000.')
    expect(validateRentPayment(invoice, [], 500_000, { method: 'deposit', depositHeld: 500_000 })).toBeNull()
    expect(validateRentPayment(invoice, [], 1, { method: 'deposit', depositHeld: 0 })).toBe('Jaminan yang dipegang hanya Rp 0.')
    // overpayment message still wins when both apply
    expect(validateRentPayment(invoice, [], 1_500_001, { method: 'deposit', depositHeld: 100_000 })).toBe(
      'Jumlah melebihi sisa tagihan (Rp 1.500.000).',
    )
    expect(validateRentPayment(invoice, [], 0, { method: 'deposit', depositHeld: 0 })).toBe('Jumlah pembayaran harus lebih dari 0.')
  })

  it('method deposit without depositHeld, or other methods, skip the deposit check', () => {
    expect(validateRentPayment(invoice, [], 1_000_000, { method: 'deposit' })).toBeNull()
    expect(validateRentPayment(invoice, [], 1_000_000, { method: 'cash', depositHeld: 0 })).toBeNull()
    expect(validateRentPayment(invoice, [], 1_000_000, {})).toBeNull()
  })
})

// ---------- extra breakdown ----------

describe('parseExtraBreakdown / formatExtraBreakdown', () => {
  it('parses the canonical string', () => {
    expect(parseExtraBreakdown('Listrik: 125000; Denda: 50000; Lainnya: 10000')).toEqual({ listrik: 125_000, denda: 50_000, lainnya: 10_000 })
  })

  it('is case-insensitive, accepts thousand dots and an Rp prefix, and ignores surrounding text', () => {
    expect(parseExtraBreakdown('listrik: 125.000; DENDA: Rp 50.000')).toEqual({ listrik: 125_000, denda: 50_000 })
    expect(parseExtraBreakdown('Bayar telat. Denda: 25000 (3 hari). Listrik:75000')).toEqual({ denda: 25_000, listrik: 75_000 })
  })

  it('returns {} for null, empty or unrelated notes; a repeated label keeps the last value', () => {
    expect(parseExtraBreakdown(null)).toEqual({})
    expect(parseExtraBreakdown('')).toEqual({})
    expect(parseExtraBreakdown('Sudah termasuk air')).toEqual({})
    expect(parseExtraBreakdown('Denda: 10000; Denda: 20000')).toEqual({ denda: 20_000 })
  })

  it('formats in fixed order, omitting zero/undefined parts; empty -> ""', () => {
    expect(formatExtraBreakdown({ listrik: 125_000, denda: 50_000, lainnya: 10_000 })).toBe('Listrik: 125000; Denda: 50000; Lainnya: 10000')
    expect(formatExtraBreakdown({ lainnya: 10_000, listrik: 125_000 })).toBe('Listrik: 125000; Lainnya: 10000')
    expect(formatExtraBreakdown({ listrik: 0, denda: 50_000 })).toBe('Denda: 50000')
    expect(formatExtraBreakdown({})).toBe('')
    expect(formatExtraBreakdown({ listrik: 0, denda: undefined })).toBe('')
  })

  it('round-trips', () => {
    const parts = { listrik: 125_000, denda: 50_000 }
    expect(parseExtraBreakdown(formatExtraBreakdown(parts))).toEqual(parts)
  })
})


describe('isPaidUpAndEnding', () => {
  it('is true for a paid-up lease ending within the window, false otherwise', async () => {
    const { isPaidUpAndEnding } = await import('./billing')
    const base = { leaseId: 'L', coveredThrough: '2026-03-10', paidThrough: '2026-03-10', outstanding: 0, nextDueDate: '2026-03-11', daysUntilDue: 1, state: 'due_soon' as const }
    // last night 10 Mar -> check-out 11 Mar (SPEC 7.3)
    const lease = { ...makeLease({ status: 'active', start_date: '2026-03-01', end_date: '2026-03-10' }) }
    expect(isPaidUpAndEnding(lease, base, '2026-03-10')).toBe(true)
    expect(isPaidUpAndEnding(lease, base, '2026-03-04')).toBe(true) // check-out exactly 7 days away
    expect(isPaidUpAndEnding(lease, base, '2026-03-03')).toBe(false) // check-out 8 days away
    expect(isPaidUpAndEnding(lease, base, '2026-03-12')).toBe(false) // check-out day already past
    expect(isPaidUpAndEnding(lease, { ...base, outstanding: 500 }, '2026-03-10')).toBe(false)
    expect(isPaidUpAndEnding(lease, { ...base, state: 'unbilled' }, '2026-03-10')).toBe(false)
    expect(isPaidUpAndEnding({ ...lease, status: 'ended' }, base, '2026-03-10')).toBe(false)
  })

  it('still counts on the check-out day itself (end_date + 1), so the lease is not shown as due today', async () => {
    const { isPaidUpAndEnding } = await import('./billing')
    // rolling lease: next due = check-out day = today
    const onCheckoutDay = { leaseId: 'L', coveredThrough: '2026-03-10', paidThrough: '2026-03-10', outstanding: 0, nextDueDate: '2026-03-11', daysUntilDue: 0, state: 'due_soon' as const }
    const lease = makeLease({ status: 'active', start_date: '2026-03-01', end_date: '2026-03-10' })
    expect(isPaidUpAndEnding(lease, onCheckoutDay, '2026-03-11')).toBe(true)
    expect(isPaidUpAndEnding(lease, onCheckoutDay, '2026-03-11', 0)).toBe(true)
    expect(isPaidUpAndEnding(lease, onCheckoutDay, '2026-03-10', 0)).toBe(false)
    // month end / year end: last night 31 Des -> check-out 1 Jan
    expect(isPaidUpAndEnding({ ...lease, end_date: '2026-12-31' }, onCheckoutDay, '2027-01-01')).toBe(true)
    expect(isPaidUpAndEnding({ ...lease, end_date: '2026-12-31' }, onCheckoutDay, '2027-01-02')).toBe(false)
  })
})

// ---------- SPEC 5.2: period type / price overrides ----------

describe('nextPeriodBounds with a periodType override (SPEC 5.2)', () => {
  const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-03-01', end_date: '2026-03-10' })
  const billed = [makeInvoice({ period_start: '2026-03-01', period_end: '2026-03-10', quantity: 10, base_amount: 1_000_000, total_amount: 1_000_000 })]

  it('same type as the lease (explicit or omitted) keeps the anchored grid', () => {
    expect(nextPeriodBounds(daily, billed, 2, 'daily')).toEqual({ period_start: '2026-03-11', period_end: '2026-03-12' })
    expect(nextPeriodBounds(daily, billed, 2)).toEqual(nextPeriodBounds(daily, billed, 2, 'daily'))
    const monthly = makeLease({ start_date: '2026-01-31' })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' })
    expect(nextPeriodBounds(monthly, [first], 1, 'monthly')).toEqual({ period_start: '2026-02-28', period_end: '2026-03-30' })
  })

  it('different type: starts the day after the latest non-void period_end and uses the new type', () => {
    expect(nextPeriodBounds(daily, billed, 1, 'monthly')).toEqual({ period_start: '2026-03-11', period_end: '2026-04-10' })
    expect(nextPeriodBounds(daily, billed, 2, 'weekly')).toEqual({ period_start: '2026-03-11', period_end: '2026-03-24' })
  })

  it('different type with no invoices starts at lease.start_date; void invoices are ignored', () => {
    expect(nextPeriodBounds(daily, [], 1, 'monthly')).toEqual({ period_start: '2026-03-01', period_end: '2026-03-31' })
    const voided = makeInvoice({ period_start: '2026-03-11', period_end: '2026-03-20', quantity: 10, status: 'void' })
    expect(nextPeriodBounds(daily, [...billed, voided], 1, 'monthly')).toEqual({ period_start: '2026-03-11', period_end: '2026-04-10' })
  })

  it('different type on a monthly lease anchored on Jan 31 ignores the anchored grid (weekly from Feb 28)', () => {
    const monthly = makeLease({ start_date: '2026-01-31' })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' })
    expect(nextPeriodBounds(monthly, [first], 1, 'weekly')).toEqual({ period_start: '2026-02-28', period_end: '2026-03-06' })
  })

  it('still rejects quantity < 1', () => {
    expect(() => nextPeriodBounds(daily, billed, 0, 'monthly')).toThrow('Jumlah periode minimal 1')
  })
})

describe('buildInvoiceDraft with periodType / pricePerPeriod overrides (SPEC 5.2 / 5.4)', () => {
  const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-03-01', end_date: '2026-03-10' })
  const last = makeInvoice({
    invoice_number: 'INV-202603-0001',
    period_type: 'daily',
    period_start: '2026-03-01',
    period_end: '2026-03-10',
    quantity: 10,
    base_amount: 1_000_000,
    total_amount: 1_000_000,
    status: 'paid',
  })

  it('daily lease (Rp 100.000) extended as monthly (Rp 1.500.000) from the day after the last invoice', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(draft.period_type).toBe('monthly')
    expect(draft.price_per_period).toBe(1_500_000)
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-04-10') // 2026-03-11 + 1 month - 1 day
    expect(draft.quantity).toBe(1)
    expect(draft.base_amount).toBe(1_500_000)
    expect(draft.total_amount).toBe(1_500_000)
    expect(draft.due_date).toBe('2026-03-11')
    expect(draft.new_lease_end_date).toBe('2026-04-10')
    expect(draft.invoice_number).toBe('INV-202603-0002')
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
    expect(draft.warnings).toContain('Jenis periode berbeda dari sewa; periode berikutnya dihitung dari akhir tagihan ini.')
  })

  it('daily -> weekly x2 at Rp 600.000 per week', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 2, existingInvoices: [last], periodType: 'weekly', pricePerPeriod: 600_000 })
    expect(draft.period_type).toBe('weekly')
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-03-24')
    expect(draft.base_amount).toBe(1_200_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
  })

  it('same type (explicit) is unchanged: anchored bounds, lease price and no warning', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 3, existingInvoices: [last], periodType: 'daily' })
    expect(draft.period_type).toBe('daily')
    expect(draft.price_per_period).toBe(100_000)
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-03-13')
    expect(draft.base_amount).toBe(300_000)
    expect(draft.warnings).toEqual([])
    const implicit = buildInvoiceDraft({ lease: daily, addons: [], quantity: 3, existingInvoices: [last] })
    expect(implicit).toEqual(draft)
  })

  it('same type on a Jan-31 monthly lease stays on the anchored grid (Feb 28 .. Mar 30), no warning', () => {
    const monthly = makeLease({ start_date: '2026-01-31', end_date: '2026-02-27' })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const draft = buildInvoiceDraft({ lease: monthly, addons: [], quantity: 1, existingInvoices: [first], periodType: 'monthly' })
    expect(draft.period_start).toBe('2026-02-28')
    expect(draft.period_end).toBe('2026-03-30')
    expect(draft.warnings).toEqual([])
  })

  it('type change with no invoices yet starts at lease.start_date (first invoice gets one_time addons)', () => {
    const oneTime = makeAddon({ name: 'Kunci', amount: 50_000, billing: 'one_time' })
    const draft = buildInvoiceDraft({ lease: daily, addons: [oneTime], quantity: 1, existingInvoices: [], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(draft.period_start).toBe('2026-03-01')
    expect(draft.period_end).toBe('2026-03-31')
    expect(draft.addons_amount).toBe(50_000)
    expect(draft.total_amount).toBe(1_550_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
  })

  it('pricePerPeriod alone (negotiated price, same type): base = quantity * price, no warning', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 3, existingInvoices: [last], pricePerPeriod: 90_000 })
    expect(draft.period_type).toBe('daily')
    expect(draft.price_per_period).toBe(90_000)
    expect(draft.base_amount).toBe(270_000)
    expect(draft.warnings).toEqual([])
  })

  it('pricePerPeriod 0 is allowed (free period -> total 0)', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 2, existingInvoices: [last], pricePerPeriod: 0 })
    expect(draft.price_per_period).toBe(0)
    expect(draft.base_amount).toBe(0)
    expect(draft.total_amount).toBe(0)
  })

  it('baseAmount override wins over quantity * pricePerPeriod, but price_per_period still reports the effective price', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000, baseAmount: 1_400_000 })
    expect(draft.base_amount).toBe(1_400_000)
    expect(draft.price_per_period).toBe(1_500_000)
  })

  it('invalid pricePerPeriod throws "Nilai tidak boleh negatif."', () => {
    expect(() => buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], pricePerPeriod: -1 })).toThrow('Nilai tidak boleh negatif.')
    expect(() => buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], pricePerPeriod: Number.NaN })).toThrow('Nilai tidak boleh negatif.')
    expect(() => buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: -1_500_000 })).toThrow('Nilai tidak boleh negatif.')
  })

  it('periodStart override with a changed type uses the new type for the end and warns about both', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000, periodStart: '2026-03-15' })
    expect(draft.period_start).toBe('2026-03-15')
    expect(draft.period_end).toBe('2026-04-14')
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, WARN_OFF_SCHEDULE])
  })

  it('periodStart override equal to the fallback start with a changed type warns only about the type', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000, periodStart: '2026-03-11' })
    expect(draft.period_end).toBe('2026-04-10')
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
  })

  it('periodEnd (pro-rata) with a changed type: quantity 1, start from the fallback, custom end', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 5, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000, periodEnd: '2026-03-25', baseAmount: 750_000 })
    expect(draft.quantity).toBe(1)
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-03-25')
    expect(draft.base_amount).toBe(750_000)
    expect(draft.period_type).toBe('monthly')
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, WARN_OFF_SCHEDULE])
  })

  it('new_lease_end_date is max(lease.end_date, period_end) also with a type change', () => {
    const longLease = makeLease({ ...daily, end_date: '2026-06-30' })
    const draft = buildInvoiceDraft({ lease: longLease, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(draft.period_end).toBe('2026-04-10')
    expect(draft.new_lease_end_date).toBe('2026-06-30')
  })

  it('after a type-changed invoice is stored, the next default invoice (lease still daily) continues from its end', () => {
    const monthlyInv = makeInvoice({
      invoice_number: 'INV-202603-0002',
      period_type: 'monthly',
      period_start: '2026-03-11',
      period_end: '2026-04-10',
      quantity: 1,
      base_amount: 1_500_000,
      total_amount: 1_500_000,
      status: 'paid',
    })
    // billedPeriodCount is null (the monthly invoice is not on the daily grid), so the fallback applies: no gap
    expect(billedPeriodCount(daily, [last, monthlyInv])).toBeNull()
    const next = buildInvoiceDraft({ lease: daily, addons: [], quantity: 2, existingInvoices: [last, monthlyInv] })
    expect(next.period_start).toBe('2026-04-11')
    expect(next.period_end).toBe('2026-04-12')
    expect(next.period_type).toBe('daily')
    expect(next.warnings).toEqual([])
    // and when the lease itself was switched to monthly, the grid does not fit start_date (03-01) so the chain
    // re-anchors on the monthly switch invoice (03-11): the 11th stays the billing day
    const switched = makeLease({ ...daily, period_type: 'monthly', price_per_period: 1_500_000 })
    expect(chainAnchor(switched, [last, monthlyInv])).toEqual({ anchor: '2026-03-11', count: 1 })
    const nextMonthly = buildInvoiceDraft({ lease: switched, addons: [], quantity: 1, existingInvoices: [last, monthlyInv] })
    expect(nextMonthly).toMatchObject({ period_start: '2026-04-11', period_end: '2026-05-10', base_amount: 1_500_000, period_type: 'monthly', warnings: [] })
  })
})

// ---------- findings on SPEC 5.2 type changes ----------

describe('finding: per_period add-ons on a type-changed invoice are charged per lease period', () => {
  const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-03-01', end_date: '2026-03-10' })
  const last = makeInvoice({ period_type: 'daily', period_start: '2026-03-01', period_end: '2026-03-10', quantity: 10, status: 'paid' })
  const parkir = makeAddon({ name: 'Parkir motor', amount: 10_000, billing: 'per_period' })

  it('daily lease with Parkir motor Rp 10.000/malam extended monthly: 31 nights = Rp 310.000, with a unit warning', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-04-10')
    expect(draft.base_amount).toBe(1_500_000)
    expect(draft.addons_amount).toBe(310_000) // not 10.000 x quantity 1
    expect(draft.total_amount).toBe(1_810_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, addonUnitWarning('daily', 31)])
    expect(draft.warnings[1]).toBe('Add-on per periode dihitung per malam sesuai satuan sewa (31 malam); periksa jumlahnya.')
  })

  it('daily -> weekly x2 charges 14 nights of the add-on', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 2, existingInvoices: [last], periodType: 'weekly', pricePerPeriod: 600_000 })
    expect(draft.period_end).toBe('2026-03-24')
    expect(draft.addons_amount).toBe(140_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, addonUnitWarning('daily', 14)])
  })

  it('weekly lease (laundry Rp 50.000/minggu) extended monthly over 31 days: 5 weeks rounded up', () => {
    const weekly = makeLease({ period_type: 'weekly', price_per_period: 600_000, start_date: '2026-03-02', end_date: '2026-03-08' })
    const w1 = makeInvoice({ period_type: 'weekly', period_start: '2026-03-02', period_end: '2026-03-08', status: 'paid' })
    const laundry = makeAddon({ name: 'Laundry', amount: 50_000, billing: 'per_period' })
    const draft = buildInvoiceDraft({ lease: weekly, addons: [laundry], quantity: 1, existingInvoices: [w1], periodType: 'monthly', pricePerPeriod: 2_000_000 })
    expect(draft.period_start).toBe('2026-03-09')
    expect(draft.period_end).toBe('2026-04-08')
    expect(draft.addons_amount).toBe(250_000)
    expect(draft.warnings).toContain('Add-on per periode dihitung per minggu sesuai satuan sewa (5 minggu); periksa jumlahnya.')
  })

  it('monthly lease (parkir Rp 100.000/bulan) billed 3 nights daily charges one month of the add-on and warns', () => {
    const monthly = makeLease({ start_date: '2026-01-31', end_date: '2026-02-27' })
    const first = makeInvoice({ period_type: 'monthly', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    const addon = makeAddon({ name: 'Parkir mobil', amount: 100_000, billing: 'per_period' })
    const draft = buildInvoiceDraft({ lease: monthly, addons: [addon], quantity: 3, existingInvoices: [first], periodType: 'daily', pricePerPeriod: 150_000 })
    expect(draft.period_start).toBe('2026-02-28')
    expect(draft.period_end).toBe('2026-03-02')
    expect(draft.base_amount).toBe(450_000)
    expect(draft.addons_amount).toBe(100_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, addonUnitWarning('monthly', 1)])
    expect(draft.warnings[1]).toBe('Add-on per periode dihitung per bulan sesuai satuan sewa (1 bulan); periksa jumlahnya.')
  })

  it('addonsAmount override replaces the computed add-ons and silences the unit warning; negative throws', () => {
    const draft = buildInvoiceDraft({
      lease: daily,
      addons: [parkir],
      quantity: 1,
      existingInvoices: [last],
      periodType: 'monthly',
      pricePerPeriod: 1_500_000,
      addonsAmount: 150_000,
    })
    expect(draft.addons_amount).toBe(150_000)
    expect(draft.total_amount).toBe(1_650_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
    expect(() =>
      buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000, addonsAmount: -1 }),
    ).toThrow('Nilai tidak boleh negatif.')
    // the override also works without a type change
    const sameType = buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 3, existingInvoices: [last], addonsAmount: 0 })
    expect(sameType.addons_amount).toBe(0)
    expect(sameType.warnings).toEqual([])
  })

  it('no unit warning without per_period add-ons, and none when the type is unchanged', () => {
    const oneTime = makeAddon({ name: 'Kunci', amount: 50_000, billing: 'one_time' })
    const changed = buildInvoiceDraft({ lease: daily, addons: [oneTime], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(changed.addons_amount).toBe(0) // one_time only on the first invoice
    expect(changed.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
    const same = buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 3, existingInvoices: [last] })
    expect(same.addons_amount).toBe(30_000)
    expect(same.warnings).toEqual([])
  })

  it('a pro-rata (periodEnd) type change counts the lease periods covered by the custom dates', () => {
    const draft = buildInvoiceDraft({
      lease: daily,
      addons: [parkir],
      quantity: 1,
      existingInvoices: [last],
      periodType: 'monthly',
      pricePerPeriod: 1_500_000,
      periodEnd: '2026-03-25',
      baseAmount: 750_000,
    })
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.addons_amount).toBe(150_000) // 15 nights
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, WARN_OFF_SCHEDULE, addonUnitWarning('daily', 15)])
  })

  it('addonPeriodQuantity: same type -> quantity; different type -> lease periods covering the bounds', () => {
    const bounds = { period_start: '2026-03-11', period_end: '2026-04-10' }
    expect(addonPeriodQuantity(daily, 'daily', bounds, 4)).toBe(4)
    expect(addonPeriodQuantity(daily, 'monthly', bounds, 1)).toBe(31)
    expect(addonPeriodQuantity(makeLease({ period_type: 'weekly' }), 'monthly', bounds, 1)).toBe(5)
    expect(addonPeriodQuantity(makeLease({ period_type: 'monthly' }), 'daily', { period_start: '2026-02-28', period_end: '2026-03-02' }, 3)).toBe(1)
  })
})

describe('finding: type change without pricePerPeriod warns that the old unit price is used', () => {
  const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-03-01', end_date: '2026-03-10' })
  const last = makeInvoice({ period_type: 'daily', period_start: '2026-03-01', period_end: '2026-03-10', quantity: 10, status: 'paid' })

  it('daily Rp 100.000 billed monthly with no price: base 100.000 for a month plus WARN_PRICE_NOT_SET', () => {
    const draft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly' })
    expect(draft.period_type).toBe('monthly')
    expect(draft.period_start).toBe('2026-03-11')
    expect(draft.period_end).toBe('2026-04-10')
    expect(draft.price_per_period).toBe(100_000)
    expect(draft.base_amount).toBe(100_000)
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, WARN_PRICE_NOT_SET])
    expect(WARN_PRICE_NOT_SET).toBe(
      'Harga per periode belum disesuaikan dengan jenis periode baru; tarif sewa lama dipakai apa adanya. Periksa harganya.',
    )
  })

  it('no price warning when pricePerPeriod or baseAmount is given, or when the type is unchanged', () => {
    const priced = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(priced.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
    const based = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [last], periodType: 'monthly', baseAmount: 1_400_000 })
    expect(based.base_amount).toBe(1_400_000)
    expect(based.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
    const same = buildInvoiceDraft({ lease: daily, addons: [], quantity: 2, existingInvoices: [last] })
    expect(same.warnings).toEqual([])
  })

  it('orders warnings: type changed, off schedule, price not set, add-on unit', () => {
    const parkir = makeAddon({ name: 'Parkir motor', amount: 10_000, billing: 'per_period' })
    const draft = buildInvoiceDraft({ lease: daily, addons: [parkir], quantity: 1, existingInvoices: [last], periodType: 'monthly', periodStart: '2026-03-15' })
    expect(draft.period_end).toBe('2026-04-14')
    expect(draft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED, WARN_OFF_SCHEDULE, WARN_PRICE_NOT_SET, addonUnitWarning('daily', 31)])
  })
})

describe('finding: month-end chain re-anchors on the switch invoice once the lease type is made monthly', () => {
  // daily guest from Jan 1 billed through Jan 30, extended monthly from Jan 31 (Rp 1.500.000)
  const daily = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2026-01-01', end_date: '2026-01-30' })
  const nights = makeInvoice({ period_type: 'daily', period_start: '2026-01-01', period_end: '2026-01-30', quantity: 30, status: 'paid' })
  const switchDraft = buildInvoiceDraft({ lease: daily, addons: [], quantity: 1, existingInvoices: [nights], periodType: 'monthly', pricePerPeriod: 1_500_000 })
  const switchInv = makeInvoice({
    period_type: 'monthly',
    period_start: switchDraft.period_start,
    period_end: switchDraft.period_end,
    base_amount: 1_500_000,
    total_amount: 1_500_000,
    status: 'paid',
  })
  const switched = makeLease({ ...daily, period_type: 'monthly', price_per_period: 1_500_000, end_date: switchInv.period_end })

  it('the switch invoice is 2026-01-31..2026-02-27', () => {
    expect(switchDraft.period_start).toBe('2026-01-31')
    expect(switchDraft.period_end).toBe('2026-02-27')
    expect(switchDraft.warnings).toEqual([WARN_PERIOD_TYPE_CHANGED])
  })

  it('chainAnchor: start_date grid does not fit, so the chain anchors on the switch invoice', () => {
    expect(billedPeriodCount(switched, [nights, switchInv])).toBeNull()
    expect(chainAnchor(switched, [nights, switchInv])).toEqual({ anchor: '2026-01-31', count: 1 })
  })

  it('next default invoices keep the 31st as billing day: 02-28..03-30, 03-31..04-29, 04-30..05-30 (no drift)', () => {
    const second = buildInvoiceDraft({ lease: switched, addons: [], quantity: 1, existingInvoices: [nights, switchInv] })
    expect(second).toMatchObject({ period_type: 'monthly', period_start: '2026-02-28', period_end: '2026-03-30', base_amount: 1_500_000, warnings: [] })
    expect(second.due_date).toBe('2026-02-28')
    expect(second.new_lease_end_date).toBe('2026-03-30')

    const inv2 = makeInvoice({ period_type: 'monthly', period_start: second.period_start, period_end: second.period_end, status: 'paid' })
    const third = nextPeriodBounds(makeLease({ ...switched, end_date: inv2.period_end }), [nights, switchInv, inv2], 1)
    expect(third).toEqual({ period_start: '2026-03-31', period_end: '2026-04-29' })
    expect(chainAnchor(switched, [nights, switchInv, inv2])).toEqual({ anchor: '2026-01-31', count: 2 })

    const inv3 = makeInvoice({ period_type: 'monthly', period_start: third.period_start, period_end: third.period_end, status: 'paid' })
    expect(nextPeriodBounds(switched, [nights, switchInv, inv2, inv3], 1)).toEqual({ period_start: '2026-04-30', period_end: '2026-05-30' })
    // quantity 2 from the anchor as well
    expect(nextPeriodBounds(switched, [nights, switchInv, inv2, inv3], 2)).toEqual({ period_start: '2026-04-30', period_end: '2026-06-29' })

    // the dashboard's next due date agrees with the re-anchored start
    const s = summarizeLeaseBilling(makeLease({ ...switched, end_date: inv2.period_end }), [nights, switchInv, inv2], [], '2026-03-25')
    expect(s.nextDueDate).toBe('2026-03-31')
  })

  it('legacy daily invoices with period_type null (read as the lease type) still re-anchor on the switch invoice', () => {
    const legacy = makeInvoice({ period_type: null, period_start: '2026-01-01', period_end: '2026-01-30', quantity: 30, status: 'paid' })
    expect(chainAnchor(switched, [legacy, switchInv])).toEqual({ anchor: '2026-01-31', count: 1 })
    expect(nextPeriodBounds(switched, [legacy, switchInv], 1)).toEqual({ period_start: '2026-02-28', period_end: '2026-03-30' })
  })

  it('while the lease is still daily the monthly invoice is another type: no anchor, plain fallback', () => {
    expect(chainAnchor(daily, [nights, switchInv])).toBeNull()
    expect(nextPeriodBounds(daily, [nights, switchInv], 2)).toEqual({ period_start: '2026-02-28', period_end: '2026-03-01' })
  })

  it('leap year: switch invoice 2024-01-31..2024-02-28 -> 02-29..03-30 -> 03-31..04-29', () => {
    const d24 = makeLease({ period_type: 'daily', price_per_period: 100_000, start_date: '2024-01-01', end_date: '2024-01-30' })
    const n24 = makeInvoice({ period_type: 'daily', period_start: '2024-01-01', period_end: '2024-01-30', quantity: 30, status: 'paid' })
    const sw = buildInvoiceDraft({ lease: d24, addons: [], quantity: 1, existingInvoices: [n24], periodType: 'monthly', pricePerPeriod: 1_500_000 })
    expect(sw.period_end).toBe('2024-02-28')
    const swInv = makeInvoice({ period_type: 'monthly', period_start: sw.period_start, period_end: sw.period_end, status: 'paid' })
    const m24 = makeLease({ ...d24, period_type: 'monthly', price_per_period: 1_500_000 })
    expect(nextPeriodBounds(m24, [n24, swInv], 1)).toEqual({ period_start: '2024-02-29', period_end: '2024-03-30' })
    const inv2 = makeInvoice({ period_type: 'monthly', period_start: '2024-02-29', period_end: '2024-03-30', status: 'paid' })
    expect(nextPeriodBounds(m24, [n24, swInv, inv2], 1)).toEqual({ period_start: '2024-03-31', period_end: '2024-04-29' })
  })

  it('chainAnchor on the normal grid is start_date with billedPeriodCount; empty -> count 0; pro-rata end -> null', () => {
    const lease = makeLease({ start_date: '2026-01-31' })
    expect(chainAnchor(lease, [])).toEqual({ anchor: '2026-01-31', count: 0 })
    const first = makeInvoice({ period_start: '2026-01-31', period_end: '2026-02-27' })
    const second = makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-30' })
    expect(chainAnchor(lease, [first, second])).toEqual({ anchor: '2026-01-31', count: 2 })
    // manual 02-28..03-27 breaks the start_date grid: re-anchor on that invoice (same bounds as "end + 1")
    const manual = makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-27' })
    expect(chainAnchor(lease, [first, manual])).toEqual({ anchor: '2026-02-28', count: 1 })
    expect(nextPeriodBounds(lease, [first, manual], 1)).toEqual({ period_start: '2026-03-28', period_end: '2026-04-27' })
    // a pro-rata end is not a whole period from its start: no anchor, fallback
    const proRata = makeInvoice({ period_start: '2026-02-28', period_end: '2026-03-13' })
    expect(chainAnchor(lease, [first, proRata])).toBeNull()
    expect(nextPeriodBounds(lease, [first, proRata], 1)).toEqual({ period_start: '2026-03-14', period_end: '2026-04-13' })
  })

  it('a manual first invoice on the 31st of a lease that started mid-month anchors the chain on the 31st', () => {
    const lease = makeLease({ start_date: '2026-01-15', end_date: '2026-02-27' })
    const manual = makeInvoice({ period_type: 'monthly', period_start: '2026-01-31', period_end: '2026-02-27', status: 'paid' })
    expect(billedPeriodCount(lease, [manual])).toBeNull()
    expect(chainAnchor(lease, [manual])).toEqual({ anchor: '2026-01-31', count: 1 })
    // previously the fallback gave 02-28..03-27 and the billing day drifted to the 28th
    expect(nextPeriodBounds(lease, [manual], 1)).toEqual({ period_start: '2026-02-28', period_end: '2026-03-30' })
  })
})

describe('invoicePeriodType / invoiceUnitLabel', () => {
  const daily = makeLease({ period_type: 'daily' })
  it('uses the invoice period_type when stored, else the lease type', () => {
    expect(invoicePeriodType(makeInvoice({ period_type: 'monthly' }), daily)).toBe('monthly')
    expect(invoicePeriodType(makeInvoice({ period_type: 'weekly' }), daily)).toBe('weekly')
    expect(invoicePeriodType(makeInvoice({ period_type: null }), daily)).toBe('daily')
    expect(invoicePeriodType(makeInvoice({ period_type: null }), makeLease({ period_type: 'monthly' }))).toBe('monthly')
  })
  it('labels the unit in Indonesian', () => {
    expect(invoiceUnitLabel(makeInvoice({ period_type: null }), daily)).toBe('malam')
    expect(invoiceUnitLabel(makeInvoice({ period_type: 'weekly' }), daily)).toBe('minggu')
    expect(invoiceUnitLabel(makeInvoice({ period_type: 'monthly' }), daily)).toBe('bulan')
  })
})

describe('nextDueSortKey (SPEC 5.1)', () => {
  const today = '2026-10-12'
  it('returns nextDueDate, or 9999-12-31 when null', () => {
    const lease = makeLease({ start_date: '2026-10-20' })
    const s = summarizeLeaseBilling(lease, [], [], today)
    expect(nextDueSortKey(s)).toBe('2026-10-20')
    expect(nextDueSortKey({ ...s, nextDueDate: null })).toBe('9999-12-31')
  })
  it('sorts overdue first, then due soon, then far away, then no due date', () => {
    const overdue = summarizeLeaseBilling(
      makeLease({ id: 'overdue', start_date: '2026-09-01' }),
      [makeInvoice({ lease_id: 'overdue', period_start: '2026-09-01', period_end: '2026-09-30', status: 'unpaid' })],
      [],
      today,
    )
    const dueSoon = summarizeLeaseBilling(
      makeLease({ id: 'soon', start_date: '2026-09-14' }),
      [makeInvoice({ lease_id: 'soon', period_start: '2026-09-14', period_end: '2026-10-13', status: 'paid' })],
      [],
      today,
    )
    const far = summarizeLeaseBilling(makeLease({ id: 'far', start_date: '2026-11-01' }), [], [], today)
    const none = { ...far, leaseId: 'none', nextDueDate: null }
    expect(overdue.state).toBe('overdue')
    expect(dueSoon.state).toBe('due_soon')
    expect(nextDueSortKey(overdue)).toBe('2026-09-01')
    expect(nextDueSortKey(dueSoon)).toBe('2026-10-14')
    expect(nextDueSortKey(far)).toBe('2026-11-01')
    const sorted = [none, far, dueSoon, overdue].sort((a, b) => (nextDueSortKey(a) < nextDueSortKey(b) ? -1 : nextDueSortKey(a) > nextDueSortKey(b) ? 1 : 0))
    expect(sorted.map((s) => s.leaseId)).toEqual(['overdue', 'soon', 'far', 'none'])
  })
})
