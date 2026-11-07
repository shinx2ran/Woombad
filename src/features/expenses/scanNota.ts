/**
 * Scan nota (SPEC 7.16), the app side: prepare the photo, ask the "scan-nota" Edge Function to read it, and turn
 * what came back into rows the person checks before anything is saved. The reading itself (prompt, schema, strict
 * check) lives in supabase/functions/scan-nota/scan.ts and is shared with the function.
 */
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase'
import { REFUND_CATEGORIES, type Expense, type ExpenseCategory } from '../../types/db'
import {
  SCAN_MEDIA_TYPES,
  parseScanOutput,
  type ScanItem,
  type ScanMediaType,
  type ScanResult,
} from '../../../supabase/functions/scan-nota/scan.ts'
import type { ExpenseDraft } from './expenseUtils'
import { scaledSize } from './receiptImage'

export type { ScanResult } from '../../../supabase/functions/scan-nota/scan.ts'

/** Handwriting needs more pixels than a printed receipt; the same JPEG is kept as the receipt photo. */
export const SCAN_MAX_EDGE = 2000
const SCAN_JPEG_QUALITY = 0.85
/** the receipts bucket limit (supabase/schema.sql) */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

export interface PreparedScanImage {
  /** what is uploaded as the receipt photo */
  file: File
  base64: string
  mediaType: ScanMediaType
}

/** A message for the person scanning; `code` is the function's error code (or a local one). */
export class ScanRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ScanRequestError'
    this.code = code
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function reencode(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, SCAN_MAX_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SCAN_JPEG_QUALITY))
    if (!blob) return null
    return new File([blob], file.name.replace(/\.[^./]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

/**
 * Scale the photo down to a JPEG of at most 2000 px (enough to read handwriting, and a predictable cost per scan).
 * A photo the browser cannot decode is sent as it is when it is already a JPG/PNG/WebP under 5 MB.
 */
export async function prepareScanImage(file: File): Promise<PreparedScanImage> {
  const scaled = await reencode(file)
  const chosen = scaled ?? file
  const mediaType = chosen.type as ScanMediaType
  if (!SCAN_MEDIA_TYPES.includes(mediaType)) {
    throw new ScanRequestError('format', 'Format foto tidak didukung. Ambil foto dengan kamera, atau pilih foto JPG/PNG.')
  }
  if (chosen.size > MAX_PHOTO_BYTES) throw new ScanRequestError('too_large', 'Foto terlalu besar (maksimal 5 MB). Ambil ulang fotonya.')
  return { file: chosen, base64: await toBase64(chosen), mediaType }
}

/** Ask the Edge Function to read the photo. Errors come back as ScanRequestError with a message to show as is. */
export async function requestScan(orgId: string, image: PreparedScanImage): Promise<ScanResult> {
  let data: unknown
  try {
    const res = await getSupabase().functions.invoke('scan-nota', { body: { orgId, image: image.base64, mediaType: image.mediaType } })
    if (res.error) throw res.error
    data = res.data
  } catch (err) {
    throw await toScanError(err)
  }
  const result = (data as { result?: unknown } | null)?.result
  try {
    return parseScanOutput(result)
  } catch {
    throw new ScanRequestError('upstream', 'Hasil baca tidak lengkap. Coba lagi atau ambil ulang fotonya.')
  }
}

/**
 * The function's own message when it sent one; otherwise a plain explanation by kind of failure. Only replies with the
 * function's shape ({ error, message }) are shown as they are: the Supabase gateway answers with its own English JSON
 * (e.g. 404 "Requested function was not found" before the function is deployed; the function itself never answers 404).
 */
export async function toScanError(err: unknown): Promise<ScanRequestError> {
  if (err instanceof ScanRequestError) return err
  if (err instanceof FunctionsHttpError) {
    const response = err.context as Response | undefined
    if (response?.status === 404) return new ScanRequestError('not_deployed', 'Scan nota belum tersedia di server. Hubungi pemilik.')
    const payload = await response
      ?.clone()
      .json()
      .catch(() => null)
    if (payload && typeof payload.error === 'string' && typeof payload.message === 'string') return new ScanRequestError(payload.error, payload.message)
    return new ScanRequestError('upstream', 'Server tidak dapat membaca foto saat ini. Coba lagi.')
  }
  if (err instanceof FunctionsFetchError) return new ScanRequestError('offline', 'Tidak ada sambungan ke server. Periksa internet lalu coba lagi.')
  return new ScanRequestError('upstream', 'Server tidak dapat membaca foto saat ini. Coba lagi.')
}

/**
 * Mode Demo has no server: the review screen shows this made-up month instead (it says so on screen), so the flow can
 * be tried without a key. Not real data.
 */
export const DEMO_SCAN_RESULT: ScanResult = {
  kind: 'expense_list',
  items: [
    { day: 2, month: 10, year: null, description: 'Token listrik bawah tangga', written_text: '2/10 Token listrik bwh tangga 500.000', amount: 500000, category: 'utilities', vendor: null, unclear: false },
    { day: 5, month: 10, year: null, description: 'Lampu LED kamar mandi 3 buah', written_text: '5/10 Lampu LED km 3bh 105.000', amount: 105000, category: 'maintenance', vendor: null, unclear: false },
    { day: 12, month: 10, year: null, description: 'Internet', written_text: '12/10 Internet 650.000', amount: 650000, category: 'utilities', vendor: null, unclear: false },
    { day: 14, month: 10, year: null, description: 'Kantong sampah 2 bungkus', written_text: '14/10 Kantong sampah 2bks 20.000', amount: 20000, category: 'supplies', vendor: null, unclear: false },
    { day: 18, month: 10, year: null, description: 'Servis pompa air', written_text: '18/10 Servis pompa air 175.0?0', amount: 175000, category: 'maintenance', vendor: null, unclear: true },
    { day: 21, month: 10, year: null, description: 'Sabun cuci dan pewangi lantai', written_text: '21/10 Sabun cuci + pewangi lantai 48.500', amount: 48500, category: 'supplies', vendor: null, unclear: false },
    { day: 26, month: 10, year: null, description: 'Upah bersih selokan', written_text: '26/10 Upah bersih selokan 100.000', amount: 100000, category: 'wages', vendor: null, unclear: false },
    { day: 29, month: 10, year: null, description: 'Token listrik', written_text: '29/10 Token listrik 500.000', amount: 500000, category: 'utilities', vendor: null, unclear: false },
  ],
  written_total: 2098500,
  notes: 'Baris 18/10: angka jumlahnya kurang jelas, mohon diperiksa.',
}

// ---------- rows for the review screen ----------

export interface ScanRow {
  key: string
  /** saved when ticked */
  include: boolean
  /** ISO date, '' when it could not be read */
  date: string
  /** the month was not written: the app took the current (or previous) month */
  monthGuessed: boolean
  description: string
  amount: number
  category: ExpenseCategory
  vendor: string
  /** the line as Claude read it */
  writtenText: string
  unclear: boolean
  /** an expense already recorded with the same date and amount */
  duplicateOf: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const DAY_MS = 86_400_000
/** a line dated up to a week ahead (written in advance) is taken as dated ahead; further ahead it belongs to an earlier year */
const FUTURE_SLACK_DAYS = 7

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * The date of a scanned line. Lists rarely carry a year: the latest year that does not put the line more than a week
 * in the future (October read on 7 Nov 2026 is 2026; December read in January is last year; 2 January read on 28
 * December is next year). A line without a month takes `monthForUndated` (one month for the whole scan, see
 * monthForUndatedLines), or on its own this month, or last month when its day is still ahead. No day, or a day that
 * does not exist, gives ''.
 */
export function resolveScanDate(
  item: Pick<ScanItem, 'day' | 'month' | 'year'>,
  today: string,
  monthForUndated: number | null = null,
): { date: string; monthGuessed: boolean } {
  const [ty, tm, td] = today.split('-').map(Number)
  const day = item.day
  if (!day) return { date: '', monthGuessed: false }
  let month = item.month
  let monthGuessed = false
  if (month === null) {
    monthGuessed = true
    month = monthForUndated ?? (day > td ? (tm === 1 ? 12 : tm - 1) : tm)
  }
  let year = item.year
  if (year === null) {
    const now = Date.UTC(ty, tm - 1, td)
    const m = month
    const ahead = (y: number) => (Date.UTC(y, m - 1, day) - now) / DAY_MS
    year = [ty + 1, ty, ty - 1].find((y) => ahead(y) <= FUTURE_SLACK_DAYS) ?? ty - 1
  }
  if (!isRealDate(year, month, day)) return { date: '', monthGuessed }
  return { date: iso(year, month, day), monthGuessed }
}

/**
 * One month for every line of a scan that carries no month, so a page is never split over two months: the month the
 * other lines name most; with no month anywhere, last month when any of those days is still ahead this month, else this
 * month. null when every line has a month (or no day).
 */
export function monthForUndatedLines(items: Pick<ScanItem, 'day' | 'month'>[], today: string): number | null {
  const undated = items.filter((i) => i.day && i.month === null)
  if (undated.length === 0) return null
  const counts = new Map<number, number>()
  for (const i of items) if (i.month !== null) counts.set(i.month, (counts.get(i.month) ?? 0) + 1)
  if (counts.size > 0) return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  const [, tm, td] = today.split('-').map(Number)
  return undated.some((i) => (i.day ?? 0) > td) ? (tm === 1 ? 12 : tm - 1) : tm
}

/**
 * Rows for the review screen. A line with the same date and amount as an expense already recorded is shown but
 * unticked ("mungkin sudah tercatat"): scanning the same page twice must not double the costs. Each recorded expense
 * answers for one line only (two 30.000 lines on the same day, one recorded: one stays ticked), and refunds to a tenant
 * are never taken for a scanned cost.
 */
export function buildScanRows(
  result: ScanResult,
  today: string,
  existing: (Pick<Expense, 'id' | 'expense_date' | 'amount'> & Partial<Pick<Expense, 'category'>>)[],
): ScanRow[] {
  const monthForUndated = monthForUndatedLines(result.items, today)
  const unmatched = existing.filter((e) => !e.category || !REFUND_CATEGORIES.includes(e.category))
  return result.items.map((item, i) => {
    const { date, monthGuessed } = resolveScanDate(item, today, monthForUndated)
    const at = date ? unmatched.findIndex((e) => e.expense_date === date && e.amount === item.amount) : -1
    const duplicate = at >= 0 ? unmatched.splice(at, 1)[0] : undefined
    return {
      key: `scan-${i}`,
      include: !duplicate,
      date,
      monthGuessed,
      description: item.description,
      amount: item.amount,
      category: item.category,
      vendor: item.vendor ?? '',
      writtenText: item.written_text,
      unclear: item.unclear,
      duplicateOf: duplicate?.id ?? null,
    }
  })
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** What is missing on a row that would be saved, or null. */
export function scanRowError(row: Pick<ScanRow, 'date' | 'amount' | 'description'>): string | null {
  if (!ISO_DATE_RE.test(row.date)) return 'Isi tanggalnya.'
  if (!Number.isInteger(row.amount) || row.amount <= 0) return 'Isi jumlahnya.'
  if (!row.description.trim()) return 'Isi keterangannya.'
  return null
}

export interface ScanTotalCheck {
  /** every row read, ticked or not: the paper's total counts every line */
  sum: number
  writtenTotal: number | null
  /** writtenTotal - sum (0 = matches) */
  difference: number
}

/**
 * The total to check the lines against: a handwritten list's own total is an independent check; a receipt's total is
 * the same number read once (it is the line), so it proves nothing and is not shown as a match.
 */
export function totalToCheck(result: Pick<ScanResult, 'kind' | 'written_total'>): number | null {
  return result.kind === 'expense_list' ? result.written_total : null
}

export function scanTotalCheck(rows: Pick<ScanRow, 'amount'>[], writtenTotal: number | null): ScanTotalCheck {
  const sum = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0)
  return { sum, writtenTotal, difference: writtenTotal === null ? 0 : writtenTotal - sum }
}

/** Expense rows for the ticked lines (kos chosen once for the whole scan; null = Bersama). */
export function scannedExpenseDrafts(rows: ScanRow[], propertyId: string | null): ExpenseDraft[] {
  return rows
    .filter((r) => r.include)
    .map((r) => ({
      expense_date: r.date,
      property_id: propertyId,
      lease_id: null,
      category: r.category,
      amount: r.amount,
      description: r.description.trim(),
      vendor: r.vendor.trim() || null,
      receipt_path: null,
    }))
}
