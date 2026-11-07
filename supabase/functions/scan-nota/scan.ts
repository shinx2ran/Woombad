/**
 * Scan nota (SPEC 7.16): what Claude is asked to read from a photo of an expense record, and the strict check of what
 * comes back. Plain TypeScript with no imports, so the Edge Function (Deno) and the app's unit tests (Vitest) run the
 * same code.
 */

/** The operating-expense categories Claude may suggest (refunds are never scanned: they need a lease). */
export const SCAN_CATEGORIES = ['wages', 'maintenance', 'utilities', 'supplies', 'tax', 'marketing', 'other'] as const
export type ScanCategory = (typeof SCAN_CATEGORIES)[number]

export const SCAN_KINDS = ['expense_list', 'receipt', 'unreadable'] as const
export type ScanKind = (typeof SCAN_KINDS)[number]

export interface ScanItem {
  /** day / month / year as written; null when that part is not on the photo */
  day: number | null
  month: number | null
  year: number | null
  /** readable Indonesian description (abbreviations written out) */
  description: string
  /** the line exactly as read, for the person checking */
  written_text: string
  /** rupiah, whole number */
  amount: number
  category: ScanCategory
  vendor: string | null
  /** some part of the line (especially the amount) was hard to read */
  unclear: boolean
}

export interface ScanResult {
  kind: ScanKind
  items: ScanItem[]
  /** the total written under the list or on the receipt, if any */
  written_total: number | null
  /** short Indonesian note for the person checking, or '' */
  notes: string
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

/** JSON schema for structured outputs (every object closed, every property required, no numeric constraints). */
export const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'items', 'written_total', 'notes'],
  properties: {
    kind: { type: 'string', enum: [...SCAN_KINDS] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'month', 'year', 'description', 'written_text', 'amount', 'category', 'vendor', 'unclear'],
        properties: {
          day: nullable({ type: 'integer' }),
          month: nullable({ type: 'integer' }),
          year: nullable({ type: 'integer' }),
          description: { type: 'string' },
          written_text: { type: 'string' },
          amount: { type: 'integer' },
          category: { type: 'string', enum: [...SCAN_CATEGORIES] },
          vendor: nullable({ type: 'string' }),
          unclear: { type: 'boolean' },
        },
      },
    },
    written_total: nullable({ type: 'integer' }),
    notes: { type: 'string' },
  },
} as const

export const SCAN_SYSTEM_PROMPT = `You read photos of expense records for a boarding house (kos) in Indonesia and return them as structured data for the owner's bookkeeping app. Someone checks every line before it is saved, so mark what you are unsure of rather than guessing silently.

The photo is usually one of two things:
- A handwritten expense list, often one page per month: each line has a date such as "17/10", a short description and an amount. Return one item per expense line. Skip headings, the month name and sum lines. Put the total written under the list in written_total; ignore a total that belongs to another list on the page (for example a previous month's total at the top).
- A shop receipt or nota: return one item for the whole transaction, with the total paid, a short description of what was bought, the shop name as vendor, and the receipt's date. Put the receipt's total in written_total too.

Amounts are rupiah as whole numbers. A dot or comma between groups of three digits separates thousands: "500.000" is 500000, "757.800" is 757800, "30rb" is 30000, "1,5jt" is 1500000.

Dates: give day, month and year as written, as numbers; use null for any part that is not written. Handwritten lists usually omit the year; take the month from a heading such as "Bulan Oktober" when a line has no month. A two-digit year such as "26" is 2026.

description: Indonesian, as written but easy to read: fix obvious spelling and write abbreviations out (bh = buah, bks = bungkus, bwh = bawah, pcs = buah). written_text: the line exactly as you read it.

category, one of:
- utilities: electricity (listrik, voucher or token PLN), water (air, PDAM, air tangki, air waduk), internet, gas
- maintenance: repairs, spare parts, tools, lamps and fittings, pumps
- supplies: cleaning items, trash bags, soap and detergent, toiletries, stationery
- wages: pay for staff or workers
- tax: taxes and official fees (pajak, retribusi)
- marketing: advertising
- other: anything else, or when unsure

unclear: true when any part of the line, especially the amount, is hard to read.

If the photo is not an expense record or cannot be read, return kind "unreadable" with no items and say why in notes.

notes: one or two short Indonesian sentences for the person checking (for example which line was hard to read or that a total does not match), or an empty string.`

export const SCAN_USER_TEXT = 'Baca catatan pengeluaran di foto ini.'

/** Image types Claude accepts that a phone produces. */
export const SCAN_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ScanMediaType = (typeof SCAN_MEDIA_TYPES)[number]

/** The app sends at most a 2000 px JPEG (well under 2 MB); this refuses anything far bigger before it costs money. */
export const MAX_IMAGE_BASE64_CHARS = 8_000_000

/** Thrown when the model's output does not have the promised shape. */
export class ScanOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanOutputError'
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function intOrNull(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isInteger(v)) return v
  throw new ScanOutputError(`${field} bukan bilangan bulat`)
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new ScanOutputError(`${field} bukan teks`)
  return v.trim().replace(/\s+/g, ' ')
}

/**
 * Check and tidy Claude's JSON (already parsed). Structured outputs guarantee the shape, but the result is checked
 * anyway: it decides money. Day/month/year outside the calendar become null (the app then asks for the date), an
 * unknown category becomes 'other', amounts must be positive whole rupiah.
 */
export function parseScanOutput(value: unknown): ScanResult {
  if (!isRecord(value)) throw new ScanOutputError('hasil bukan objek')
  const kind = SCAN_KINDS.includes(value.kind as ScanKind) ? (value.kind as ScanKind) : null
  if (!kind) throw new ScanOutputError('jenis foto tidak dikenal')
  if (!Array.isArray(value.items)) throw new ScanOutputError('daftar baris tidak ada')
  const items: ScanItem[] = value.items.map((raw, i) => {
    const at = `baris ${i + 1}`
    if (!isRecord(raw)) throw new ScanOutputError(`${at} bukan objek`)
    const amount = raw.amount
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) throw new ScanOutputError(`${at}: jumlah tidak valid`)
    const day = intOrNull(raw.day, `${at} tanggal`)
    const month = intOrNull(raw.month, `${at} bulan`)
    const year = intOrNull(raw.year, `${at} tahun`)
    const vendor = raw.vendor === null || raw.vendor === undefined ? null : text(raw.vendor, `${at} vendor`) || null
    return {
      day: day !== null && day >= 1 && day <= 31 ? day : null,
      month: month !== null && month >= 1 && month <= 12 ? month : null,
      year: year !== null && year >= 2000 && year <= 2100 ? year : null,
      description: text(raw.description, `${at} keterangan`),
      written_text: text(raw.written_text ?? '', `${at} teks`),
      amount,
      category: SCAN_CATEGORIES.includes(raw.category as ScanCategory) ? (raw.category as ScanCategory) : 'other',
      vendor,
      unclear: raw.unclear === true,
    }
  })
  const total = intOrNull(value.written_total, 'total')
  return {
    kind,
    items,
    written_total: total !== null && total > 0 ? total : null,
    notes: typeof value.notes === 'string' ? value.notes.trim() : '',
  }
}
