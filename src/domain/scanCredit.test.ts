import { describe, expect, it } from 'vitest'
import { costMicros, creditCycle, startOfDayInstant, summarizeCredit } from './scanCredit'

// SPEC 7.17 Kredit Claude: the credit cycle and the estimate of what is left.
describe('creditCycle', () => {
  it('renewal on the 1st: the calendar month', () => {
    expect(creditCycle('2026-11-07', 1)).toEqual({ start: '2026-11-01', next: '2026-12-01', previousStart: '2026-10-01' })
  })

  it('renewal later in the month: the cycle started last month until the day comes round', () => {
    expect(creditCycle('2026-11-07', 15)).toEqual({ start: '2026-10-15', next: '2026-11-15', previousStart: '2026-09-15' })
    expect(creditCycle('2026-11-15', 15).start).toBe('2026-11-15')
    expect(creditCycle('2026-11-14', 15).start).toBe('2026-10-15')
  })

  it('across a new year', () => {
    expect(creditCycle('2027-01-05', 15)).toEqual({ start: '2026-12-15', next: '2027-01-15', previousStart: '2026-11-15' })
    expect(creditCycle('2026-12-20', 15).next).toBe('2027-01-15')
  })

  it('day 29-31 renews on the last day of a shorter month', () => {
    expect(creditCycle('2027-02-28', 31)).toEqual({ start: '2027-02-28', next: '2027-03-31', previousStart: '2027-01-31' })
    expect(creditCycle('2027-03-30', 31)).toEqual({ start: '2027-02-28', next: '2027-03-31', previousStart: '2027-01-31' })
    expect(creditCycle('2028-02-29', 30).start).toBe('2028-02-29')
  })

  it('no renewal day, or a day outside 1-31: the 1st', () => {
    expect(creditCycle('2026-11-07', null).start).toBe('2026-11-01')
    expect(creditCycle('2026-11-07', 0).start).toBe('2026-11-01')
    expect(creditCycle('2026-11-07', 32).start).toBe('2026-11-01')
  })
})

describe('costMicros and startOfDayInstant', () => {
  it('costs in whole micro-US$, whether the database sends a number or a string', () => {
    expect(costMicros(0.092)).toBe(92000)
    expect(costMicros('0.0875')).toBe(87500)
    for (const none of [null, undefined, 'x', -1]) expect(costMicros(none)).toBe(0)
  })
  it('the start of a local day', () => {
    expect(new Date(startOfDayInstant('2026-11-07')).getTime()).toBe(new Date(2026, 10, 7).getTime())
  })
})

describe('summarizeCredit', () => {
  // created_at built from local times, so the test holds in any time zone
  const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString()
  const rows = [
    { created_at: at(2026, 11, 7), cost_usd: 0.092 },
    { created_at: at(2026, 10, 20), cost_usd: '0.0875' },
    { created_at: at(2026, 10, 1), cost_usd: 0.05 }, // previous cycle (15 Sep - 14 Oct)
    { created_at: at(2026, 9, 1), cost_usd: 0.5 }, // older: not counted
  ]

  it('monthly credit minus the scans of this cycle; the previous cycle for comparison', () => {
    const s = summarizeCredit({ monthlyUsd: 100, renewalDay: 15 }, rows, '2026-11-07')
    expect(s).toMatchObject({
      cycle: { start: '2026-10-15', next: '2026-11-15' },
      monthlyUsd: 100,
      renewalDay: 15,
      usedUsd: 0.1795,
      remainingUsd: 99.8205,
      scans: 2,
      averageUsd: 0.08975,
      previousUsedUsd: 0.05,
      previousScans: 1,
    })
    // 99.8205 / 0.08975 = 1112.2
    expect(s.scansLeft).toBe(1112)
  })

  it('without settings: US$100 renewing on the 1st (Claude Max); without scans: no average', () => {
    const s = summarizeCredit({ monthlyUsd: null, renewalDay: undefined }, [], '2026-11-07')
    expect(s).toMatchObject({ monthlyUsd: 100, renewalDay: 1, usedUsd: 0, remainingUsd: 100, scans: 0, averageUsd: null, scansLeft: null })
  })

  it('a scan on the renewal day counts in the new cycle', () => {
    const s = summarizeCredit({ monthlyUsd: 100, renewalDay: 7 }, [{ created_at: at(2026, 11, 7, 0), cost_usd: 0.1 }, { created_at: at(2026, 11, 6, 23), cost_usd: 0.2 }], '2026-11-07')
    expect(s).toMatchObject({ scans: 1, usedUsd: 0.1, previousScans: 1, previousUsedUsd: 0.2 })
  })

  it('spent past the credit: below zero, no scans left', () => {
    const s = summarizeCredit({ monthlyUsd: 0, renewalDay: 15 }, rows, '2026-11-07')
    expect(s.remainingUsd).toBe(-0.1795)
    expect(s.scansLeft).toBe(0)
  })

  it('scans left are counted in whole numbers (7 scans of US$0.0625 in all: exactly 11,193 more)', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ created_at: at(2026, 11, 2), cost_usd: i === 0 ? 0.0085 : 0.009 }))
    // 0.0085 + 6 × 0.009 = 0.0625; 99.9375 / (0.0625 / 7) = 11,193 (a rounded average gives 11,192)
    expect(summarizeCredit({ monthlyUsd: 100, renewalDay: 1 }, seven, '2026-11-07').scansLeft).toBe(11193)
  })

  it('many small costs add up exactly', () => {
    const many = Array.from({ length: 1000 }, () => ({ created_at: at(2026, 11, 2), cost_usd: 0.000123 }))
    expect(summarizeCredit({ monthlyUsd: 100, renewalDay: 1 }, many, '2026-11-07').usedUsd).toBe(0.123)
  })
})
