/**
 * Pure helpers for the Laporan page: preset/range state, labels and compact number formatting.
 * Everything date-related delegates to src/domain/period.ts (no re-implementation of calculations).
 */
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import type { DateRange, Granularity, RangePreset } from '../../domain/period'
import {
  addDaysISO,
  bucketKey,
  bucketLabel,
  daysBetween,
  defaultGranularity,
  parseISODate,
  rangeForPreset,
  shiftRange,
} from '../../domain/period'
import { formatDate } from '../../lib/format'

export type ReportPreset = RangePreset | 'custom'
export type GranularityChoice = Granularity | 'auto'

export const PRESET_OPTIONS: { value: ReportPreset; label: string }[] = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
  { value: 'custom', label: 'Kustom' },
]

export const GRANULARITY_OPTIONS: { value: GranularityChoice; label: string }[] = [
  { value: 'auto', label: 'Otomatis' },
  { value: 'day', label: 'Hari' },
  { value: 'week', label: 'Minggu' },
  { value: 'month', label: 'Bulan' },
  { value: 'year', label: 'Tahun' },
]

const PRESETS: readonly ReportPreset[] = ['daily', 'weekly', 'monthly', 'yearly', 'custom']
const GRANULARITIES: readonly GranularityChoice[] = ['auto', 'day', 'week', 'month', 'year']

export function isReportPreset(value: string | null): value is ReportPreset {
  return value !== null && (PRESETS as readonly string[]).includes(value)
}

export function isGranularityChoice(value: string | null): value is GranularityChoice {
  return value !== null && (GRANULARITIES as readonly string[]).includes(value)
}

/** Strict 'YYYY-MM-DD' check (calendar-valid), used for query-string input. */
export function isISODate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    parseISODate(value)
    return true
  } catch {
    return false
  }
}

export interface ReportRangeState {
  preset: ReportPreset
  range: DateRange
  granularity: GranularityChoice
}

/**
 * Resolve the page state from query-string values. Invalid or missing values fall back to the monthly
 * range around `today`. For presets the range is re-derived from `from` so a hand-edited URL stays valid;
 * for 'custom' both `from` and `to` are used (swapped when reversed).
 */
export function resolveRangeState(
  params: { preset: string | null; from: string | null; to: string | null; granularity: string | null },
  today: string,
): ReportRangeState {
  const preset: ReportPreset = isReportPreset(params.preset) ? params.preset : 'monthly'
  const granularity: GranularityChoice = isGranularityChoice(params.granularity) ? params.granularity : 'auto'
  if (preset === 'custom') {
    const from = isISODate(params.from) ? params.from : rangeForPreset('monthly', today).start
    const to = isISODate(params.to) ? params.to : today
    return { preset, range: from <= to ? { start: from, end: to } : { start: to, end: from }, granularity }
  }
  const anchor = isISODate(params.from) ? params.from : today
  return { preset, range: rangeForPreset(preset, anchor), granularity }
}

/** Range after pressing ◀ (n = -1) or ▶ (n = +1). A custom range moves by its own length. */
export function shiftReportRange(range: DateRange, preset: ReportPreset, n: number): DateRange {
  if (preset !== 'custom') return shiftRange(range, preset, n)
  const length = daysBetween(range.start, range.end) + 1
  return { start: addDaysISO(range.start, n * length), end: addDaysISO(range.end, n * length) }
}

/** Switch preset keeping the current start date as the anchor (custom keeps the whole range). */
export function rangeForPresetChange(preset: ReportPreset, current: DateRange, today: string): DateRange {
  if (preset === 'custom') return current
  // anchor on today when it is inside the current range (so "Bulanan" from this week gives this month)
  const anchor = today >= current.start && today <= current.end ? today : current.start
  return rangeForPreset(preset, anchor)
}

/**
 * Human label for the range: 'Maret 2026', 'Mgg 10 2026', '5 Mar 2026', '2026' or
 * '1 Mar 2026 – 15 Apr 2026' (custom, or a single day when start = end).
 */
export function rangeLabel(range: DateRange, preset: ReportPreset): string {
  switch (preset) {
    case 'daily':
      return formatDate(range.start)
    case 'weekly':
      return bucketLabel(bucketKey(range.start, 'week'), 'week')
    case 'monthly':
      return format(parseISODate(range.start), 'MMMM yyyy', { locale: localeId })
    case 'yearly':
      return range.start.slice(0, 4)
    case 'custom':
      return range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} – ${formatDate(range.end)}`
  }
}

/** The granularity to chart with: the manual override, or `defaultGranularity` of the range. */
export function effectiveGranularity(range: DateRange, choice: GranularityChoice): Granularity {
  return choice === 'auto' ? defaultGranularity(range) : choice
}

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: 'hari',
  week: 'minggu',
  month: 'bulan',
  year: 'tahun',
}

// ---------- number formatting ----------

/** Indonesian decimal comma, at most one decimal, no trailing ',0': 1.25 -> '1,3'; 2 -> '2'. */
function oneDecimal(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return String(rounded).replace('.', ',')
}

/**
 * Compact Rupiah for axis ticks: 1_200_000 -> '1,2 jt'; 850_000 -> '850 rb'; 1_500_000_000 -> '1,5 M';
 * 0 -> '0'; negatives keep the sign ('-1,2 jt').
 */
export function formatCompactRupiah(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}${oneDecimal(abs / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `${sign}${oneDecimal(abs / 1_000_000)} jt`
  if (abs >= 1_000) return `${sign}${oneDecimal(abs / 1_000)} rb`
  return `${sign}${Math.round(abs)}`
}

/** 0.3249 -> '32%' ; 1.5 -> '150%' ; null -> '–' */
export function formatPct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '–'
  return `${Math.round(ratio * 100)}%`
}

export interface DeltaInfo {
  /** 'up' | 'down' | 'flat' */
  direction: 'up' | 'down' | 'flat'
  /** '▲ Rp 1.200.000 (12%)' / '▼ 3 poin' / '— tidak berubah' */
  text: string
}

/**
 * Delta of an amount vs the previous period (current - previous), rendered with ▲/▼ and a percentage of
 * the previous value when that is non-zero. `format` renders the absolute delta (e.g. formatRupiah).
 */
export function describeDelta(delta: number, previous: number, format: (n: number) => string): DeltaInfo {
  if (delta === 0) return { direction: 'flat', text: '— tidak berubah' }
  const arrow = delta > 0 ? '▲' : '▼'
  const pct = previous !== 0 ? ` (${formatPct(Math.abs(delta) / Math.abs(previous))})` : ''
  return { direction: delta > 0 ? 'up' : 'down', text: `${arrow} ${format(Math.abs(delta))}${pct}` }
}

/** Delta for ratios (margin, collection rate, occupancy) in percentage points: '▲ 3 poin'. */
export function describeRatioDelta(current: number | null, previous: number | null): DeltaInfo {
  if (current === null || previous === null) return { direction: 'flat', text: '— tidak ada pembanding' }
  const points = Math.round((current - previous) * 100)
  if (points === 0) return { direction: 'flat', text: '— tidak berubah' }
  return { direction: points > 0 ? 'up' : 'down', text: `${points > 0 ? '▲' : '▼'} ${Math.abs(points)} poin` }
}
