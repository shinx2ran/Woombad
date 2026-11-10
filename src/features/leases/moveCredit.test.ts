import { describe, expect, it } from 'vitest'
import type { Invoice, Payment } from '../../types/db'
import { unusedPaidRent } from './moveCredit'

// SPEC 7.24: the owner's example: 3 nights paid in B3, the guest moves after 2 nights
const inv = (id: string, start: string, end: string, total: number, over: Partial<Invoice> = {}): Invoice =>
  ({ id, lease_id: 'L1', period_start: start, period_end: end, base_amount: total, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: total, status: 'paid', ...over }) as Invoice
const pay = (invoiceId: string, amount: number, kind: Payment['kind'] = 'rent'): Payment => ({ id: `p-${invoiceId}-${amount}`, invoice_id: invoiceId, lease_id: 'L1', amount, kind }) as Payment

describe('unusedPaidRent', () => {
  const threeNights = inv('i1', '2026-11-10', '2026-11-12', 450_000)

  it('3 nights for Rp 450.000, moving on the 3rd day: 1 night left, worth Rp 150.000, paid through 12 Nov, a new stay may start 13 Nov', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-12')).toEqual({ nights: 1, amount: 150_000, paidThrough: '2026-11-12', resumeOn: '2026-11-13' })
  })

  it('moving on the first day: everything is left; on the check-out day: nothing', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-10')).toMatchObject({ nights: 3, amount: 450_000 })
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-13')).toEqual({ nights: 0, amount: 0, paidThrough: null, resumeOn: null })
    // a move dated before the paid period starts: the nights in between are not paid, so nothing runs on from the move day
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '2026-11-01')).toMatchObject({ nights: 0, amount: 0 })
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

  it('only the rent is given back: a one-time add-on, a late fee and a discount stay out of it', () => {
    // 3 nights x 150.000 + add-on 30.000 = 480.000 paid: one night is still worth 150.000, not 160.000
    const withAddon = inv('a1', '2026-11-10', '2026-11-12', 480_000, { base_amount: 450_000, addons_amount: 30_000 })
    expect(unusedPaidRent('L1', [withAddon], [pay('a1', 480_000)], '2026-11-12').amount).toBe(150_000)
    const withFee = inv('a2', '2026-11-10', '2026-11-12', 500_000, { base_amount: 450_000, extra_amount: 50_000 })
    expect(unusedPaidRent('L1', [withFee], [pay('a2', 500_000)], '2026-11-12').amount).toBe(150_000)
    // a discounted stay: 450.000 - 90.000 = 360.000 paid, one night worth 120.000
    const discounted = inv('a3', '2026-11-10', '2026-11-12', 360_000, { base_amount: 450_000, discount_amount: 90_000 })
    expect(unusedPaidRent('L1', [discounted], [pay('a3', 360_000)], '2026-11-12').amount).toBe(120_000)
  })

  it('a gap ends the run: paid 10-12, unpaid 13-15, paid 16-18: moving on the 12th leaves 1 night, paid through the 12th', () => {
    const a = inv('g1', '2026-11-10', '2026-11-12', 450_000)
    const gap = inv('g2', '2026-11-13', '2026-11-15', 450_000, { status: 'unpaid' })
    const c = inv('g3', '2026-11-16', '2026-11-18', 450_000)
    expect(unusedPaidRent('L1', [c, gap, a], [pay('g1', 450_000), pay('g3', 450_000)], '2026-11-12')).toEqual({ nights: 1, amount: 150_000, paidThrough: '2026-11-12', resumeOn: '2026-11-13' })
  })

  it('an empty or malformed move date leaves nothing', () => {
    expect(unusedPaidRent('L1', [threeNights], [pay('i1', 450_000)], '')).toEqual({ nights: 0, amount: 0, paidThrough: null, resumeOn: null })
  })
})
