import { describe, expect, it } from 'vitest'
import type { Invoice, Payment } from '../../types/db'
import { unusedPaidRent } from './moveCredit'

// SPEC 7.24: the owner's example: 3 nights paid in B3, the guest moves after 2 nights
const inv = (id: string, start: string, end: string, total: number, over: Partial<Invoice> = {}): Invoice =>
  ({ id, lease_id: 'L1', period_start: start, period_end: end, total_amount: total, status: 'paid', ...over }) as Invoice
const pay = (invoiceId: string, amount: number, kind: Payment['kind'] = 'rent'): Payment => ({ id: `p-${invoiceId}-${amount}`, invoice_id: invoiceId, lease_id: 'L1', amount, kind }) as Payment

describe('unusedPaidRent', () => {
  const threeNights = inv('i1', '2026-11-10', '2026-11-12', 450_000)

  it('3 nights for Rp 450.000, moving on the 3rd day: 1 night left, worth Rp 150.000, paid through 12 Nov, a new stay may start 13 Nov', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-12')).toEqual({ nights: 1, amount: 150_000, paidThrough: '2026-11-12', resumeOn: '2026-11-13' })
  })

  it('moving on the first day: everything is left; on the check-out day: nothing', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-10')).toMatchObject({ nights: 3, amount: 450_000 })
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-13')).toEqual({ nights: 0, amount: 0, paidThrough: null, resumeOn: null })
    // a move dated before the invoice starts counts the invoice's own nights only
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-01')).toMatchObject({ nights: 3, amount: 450_000 })
  })

  it('rounds down, never more than was paid: Rp 100.000 for 3 nights, 1 left = Rp 33.333', () => {
    expect(unusedPaidRent('L1', [inv('i1', '2026-11-10', '2026-11-12', 100_000)], [pay('i1', 100_000)], '2026-11-12').amount).toBe(33_333)
  })

  it('only settled invoices count: unpaid, part-paid, void, free and other leases are left out; deposits are not rent', () => {
    const partly = inv('i2', '2026-11-10', '2026-11-12', 450_000, { status: 'partial' })
    expect(unusedPaidRent('L1', [partly], [pay('i2', 200_000)], '2026-11-12').nights).toBe(0)
    expect(unusedPaidRent('L1', [partly], [pay('i2', 200_000), pay('i2', 250_000, 'deposit')], '2026-11-12').nights).toBe(0)
    expect(unusedPaidRent('L1', [inv('i3', '2026-11-10', '2026-11-12', 450_000, { status: 'void' })], [pay('i3', 450_000)], '2026-11-12').nights).toBe(0)
    expect(unusedPaidRent('L1', [inv('i4', '2026-11-10', '2026-11-12', 0)], [], '2026-11-12').nights).toBe(0)
    expect(unusedPaidRent('L1', [{ ...threeNights, lease_id: 'L2' }], [pay('i1', 450_000)], '2026-11-12').nights).toBe(0)
    // settled by payments although the status column still says partial
    expect(unusedPaidRent('L1', [partly], [pay('i2', 450_000)], '2026-11-12')).toMatchObject({ nights: 1, amount: 150_000 })
  })

  it('several paid invoices ahead add up: a week paid plus the next week paid, moving mid-first-week', () => {
    const w1 = inv('w1', '2026-11-10', '2026-11-16', 700_000)
    const w2 = inv('w2', '2026-11-17', '2026-11-23', 700_000)
    // 14 Nov: nights 14, 15, 16 of week 1 (3/7 of 700.000 = 300.000) and all of week 2
    expect(unusedPaidRent('L1', [w1, w2], [pay('w1', 700_000), pay('w2', 700_000)], '2026-11-14')).toEqual({ nights: 10, amount: 1_000_000, paidThrough: '2026-11-23', resumeOn: '2026-11-24' })
  })

  it('an empty or malformed move date leaves nothing', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '')).toEqual({ nights: 0, amount: 0, paidThrough: null, resumeOn: null })
  })
})
