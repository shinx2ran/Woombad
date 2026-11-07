/**
 * Kredit Claude (SPEC 7.17): the owner's estimate of the Claude API credit left. Anthropic offers no API for the
 * balance, so the estimate is the monthly credit minus what the scans recorded in Woombad cost since the credit last
 * renewed. Pure functions; dates are the device's local dates ('YYYY-MM-DD'), like the rest of the app.
 */
import { toDateISO } from '../lib/format'

/** Claude Max includes US$100 of API credit a month. */
export const DEFAULT_MONTHLY_CREDIT_USD = 100
export const DEFAULT_RENEWAL_DAY = 1

export interface CreditCycle {
  /** first day of the current cycle (the last renewal on or before today) */
  start: string
  /** the next renewal (the cycle runs until the day before) */
  next: string
  /** first day of the previous cycle */
  previousStart: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate()

/** The renewal date in a month: day 29-31 falls on the last day of a shorter month. month0 may run past 0-11. */
function renewalIn(year: number, month0: number, day: number): string {
  const d = new Date(year, month0, 1)
  const y = d.getFullYear()
  const m = d.getMonth()
  return `${y}-${pad(m + 1)}-${pad(Math.min(day, daysIn(y, m)))}`
}

/** The credit cycle that today falls in, for a renewal day of the month (1-31; anything else counts as 1). */
export function creditCycle(today: string, renewalDay: number | null | undefined): CreditCycle {
  const day = clampDay(renewalDay)
  const [y, m] = today.split('-').map(Number)
  const thisMonth = renewalIn(y, m - 1, day)
  const offset = today >= thisMonth ? 0 : -1
  return {
    start: renewalIn(y, m - 1 + offset, day),
    next: renewalIn(y, m + offset, day),
    previousStart: renewalIn(y, m - 2 + offset, day),
  }
}

/** Local midnight at the start of a 'YYYY-MM-DD' day, as an instant (for filtering created_at). */
export function startOfDayInstant(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** A scan_usage cost (Postgres numeric: a number, or a string from some clients) in whole micro-US$. */
export function costMicros(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : 0
}

export interface UsageRowLike {
  created_at: string
  cost_usd: number | string
}

export interface CreditSummary {
  cycle: CreditCycle
  monthlyUsd: number
  renewalDay: number
  /** what the recorded scans of this cycle cost */
  usedUsd: number
  /** monthly credit minus usedUsd (can go below 0) */
  remainingUsd: number
  scans: number
  /** null without scans */
  averageUsd: number | null
  /** about how many more scans the estimate allows at the average cost (null without scans) */
  scansLeft: number | null
  previousUsedUsd: number
  previousScans: number
}

/**
 * The estimate for today. A scan belongs to the cycle of its local date; sums are made in whole micro-US$ so that
 * many small costs add up exactly.
 */
export function summarizeCredit(
  settings: { monthlyUsd: number | null | undefined; renewalDay: number | null | undefined },
  rows: readonly UsageRowLike[],
  today: string,
): CreditSummary {
  const monthlyUsd = Number.isFinite(settings.monthlyUsd) && (settings.monthlyUsd as number) >= 0 ? (settings.monthlyUsd as number) : DEFAULT_MONTHLY_CREDIT_USD
  const cycle = creditCycle(today, settings.renewalDay)
  const renewalDay = clampDay(settings.renewalDay)
  let used = 0
  let scans = 0
  let previous = 0
  let previousScans = 0
  for (const row of rows) {
    const day = toDateISO(new Date(row.created_at))
    if (day >= cycle.start && day < cycle.next) {
      used += costMicros(row.cost_usd)
      scans += 1
    } else if (day >= cycle.previousStart && day < cycle.start) {
      previous += costMicros(row.cost_usd)
      previousScans += 1
    }
  }
  const usedUsd = used / 1_000_000
  const remainingMicros = Math.round(monthlyUsd * 1_000_000) - used
  const averageMicros = scans > 0 ? used / scans : null
  return {
    cycle,
    monthlyUsd,
    renewalDay,
    usedUsd,
    remainingUsd: remainingMicros / 1_000_000,
    scans,
    averageUsd: averageMicros === null ? null : averageMicros / 1_000_000,
    // in whole micro-US$: remaining / (used / scans) = remaining × scans / used, without a rounded average
    scansLeft: scans > 0 && used > 0 ? Math.max(0, Math.floor((remainingMicros * scans) / used)) : null,
    previousUsedUsd: previous / 1_000_000,
    previousScans,
  }
}

function clampDay(day: number | null | undefined): number {
  return Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31 ? (day as number) : DEFAULT_RENEWAL_DAY
}
