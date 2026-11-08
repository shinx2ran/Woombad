/**
 * Scan KTP with Claude (SPEC 7.19): what Claude is asked to read from a photo of an identity document, and the strict
 * check of what comes back. Plain TypeScript with no imports, so the Edge Function (Deno) and the app's unit tests
 * (Vitest) run the same code. The result is the raw card fields; the app (src/features/scanner/claudeScan.ts) turns
 * them into form values, a KTP through the same ktpFieldsToTenant the on-device reader uses, so both readers meet the
 * same review screen.
 */

export const KTP_SCAN_KINDS = ['ktp', 'passport', 'unknown'] as const
export type KtpScanKind = (typeof KTP_SCAN_KINDS)[number]

/** The card's fields exactly as printed (upper case), null when not on the card or not readable. */
export interface KtpScanFields {
  nik: string | null
  nama: string | null
  tempat_lahir: string | null
  /** 'YYYY-MM-DD' */
  tanggal_lahir: string | null
  /** 'L' | 'P' */
  jenis_kelamin: string | null
  gol_darah: string | null
  alamat: string | null
  /** 'NNN/NNN' */
  rt_rw: string | null
  kel_desa: string | null
  kecamatan: string | null
  /** 'KOTA X' -> 'X', 'KABUPATEN X' -> 'KAB. X', as the app's parser does */
  kota: string | null
  provinsi: string | null
  agama: string | null
  status_perkawinan: string | null
  pekerjaan: string | null
  kewarganegaraan: string | null
}

/** A passport's machine-readable data (the two MRZ lines), as the app's passport parser produces it. */
export interface PassportScanFields {
  surname: string | null
  given_names: string | null
  passport_number: string | null
  /** ISO 3166-1 alpha-3, e.g. 'IDN' */
  nationality: string | null
  /** 'YYYY-MM-DD' */
  birth_date: string | null
  /** 'L' | 'P' */
  sex: string | null
  /** 'YYYY-MM-DD' */
  expiry_date: string | null
}

export interface KtpScanResult {
  kind: KtpScanKind
  ktp: KtpScanFields | null
  passport: PassportScanFields | null
  /** field names (of ktp or passport) the reader was not sure of */
  unclear: string[]
  /** short Indonesian note for the person checking, or '' */
  notes: string
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const text = nullable({ type: 'string' })

const KTP_FIELD_NAMES = [
  'nik', 'nama', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'gol_darah', 'alamat', 'rt_rw', 'kel_desa', 'kecamatan',
  'kota', 'provinsi', 'agama', 'status_perkawinan', 'pekerjaan', 'kewarganegaraan',
] as const
const PASSPORT_FIELD_NAMES = ['surname', 'given_names', 'passport_number', 'nationality', 'birth_date', 'sex', 'expiry_date'] as const

/** JSON schema for structured outputs (every object closed, every property required, no numeric constraints). */
export const KTP_SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'ktp', 'passport', 'unclear', 'notes'],
  properties: {
    kind: { type: 'string', enum: [...KTP_SCAN_KINDS] },
    ktp: nullable({
      type: 'object',
      additionalProperties: false,
      required: [...KTP_FIELD_NAMES],
      properties: Object.fromEntries(KTP_FIELD_NAMES.map((k) => [k, text])),
    }),
    passport: nullable({
      type: 'object',
      additionalProperties: false,
      required: [...PASSPORT_FIELD_NAMES],
      properties: Object.fromEntries(PASSPORT_FIELD_NAMES.map((k) => [k, text])),
    }),
    unclear: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
} as const

export const KTP_SCAN_SYSTEM_PROMPT = `You read photos of identity documents for a boarding house (kos) in Indonesia and return the printed data as structured fields for the owner's tenant form. A person checks every field before it is saved, so mark what you are unsure of rather than guessing silently.

The photo is one of:
- An Indonesian e-KTP (national identity card). Return kind "ktp" and every field exactly as printed, in UPPER CASE as on the card:
  - nik: the 16 digits, no spaces. tempat_lahir and tanggal_lahir come from the one line "Tempat/Tgl Lahir: PLACE, DD-MM-YYYY"; give tanggal_lahir as YYYY-MM-DD.
  - jenis_kelamin: "L" for LAKI-LAKI, "P" for PEREMPUAN. gol_darah: A, B, AB or O; null when the card shows "-".
  - rt_rw as printed, "NNN/NNN". alamat is the street line only (RT/RW, Kel/Desa and Kecamatan are their own fields).
  - provinsi: the first header line without the word PROVINSI. kota: the second header line: "KOTA X" becomes "X", "KABUPATEN X" becomes "KAB. X"; a line with neither word (Jakarta's "JAKARTA SELATAN") stays as printed.
  - Do not read the issue place and date printed under the photo into any field. The NIK's digits 7-12 encode the birth date (DDMMYY; DD over 40 means a woman, minus 40): when the printed date and the NIK disagree, keep what is printed and name the field in unclear.
- A passport: return kind "passport" with the fields of the two machine-readable lines at the bottom (surname, given names, passport number, nationality as the 3-letter code, birth date and expiry as YYYY-MM-DD, sex "L" or "P"). Prefer the machine-readable lines over the printed page when they differ.
- Anything else, or a photo too blurry or dark to read: kind "unknown" with ktp and passport null, and say why in notes.

Use null for any field you cannot read at all. List in unclear every field you were not sure of (a smudged digit, glare over a word). Never invent a value to fill a field.

notes: one or two short Indonesian sentences for the person checking (for example which field was hard to read), or an empty string.`

export const KTP_SCAN_USER_TEXT = 'Baca dokumen identitas di foto ini.'

/** Thrown when the model's output does not have the promised shape. */
export class KtpScanOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KtpScanOutputError'
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** year first, '-', '/' or '.' between, day and month with or without a leading zero ('1990-5-25') */
const YEAR_FIRST_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
/** the card's own form, DD-MM-YYYY, in case the model copies it instead of converting ('5-3-1990' too) */
const PRINTED_DATE_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/

/** A trimmed, single-spaced, upper-cased string, or null when empty or not a string. */
function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ').toUpperCase()
  return t === '' || t === '-' ? null : t
}

/**
 * 'YYYY-MM-DD' that exists in the calendar, else null. The prompt asks for that form; a date the model wrote another
 * unambiguous way (the card's DD-MM-YYYY, no leading zeros, '/' or '.') is turned into it rather than lost.
 */
function cleanDate(v: unknown): string | null {
  const t = clean(v)
  if (!t) return null
  const yearFirst = YEAR_FIRST_RE.exec(t)
  const printed = yearFirst ? null : PRINTED_DATE_RE.exec(t)
  const parts = yearFirst ? [yearFirst[1], yearFirst[2], yearFirst[3]] : printed ? [printed[3], printed[2], printed[1]] : null
  if (!parts) return null
  const [y, m, d] = parts.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
}

/** 'NNN/NNN' from '003/005', '3/5', '003 / 005' or 'RT 003 RW 005'; anything else (a third number, other words) null */
function cleanRtRw(v: unknown): string | null {
  const t = clean(v)
  if (!t) return null
  const numbers = t.match(/\d+/g)
  if (!numbers || numbers.length !== 2 || numbers.some((n) => n.length > 3)) return null
  if (t.replace(/\d+/g, '').replace(/RT|RW|[\s./]/g, '') !== '') return null
  return numbers.map((n) => n.padStart(3, '0')).join('/')
}

/** a name from the machine-readable lines: the '<' fillers are spaces ('ERIKA<<MARIA' -> 'ERIKA MARIA') */
function cleanMrzName(v: unknown): string | null {
  const t = clean(v)
  return t ? clean(t.replace(/</g, ' ')) : null
}

function cleanGender(v: unknown): string | null {
  const t = clean(v)
  if (!t) return null
  if (t === 'L' || t.startsWith('LAKI') || t === 'M' || t === 'MALE') return 'L'
  if (t === 'P' || t.startsWith('PEREMPUAN') || t === 'F' || t === 'FEMALE') return 'P'
  return null
}

/**
 * Check and tidy Claude's JSON (already parsed). Structured outputs guarantee the shape, but the result decides what
 * lands in a tenant record, so it is checked anyway: a NIK must be 16 digits, dates real, gender L/P; anything else in
 * those fields becomes null (the app then leaves the field empty and the person types it). Text fields are upper-cased
 * and single-spaced; the app title-cases them with the same code it uses for the on-device reader.
 */
export function parseKtpScanOutput(value: unknown): KtpScanResult {
  if (!isRecord(value)) throw new KtpScanOutputError('hasil bukan objek')
  const kind = KTP_SCAN_KINDS.includes(value.kind as KtpScanKind) ? (value.kind as KtpScanKind) : null
  if (!kind) throw new KtpScanOutputError('jenis dokumen tidak dikenal')
  const unclear = Array.isArray(value.unclear) ? value.unclear.filter((u): u is string => typeof u === 'string') : []
  const notes = typeof value.notes === 'string' ? value.notes.trim() : ''

  let ktp: KtpScanFields | null = null
  let passport: PassportScanFields | null = null
  if (kind === 'ktp') {
    if (!isRecord(value.ktp)) throw new KtpScanOutputError('data KTP tidak ada')
    const k = value.ktp
    const nik = clean(k.nik)?.replace(/\s/g, '') ?? null
    ktp = {
      nik: nik && /^\d{16}$/.test(nik) ? nik : null,
      nama: clean(k.nama),
      tempat_lahir: clean(k.tempat_lahir),
      tanggal_lahir: cleanDate(k.tanggal_lahir),
      jenis_kelamin: cleanGender(k.jenis_kelamin),
      gol_darah: (() => {
        const g = clean(k.gol_darah)
        return g && ['A', 'B', 'AB', 'O'].includes(g) ? g : null
      })(),
      alamat: clean(k.alamat),
      rt_rw: cleanRtRw(k.rt_rw),
      kel_desa: clean(k.kel_desa),
      kecamatan: clean(k.kecamatan),
      kota: clean(k.kota),
      provinsi: clean(k.provinsi),
      agama: clean(k.agama),
      status_perkawinan: clean(k.status_perkawinan),
      pekerjaan: clean(k.pekerjaan),
      kewarganegaraan: clean(k.kewarganegaraan),
    }
  } else if (kind === 'passport') {
    if (!isRecord(value.passport)) throw new KtpScanOutputError('data paspor tidak ada')
    const p = value.passport
    const nat = clean(p.nationality)?.replace(/</g, '') || null
    passport = {
      surname: cleanMrzName(p.surname),
      given_names: cleanMrzName(p.given_names),
      passport_number: clean(p.passport_number)?.replace(/[^A-Z0-9]/g, '') || null,
      nationality: nat && /^[A-Z]{1,3}$/.test(nat) ? nat : null,
      birth_date: cleanDate(p.birth_date),
      sex: cleanGender(p.sex),
      expiry_date: cleanDate(p.expiry_date),
    }
  }
  return { kind, ktp, passport, unclear, notes }
}

/** The fields a KTP scan filled (for the function's usage log: a count, never the values). */
export function countFilledFields(result: KtpScanResult): number {
  const obj = result.ktp ?? result.passport
  return obj ? Object.values(obj).filter((v) => v !== null).length : 0
}
