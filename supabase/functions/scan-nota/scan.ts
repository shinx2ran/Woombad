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

// ---------- what a scan cost (SPEC 7.17) ----------

/** US$ per million tokens (platform.claude.com/docs/en/about-claude/pricing, checked 7 Nov 2026). */
export interface ModelPrice {
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}

/**
 * The scan model and the models a server-side fallback (`fallbacks: "default"`) can re-run a refused scan on. A model
 * missing here is priced at the dearest entry and marked priced: false, so the estimate errs toward less credit left.
 */
export const SCAN_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
}
const DEAREST: ModelPrice = { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 }

/** A refusal before any output is billed only in these categories (docs: refusals-and-fallback, "How refusals are billed"). */
export const BILLED_PRE_OUTPUT_CATEGORIES: ReadonlyArray<string> = ['bio', 'frontier_llm', 'reasoning_extraction']

interface TokenCounts {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null
}
interface IterationLike extends TokenCounts {
  type: string
  model?: string | null
}

/** The parts of a (beta) Messages API response the cost needs; the SDK's BetaMessage fits it. */
export interface CostInput {
  model: string
  stop_reason: string | null
  stop_details?: { category: string | null } | null
  content: ReadonlyArray<{ type: string }>
  usage: TokenCounts & { iterations?: ReadonlyArray<IterationLike> | null }
}

export interface ScanAttempt {
  kind: 'message' | 'fallback_message'
  model: string
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  /** the refusal category when this attempt declined (null: declined without a category); absent when it did not */
  declined?: string | null
  billed: boolean
  /** false when the model was missing from SCAN_PRICES (priced at the dearest entry) */
  priced: boolean
  cost_usd: number
}

export interface ScanCost {
  attempts: ScanAttempt[]
  /** every billed attempt, each at its own model's price, rounded to 6 decimals (micro-US$) */
  cost_usd: number
  /** summed over the billed attempts; output includes thinking */
  input_tokens: number
  output_tokens: number
  /** the model that produced the reply */
  model: string
  fell_back: boolean
}

const baseModel = (m: string) => m.replace(/-\d{8}$/, '')
const micro = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000

function priceOf(t: TokenCounts, p: ModelPrice): number {
  const write = t.cache_creation_input_tokens ?? 0
  const w1h = t.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = t.cache_creation ? t.cache_creation.ephemeral_5m_input_tokens : write
  const perMillion =
    t.input_tokens * p.input + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h + (t.cache_read_input_tokens ?? 0) * p.cacheRead + t.output_tokens * p.output
  return perMillion / 1_000_000
}

/**
 * What one scan cost. usage.iterations is the per-attempt billing record when a server-side fallback ran (a declined hop
 * is a "message" entry, the hop that served a "fallback_message"); the top-level usage covers only the attempt that
 * produced the reply, so it is used only when there are no iterations, and the two are never added together. A hop that
 * declined before any output is free unless its category is billed; a hop that produced output is always billed.
 */
export function scanCost(res: CostInput, requestedModel: string): ScanCost {
  const entries = (res.usage.iterations ?? []).filter((e) => e.type === 'message' || e.type === 'fallback_message')
  const list: IterationLike[] = entries.length > 0 ? entries : [{ ...res.usage, type: 'message', model: res.model }]
  // one "fallback" content block per hop that declined, in order; its trigger.category says why
  const declinedCategories = res.content
    .filter((b) => b.type === 'fallback')
    .map((b) => (b as { trigger?: { category?: string | null } }).trigger?.category ?? null)
  const attempts = list.map((e, i): ScanAttempt => {
    const isLast = i === list.length - 1
    const declinedHop = !isLast || res.stop_reason === 'refusal'
    // undefined = declined, category unknown (billed, to be safe)
    const category: string | null | undefined = !isLast
      ? i < declinedCategories.length
        ? declinedCategories[i]
        : undefined
      : res.stop_reason === 'refusal'
        ? (res.stop_details?.category ?? null)
        : undefined
    const billed =
      !declinedHop || e.output_tokens > 0 || category === undefined || (category !== null && BILLED_PRE_OUTPUT_CATEGORIES.includes(category))
    // a declined "message" hop can report model: null; it was the requested model
    const model = baseModel(e.model ?? (e.type === 'message' && entries.length > 0 ? requestedModel : res.model))
    const price = SCAN_PRICES[model]
    const attempt: ScanAttempt = {
      kind: e.type === 'fallback_message' ? 'fallback_message' : 'message',
      model,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cache_write_tokens: e.cache_creation_input_tokens ?? 0,
      cache_read_tokens: e.cache_read_input_tokens ?? 0,
      billed,
      priced: price !== undefined,
      cost_usd: billed ? micro(priceOf(e, price ?? DEAREST)) : 0,
    }
    if (declinedHop) attempt.declined = category ?? null
    return attempt
  })
  const billed = attempts.filter((a) => a.billed)
  return {
    attempts,
    cost_usd: micro(billed.reduce((s, a) => s + a.cost_usd, 0)),
    input_tokens: billed.reduce((s, a) => s + a.input_tokens + a.cache_write_tokens + a.cache_read_tokens, 0),
    output_tokens: billed.reduce((s, a) => s + a.output_tokens, 0),
    model: baseModel(res.model),
    fell_back: attempts.some((a) => a.kind === 'fallback_message'),
  }
}

/** How a billed reply ended, as stored in scan_usage.outcome. */
export type ScanOutcome = 'ok' | 'refused' | 'max_tokens' | 'invalid'

/**
 * The scan_usage row the function writes after a billed reply (the database CHECKs mirror this: kind and lines only for
 * a scan that was read).
 */
export function scanUsageRow(
  orgId: string,
  userId: string,
  cost: ScanCost,
  outcome: ScanOutcome,
  read: Pick<ScanResult, 'kind' | 'items'> | null,
) {
  return {
    org_id: orgId,
    user_id: userId,
    model: cost.model,
    input_tokens: cost.input_tokens,
    output_tokens: cost.output_tokens,
    cost_usd: cost.cost_usd,
    outcome,
    kind: outcome === 'ok' && read ? read.kind : null,
    lines: outcome === 'ok' && read ? read.items.length : null,
    attempts: cost.attempts,
  }
}

/** What a scan cost, as the app receives it (the function's reply field `cost`). */
export interface ScanCostReply {
  cost_usd: number
  fell_back: boolean
}

/** The `cost` field of a reply, checked; null when it is missing (an older function) or malformed. Never throws. */
export function parseScanCostReply(value: unknown): ScanCostReply | null {
  if (!isRecord(value)) return null
  const usd = value.cost_usd
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return null
  return { cost_usd: usd, fell_back: value.fell_back === true }
}

/** What went wrong calling Claude, reduced to what the mapping needs (SDK error classes stay in index.ts). */
export interface ScanApiFailure {
  kind: 'timeout' | 'connection' | 'api' | 'other'
  /** HTTP status of an API error */
  status?: number | null
  /** error.type of an API error, e.g. 'billing_error' */
  type?: string | null
  /** error.message of an API error (wording can change: only a fallback signal) */
  message?: string | null
}

export interface ScanFailureReply {
  status: number
  error: string
  message: string
}

/**
 * The reply for a failed Claude call, in words the person scanning can act on. Only a problem with the photo itself
 * asks for a new photo; a setup problem (credit, key) points the owner to the Console, so nobody keeps retaking photos.
 * - Credit used up arrives as 402 / billing_error, or as a 400 whose message mentions the credit balance.
 * - A personal key from the Claude Console (not scoped to a workspace) is refused with a 400 that names the workspace
 *   (seen live on 7 Nov 2026); the fix is a workspace key, not a new photo.
 * - Any other 400 says so only when its message is about the image; otherwise it is a request the photo cannot fix.
 */
export function describeScanFailure(f: ScanApiFailure): ScanFailureReply {
  if (f.kind === 'timeout') return { status: 504, error: 'timeout', message: 'Pembacaan terlalu lama. Coba lagi, atau foto per halaman.' }
  if (f.kind === 'connection') return { status: 502, error: 'upstream', message: 'Tidak dapat menghubungi layanan pembaca. Coba lagi.' }
  if (f.kind === 'other') return { status: 500, error: 'internal', message: 'Terjadi kesalahan. Coba lagi.' }
  const status = f.status ?? 0
  const said = f.message ?? ''
  if (status === 402 || f.type === 'billing_error' || (status === 400 && /credit balance/i.test(said))) {
    return {
      status: 503,
      error: 'not_configured',
      message: 'Kredit API Claude habis. Pemilik perlu menambah kredit di platform.claude.com, atau menunggu kredit bulan berikutnya.',
    }
  }
  if (status === 401 || status === 403 || f.type === 'authentication_error' || f.type === 'permission_error') {
    return { status: 503, error: 'not_configured', message: 'Kunci API Claude tidak valid. Pemilik perlu memeriksanya di platform.claude.com.' }
  }
  if (status === 404 || f.type === 'not_found_error') {
    return { status: 503, error: 'not_configured', message: 'Model Claude tidak tersedia untuk kunci ini. Pemilik perlu memeriksanya di platform.claude.com.' }
  }
  if (status === 429 || status === 529 || f.type === 'rate_limit_error' || f.type === 'overloaded_error') {
    return { status: 429, error: 'busy', message: 'Layanan pembaca sedang sibuk. Coba lagi sebentar lagi.' }
  }
  if (status === 413 || f.type === 'request_too_large') return { status: 413, error: 'too_large', message: 'Foto terlalu besar. Ambil ulang fotonya.' }
  if (status === 400) {
    if (/workspace/i.test(said)) {
      return {
        status: 503,
        error: 'not_configured',
        message: 'Kunci API Claude harus milik sebuah workspace. Pemilik perlu membuat kunci workspace di platform.claude.com, lalu menggantinya di Supabase.',
      }
    }
    if (/api[ -]?key/i.test(said)) {
      return { status: 503, error: 'not_configured', message: 'Kunci API Claude tidak dapat dipakai. Pemilik perlu memeriksanya di platform.claude.com.' }
    }
    if (/image/i.test(said)) {
      return { status: 400, error: 'unreadable', message: 'Foto ini tidak dapat diproses. Ambil ulang fotonya (JPG, terang, satu halaman).' }
    }
    return { status: 502, error: 'upstream', message: 'Layanan pembaca menolak permintaan ini. Coba lagi; bila terus terjadi, beri tahu pemilik.' }
  }
  return { status: 502, error: 'upstream', message: 'Layanan pembaca sedang bermasalah. Coba lagi.' }
}
