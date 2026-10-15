import { addDays, format as dfFormat, parseISO, isValid } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** 1500000 -> "Rp 1.500.000" (negative values keep the sign). */
export function formatRupiah(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return 'Rp 0'
  // Intl renders "Rp 1.500.000" with a non-breaking space; normalise to a plain space.
  return rupiah.format(Math.round(amount)).replace(/ /g, ' ')
}

/** 1500000 -> "1.500.000" */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
  return number.format(Math.round(n))
}

/** Parse a user-typed Rupiah string ("1.500.000", "Rp 1,5jt" is NOT supported) to integer. */
export function parseRupiah(input: string): number {
  const digits = input.replace(/[^0-9-]/g, '')
  if (!digits || digits === '-') return 0
  return Number.parseInt(digits, 10)
}

/** A typed count ("12", "12 bulan"): digits only, at most four (9999 nights is far beyond any stay); null when none. */
export function parseCount(text: string): number | null {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits === '' ? null : Number.parseInt(digits, 10)
}

/** Today's date as 'YYYY-MM-DD' in the user's local timezone. */
export function todayISO(now: Date = new Date()): string {
  return toDateISO(now)
}

/** Date -> 'YYYY-MM-DD' (local timezone, no UTC shift). */
export function toDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' or ISO timestamp -> Date (local). Returns null when invalid. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return isValid(d) ? d : null
}

/** '2026-03-05' -> '5 Mar 2026' */
export function formatDate(value: string | Date | null | undefined, pattern = 'd MMM yyyy'): string {
  const d = typeof value === 'string' ? parseDate(value) : value
  if (!d || !isValid(d)) return '-'
  return dfFormat(d, pattern, { locale: localeId })
}

// ---------- stay dates: stored as the last night, shown as the check-out day ----------
//
// The database stores a period / lease end as the LAST NIGHT (inclusive): 2 nights from 15 Okt end on 16 Okt, a month
// from 15 Okt ends on 14 Nov, and the next period starts the day after. People read an end date as the day the stay
// is over (hotel and kos convention: "15 Okt – 17 Okt" is 2 nights, "15 Okt – 15 Nov" is one month). So every end of
// a stay is SHOWN as the check-out day = last night + 1, and every end date the user types is read as a check-out day
// and stored as check-out - 1. Only these helpers do that conversion (SPEC 7.3).

/** Last night (stored, inclusive) -> check-out day shown to the user: '2026-10-16' -> '2026-10-17'. */
export function checkoutISO(lastNightISO: string): string
export function checkoutISO(lastNightISO: string | null | undefined): string | null
export function checkoutISO(lastNightISO: string | null | undefined): string | null {
  const d = parseDate(lastNightISO)
  return d ? toDateISO(addDays(d, 1)) : null
}

/** Check-out day typed by the user -> last night to store: '2026-10-17' -> '2026-10-16'. */
export function lastNightISO(checkoutDayISO: string): string
export function lastNightISO(checkoutDayISO: string | null | undefined): string | null
export function lastNightISO(checkoutDayISO: string | null | undefined): string | null {
  const d = parseDate(checkoutDayISO)
  return d ? toDateISO(addDays(d, -1)) : null
}

/** The check-out day of a stay that ends on `lastNight` (stored), formatted: '2026-10-16' -> '17 Okt 2026'. */
export function formatCheckout(lastNight: string | null | undefined, pattern = 'd MMM yyyy'): string {
  return formatDate(checkoutISO(lastNight), pattern)
}

/**
 * A stay as people read it, check-in – check-out: ('2026-10-15', '2026-10-16') -> '15 Okt – 17 Okt 2026' (2 nights);
 * the start keeps its year only when the year changes ('28 Des 2026 – 2 Jan 2027'). `full` writes both years.
 */
export function formatStay(start: string | null | undefined, lastNight: string | null | undefined, opts: { full?: boolean } = {}): string {
  const out = checkoutISO(lastNight)
  if (!start || !out) return '-'
  const sameYear = start.slice(0, 4) === out.slice(0, 4)
  const from = formatDate(start, opts.full || !sameYear ? 'd MMM yyyy' : 'd MMM')
  return `${from} – ${formatDate(out)}`
}

/** '2026-03-05T10:20:00Z' -> '5 Mar 2026, 17.20' */
export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, 'd MMM yyyy, HH.mm')
}

/** Month label for charts: '2026-03' -> 'Mar 2026' */
export function formatMonth(yyyyMm: string): string {
  const d = parseDate(`${yyyyMm}-01`)
  return d ? dfFormat(d, 'MMM yyyy', { locale: localeId }) : yyyyMm
}

/** Indonesian phone normaliser: '0812-3456-7890' -> '+6281234567890' (best effort). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = input.replace(/[^0-9+]/g, '')
  if (!digits) return null
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('62')) return `+${digits}`
  if (digits.startsWith('0')) digits = digits.slice(1)
  return `+62${digits}`
}

/** WhatsApp deep link for a phone number; null when phone missing. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  const digits = normalized.replace(/[^0-9]/g, '')
  const q = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${digits}${q}`
}
