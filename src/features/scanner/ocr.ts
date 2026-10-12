/**
 * Document scan pipeline (browser): image file -> canvas (resize to <= 1600px wide, grayscale, contrast
 * stretch) -> JPEG blob -> tesseract.js ('ind' + 'eng') -> `interpretOcrText`: detect KTP vs passport
 * (`detectDocument`), parse (`parseKtpText` / `parsePassportMrz`) and map to a `ScanPrefill`.
 *
 * tesseract.js is loaded with a dynamic `import()` so the main bundle stays small; its worker script,
 * WASM core and language data (~15 MB, once) come from the CDN and are cached by the service worker
 * (see vite.config.ts runtimeCaching).
 *
 * The pure parts (`fitWithin`, `grayscaleContrastStretch`, `mapOcrProgress`, `interpretOcrText`) have unit
 * tests; the canvas/worker parts only run in a browser.
 */
import { ktpFieldsToTenant, parseKtpText, splitKtpLines, type KtpParseResult } from '../../domain/ktp'
import { detectDocument, parsePassportMrz, passportToTenant, type DocumentKind, type PassportParseResult } from '../../domain/passport'
import type { ScanPrefill } from './types'

export const MAX_IMAGE_WIDTH = 1600
export const OCR_LANGS = ['ind', 'eng']
/** localStorage flag: language data has been downloaded at least once on this device. */
export const OCR_READY_KEY = 'woombad.ocrLangReady'

export type OcrPhase = 'preprocess' | 'load' | 'recognize' | 'parse'

export interface OcrProgress {
  phase: OcrPhase
  /** 0..100 across the whole pipeline */
  percent: number
  /** Indonesian label for the current step */
  status: string
  /** true while language data is being fetched (first run: a ~15 MB download) */
  downloading: boolean
}

/** What `interpretOcrText` makes of the raw OCR text (no I/O; unit-tested). */
export interface OcrInterpretation {
  kind: DocumentKind
  /** values to offer the form; `id_type` follows the detected document ('ktp' when unknown) */
  prefill: ScanPrefill
  /** KTP parse details when kind = 'ktp' */
  ktp: KtpParseResult | null
  /** MRZ parse details (check digits!) when kind = 'passport' */
  passport: PassportParseResult | null
  /** 0..1: KTP key-field share or passport check-digit share; 0 when unknown */
  confidence: number
  /** cleaned, non-empty OCR lines for the "Lihat teks hasil OCR" panel */
  lines: string[]
}

export interface DocumentScanResult extends OcrInterpretation {
  /** raw OCR text */
  text: string
  /** tesseract's own mean confidence, 0..100 */
  ocrConfidence: number
  /** the preprocessed JPEG that was recognised (also what gets uploaded as the document photo) */
  image: Blob
}

/** Scale (width, height) down so width <= maxWidth, keeping the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxWidth: number = MAX_IMAGE_WIDTH): { width: number; height: number } {
  if (width <= maxWidth || width <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  const scale = maxWidth / width
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) }
}

/**
 * In-place grayscale + linear contrast stretch on RGBA pixels. Luminance = 0.299R + 0.587G + 0.114B; the
 * 1st and 99th percentiles are stretched to 0 and 255 so a dim phone photo of a card becomes high-contrast
 * black text on white. Alpha is kept. Returns the [lo, hi] range that was stretched (for tests).
 */
export function grayscaleContrastStretch(pixels: Uint8ClampedArray, lowPct = 0.01, highPct = 0.99): [number, number] {
  const n = pixels.length >> 2
  if (n === 0) return [0, 255]
  const gray = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const y = Math.round(0.299 * pixels[o] + 0.587 * pixels[o + 1] + 0.114 * pixels[o + 2])
    gray[i] = y
    hist[y]++
  }
  let lo = 0
  let hi = 255
  let acc = 0
  // Smallest value whose cumulative count reaches the percentile; at least one pixel so pct 0 = true min.
  const loTarget = Math.max(1, n * lowPct)
  const hiTarget = Math.max(1, n * highPct)
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= loTarget) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= hiTarget) {
      hi = v
      break
    }
  }
  if (hi - lo < 1) {
    lo = 0
    hi = 255
  }
  const scale = 255 / (hi - lo)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    let y = (gray[i] - lo) * scale
    if (y < 0) y = 0
    else if (y > 255) y = 255
    pixels[o] = pixels[o + 1] = pixels[o + 2] = y
  }
  return [lo, hi]
}

/** tesseract.js logger statuses -> one progress bar (10..100; 0..10 is image preprocessing). */
export function mapOcrProgress(status: string, progress: number): OcrProgress {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  const s = status.toLowerCase()
  if (s.includes('loading tesseract core')) return { phase: 'load', percent: 10 + p * 10, status: 'Memuat mesin OCR…', downloading: false }
  if (s.includes('initializing tesseract') || s.includes('initialized tesseract')) {
    return { phase: 'load', percent: 20 + p * 5, status: 'Menyiapkan mesin OCR…', downloading: false }
  }
  if (s.includes('loading language')) return { phase: 'load', percent: 25 + p * 20, status: 'Memuat data bahasa…', downloading: true }
  if (s.includes('loaded language')) return { phase: 'load', percent: 45, status: 'Data bahasa siap', downloading: false }
  if (s.includes('initializing api') || s.includes('initialized api')) {
    return { phase: 'load', percent: 45 + p * 5, status: 'Menyiapkan pengenal teks…', downloading: false }
  }
  if (s.includes('recognizing')) return { phase: 'recognize', percent: 50 + p * 50, status: 'Membaca teks dokumen…', downloading: false }
  return { phase: 'load', percent: 10, status: 'Menyiapkan…', downloading: false }
}

/** Accepts common photo types; HEIC from iPhones cannot be decoded by canvas. */
export function describeUnsupportedImage(file: Blob): string | null {
  const type = file.type.toLowerCase()
  if (!type) return null // let the browser try
  if (type === 'image/heic' || type === 'image/heif') {
    return 'Format HEIC belum didukung. Ubah pengaturan kamera ke "Paling kompatibel" (JPEG) atau pilih gambar lain.'
  }
  if (!type.startsWith('image/')) return 'File yang dipilih bukan gambar.'
  return null
}

/** an OCR line that is plausibly an MRZ line once cleaned: 38+ chars of [A-Z0-9<] with some filler */
const MRZ_LIKE_RE = /^[A-Z0-9<]{38,80}$/
const FILLER_NOISE_RE = /[«»‹›({[]/g
const MRZ_JUNK_RE = /[\s.,'"`\-_:;|]/g
/** filler as tesseract reads a long '<<<<' run in Courier-like fonts: '<' mixed with K / L / I */
const FILLER_ONLY_RE = /^[<KLI]+$/
/** first line of a TD3 MRZ: 'P', type or filler, 3-character issuing state */
const MRZ_LINE1_RE = /^P[A-Z0-9<][A-Z0-9<]{3}/
/** TD3 line 2: positions 28..41 hold the optional personal number (mostly '<' filler) */
const LINE2_PERSONAL_START = 28
const LINE2_PERSONAL_END = 42

/**
 * Line 1 (names from position 5: SURNAME<<GIVEN<NAMES<<<…). A correctly read name field contains '<<' once
 * (the surname / given-names separator) before the filler, so the filler starts at the first '<<' *after*
 * that separator (or right after it for a mononym). Only when everything from there to the end of the line
 * is '<' or K / L / I is it rewritten to '<'; the names themselves are never touched, whatever letters they
 * contain (HILL, LILY, MALIK, WILLI, NIKKI…). Over-long lines are cut to 44 characters.
 */
function repairMrzLine1(line: string): string {
  let out = line
  const separator = out.indexOf('<<', 5)
  if (separator >= 0) {
    const afterSeparator = separator + 2
    const fillerStart = out.startsWith('<', afterSeparator) ? afterSeparator : out.indexOf('<<', afterSeparator)
    if (fillerStart >= 0) {
      const tail = out.slice(fillerStart)
      if (FILLER_ONLY_RE.test(tail)) out = out.slice(0, fillerStart) + '<'.repeat(tail.length)
    }
  }
  return out.length > 44 ? out.slice(0, 44) : out
}

/**
 * Line 2: the document number, nationality, dates and sex (positions 0..27) are never changed. Only the
 * personal-number field (28..41, before the last two check digits) is repaired, and only when it holds
 * nothing but '<' and K / L / I (an empty personal number misread); it then becomes all '<'.
 */
function repairMrzLine2(line: string): string {
  const end = Math.min(LINE2_PERSONAL_END, line.length - 2)
  if (end <= LINE2_PERSONAL_START) return line
  const field = line.slice(LINE2_PERSONAL_START, end)
  if (!field.includes('<') || !FILLER_ONLY_RE.test(field)) return line
  return line.slice(0, LINE2_PERSONAL_START) + '<'.repeat(field.length) + line.slice(end)
}

/**
 * Repair what OCR typically does to the '<' filler of an MRZ before `detectDocument` / `parsePassportMrz`
 * see it (the domain parser tolerates the usual letter/digit confusions but needs lines of 40-46 chars).
 * Only the trailing filler of line 1 and the personal-number filler of line 2 are rewritten (see
 * repairMrzLine1 / repairMrzLine2), so a correctly read name or document number always survives. Line 2 is
 * the MRZ-like line right after line 1 (it may itself start with 'P'). Other lines are returned unchanged.
 */
export function repairMrzText(text: string): string {
  let previousWasLine1 = false
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === '') return line
      const cleaned = line.toUpperCase().replace(FILLER_NOISE_RE, '<').replace(MRZ_JUNK_RE, '')
      const mrzLike = MRZ_LIKE_RE.test(cleaned) && cleaned.includes('<')
      const isLine2 = previousWasLine1
      previousWasLine1 = false
      if (!mrzLike) return line
      if (isLine2) return repairMrzLine2(cleaned)
      if (MRZ_LINE1_RE.test(cleaned)) {
        previousWasLine1 = true
        return repairMrzLine1(cleaned)
      }
      return line
    })
    .join('\n')
}

/**
 * Pure step after OCR: which document is it, what does it say, what should the form get.
 * - 'passport': `parsePassportMrz` -> `passportToTenant` (id_type 'passport', id_number, nationality, name,
 *   gender, birth date); confidence = share of passing check digits.
 * - 'ktp': `parseKtpText` -> `ktpFieldsToTenant` (id_type 'ktp'); confidence = share of key fields found.
 * - 'unknown': empty prefill with id_type 'ktp' (the form default) and confidence 0; the UI tells the user to
 *   retake the photo or type the data manually.
 * `now` only matters for the century rule of MRZ / NIK birth dates (tests).
 */
export function interpretOcrText(rawText: string, now?: Date): OcrInterpretation {
  const text = repairMrzText(rawText)
  const kind = detectDocument(text)
  const lines = splitKtpLines(rawText)
  if (kind === 'passport') {
    const passport = parsePassportMrz(text, now)
    if (passport) {
      const prefill: ScanPrefill = { ...passportToTenant(passport) }
      return { kind, prefill, ktp: null, passport, confidence: passport.confidence, lines }
    }
  }
  if (kind === 'ktp') {
    const ktp = parseKtpText(text, now)
    return { kind, prefill: { id_type: 'ktp', ...ktpFieldsToTenant(ktp.fields) }, ktp, passport: null, confidence: ktp.confidence, lines }
  }
  return { kind: 'unknown', prefill: { id_type: 'ktp' }, ktp: null, passport: null, confidence: 0, lines }
}

export function hasOcrDataCached(): boolean {
  try {
    return localStorage.getItem(OCR_READY_KEY) === '1'
  } catch {
    return false
  }
}

function markOcrDataCached(): void {
  try {
    localStorage.setItem(OCR_READY_KEY, '1')
  } catch {
    /* ignore */
  }
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Gambar tidak bisa dibuka. Coba foto ulang atau pilih file JPG/PNG.'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal mengubah gambar menjadi JPEG.'))),
      type,
      quality,
    )
  })
}

/** Resize to <= 1600px wide, grayscale + contrast stretch, encode as JPEG. */
export async function preprocessImage(file: Blob): Promise<Blob> {
  const unsupported = describeUnsupportedImage(file)
  if (unsupported) throw new Error(unsupported)
  const img = await loadImageElement(file)
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas tidak tersedia di browser ini.')
  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  grayscaleContrastStretch(imageData.data)
  ctx.putImageData(imageData, 0, 0)
  return canvasToBlob(canvas, 'image/jpeg', 0.92)
}

/** Thrown by `recognizeDocument` when its `signal` is aborted (the scanner was closed); not a user error. */
export class ScanAbortedError extends Error {
  constructor() {
    super('Scan dibatalkan.')
    this.name = 'ScanAbortedError'
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ScanAbortedError()
}

/** Settle with `promise`, or reject with ScanAbortedError as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new ScanAbortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ScanAbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/**
 * Full pipeline. `onProgress` is called with 0..100. Throws an Error with an Indonesian message on failure;
 * the tesseract worker is always terminated. When `signal` aborts (e.g. the form was closed mid-scan) the
 * worker is terminated right away, no further progress is reported and the promise rejects with
 * ScanAbortedError.
 */
export async function recognizeDocument(file: Blob, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<DocumentScanResult> {
  const report = (p: OcrProgress) => {
    if (!signal?.aborted) onProgress(p)
  }
  report({ phase: 'preprocess', percent: 2, status: 'Memproses gambar…', downloading: false })
  const image = await preprocessImage(file)
  throwIfAborted(signal)
  report({ phase: 'preprocess', percent: 10, status: 'Gambar siap', downloading: false })

  let tesseract: typeof import('tesseract.js')
  try {
    tesseract = await import('tesseract.js')
  } catch {
    throw new Error('Komponen OCR tidak bisa dimuat. Periksa koneksi internet lalu coba lagi.')
  }
  throwIfAborted(signal)

  const firstRun = !hasOcrDataCached()
  let worker: Awaited<ReturnType<typeof tesseract.createWorker>> | null = null
  try {
    const creating = tesseract.createWorker(OCR_LANGS, undefined, {
      logger: (m) => {
        const mapped = mapOcrProgress(m.status, m.progress)
        report({ ...mapped, downloading: mapped.downloading && firstRun })
      },
      errorHandler: () => {
        /* surfaced through the rejected promise below */
      },
    })
    // Aborted while the worker was still starting: terminate it as soon as it exists.
    const terminateLate = () => void creating.then((w) => w.terminate()).catch(() => undefined)
    signal?.addEventListener('abort', terminateLate, { once: true })
    worker = await untilAborted(creating, signal)
    signal?.removeEventListener('abort', terminateLate)
    const { data } = await untilAborted(worker.recognize(image), signal)
    markOcrDataCached()
    report({ phase: 'parse', percent: 100, status: 'Selesai', downloading: false })
    return { text: data.text, ocrConfidence: Math.round(data.confidence ?? 0), image, ...interpretOcrText(data.text) }
  } catch (err) {
    if (err instanceof ScanAbortedError || signal?.aborted) throw new ScanAbortedError()
    const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new Error(
      offline
        ? 'Tidak ada koneksi internet. Data OCR perlu diunduh sekali saat online.'
        : `Scan dokumen gagal${detail ? `: ${detail}` : '.'} Coba foto yang lebih terang dan rata.`,
    )
  } finally {
    if (worker) await worker.terminate().catch(() => undefined)
  }
}
