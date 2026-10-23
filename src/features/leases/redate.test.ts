import { describe, expect, it } from 'vitest'
import type { Invoice, InvoiceStatus, Lease, Payment, PeriodType } from '../../types/db'
import { billedPeriodCount, latestCoveredThrough, nextPeriodBounds } from '../../domain/billing'
import { addDaysISO } from '../../domain/period'
import {
  REDATE_INACTIVE_MESSAGE,
  REDATE_INVALID_DATE_MESSAGE,
  REDATE_SAME_DATE_MESSAGE,
  applyRedatePlan,
  gridIndexOf,
  leaseStateText,
  nightsOf,
  planLeaseRedate,
  redateDataChanged,
  redateNoteLine,
  redateNotes,
  redateShiftWarning,
  redateStatePreview,
  type LeaseRedatePlan,
} from './redate'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function mkLease(over: Partial<Lease> = {}): Lease {
  return {
    id: 'L',
    ...ts,
    property_id: 'P',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 1_000_000,
    start_date: '2026-09-01',
    end_date: '2026-11-30',
    status: 'active',
    checkout_date: null,
    notes: null,
    ...over,
  }
}

let seq = 0
function mkInv(id: string, start: string, end: string, opts: { quantity?: number; status?: InvoiceStatus; due?: string; type?: PeriodType | null; lease?: string; total?: number } = {}): Invoice {
  seq += 1
  return {
    id,
    ...ts,
    property_id: 'P',
    lease_id: opts.lease ?? 'L',
    invoice_number: `INV-${start.slice(0, 7).replace('-', '')}-${String(seq).padStart(4, '0')}`,
    period_type: opts.type === undefined ? null : opts.type,
    period_start: start,
    period_end: end,
    quantity: opts.quantity ?? 1,
    base_amount: opts.total ?? 1_500_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: opts.total ?? 1_500_000,
    due_date: opts.due ?? start,
    status: opts.status ?? 'unpaid',
    notes: null,
  }
}

const periods = (plan: LeaseRedatePlan) => plan.invoices.map((r) => [r.invoice.id, r.after.period_start, r.after.period_end])

/** The owner's monthly lease: started (wrongly) on 1 Sep, billed Sep, Oct, Nov. */
function ownerCase() {
  const lease = mkLease()
  const invoices = [
    mkInv('SEP', '2026-09-01', '2026-09-30', { status: 'paid' }),
    mkInv('OCT', '2026-10-01', '2026-10-31', { status: 'paid' }),
    mkInv('NOV', '2026-11-01', '2026-11-30'),
  ]
  return { lease, invoices }
}

describe('gridIndexOf', () => {
  it('finds the period index of a grid point, null otherwise', () => {
    expect(gridIndexOf('2026-01-31', 'monthly', '2026-01-31')).toBe(0)
    expect(gridIndexOf('2026-01-31', 'monthly', '2026-02-28')).toBe(1)
    expect(gridIndexOf('2026-01-31', 'monthly', '2026-03-31')).toBe(2)
    expect(gridIndexOf('2026-01-31', 'monthly', '2026-03-01')).toBeNull()
    expect(gridIndexOf('2026-01-31', 'monthly', '2026-01-30')).toBeNull()
    expect(gridIndexOf('2024-01-31', 'monthly', '2024-02-29')).toBe(1)
    expect(gridIndexOf('2026-01-31', 'monthly', '2027-01-31')).toBe(12)
    expect(gridIndexOf('2026-10-05', 'weekly', '2026-10-19')).toBe(2)
    expect(gridIndexOf('2026-10-05', 'weekly', '2026-10-13')).toBeNull()
    expect(gridIndexOf('2026-10-08', 'daily', '2026-10-13')).toBe(5)
  })
})

describe('planLeaseRedate: grid mode (every invoice on the anchored grid)', () => {
  it('the owner typed 1 Sep instead of 18 Agt: every month moves to the 18th; end, due dates and the next Tagih follow', () => {
    const { lease, invoices } = ownerCase()
    const plan = planLeaseRedate(lease, invoices, '2026-08-18')
    expect(plan.error).toBeNull()
    expect(plan.mode).toBe('grid')
    expect(plan.deltaDays).toBe(-14)
    expect(plan.warnings).toEqual([])
    expect(periods(plan)).toEqual([
      ['SEP', '2026-08-18', '2026-09-17'],
      ['OCT', '2026-09-18', '2026-10-17'],
      ['NOV', '2026-10-18', '2026-11-17'],
    ])
    expect(plan.patches.map((p) => p.due_date)).toEqual(['2026-08-18', '2026-09-18', '2026-10-18'])
    expect(plan.invoices.map((r) => r.gridIndex)).toEqual([0, 1, 2])
    expect(plan.lease).toEqual({ start_date: '2026-08-18', end_date: '2026-11-17' })

    const after = applyRedatePlan(lease, invoices, plan)
    expect(billedPeriodCount(after.lease, after.invoices)).toBe(billedPeriodCount(lease, invoices))
    expect(billedPeriodCount(after.lease, after.invoices)).toBe(3)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: '2026-11-18', period_end: '2026-12-17' })
  })

  it('a later start works the same way', () => {
    const { lease, invoices } = ownerCase()
    const plan = planLeaseRedate(lease, invoices, '2026-09-15')
    expect(plan.mode).toBe('grid')
    expect(plan.deltaDays).toBe(14)
    expect(periods(plan)).toEqual([
      ['SEP', '2026-09-15', '2026-10-14'],
      ['OCT', '2026-10-15', '2026-11-14'],
      ['NOV', '2026-11-15', '2026-12-14'],
    ])
    expect(plan.lease).toEqual({ start_date: '2026-09-15', end_date: '2026-12-14' })
    const after = applyRedatePlan(lease, invoices, plan)
    expect(nextPeriodBounds(after.lease, after.invoices, 2)).toEqual({ period_start: '2026-12-15', period_end: '2027-02-14' })
  })

  it.each([
    [
      '2026-01-31',
      [
        ['2026-01-31', '2026-02-27'],
        ['2026-02-28', '2026-03-30'],
        ['2026-03-31', '2026-04-29'],
        ['2026-04-30', '2026-05-30'],
      ],
      ['2026-05-31', '2026-06-29'],
    ],
    [
      '2026-01-30',
      [
        ['2026-01-30', '2026-02-27'],
        ['2026-02-28', '2026-03-29'],
        ['2026-03-30', '2026-04-29'],
        ['2026-04-30', '2026-05-29'],
      ],
      ['2026-05-30', '2026-06-29'],
    ],
    [
      '2026-01-29',
      [
        ['2026-01-29', '2026-02-27'],
        ['2026-02-28', '2026-03-28'],
        ['2026-03-29', '2026-04-28'],
        ['2026-04-29', '2026-05-28'],
      ],
      ['2026-05-29', '2026-06-28'],
    ],
  ])('moving to the %s keeps the month-end anchor through February (no drift)', (newStart, expected, next) => {
    const lease = mkLease({ start_date: '2026-01-15', end_date: '2026-05-14' })
    const invoices = [
      mkInv('M0', '2026-01-15', '2026-02-14'),
      mkInv('M1', '2026-02-15', '2026-03-14'),
      mkInv('M2', '2026-03-15', '2026-04-14'),
      mkInv('M3', '2026-04-15', '2026-05-14'),
    ]
    const plan = planLeaseRedate(lease, invoices, newStart)
    expect(plan.mode).toBe('grid')
    expect(plan.invoices.map((r) => [r.after.period_start, r.after.period_end])).toEqual(expected)
    expect(plan.lease.end_date).toBe(expected[3][1])
    const after = applyRedatePlan(lease, invoices, plan)
    expect(billedPeriodCount(after.lease, after.invoices)).toBe(4)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: next[0], period_end: next[1] })
  })

  it('away from a month-end anchor: 31 Jan -> 1 Feb gives whole calendar months', () => {
    const lease = mkLease({ start_date: '2026-01-31', end_date: '2026-04-29' })
    const invoices = [mkInv('A', '2026-01-31', '2026-02-27'), mkInv('B', '2026-02-28', '2026-03-30'), mkInv('C', '2026-03-31', '2026-04-29')]
    expect(billedPeriodCount(lease, invoices)).toBe(3)
    const plan = planLeaseRedate(lease, invoices, '2026-02-01')
    expect(periods(plan)).toEqual([
      ['A', '2026-02-01', '2026-02-28'],
      ['B', '2026-03-01', '2026-03-31'],
      ['C', '2026-04-01', '2026-04-30'],
    ])
    expect(plan.lease.end_date).toBe('2026-04-30')
  })

  it('leap year: 29 Feb is a grid point, and an invoice of 3 months keeps its quantity', () => {
    const lease = mkLease({ start_date: '2024-01-15', end_date: '2024-05-14' })
    const invoices = [mkInv('J', '2024-01-15', '2024-02-14'), mkInv('Q3', '2024-02-15', '2024-05-14', { quantity: 3 })]
    const plan = planLeaseRedate(lease, invoices, '2024-01-31')
    expect(periods(plan)).toEqual([
      ['J', '2024-01-31', '2024-02-28'],
      ['Q3', '2024-02-29', '2024-05-30'],
    ])
    const after = applyRedatePlan(lease, invoices, plan)
    expect(billedPeriodCount(after.lease, after.invoices)).toBe(4)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: '2024-05-31', period_end: '2024-06-29' })

    const fromLeapDay = planLeaseRedate(mkLease({ start_date: '2024-02-10', end_date: '2024-05-09' }), [mkInv('Q', '2024-02-10', '2024-05-09', { quantity: 3 })], '2024-02-29')
    expect(periods(fromLeapDay)).toEqual([['Q', '2024-02-29', '2024-05-28']])
    expect(fromLeapDay.lease.end_date).toBe('2024-05-28')
  })

  it('weekly lease: weeks move with the start, a 2-week invoice stays 2 weeks', () => {
    const lease = mkLease({ period_type: 'weekly', start_date: '2026-10-05', end_date: '2026-10-25' })
    const invoices = [mkInv('W1', '2026-10-05', '2026-10-11'), mkInv('W23', '2026-10-12', '2026-10-25', { quantity: 2 })]
    const plan = planLeaseRedate(lease, invoices, '2026-10-01')
    expect(plan.mode).toBe('grid')
    expect(periods(plan)).toEqual([
      ['W1', '2026-10-01', '2026-10-07'],
      ['W23', '2026-10-08', '2026-10-21'],
    ])
    expect(plan.lease.end_date).toBe('2026-10-21')
    const after = applyRedatePlan(lease, invoices, plan)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: '2026-10-22', period_end: '2026-10-28' })
  })

  it('daily lease: the nights move with the start', () => {
    const lease = mkLease({ period_type: 'daily', price_per_period: 130_000, start_date: '2026-10-08', end_date: '2026-10-15' })
    const invoices = [mkInv('D', '2026-10-08', '2026-10-15', { quantity: 8 })]
    const plan = planLeaseRedate(lease, invoices, '2026-10-06')
    expect(periods(plan)).toEqual([['D', '2026-10-06', '2026-10-13']])
    expect(plan.lease).toEqual({ start_date: '2026-10-06', end_date: '2026-10-13' })
    const after = applyRedatePlan(lease, invoices, plan)
    expect(nextPeriodBounds(after.lease, after.invoices, 2)).toEqual({ period_start: '2026-10-14', period_end: '2026-10-15' })
  })

  it('void invoices: one on a grid position follows the grid, an off-grid one moves by the same number of days', () => {
    const lease = mkLease({ end_date: '2026-10-31' })
    const invoices = [
      mkInv('SEP', '2026-09-01', '2026-09-30', { status: 'paid' }),
      mkInv('OCT_VOID', '2026-10-01', '2026-10-31', { status: 'void' }),
      mkInv('OCT', '2026-10-01', '2026-10-31'),
      mkInv('ODD_VOID', '2026-10-05', '2026-10-20', { status: 'void' }),
      // quantity 2 from the 3rd period would end on 31 Dec: not a grid position
      mkInv('BAD_Q_VOID', '2026-11-01', '2026-11-30', { status: 'void', quantity: 2 }),
    ]
    const plan = planLeaseRedate(lease, invoices, '2026-08-18')
    expect(plan.mode).toBe('grid')
    const byId = Object.fromEntries(plan.invoices.map((r) => [r.invoice.id, [r.after.period_start, r.after.period_end, r.gridIndex]]))
    expect(byId).toEqual({
      SEP: ['2026-08-18', '2026-09-17', 0],
      OCT: ['2026-09-18', '2026-10-17', 1],
      OCT_VOID: ['2026-09-18', '2026-10-17', 1],
      ODD_VOID: ['2026-09-21', '2026-10-06', null],
      BAD_Q_VOID: ['2026-10-18', '2026-11-16', null],
    })
    // the latest live invoice decides the end; void ones never do
    expect(plan.lease.end_date).toBe('2026-10-17')
    expect(plan.patches).toHaveLength(5)
    const after = applyRedatePlan(lease, invoices, plan)
    expect(billedPeriodCount(after.lease, after.invoices)).toBe(2)
  })

  it('a lease without any invoice yet (a reservation) just moves its start and planned end', () => {
    const lease = mkLease({ start_date: '2026-11-01', end_date: '2026-11-30' })
    const plan = planLeaseRedate(lease, [], '2026-11-10')
    expect(plan.mode).toBe('grid')
    expect(plan.patches).toEqual([])
    expect(plan.lease).toEqual({ start_date: '2026-11-10', end_date: '2026-12-09' })
  })
})

describe('planLeaseRedate: shift mode (custom periods)', () => {
  it('a pro-rata invoice makes every date move by the same days, with a warning; the next period continues after it', () => {
    const lease = mkLease({ start_date: '2026-01-31', end_date: '2026-03-13' })
    const invoices = [mkInv('A', '2026-01-31', '2026-02-27'), mkInv('PRO', '2026-02-28', '2026-03-13', { total: 700_000 })]
    expect(billedPeriodCount(lease, invoices)).toBeNull()
    const plan = planLeaseRedate(lease, invoices, '2026-01-29')
    expect(plan.mode).toBe('shift')
    expect(plan.deltaDays).toBe(-2)
    expect(plan.warnings).toEqual(['Ada tagihan dengan periode khusus, jadi semua tanggal digeser 2 hari.'])
    expect(periods(plan)).toEqual([
      ['A', '2026-01-29', '2026-02-25'],
      ['PRO', '2026-02-26', '2026-03-11'],
    ])
    expect(plan.invoices.every((r) => r.gridIndex === null)).toBe(true)
    expect(plan.lease).toEqual({ start_date: '2026-01-29', end_date: '2026-03-11' })
    const after = applyRedatePlan(lease, invoices, plan)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: '2026-03-12', period_end: '2026-04-11' })
  })

  it('redateShiftWarning uses the number of days without a sign', () => {
    expect(redateShiftWarning(-14)).toBe('Ada tagihan dengan periode khusus, jadi semua tanggal digeser 14 hari.')
    expect(redateShiftWarning(3)).toBe('Ada tagihan dengan periode khusus, jadi semua tanggal digeser 3 hari.')
  })

  /** Off-grid layouts the owner can make: pro-rata, a type switch made permanent, gaps, February and leap-day anchors. */
  const offGrid: [string, Lease, Invoice[]][] = [
    ['31 Jan anchor + pro-rata', mkLease({ start_date: '2026-01-31', end_date: '2026-03-13' }), [mkInv('a', '2026-01-31', '2026-02-27'), mkInv('b', '2026-02-28', '2026-03-13')]],
    [
      'daily guest switched to monthly (re-anchored on 31 Jan)',
      mkLease({ start_date: '2026-01-01', end_date: '2026-02-27' }),
      [mkInv('d', '2026-01-01', '2026-01-30', { quantity: 30, type: 'daily' }), mkInv('m', '2026-01-31', '2026-02-27', { type: 'monthly' })],
    ],
    [
      '29 Mar anchor with a gap and a manual start',
      mkLease({ start_date: '2026-03-29', end_date: '2026-06-09' }),
      [mkInv('a', '2026-03-29', '2026-04-28'), mkInv('b', '2026-05-10', '2026-06-09')],
    ],
    [
      '30 Jan anchor, February pro-rata then monthly from 1 Mar',
      mkLease({ start_date: '2026-01-30', end_date: '2026-03-31' }),
      [mkInv('a', '2026-01-30', '2026-02-27'), mkInv('b', '2026-02-28', '2026-02-28'), mkInv('c', '2026-03-01', '2026-03-31')],
    ],
    [
      '29 Feb leap anchor + pro-rata',
      mkLease({ start_date: '2024-02-29', end_date: '2024-04-10' }),
      [mkInv('a', '2024-02-29', '2024-03-28'), mkInv('b', '2024-03-29', '2024-04-10')],
    ],
    [
      'weekly lease extended 3 nights daily',
      mkLease({ period_type: 'weekly', start_date: '2026-10-05', end_date: '2026-10-14' }),
      [mkInv('w', '2026-10-05', '2026-10-11'), mkInv('x', '2026-10-12', '2026-10-14', { quantity: 3, type: 'daily' })],
    ],
    [
      'first invoice not on the start (gap at the start)',
      mkLease({ start_date: '2026-08-28', end_date: '2026-10-31' }),
      [mkInv('a', '2026-09-01', '2026-09-30'), mkInv('b', '2026-10-01', '2026-10-31')],
    ],
  ]
  const deltas = [-45, -31, -30, -29, -28, -14, -3, -1, 1, 2, 13, 28, 29, 30, 31, 59]

  it.each(offGrid)('%s: after any shift the next period starts the day after the latest invoice (no overlap, no gap)', (_label, lease, invoices) => {
    expect(billedPeriodCount(lease, invoices)).toBeNull()
    for (const d of deltas) {
      const newStart = addDaysISO(lease.start_date, d)
      const plan = planLeaseRedate(lease, invoices, newStart)
      expect(plan.error, `delta ${d}`).toBeNull()
      expect(plan.mode).toBe('shift')
      // every boundary moved by the same days: lengths, gaps and order are kept
      for (const r of plan.invoices) {
        expect(r.after.period_start).toBe(addDaysISO(r.before.period_start, d))
        expect(r.after.period_end).toBe(addDaysISO(r.before.period_end, d))
      }
      const after = applyRedatePlan(lease, invoices, plan)
      const latest = latestCoveredThrough(after.invoices)!
      for (const q of [1, 2]) {
        const next = nextPeriodBounds(after.lease, after.invoices, q)
        expect(next.period_start, `delta ${d}, quantity ${q}`).toBe(addDaysISO(latest, 1))
        expect(next.period_end >= next.period_start).toBe(true)
      }
      expect(after.lease.end_date).toBe(latest)
    }
  })
})

describe('planLeaseRedate: lease end_date', () => {
  it('a planned end on a grid point (6 months, like the demo leases) moves to the same grid point', () => {
    const lease = mkLease({ start_date: '2026-01-31', end_date: '2026-04-29' })
    const invoices = [mkInv('A', '2026-01-31', '2026-02-27')]
    const plan = planLeaseRedate(lease, invoices, '2026-01-15')
    expect(plan.mode).toBe('grid')
    expect(periods(plan)).toEqual([['A', '2026-01-15', '2026-02-14']])
    // 3 months from the 15th, not 29 Apr - 16 days (13 Apr)
    expect(plan.lease.end_date).toBe('2026-04-14')
  })

  it('a planned check-out that is not a grid point moves by the same days', () => {
    const { lease, invoices } = ownerCase()
    const plan = planLeaseRedate({ ...lease, end_date: '2026-12-14' }, invoices, '2026-08-18')
    expect(plan.mode).toBe('grid')
    expect(plan.lease.end_date).toBe('2026-11-30')
  })

  it('shift mode: an end past the latest invoice moves by the same days', () => {
    const lease = mkLease({ start_date: '2026-01-31', end_date: '2026-03-20' })
    const plan = planLeaseRedate(lease, [mkInv('a', '2026-01-31', '2026-02-27'), mkInv('b', '2026-02-28', '2026-03-13')], '2026-02-03')
    expect(plan.mode).toBe('shift')
    expect(plan.lease.end_date).toBe('2026-03-23')
  })

  it('never before the new start date', () => {
    // a damaged row (end before start) cannot pull the new end below the new start
    const plan = planLeaseRedate(mkLease({ start_date: '2026-09-01', end_date: '2026-08-31' }), [], '2026-09-10')
    expect(plan.lease).toEqual({ start_date: '2026-09-10', end_date: '2026-09-10' })
  })
})

describe('planLeaseRedate: due dates', () => {
  it('keep their offset in days from their own period start, in both modes', () => {
    const lease = mkLease({ end_date: '2026-10-31' })
    const grid = planLeaseRedate(
      lease,
      [mkInv('SEP', '2026-09-01', '2026-09-30', { due: '2026-09-04' }), mkInv('OCT', '2026-10-01', '2026-10-31', { due: '2026-09-29' })],
      '2026-08-18',
    )
    expect(grid.mode).toBe('grid')
    expect(grid.patches.map((p) => p.due_date)).toEqual(['2026-08-21', '2026-09-16'])

    const shift = planLeaseRedate(
      mkLease({ start_date: '2026-01-31', end_date: '2026-03-13' }),
      [mkInv('a', '2026-01-31', '2026-02-27', { due: '2026-02-03' }), mkInv('b', '2026-02-28', '2026-03-13', { due: '2026-02-26' })],
      '2026-02-10',
    )
    expect(shift.mode).toBe('shift')
    expect(shift.patches.map((p) => p.due_date)).toEqual(['2026-02-13', '2026-03-08'])
  })
})

describe('planLeaseRedate: what never changes', () => {
  it('amounts, numbers, status, quantity and type stay; the patches carry only the dates', () => {
    const { lease, invoices } = ownerCase()
    const plan = planLeaseRedate(lease, invoices, '2026-08-18')
    for (const p of plan.patches) expect(Object.keys(p).sort()).toEqual(['due_date', 'id', 'period_end', 'period_start'])
    const after = applyRedatePlan(lease, invoices, plan)
    for (const [i, inv] of after.invoices.entries()) {
      const { period_start: _s, period_end: _e, due_date: _d, ...rest } = inv
      const { period_start: _s0, period_end: _e0, due_date: _d0, ...before } = invoices[i]
      expect(rest).toEqual(before)
    }
    const { start_date: _a, end_date: _b, ...leaseRest } = after.lease
    const { start_date: _a0, end_date: _b0, ...leaseBefore } = lease
    expect(leaseRest).toEqual(leaseBefore)
  })

  it("other leases' invoices in the list are ignored", () => {
    const { lease, invoices } = ownerCase()
    const plan = planLeaseRedate(lease, [...invoices, mkInv('OTHER', '2026-09-05', '2026-10-04', { lease: 'L2' })], '2026-08-18')
    expect(plan.patches.map((p) => p.id)).toEqual(['SEP', 'OCT', 'NOV'])
    expect(plan.mode).toBe('grid')
  })
})

describe('planLeaseRedate: refusals', () => {
  it('the same date, an empty or impossible date', () => {
    const { lease, invoices } = ownerCase()
    for (const [date, message] of [
      ['2026-09-01', REDATE_SAME_DATE_MESSAGE],
      ['', REDATE_INVALID_DATE_MESSAGE],
      ['2026-02-30', REDATE_INVALID_DATE_MESSAGE],
      ['1 Sep', REDATE_INVALID_DATE_MESSAGE],
    ]) {
      const plan = planLeaseRedate(lease, invoices, date)
      expect(plan.error).toBe(message)
      expect(plan.patches).toEqual([])
      expect(plan.lease).toEqual({ start_date: '2026-09-01', end_date: '2026-11-30' })
    }
    expect(REDATE_SAME_DATE_MESSAGE).toBe('Tanggal mulai sama dengan sebelumnya.')
  })

  it('an ended or cancelled lease keeps its dates', () => {
    const { invoices } = ownerCase()
    for (const status of ['ended', 'cancelled'] as const) {
      const plan = planLeaseRedate(mkLease({ status, checkout_date: status === 'ended' ? '2026-12-01' : null }), invoices, '2026-08-18')
      expect(plan.error).toBe('Sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.')
      expect(plan.error).toBe(REDATE_INACTIVE_MESSAGE)
      expect(plan.patches).toEqual([])
    }
  })

  it('a span that collides with another lease of the room names its tenant and stay; the preview is still computed', () => {
    const { lease, invoices } = ownerCase()
    const previous = mkLease({ id: 'PREV', tenant_id: 'T2', start_date: '2026-07-01', end_date: '2026-08-24' })
    const plan = planLeaseRedate(lease, invoices, '2026-08-18', { leases: [lease, previous], tenants: [{ id: 'T2', full_name: 'Siti Rahayu' }] })
    expect(plan.error).toBe('Bentrok dengan sewa Siti Rahayu di kamar ini (1 Jul – 25 Agt 2026). Pilih tanggal lain.')
    expect(plan.conflict?.id).toBe('PREV')
    expect(plan.patches).toHaveLength(3)
    // without the tenant list the message still reads
    expect(planLeaseRedate(lease, invoices, '2026-08-18', { leases: [previous] }).error).toBe(
      'Bentrok dengan sewa penyewa lain di kamar ini (1 Jul – 25 Agt 2026). Pilih tanggal lain.',
    )
  })

  it('same-day turnover is fine (7.3): a tenant who checked out on the new start day does not collide', () => {
    const { lease, invoices } = ownerCase()
    const left = mkLease({ id: 'LEFT', tenant_id: 'T2', start_date: '2026-06-18', end_date: '2026-08-17', status: 'ended', checkout_date: '2026-08-18' })
    expect(planLeaseRedate(lease, invoices, '2026-08-18', { leases: [left] }).error).toBeNull()
    const plan = planLeaseRedate(lease, invoices, '2026-08-17', { leases: [left], tenants: [{ id: 'T2', full_name: 'Agus' }] })
    expect(plan.error).toBe('Bentrok dengan sewa Agus di kamar ini (18 Jun – 18 Agt 2026). Pilih tanggal lain.')
  })

  it('cancelled leases and other rooms never collide; a later start can hit the next booking', () => {
    const { lease, invoices } = ownerCase()
    const cancelled = mkLease({ id: 'C', start_date: '2026-08-01', end_date: '2026-08-31', status: 'cancelled' })
    const otherRoom = mkLease({ id: 'O', room_id: 'R2', start_date: '2026-08-01', end_date: '2026-12-31' })
    expect(planLeaseRedate(lease, invoices, '2026-08-18', { leases: [cancelled, otherRoom] }).error).toBeNull()
    const booking = mkLease({ id: 'NEXT', tenant_id: 'T3', start_date: '2026-12-05', end_date: '2027-01-04' })
    expect(planLeaseRedate(lease, invoices, '2026-08-18', { leases: [booking] }).error).toBeNull()
    const later = planLeaseRedate(lease, invoices, '2026-09-15', { leases: [booking], tenants: [{ id: 'T3', full_name: 'Dewi' }] })
    expect(later.lease.end_date).toBe('2026-12-14')
    expect(later.error).toBe('Bentrok dengan sewa Dewi di kamar ini (5 Des 2026 – 5 Jan 2027). Pilih tanggal lain.')
  })

  it('a lease that moved rooms (Pindah kamar) is not blocked by the previous tenant of its new room; new collisions still are', () => {
    // Budi started 15 Jun in A1 and moved to B2 on 1 Sep; Siti lived in B2 until she checked out on 1 Sep. The lease row
    // now says B2 for the whole stay, so Siti's stay already overlaps it before any correction.
    const budi = mkLease({ id: 'BUDI', room_id: 'B2', start_date: '2026-06-15', end_date: '2026-11-14' })
    const months = ['06', '07', '08', '09', '10'].map((m, i) =>
      mkInv(`M${m}`, `2026-${m}-15`, `2026-${['07', '08', '09', '10', '11'][i]}-14`, { lease: 'BUDI', status: i < 4 ? 'paid' : 'unpaid' }),
    )
    const siti = mkLease({ id: 'SITI', room_id: 'B2', tenant_id: 'T2', start_date: '2026-01-01', end_date: '2026-09-30', status: 'ended', checkout_date: '2026-09-01' })
    const dewi = mkLease({ id: 'DEWI', room_id: 'B2', tenant_id: 'T3', start_date: '2026-11-20', end_date: '2026-12-19' })
    const tenants = [
      { id: 'T2', full_name: 'Siti' },
      { id: 'T3', full_name: 'Dewi' },
    ]
    const leases = [budi, siti, dewi]
    for (const date of ['2026-06-01', '2026-06-14', '2026-06-20']) {
      const plan = planLeaseRedate(budi, months, date, { leases, tenants })
      expect(plan.mode).toBe('grid')
      expect(plan.error).toBeNull()
      expect(plan.conflict).toBeNull()
    }
    expect(planLeaseRedate(budi, months, '2026-06-01', { leases }).lease).toEqual({ start_date: '2026-06-01', end_date: '2026-10-31' })
    // a booking the correction would now run into is still refused
    const late = planLeaseRedate(budi, months, '2026-06-25', { leases, tenants })
    expect(late.lease.end_date).toBe('2026-11-24')
    expect(late.error).toBe('Bentrok dengan sewa Dewi di kamar ini (20 Nov – 20 Des 2026). Pilih tanggal lain.')
    expect(late.conflict?.id).toBe('DEWI')

    // the same with an earlier tenant who left before the move: X moved into B on 1 Agt, Y checked out of B on 1 Agt
    const x = mkLease({ id: 'X', room_id: 'B', start_date: '2026-05-01', end_date: '2026-10-31' })
    const xInv = ['05', '06', '07', '08', '09', '10'].map((m) => mkInv(`X${m}`, `2026-${m}-01`, addDaysISO(`2026-${String(Number(m) + 1).padStart(2, '0')}-01`, -1), { lease: 'X' }))
    const y = mkLease({ id: 'Y', room_id: 'B', tenant_id: 'T2', start_date: '2026-01-01', end_date: '2026-07-31', status: 'ended', checkout_date: '2026-08-01' })
    for (const date of ['2026-04-20', '2026-05-05', '2026-08-01']) expect(planLeaseRedate(x, xInv, date, { leases: [x, y] }).error).toBeNull()
  })
})

describe('notes and the state preview', () => {
  it('the note line, with and without a reason', () => {
    expect(redateNoteLine('2026-09-01', '2026-08-18', '2026-10-23')).toBe('Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)')
    expect(redateNoteLine('2026-09-01', '2026-08-18', '2026-10-23', '  salah ketik\nbulan ')).toBe(
      'Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026): salah ketik bulan',
    )
    expect(redateNotes(null, '2026-09-01', '2026-08-18', '2026-10-23', '')).toBe('Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)')
    expect(redateNotes('Pindah dari A1 ke B2 pada 2026-09-05\n', '2026-09-01', '2026-08-18', '2026-10-23')).toBe(
      'Pindah dari A1 ke B2 pada 2026-09-05\nTanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)',
    )
  })

  it('nightsOf counts inclusive nights', () => {
    expect(nightsOf('2026-02-01', '2026-02-28')).toBe(28)
    expect(nightsOf('2026-10-15', '2026-10-15')).toBe(1)
  })

  it('today the tenant goes from paid-up to 5 days late, in the words of the lease list', () => {
    const { lease, invoices } = ownerCase()
    const pay = (id: string): Payment => ({ id: `p-${id}`, ...ts, property_id: 'P', invoice_id: id, lease_id: 'L', amount: 1_500_000, paid_at: '2026-09-01', method: 'cash', kind: 'rent', notes: null, created_by: null })
    const payments = [pay('SEP'), pay('OCT')]
    const plan = planLeaseRedate(lease, invoices, '2026-08-18')
    const preview = redateStatePreview(lease, invoices, payments, plan, '2026-10-23')
    expect(preview.before.paidThrough).toBe('2026-10-31')
    expect(preview.after.paidThrough).toBe('2026-10-17')
    expect(preview.beforeText).toBe('sisa Rp 1.500.000 · jatuh tempo 9 hari lagi')
    expect(preview.after.state).toBe('overdue')
    expect(preview.afterText).toBe('telat 5 hari · sisa Rp 1.500.000')

    // all paid: 'lunas s/d <check-out day>' and the days until the next bill
    const paidAll = [...payments, pay('NOV')]
    const allPaid = redateStatePreview(lease, invoices, paidAll, planLeaseRedate(lease, invoices, '2026-09-15'), '2026-10-23')
    expect(allPaid.beforeText).toBe('lunas s/d 1 Des · jatuh tempo 39 hari lagi')
    expect(allPaid.afterText).toBe('lunas s/d 15 Des · jatuh tempo 53 hari lagi')
  })

  it('leaseStateText covers due today, grace, unbilled and a paid-up stay ending soon', () => {
    const { lease, invoices } = ownerCase()
    const summary = (over: object) => ({ leaseId: 'L', coveredThrough: '2026-11-30', paidThrough: null, outstanding: 1_500_000, nextDueDate: '2026-11-01', daysUntilDue: 0, state: 'due_soon' as const, ...over })
    expect(leaseStateText(lease, summary({}), '2026-11-01')).toBe('jatuh tempo hari ini · sisa Rp 1.500.000')
    expect(leaseStateText(lease, summary({ daysUntilDue: -2 }), '2026-11-03')).toBe('lewat 2 hari (tenggang) · sisa Rp 1.500.000')
    expect(leaseStateText(lease, summary({ outstanding: 0, coveredThrough: null, nextDueDate: '2026-12-01', daysUntilDue: 10, state: 'unbilled' }), '2026-11-21')).toBe(
      'belum ditagih · jatuh tempo 10 hari lagi',
    )
    // paid up, check-out on 1 Des (end_date 30 Nov), 3 days ahead
    expect(leaseStateText(lease, summary({ outstanding: 0, paidThrough: '2026-11-30', nextDueDate: '2026-12-01', daysUntilDue: 3, state: 'due_soon' }), '2026-11-28')).toBe(
      'lunas s/d 1 Des · check-out 3 hari lagi',
    )
    expect(leaseStateText({ ...lease, status: 'ended' }, summary({ outstanding: 0, paidThrough: '2026-11-30' }), '2026-11-28')).toBe('lunas s/d 1 Des')
    expect(invoices).toHaveLength(3)
  })
})

describe('redateDataChanged', () => {
  it('only a change that moves the plan counts: dates, room, type, an invoice added, removed or voided', () => {
    const { lease, invoices } = ownerCase()
    expect(redateDataChanged(lease, invoices, { ...lease, notes: 'x', updated_at: 'later' }, invoices.map((i) => ({ ...i })))).toBe(false)
    // a payment recorded meanwhile (status paid/partial) moves no date
    expect(redateDataChanged(lease, invoices, lease, invoices.map((i) => (i.id === 'NOV' ? { ...i, status: 'partial' as const } : i)))).toBe(false)
    for (const freshLease of [
      { ...lease, start_date: '2026-09-02' },
      { ...lease, end_date: '2026-12-31' },
      { ...lease, status: 'ended' as const },
      { ...lease, room_id: 'R2' },
      { ...lease, period_type: 'weekly' as const },
    ]) {
      expect(redateDataChanged(lease, invoices, freshLease, invoices)).toBe(true)
    }
    expect(redateDataChanged(lease, invoices, lease, [...invoices, mkInv('DEC', '2026-12-01', '2026-12-31')])).toBe(true)
    expect(redateDataChanged(lease, invoices, lease, invoices.slice(0, 2))).toBe(true)
    expect(redateDataChanged(lease, invoices, lease, invoices.map((i) => (i.id === 'NOV' ? { ...i, status: 'void' as const } : i)))).toBe(true)
    expect(redateDataChanged(lease, invoices, lease, invoices.map((i) => (i.id === 'NOV' ? { ...i, due_date: '2026-11-05' } : i)))).toBe(true)
    expect(redateDataChanged(lease, invoices, lease, invoices.map((i) => (i.id === 'NOV' ? { ...i, quantity: 2 } : i)))).toBe(true)
    // other leases' rows are not this lease's business
    expect(redateDataChanged(lease, invoices, lease, [...invoices, mkInv('X', '2026-12-01', '2026-12-31', { lease: 'L2' })])).toBe(false)
  })
})
