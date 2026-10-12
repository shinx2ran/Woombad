/**
 * Pure date/period arithmetic. All dates are 'YYYY-MM-DD' strings in local time.
 * No timezone conversions: never use `new Date('YYYY-MM-DD')` (that is UTC and shifts a day in UTC+7).
 */
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfISOWeek,
  endOfMonth,
  endOfYear,
  format,
  getISOWeek,
  getISOWeekYear,
  isValid,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import type { PeriodType } from '../types/db'

export type Granularity = 'day' | 'week' | 'month' | 'year'
export type RangePreset = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface DateRange {
  /** inclusive */
  start: string
  /** inclusive */
  end: string
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/

/** 'YYYY-MM-DD' (or an ISO timestamp, date part only) -> local Date at 00:00. Throws on invalid input. */
export function parseISODate(iso: string): Date {
  const m = ISO_RE.exec(iso)
  if (!m) throw new Error(`Tanggal tidak valid: ${iso}`)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!isValid(d) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(`Tanggal tidak valid: ${iso}`)
  }
  return d
}

/** local Date -> 'YYYY-MM-DD' */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Whole days from a to b (b - a). Same day = 0. */
export function daysBetween(aISO: string, bISO: string): number {
  return differenceInCalendarDays(parseISODate(bISO), parseISODate(aISO))
}

export function addDaysISO(iso: string, days: number): string {
  return toISODate(addDays(parseISODate(iso), days))
}

/**
 * Start date + n periods. monthly uses calendar months (Jan 31 + 1 month = Feb 28/29, date-fns semantics),
 * weekly = 7 days, daily = 1 day. n may be 0 or negative.
 */
export function addPeriods(startISO: string, periodType: PeriodType, n: number): string {
  const d = parseISODate(startISO)
  switch (periodType) {
    case 'daily':
      return toISODate(addDays(d, n))
    case 'weekly':
      return toISODate(addWeeks(d, n))
    case 'monthly':
      return toISODate(addMonths(d, n))
  }
}

/**
 * Inclusive end date of `quantity` periods starting at `startISO`:
 * addPeriods(start, type, quantity) minus one day. E.g. monthly from 2026-01-15 x1 -> 2026-02-14;
 * daily from 2026-03-01 x3 -> 2026-03-03.
 */
export function periodEnd(startISO: string, periodType: PeriodType, quantity: number): string {
  if (quantity < 1) throw new Error('Jumlah periode minimal 1')
  return addDaysISO(addPeriods(startISO, periodType, quantity), -1)
}

/**
 * Period boundaries anchored on a lease start date, so monthly leases never drift at month end:
 * anchor 2026-01-31, fromIndex 1, quantity 1 -> { start: 2026-02-28, end: 2026-03-30 }
 * (the next anchor is 2026-03-31, and the period ends the day before it).
 */
export function periodBounds(anchorISO: string, periodType: PeriodType, fromIndex: number, quantity: number): DateRange {
  if (quantity < 1) throw new Error('Jumlah periode minimal 1')
  if (fromIndex < 0) throw new Error('Indeks periode tidak boleh negatif')
  return {
    start: addPeriods(anchorISO, periodType, fromIndex),
    end: addDaysISO(addPeriods(anchorISO, periodType, fromIndex + quantity), -1),
  }
}

/**
 * Number of whole periods needed to cover [startISO, endISO] inclusive (ceil, minimum 1).
 * daily: days+1; weekly: ceil((days+1)/7); monthly: smallest n with periodEnd(start, monthly, n) >= end.
 */
export function periodsToCover(startISO: string, endISO: string, periodType: PeriodType): number {
  const days = daysBetween(startISO, endISO)
  if (days < 0) return 1
  if (periodType === 'daily') return days + 1
  if (periodType === 'weekly') return Math.max(1, Math.ceil((days + 1) / 7))
  let n = 1
  while (periodEnd(startISO, 'monthly', n) < endISO) n++
  return n
}

/**
 * Range for a preset around an anchor date:
 *  daily   -> that day
 *  weekly  -> Monday..Sunday containing the anchor
 *  monthly -> first..last day of month
 *  yearly  -> Jan 1..Dec 31
 */
export function rangeForPreset(preset: RangePreset, anchorISO: string): DateRange {
  const d = parseISODate(anchorISO)
  switch (preset) {
    case 'daily':
      return { start: anchorISO.slice(0, 10), end: anchorISO.slice(0, 10) }
    case 'weekly':
      return { start: toISODate(startOfISOWeek(d)), end: toISODate(endOfISOWeek(d)) }
    case 'monthly':
      return { start: toISODate(startOfMonth(d)), end: toISODate(endOfMonth(d)) }
    case 'yearly':
      return { start: toISODate(startOfYear(d)), end: toISODate(endOfYear(d)) }
  }
}

/** Shift a preset range by n presets (n=-1 previous month, +1 next). */
export function shiftRange(range: DateRange, preset: RangePreset, n: number): DateRange {
  const s = parseISODate(range.start)
  switch (preset) {
    case 'daily':
      return rangeForPreset('daily', toISODate(addDays(s, n)))
    case 'weekly':
      return rangeForPreset('weekly', toISODate(addWeeks(s, n)))
    case 'monthly':
      return rangeForPreset('monthly', toISODate(addMonths(startOfMonth(s), n)))
    case 'yearly':
      return rangeForPreset('yearly', toISODate(addYears(startOfYear(s), n)))
  }
}

/** The equivalent range immediately before `range` (same length for custom ranges; previous month for a month, etc.). */
export function previousRange(range: DateRange, preset?: RangePreset): DateRange {
  if (preset) return shiftRange(range, preset, -1)
  const length = daysBetween(range.start, range.end) + 1
  const end = addDaysISO(range.start, -1)
  return { start: addDaysISO(end, -(length - 1)), end }
}

/**
 * Bucket key for grouping: day -> 'YYYY-MM-DD'; week -> ISO week 'YYYY-Www' (Monday start);
 * month -> 'YYYY-MM'; year -> 'YYYY'. Keys sort chronologically as strings within a granularity.
 */
export function bucketKey(iso: string, granularity: Granularity): string {
  const d = parseISODate(iso)
  switch (granularity) {
    case 'day':
      return toISODate(d)
    case 'week':
      return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`
    case 'month':
      return toISODate(d).slice(0, 7)
    case 'year':
      return String(d.getFullYear())
  }
}

/** First day of the bucket identified by key. */
export function bucketStart(key: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return key
    case 'week': {
      const m = /^(\d{4})-W(\d{2})$/.exec(key)
      if (!m) throw new Error(`Kunci minggu tidak valid: ${key}`)
      let d = new Date(Number(m[1]), 6, 1) // mid-year avoids ISO-year edge cases before setting
      d = setISOWeekYear(d, Number(m[1]))
      d = setISOWeek(d, Number(m[2]))
      return toISODate(startOfISOWeek(d))
    }
    case 'month':
      return `${key}-01`
    case 'year':
      return `${key}-01-01`
  }
}

/** Human label (Indonesian): '2026-03' -> 'Mar 2026'; '2026-W10' -> 'Mgg 10 2026'; day -> '5 Mar'; year -> '2026'. */
export function bucketLabel(key: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return format(parseISODate(key), 'd MMM', { locale: localeId })
    case 'week': {
      const m = /^(\d{4})-W(\d{2})$/.exec(key)
      return m ? `Mgg ${Number(m[2])} ${m[1]}` : key
    }
    case 'month':
      return format(parseISODate(`${key}-01`), 'MMM yyyy', { locale: localeId })
    case 'year':
      return key
  }
}

/** Every bucket key from range.start to range.end inclusive, in order, with no gaps. */
export function bucketKeysInRange(range: DateRange, granularity: Granularity): string[] {
  if (range.end < range.start) return []
  const keys: string[] = []
  let cursor = parseISODate(bucketStart(bucketKey(range.start, granularity), granularity))
  const end = parseISODate(range.end)
  // hard cap protects against runaway loops on absurd ranges (e.g. 100 years of days)
  for (let guard = 0; cursor <= end && guard < 20000; guard++) {
    keys.push(bucketKey(toISODate(cursor), granularity))
    switch (granularity) {
      case 'day':
        cursor = addDays(cursor, 1)
        break
      case 'week':
        cursor = addWeeks(cursor, 1)
        break
      case 'month':
        cursor = addMonths(cursor, 1)
        break
      case 'year':
        cursor = addYears(cursor, 1)
        break
    }
  }
  return keys
}

/** Pick a sensible chart granularity for a range: <=31 days -> day, <=120 -> week, <=730 -> month, else year. */
export function defaultGranularity(range: DateRange): Granularity {
  const days = daysBetween(range.start, range.end) + 1
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  if (days <= 730) return 'month'
  return 'year'
}

export function inRange(iso: string, range: DateRange): boolean {
  const d = iso.slice(0, 10)
  return d >= range.start && d <= range.end
}

/**
 * For period-over-period comparison of a range that is still in progress (range.end > today):
 * returns the elapsed part of the range and the same elapsed length of the previous range, so
 * "October so far" is compared with "September up to the same day". When the range is complete,
 * returns it unchanged with the full previous range.
 */
export function comparableRanges(
  range: DateRange,
  todayISO: string,
  preset?: RangePreset,
): { current: DateRange; previous: DateRange; isPartial: boolean } {
  const prev = previousRange(range, preset)
  if (todayISO >= range.end || todayISO < range.start) {
    return { current: range, previous: prev, isPartial: false }
  }
  const elapsed = daysBetween(range.start, todayISO) // 0-based
  const current = { start: range.start, end: todayISO }
  const prevEnd = addDaysISO(prev.start, elapsed)
  return { current, previous: { start: prev.start, end: prevEnd < prev.end ? prevEnd : prev.end }, isPartial: true }
}
