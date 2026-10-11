import { describe, expect, it } from 'vitest'
import {
  describeDelta,
  describeRatioDelta,
  effectiveGranularity,
  formatCompactRupiah,
  formatPct,
  isISODate,
  rangeForPresetChange,
  rangeLabel,
  resolveRangeState,
  shiftReportRange,
} from './reportRange'

const TODAY = '2026-03-14'

describe('resolveRangeState', () => {
  it('defaults to the current month when params are missing or invalid', () => {
    const s = resolveRangeState({ preset: null, from: null, to: null, granularity: null }, TODAY)
    expect(s).toEqual({ preset: 'monthly', range: { start: '2026-03-01', end: '2026-03-31' }, granularity: 'auto' })
    const bad = resolveRangeState({ preset: 'bogus', from: '2026-13-40', to: 'x', granularity: 'hourly' }, TODAY)
    expect(bad).toEqual(s)
  })

  it('re-derives a preset range from the from date', () => {
    const s = resolveRangeState({ preset: 'weekly', from: '2026-03-04', to: null, granularity: 'day' }, TODAY)
    expect(s.range).toEqual({ start: '2026-03-02', end: '2026-03-08' })
    expect(s.granularity).toBe('day')
  })

  it('custom uses from/to and swaps a reversed pair', () => {
    const s = resolveRangeState({ preset: 'custom', from: '2026-03-20', to: '2026-03-05', granularity: null }, TODAY)
    expect(s.range).toEqual({ start: '2026-03-05', end: '2026-03-20' })
    const partial = resolveRangeState({ preset: 'custom', from: null, to: null, granularity: null }, TODAY)
    expect(partial.range).toEqual({ start: '2026-03-01', end: TODAY })
  })
})

describe('shiftReportRange', () => {
  it('shifts presets by one unit', () => {
    expect(shiftReportRange({ start: '2026-03-01', end: '2026-03-31' }, 'monthly', -1)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(shiftReportRange({ start: '2026-03-14', end: '2026-03-14' }, 'daily', 1)).toEqual({ start: '2026-03-15', end: '2026-03-15' })
  })
  it('shifts a custom range by its own length', () => {
    expect(shiftReportRange({ start: '2026-03-01', end: '2026-03-10' }, 'custom', 1)).toEqual({ start: '2026-03-11', end: '2026-03-20' })
    expect(shiftReportRange({ start: '2026-03-01', end: '2026-03-10' }, 'custom', -1)).toEqual({ start: '2026-02-19', end: '2026-02-28' })
  })
})

describe('rangeForPresetChange', () => {
  it('anchors on today when today is inside the current range, else on the range start', () => {
    expect(rangeForPresetChange('monthly', { start: '2026-03-09', end: '2026-03-15' }, TODAY)).toEqual({ start: '2026-03-01', end: '2026-03-31' })
    expect(rangeForPresetChange('weekly', { start: '2026-01-01', end: '2026-01-31' }, TODAY)).toEqual({ start: '2025-12-29', end: '2026-01-04' })
    expect(rangeForPresetChange('custom', { start: '2026-01-01', end: '2026-01-31' }, TODAY)).toEqual({ start: '2026-01-01', end: '2026-01-31' })
  })
})

describe('rangeLabel', () => {
  it('labels each preset in Indonesian', () => {
    expect(rangeLabel({ start: '2026-03-01', end: '2026-03-31' }, 'monthly')).toBe('Maret 2026')
    expect(rangeLabel({ start: '2026-03-02', end: '2026-03-08' }, 'weekly')).toBe('Mgg 10 2026')
    expect(rangeLabel({ start: '2026-03-05', end: '2026-03-05' }, 'daily')).toBe('5 Mar 2026')
    expect(rangeLabel({ start: '2026-01-01', end: '2026-12-31' }, 'yearly')).toBe('2026')
    expect(rangeLabel({ start: '2026-03-01', end: '2026-04-15' }, 'custom')).toBe('1 Mar 2026 – 15 Apr 2026')
    expect(rangeLabel({ start: '2026-03-01', end: '2026-03-01' }, 'custom')).toBe('1 Mar 2026')
  })
})

describe('effectiveGranularity', () => {
  it('uses the override or the default for the range', () => {
    expect(effectiveGranularity({ start: '2026-03-01', end: '2026-03-31' }, 'auto')).toBe('day')
    expect(effectiveGranularity({ start: '2026-01-01', end: '2026-12-31' }, 'auto')).toBe('month')
    expect(effectiveGranularity({ start: '2026-01-01', end: '2026-12-31' }, 'week')).toBe('week')
  })
})

describe('formatCompactRupiah', () => {
  it('abbreviates with rb / jt / M and a decimal comma', () => {
    expect(formatCompactRupiah(0)).toBe('0')
    expect(formatCompactRupiah(500)).toBe('500')
    expect(formatCompactRupiah(850_000)).toBe('850 rb')
    expect(formatCompactRupiah(1_200_000)).toBe('1,2 jt')
    expect(formatCompactRupiah(12_000_000)).toBe('12 jt')
    expect(formatCompactRupiah(1_500_000_000)).toBe('1,5 M')
    expect(formatCompactRupiah(-1_250_000)).toBe('-1,3 jt')
  })
})

describe('deltas', () => {
  it('formatPct rounds and handles null', () => {
    expect(formatPct(0.3249)).toBe('32%')
    expect(formatPct(1.5)).toBe('150%')
    expect(formatPct(null)).toBe('–')
  })
  it('describeDelta renders arrows, amounts and percentage of previous', () => {
    const fmt = (n: number) => `Rp${n}`
    expect(describeDelta(200, 1000, fmt)).toEqual({ direction: 'up', text: '▲ Rp200 (20%)' })
    expect(describeDelta(-500, 1000, fmt)).toEqual({ direction: 'down', text: '▼ Rp500 (50%)' })
    expect(describeDelta(300, 0, fmt)).toEqual({ direction: 'up', text: '▲ Rp300' })
    expect(describeDelta(0, 0, fmt).direction).toBe('flat')
  })
  it('describeRatioDelta uses percentage points', () => {
    expect(describeRatioDelta(0.75, 0.6)).toEqual({ direction: 'up', text: '▲ 15 poin' })
    expect(describeRatioDelta(0.5, 0.6)).toEqual({ direction: 'down', text: '▼ 10 poin' })
    expect(describeRatioDelta(0.5, null).direction).toBe('flat')
  })
})

describe('isISODate', () => {
  it('accepts calendar-valid dates only', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
    expect(isISODate(null)).toBe(false)
  })
})
