import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Payment } from '../types/db'
import {
  billedPeriodCount,
  buildInvoiceDraft,
  computeAddonsAmount,
  depositBalance,
  deriveInvoiceStatus,
  invoiceNumber,
  nextInvoiceSequence,
  nextPeriodBounds,
  nextPeriodStart,
  outstandingFor,
  paidAmountFor,
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
    deposit_returned_amount: null,
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

  it('counts invoices in the same month (including void) across leases', () => {
    const org = [
      makeInvoice({ lease_id: 'a', period_start: '2026-03-01', period_end: '2026-03-31' }),
      makeInvoice({ lease_id: 'b', period_start: '2026-03-15', period_end: '2026-04-14', status: 'void' }),
      makeInvoice({ lease_id: 'c', period_start: '2026-02-28', period_end: '2026-03-27' }),
      makeInvoice({ lease_id: 'd', period_start: '2025-03-10', period_end: '2025-04-09' }),
    ]
    expect(nextInvoiceSequence('2026-03-20', org)).toBe(3)
    expect(nextInvoiceSequence('2026-02-01', org)).toBe(2)
    expect(nextInvoiceSequence('2026-04-01', org)).toBe(1)
    expect(nextInvoiceSequence('2026-04-01', [])).toBe(1)
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
      period_start: '2026-01-31',
      period_end: '2026-02-27',
      quantity: 1,
      base_amount: 1_500_000,
      addons_amount: 250_000,
      extra_amount: 0,
      discount_amount: 0,
      total_amount: 1_750_000,
      due_date: '2026-01-31',
      invoice_number: 'INV-202601-0001',
      new_lease_end_date: '2026-02-27',
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

  it('applies extra and discount; discount larger than total floors at 0', () => {
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

    const free = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: [], discountAmount: 9_000_000 })
    expect(free.total_amount).toBe(0)
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
      makeInvoice({ lease_id: 'other-1', period_start: '2026-01-05', period_end: '2026-02-04' }),
      makeInvoice({ lease_id: 'other-2', period_start: '2026-01-10', period_end: '2026-02-09' }),
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

  it('nothing billed and start within dueSoonDays -> due_soon; start passed -> overdue', () => {
    expect(summarizeLeaseBilling(lease, [], [], '2026-01-29').state).toBe('due_soon')
    expect(summarizeLeaseBilling(lease, [], [], '2026-01-31').state).toBe('due_soon')
    const late = summarizeLeaseBilling(lease, [], [], '2026-02-02')
    expect(late.state).toBe('overdue')
    expect(late.daysUntilDue).toBe(-2)
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
    expect(s.state).toBe('overdue')
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

    const late = summarizeLeaseBilling(lease, [inv], [], '2026-03-02')
    expect(late.daysUntilDue).toBe(-2)
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

  it('lease ending before next period but with an open invoice is still overdue', () => {
    const daily = makeLease({ id: 'lease-1', period_type: 'daily', start_date: '2026-03-01', end_date: '2026-03-03' })
    const inv = makeInvoice({ id: 'd1', period_start: '2026-03-01', period_end: '2026-03-03', quantity: 3, total_amount: 300_000 })
    expect(summarizeLeaseBilling(daily, [inv], [], '2026-03-03').state).toBe('overdue')
  })
})

// ---------- depositBalance ----------

describe('depositBalance', () => {
  const lease = makeLease({ id: 'lease-1', deposit_amount: 500_000 })

  it('nothing received yet', () => {
    expect(depositBalance(lease, [])).toEqual({ agreed: 500_000, received: 0, returned: 0, held: 0, shortfall: 500_000 })
  })

  it('sums deposit payments for the lease only; rent never counts', () => {
    const payments = [
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 300_000 }),
      makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 100_000 }),
      makePayment({ lease_id: 'lease-1', kind: 'rent', amount: 1_500_000, invoice_id: 'inv-1' }),
      makePayment({ lease_id: 'lease-2', kind: 'deposit', amount: 500_000 }),
    ]
    expect(depositBalance(lease, payments)).toEqual({ agreed: 500_000, received: 400_000, returned: 0, held: 400_000, shortfall: 100_000 })
  })

  it('accounts for the refund at checkout; shortfall never negative', () => {
    const refunded = makeLease({ id: 'lease-1', deposit_amount: 500_000, deposit_returned_amount: 450_000, status: 'ended' })
    const payments = [makePayment({ lease_id: 'lease-1', kind: 'deposit', amount: 600_000 })]
    expect(depositBalance(refunded, payments)).toEqual({ agreed: 500_000, received: 600_000, returned: 450_000, held: 150_000, shortfall: 0 })
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
})
