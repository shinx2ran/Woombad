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
/** runs of K / L / I touching a '<': the way tesseract reads long '<<<<' filler in Courier-like fonts */
const FILLER_RUN_RE = /<[KLI]{2,}|[KLI]{2,}(?=<)/g

/**
 * Repair what OCR typically does to the '<' filler of an MRZ before `detectDocument` / `parsePassportMrz`
 * see it (the domain parser tolerates the usual letter/digit confusions but needs lines of 40-46 chars):
 * - runs of K/L/I adjacent to a '<' become '<' of the same length;
 * - line 1 (starts with 'P', holds only names after position 5) is cut to 44 characters when OCR made it
 *   longer, since anything past the names field is filler noise.
 * Lines that do not look like an MRZ line are returned unchanged.
 */
export function repairMrzText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const cleaned = line.toUpperCase().replace(FILLER_NOISE_RE, '<').replace(MRZ_JUNK_RE, '')
      if (!MRZ_LIKE_RE.test(cleaned) || !cleaned.includes('<')) return line
      let out = cleaned.replace(FILLER_RUN_RE, (m) => '<'.repeat(m.length))
      if (out.startsWith('P') && out.length > 44) out = out.slice(0, 44)
      return out
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

/**
 * Full pipeline. `onProgress` is called with 0..100. Throws an Error with an Indonesian message on failure;
 * the tesseract worker is always terminated.
 */
export async function recognizeDocument(file: Blob, onProgress: (p: OcrProgress) => void): Promise<DocumentScanResult> {
  onProgress({ phase: 'preprocess', percent: 2, status: 'Memproses gambar…', downloading: false })
  const image = await preprocessImage(file)
  onProgress({ phase: 'preprocess', percent: 10, status: 'Gambar siap', downloading: false })

  let tesseract: typeof import('tesseract.js')
  try {
    tesseract = await import('tesseract.js')
  } catch {
    throw new Error('Komponen OCR tidak bisa dimuat. Periksa koneksi internet lalu coba lagi.')
  }

  const firstRun = !hasOcrDataCached()
  let worker: Awaited<ReturnType<typeof tesseract.createWorker>> | null = null
  try {
    worker = await tesseract.createWorker(OCR_LANGS, undefined, {
      logger: (m) => {
        const mapped = mapOcrProgress(m.status, m.progress)
        onProgress({ ...mapped, downloading: mapped.downloading && firstRun })
      },
      errorHandler: () => {
        /* surfaced through the rejected promise below */
      },
    })
    const { data } = await worker.recognize(image)
    markOcrDataCached()
    onProgress({ phase: 'parse', percent: 100, status: 'Selesai', downloading: false })
    return { text: data.text, ocrConfidence: Math.round(data.confidence ?? 0), image, ...interpretOcrText(data.text) }
  } catch (err) {
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
