import { describe, expect, it } from 'vitest'
import {
  addPeriods,
  bucketKey,
  bucketKeysInRange,
  bucketLabel,
  bucketStart,
  daysBetween,
  defaultGranularity,
  inRange,
  parseISODate,
  periodBounds,
  periodEnd,
  periodsToCover,
  previousRange,
  rangeForPreset,
  shiftRange,
  toISODate,
} from './period'

describe('parse/format', () => {
  it('round-trips local dates without timezone shift', () => {
    expect(toISODate(parseISODate('2026-03-05'))).toBe('2026-03-05')
    expect(toISODate(parseISODate('2026-03-05T23:59:00Z'))).toBe('2026-03-05')
  })
  it('rejects invalid dates', () => {
    expect(() => parseISODate('2026-02-30')).toThrow()
    expect(() => parseISODate('abc')).toThrow()
  })
  it('daysBetween', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0)
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    expect(daysBetween('2026-03-02', '2026-02-27')).toBe(-3)
  })
})

describe('periods', () => {
  it('addPeriods handles month-end clamping', () => {
    expect(addPeriods('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
    expect(addPeriods('2024-01-31', 'monthly', 1)).toBe('2024-02-29') // leap year
    expect(addPeriods('2026-01-31', 'monthly', 2)).toBe('2026-03-31')
    expect(addPeriods('2026-03-01', 'weekly', 2)).toBe('2026-03-15')
    expect(addPeriods('2026-03-01', 'daily', -1)).toBe('2026-02-28')
  })
  it('periodEnd is inclusive', () => {
    expect(periodEnd('2026-01-15', 'monthly', 1)).toBe('2026-02-14')
    expect(periodEnd('2026-03-01', 'daily', 3)).toBe('2026-03-03')
    expect(periodEnd('2026-03-02', 'weekly', 1)).toBe('2026-03-08')
    expect(() => periodEnd('2026-03-02', 'weekly', 0)).toThrow()
  })
  it('periodBounds anchored on the lease start never drifts', () => {
    expect(periodBounds('2026-01-31', 'monthly', 0, 1)).toEqual({ start: '2026-01-31', end: '2026-02-27' })
    expect(periodBounds('2026-01-31', 'monthly', 1, 1)).toEqual({ start: '2026-02-28', end: '2026-03-30' })
    expect(periodBounds('2026-01-31', 'monthly', 2, 1)).toEqual({ start: '2026-03-31', end: '2026-04-29' })
    expect(periodBounds('2026-01-31', 'monthly', 0, 3)).toEqual({ start: '2026-01-31', end: '2026-04-29' })
    expect(periodBounds('2026-03-10', 'daily', 4, 3)).toEqual({ start: '2026-03-14', end: '2026-03-16' })
  })
  it('periodsToCover', () => {
    expect(periodsToCover('2026-03-01', '2026-03-01', 'daily')).toBe(1)
    expect(periodsToCover('2026-03-01', '2026-03-10', 'daily')).toBe(10)
    expect(periodsToCover('2026-03-01', '2026-03-07', 'weekly')).toBe(1)
    expect(periodsToCover('2026-03-01', '2026-03-08', 'weekly')).toBe(2)
    expect(periodsToCover('2026-01-15', '2026-02-14', 'monthly')).toBe(1)
    expect(periodsToCover('2026-01-15', '2026-02-15', 'monthly')).toBe(2)
    expect(periodsToCover('2026-03-05', '2026-03-01', 'monthly')).toBe(1)
  })
})

describe('ranges', () => {
  it('rangeForPreset', () => {
    expect(rangeForPreset('daily', '2026-03-05')).toEqual({ start: '2026-03-05', end: '2026-03-05' })
    // 2026-03-05 is a Thursday; ISO week is Mon 2 .. Sun 8
    expect(rangeForPreset('weekly', '2026-03-05')).toEqual({ start: '2026-03-02', end: '2026-03-08' })
    expect(rangeForPreset('monthly', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(rangeForPreset('monthly', '2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(rangeForPreset('yearly', '2026-07-01')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })
  it('shiftRange and previousRange', () => {
    const march = rangeForPreset('monthly', '2026-03-15')
    expect(shiftRange(march, 'monthly', -1)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(shiftRange(march, 'monthly', 1)).toEqual({ start: '2026-04-01', end: '2026-04-30' })
    expect(previousRange(march, 'monthly')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(shiftRange(rangeForPreset('yearly', '2026-03-01'), 'yearly', -1)).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(shiftRange(rangeForPreset('weekly', '2026-03-05'), 'weekly', 1)).toEqual({ start: '2026-03-09', end: '2026-03-15' })
    // custom range keeps its length
    expect(previousRange({ start: '2026-03-10', end: '2026-03-19' })).toEqual({ start: '2026-02-28', end: '2026-03-09' })
  })
  it('inRange is inclusive and ignores time parts', () => {
    const r = { start: '2026-03-01', end: '2026-03-31' }
    expect(inRange('2026-03-01', r)).toBe(true)
    expect(inRange('2026-03-31T10:00:00Z', r)).toBe(true)
    expect(inRange('2026-04-01', r)).toBe(false)
  })
})

describe('buckets', () => {
  it('bucketKey', () => {
    expect(bucketKey('2026-03-05', 'day')).toBe('2026-03-05')
    expect(bucketKey('2026-03-05', 'month')).toBe('2026-03')
    expect(bucketKey('2026-03-05', 'year')).toBe('2026')
    expect(bucketKey('2026-03-05', 'week')).toBe('2026-W10')
    // ISO week year edge: 2027-01-01 is a Friday -> belongs to 2026-W53
    expect(bucketKey('2027-01-01', 'week')).toBe('2026-W53')
  })
  it('bucketStart inverts bucketKey', () => {
    expect(bucketStart('2026-W10', 'week')).toBe('2026-03-02')
    expect(bucketStart('2026-W53', 'week')).toBe('2026-12-28')
    expect(bucketStart('2026-03', 'month')).toBe('2026-03-01')
    expect(bucketStart('2026', 'year')).toBe('2026-01-01')
  })
  it('bucketKeysInRange has no gaps', () => {
    expect(bucketKeysInRange({ start: '2026-01-10', end: '2026-04-02' }, 'month')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(bucketKeysInRange({ start: '2026-03-01', end: '2026-03-03' }, 'day')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
    expect(bucketKeysInRange({ start: '2026-03-05', end: '2026-03-16' }, 'week')).toEqual(['2026-W10', '2026-W11', '2026-W12'])
    expect(bucketKeysInRange({ start: '2025-06-01', end: '2026-02-01' }, 'year')).toEqual(['2025', '2026'])
    expect(bucketKeysInRange({ start: '2026-03-05', end: '2026-03-01' }, 'day')).toEqual([])
  })
  it('labels are Indonesian', () => {
    expect(bucketLabel('2026-03', 'month')).toBe('Mar 2026')
    expect(bucketLabel('2026-W10', 'week')).toBe('Mgg 10 2026')
    expect(bucketLabel('2026-03-05', 'day')).toBe('5 Mar')
    expect(bucketLabel('2026', 'year')).toBe('2026')
  })
  it('defaultGranularity', () => {
    expect(defaultGranularity({ start: '2026-03-01', end: '2026-03-31' })).toBe('day')
    expect(defaultGranularity({ start: '2026-01-01', end: '2026-03-31' })).toBe('week')
    expect(defaultGranularity({ start: '2026-01-01', end: '2026-12-31' })).toBe('month')
    expect(defaultGranularity({ start: '2020-01-01', end: '2026-12-31' })).toBe('year')
  })
})
