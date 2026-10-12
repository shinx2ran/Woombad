/**
 * KTP (Indonesian ID card) text parsing. Input is raw OCR text (tesseract.js, 'ind' + 'eng');
 * output is best-effort structured fields the user can correct in the form.
 *
 * KTP layout (top to bottom): PROVINSI, KABUPATEN/KOTA, NIK, Nama, Tempat/Tgl Lahir, Jenis Kelamin,
 * Gol. Darah, Alamat, RT/RW, Kel/Desa, Kecamatan, Agama, Status Perkawinan, Pekerjaan,
 * Kewarganegaraan, Berlaku Hingga. There is NO phone number on a KTP.
 *
 * OCR is noisy: labels may be misspelled ("Nama" -> "Narna", "Alamat" -> "Alarnat"), colons may be
 * missing or read as ';' or '-', and the NIK may contain O/o for 0, I/l for 1, S for 5, B for 8.
 */
import type { Gender } from '../types/db'
import { parseISODate } from './period'

export interface KtpFields {
  nik?: string
  nama?: string
  tempat_lahir?: string
  /** 'YYYY-MM-DD' */
  tanggal_lahir?: string
  jenis_kelamin?: Gender
  gol_darah?: string
  alamat?: string
  rt_rw?: string
  kel_desa?: string
  kecamatan?: string
  kota?: string
  provinsi?: string
  agama?: string
  status_perkawinan?: string
  pekerjaan?: string
  kewarganegaraan?: string
}

export interface KtpParseResult {
  fields: KtpFields
  /** 0..1: share of the key fields (nik, nama, tanggal_lahir, jenis_kelamin, alamat) that were found */
  confidence: number
  /** cleaned, non-empty lines of the OCR text */
  lines: string[]
}

/** The five fields that drive `confidence`. */
export const KTP_KEY_FIELDS = ['nik', 'nama', 'tanggal_lahir', 'jenis_kelamin', 'alamat'] as const satisfies readonly (keyof KtpFields)[]

const NIK_RE = /^\d{16}$/

/** 16 digits. */
export function isValidNik(nik: string): boolean {
  return NIK_RE.test(nik)
}

/** Characters OCR commonly confuses with digits, and the digit they stand for. */
const NIK_CHAR_MAP: Record<string, string> = {
  O: '0',
  o: '0',
  I: '1',
  l: '1',
  i: '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2',
  z: '2',
  G: '6',
}

/** Character class of everything that may appear inside a NIK candidate (digits, look-alikes, spaces). */
const NIK_CANDIDATE_CHARS = '0-9OoIlSBZG'
const NIK_RUN_RE = new RegExp(`[${NIK_CANDIDATE_CHARS}][${NIK_CANDIDATE_CHARS} ]*`, 'g')

/** Strip spaces and map look-alike letters to digits (no length check). */
function nikDigits(candidate: string): string {
  let out = ''
  for (const ch of candidate) {
    if (ch === ' ') continue
    out += NIK_CHAR_MAP[ch] ?? ch
  }
  return out
}

/**
 * Fix common OCR digit confusions in a NIK candidate (O->0, I/l->1, S->5, B->8, Z->2, G->6) and strip spaces.
 * Returns null when the result is not 16 digits.
 */
export function normalizeNik(candidate: string): string | null {
  const digits = nikDigits(candidate.trim())
  return isValidNik(digits) ? digits : null
}

/**
 * NIK digits 7-12 encode birth date DDMMYY; DD > 40 means female (DD - 40). Century: YY > current 2-digit
 * year -> 19YY, else 20YY. Returns null for an invalid NIK or an impossible date.
 */
export function nikInfo(nik: string, now?: Date): { birthDate: string; gender: Gender } | null {
  if (!isValidNik(nik)) return null
  let day = Number(nik.slice(6, 8))
  const month = Number(nik.slice(8, 10))
  const yy = Number(nik.slice(10, 12))
  let gender: Gender = 'L'
  if (day > 40) {
    gender = 'P'
    day -= 40
  }
  const nowYY = (now ?? new Date()).getFullYear() % 100
  const year = yy <= nowYY ? 2000 + yy : 1900 + yy
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  try {
    parseISODate(iso)
  } catch {
    return null
  }
  return { birthDate: iso, gender }
}

/**
 * DD sep MM sep YYYY where sep is '-', '/', '.', or whitespace (also tolerates 'DD-MM- YYYY'). The day is
 * anchored on both sides so it cannot start in the middle of a longer digit run ('115-03-1990' or
 * '2005-03-1990' must not yield a date).
 */
const KTP_DATE_RE = /(?<!\d)(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{4})(?!\d)/

/** Build 'YYYY-MM-DD' from day/month/year strings; null when the date does not exist. */
function isoFromParts(day: string, month: string, year: string): string | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  try {
    parseISODate(iso)
  } catch {
    return null
  }
  return iso
}

/**
 * Parse Indonesian date strings from the card: '05-03-1990', '05/03/1990', '05 03 1990', '5-3-1990'
 * -> '1990-03-05'. Returns null when not parseable or impossible.
 */
export function parseKtpDate(text: string): string | null {
  const m = KTP_DATE_RE.exec(text)
  if (!m) return null
  return isoFromParts(m[1], m[2], m[3])
}

// ---------- label matching ----------

type LabelKey =
  | 'provinsi'
  | 'kota'
  | 'nik'
  | 'nama'
  | 'ttl'
  | 'jenis_kelamin'
  | 'gol_darah'
  | 'alamat'
  | 'rt_rw'
  | 'kel_desa'
  | 'kecamatan'
  | 'agama'
  | 'status_perkawinan'
  | 'pekerjaan'
  | 'kewarganegaraan'
  | 'berlaku'

/**
 * Tolerant label regexes (anchored at line start, case-insensitive). Common OCR substitutions:
 * m <-> rn, l/I/1/i interchangeable, g <-> q, '/' read as 'I' or '|'. Order matters only in that the
 * first match wins, so more specific labels come before shorter ones.
 */
const LABEL_RES: ReadonlyArray<readonly [LabelKey, RegExp]> = [
  ['provinsi', /^PROV[I1l]NS[I1l]\b/i],
  ['kota', /^(?:KABUPATEN|KAB\.?|KOTA)\b/i],
  ['nik', /^N[I1l]K\b/i],
  ['nama', /^Na(?:m|rn)a\b/i],
  ['ttl', /^Te(?:m|rn)pat\W*T[gq][lI1i]\.?\W*Lah[iIl1]r/i],
  ['jenis_kelamin', /^Jen[iIl1]s\W*Ke[lI1]a(?:m|rn)[iIl1]n/i],
  ['gol_darah', /^Go[lI1]\.?\W*Darah/i],
  ['alamat', /^A[lI1]a(?:m|rn)at\b/i],
  ['rt_rw', /^RT[\s/|\\I1l.]*RW\b/i],
  ['kel_desa', /^Ke[lI1]\.?\W*Desa\b/i],
  ['kecamatan', /^Keca(?:m|rn)atan\b/i],
  ['kewarganegaraan', /^Kewarganegaraan\b/i],
  ['agama', /^Aga(?:m|rn)a\b/i],
  ['status_perkawinan', /^Status(?:\W*Perkaw[iIl1]nan)?\b/i],
  ['pekerjaan', /^Pekerjaan\b/i],
  ['berlaku', /^Berlaku\b/i],
]

/** 'Gol. Darah' anywhere in a line (it shares the line with 'Jenis Kelamin' on most cards). */
const GOL_DARAH_INLINE_RE = /\bGo[lI1]\.?\W*Darah/i

/** Separators OCR puts between a label and its value: ':', ';', '=', '-', '.', '|' and whitespace. */
const LEADING_SEP_RE = /^[\s:;=\-.|]+/

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Text after the matched label with leading separators removed. Empty string when nothing follows. */
function valueAfter(line: string, match: RegExpExecArray): string {
  return collapseSpaces(line.slice(match.index + match[0].length).replace(LEADING_SEP_RE, ''))
}

function matchLabel(line: string): { key: LabelKey; value: string } | null {
  for (const [key, re] of LABEL_RES) {
    const m = re.exec(line)
    if (m) return { key, value: valueAfter(line, m) }
  }
  return null
}

function parseGender(value: string): Gender | undefined {
  const v = value.toUpperCase()
  if (/LAK[I1l]/.test(v) || /^PR[I1l]A\b/.test(v)) return 'L'
  if (/PEREMP|WAN[I1l]TA/.test(v)) return 'P'
  return undefined
}

/**
 * Blood type: A, B, AB, O (optionally with +/-). OCR often reads 'O' as '0'. Anything else (including the
 * '-' printed when the type is unknown) is treated as missing.
 */
function parseBloodType(value: string): string | undefined {
  const v = value.toUpperCase().replace(/\s+/g, '').replace(/^0/, 'O')
  return /^(?:A|B|AB|O)[+-]?$/.test(v) ? v : undefined
}

const TRAILING_SEP_RE = /[\s,.;:\-/]+$/

/**
 * 'BANDUNG, 05-03-1990' -> { place: 'BANDUNG', date: '1990-03-05' }; falls back to splitting on the last comma.
 *
 * A place name never ends in a digit, so digits stranded between the place and the date are OCR noise and
 * are always stripped from the place. When they sit right before the day with only whitespace in between,
 * OCR broke the day apart ('BANDUNG, 1 5-03-1990' is really 15-03-1990): if the stranded digit and the
 * matched day join into an existing date (at most two digits) that repaired date is used, otherwise the
 * split is treated as failed and the date is dropped so the NIK-encoded date can fill in. Digits set off by
 * punctuation ('BANDUNG 2, 15-03-1990') leave the complete date alone.
 */
function parseTtl(value: string): { place?: string; date?: string } {
  const m = KTP_DATE_RE.exec(value)
  if (m) {
    const before = value.slice(0, m.index)
    const remnant = /(\d+)([\s,.;:\-/]*)$/.exec(before)
    const place = collapseSpaces(
      before.slice(0, remnant ? remnant.index : before.length).replace(TRAILING_SEP_RE, ''),
    )
    let date: string | null = isoFromParts(m[1], m[2], m[3])
    if (remnant && /^\s*$/.test(remnant[2])) {
      const joinedDay = remnant[1] + m[1]
      date = joinedDay.length <= 2 ? isoFromParts(joinedDay, m[2], m[3]) : null
    }
    return { place: place || undefined, date: date ?? undefined }
  }
  const comma = value.lastIndexOf(',')
  if (comma >= 0) {
    const place = collapseSpaces(value.slice(0, comma))
    return { place: place || undefined, date: parseKtpDate(value.slice(comma + 1)) ?? undefined }
  }
  return { place: value || undefined }
}

/**
 * Pull a NIK out of free text. `lenient` (used on the line labelled NIK) accepts a run longer than 16
 * characters, since stray noise is common there: a colon read as '1'/'l'/'I' in front of the number, or a
 * trailing speck read as '0'. Every 16-digit window of the run is tried and the first one whose digits 7-12
 * decode to a real birth date (nikInfo) wins; when no window decodes, the first 16 digits are kept so the
 * user still has something to correct in the form. The strict mode used when scanning every other line
 * requires exactly 16 to avoid picking up random digit runs.
 */
function findNik(text: string, lenient: boolean, now?: Date): string | undefined {
  for (const m of text.matchAll(NIK_RUN_RE)) {
    const digits = nikDigits(m[0])
    if (isValidNik(digits)) return digits
    if (lenient && digits.length > 16) {
      for (let start = 0; start + 16 <= digits.length; start++) {
        const window = digits.slice(start, start + 16)
        if (nikInfo(window, now)) return window
      }
      return digits.slice(0, 16)
    }
  }
  return undefined
}

function put<K extends keyof KtpFields>(fields: KtpFields, key: K, value: KtpFields[K] | null | undefined): void {
  if (value === undefined || value === null || value === '') return
  if (fields[key] !== undefined) return // first occurrence wins
  fields[key] = value
}

/** Clean, trimmed, non-empty lines of OCR text (exported for the UI to show what was read). */
export function splitKtpLines(ocrText: string): string[] {
  return ocrText
    .split(/\r?\n/)
    .map(collapseSpaces)
    .filter((l) => l.length > 0)
}

function applyLabelled(fields: KtpFields, key: LabelKey, value: string, rawLine: string, now?: Date): void {
  switch (key) {
    case 'provinsi':
      put(fields, 'provinsi', value)
      break
    case 'kota': {
      // 'KOTA BANDUNG' -> 'BANDUNG'; 'KABUPATEN BOGOR' -> 'KAB. BOGOR' so a kota and a kabupaten with the
      // same name stay distinguishable in the assembled address.
      const isKab = /^KAB/i.test(rawLine)
      put(fields, 'kota', value ? (isKab ? `KAB. ${value}` : value) : undefined)
      break
    }
    case 'nik':
      put(fields, 'nik', findNik(value, true, now))
      break
    case 'nama':
      put(fields, 'nama', value)
      break
    case 'ttl': {
      const { place, date } = parseTtl(value)
      put(fields, 'tempat_lahir', place)
      put(fields, 'tanggal_lahir', date)
      break
    }
    case 'jenis_kelamin':
      put(fields, 'jenis_kelamin', parseGender(value))
      break
    case 'gol_darah':
      put(fields, 'gol_darah', parseBloodType(value))
      break
    case 'alamat':
      put(fields, 'alamat', value)
      break
    case 'rt_rw':
      put(fields, 'rt_rw', value.replace(/\s+/g, ''))
      break
    case 'kel_desa':
      put(fields, 'kel_desa', value)
      break
    case 'kecamatan':
      put(fields, 'kecamatan', value)
      break
    case 'agama':
      put(fields, 'agama', value)
      break
    case 'status_perkawinan':
      put(fields, 'status_perkawinan', value)
      break
    case 'pekerjaan':
      put(fields, 'pekerjaan', value)
      break
    case 'kewarganegaraan':
      put(fields, 'kewarganegaraan', value)
      break
    case 'berlaku':
      break
  }
}

function processLine(fields: KtpFields, line: string, now?: Date): void {
  // 'Jenis Kelamin : LAKI-LAKI Gol. Darah : O' -> handle the two halves separately
  const gd = GOL_DARAH_INLINE_RE.exec(line)
  if (gd && gd.index > 0) {
    processLine(fields, collapseSpaces(line.slice(0, gd.index)), now)
    processLine(fields, line.slice(gd.index), now)
    return
  }
  const matched = matchLabel(line)
  if (!matched) return
  applyLabelled(fields, matched.key, matched.value, line, now)
}

export function parseKtpText(ocrText: string, now?: Date): KtpParseResult {
  const lines = splitKtpLines(ocrText)
  const fields: KtpFields = {}

  for (const line of lines) processLine(fields, line, now)

  // NIK fallback: no labelled NIK line (or it was unreadable) -> first strict 16-char run anywhere
  if (fields.nik === undefined) {
    for (const line of lines) {
      const nik = findNik(line, false)
      if (nik) {
        fields.nik = nik
        break
      }
    }
  }

  // Gender / birth date fallback from the NIK. When the card prints a date it wins over the NIK-encoded
  // one: the NIK is assigned once and may encode an older/incorrect registration date, while the printed
  // Tempat/Tgl Lahir is what the holder actually identifies with.
  if (fields.nik && (fields.jenis_kelamin === undefined || fields.tanggal_lahir === undefined)) {
    const info = nikInfo(fields.nik, now)
    if (info) {
      put(fields, 'jenis_kelamin', info.gender)
      put(fields, 'tanggal_lahir', info.birthDate)
    }
  }

  const found = KTP_KEY_FIELDS.filter((k) => fields[k] !== undefined).length
  return { fields, confidence: found / KTP_KEY_FIELDS.length, lines }
}

export interface TenantPrefill {
  full_name?: string
  nik?: string
  gender?: Gender
  birth_place?: string
  birth_date?: string
  /** alamat + RT/RW + kel/desa + kecamatan + kota + provinsi joined with ', ' (missing parts skipped) */
  address?: string
  religion?: string
  marital_status?: string
  occupation?: string
}

/**
 * Title-case an all-caps OCR string: "BUDI SANTOSO" -> "Budi Santoso", "NUR'AINI" -> "Nur'aini",
 * "ABDUL-RAHMAN" -> "Abdul-Rahman", "JL. MELATI NO. 12" -> "Jl. Melati No. 12".
 * A letter is capitalised at the start and after whitespace, '-', '/', '(' or '.'; an apostrophe does not
 * start a new word.
 */
export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-/(.])(\p{L})/gu, (_m, prefix: string, ch: string) => prefix + ch.toUpperCase())
}

function putPrefill<K extends keyof TenantPrefill>(out: TenantPrefill, key: K, value: TenantPrefill[K] | undefined): void {
  if (value === undefined || value === '') return
  out[key] = value
}

/** Map parsed fields to tenant columns; title-cases the name ("BUDI SANTOSO" -> "Budi Santoso"). */
export function ktpFieldsToTenant(fields: KtpFields): TenantPrefill {
  const out: TenantPrefill = {}
  putPrefill(out, 'full_name', fields.nama ? titleCase(fields.nama) : undefined)
  putPrefill(out, 'nik', fields.nik)
  putPrefill(out, 'gender', fields.jenis_kelamin)
  putPrefill(out, 'birth_place', fields.tempat_lahir ? titleCase(fields.tempat_lahir) : undefined)
  putPrefill(out, 'birth_date', fields.tanggal_lahir)

  const addressParts = [
    fields.alamat ? titleCase(fields.alamat) : null,
    fields.rt_rw ? `RT/RW ${fields.rt_rw}` : null,
    fields.kel_desa ? titleCase(fields.kel_desa) : null,
    fields.kecamatan ? titleCase(fields.kecamatan) : null,
    fields.kota ? titleCase(fields.kota) : null,
    fields.provinsi ? titleCase(fields.provinsi) : null,
  ].filter((p): p is string => Boolean(p))
  putPrefill(out, 'address', addressParts.length ? addressParts.join(', ') : undefined)

  putPrefill(out, 'religion', fields.agama ? titleCase(fields.agama) : undefined)
  putPrefill(out, 'marital_status', fields.status_perkawinan ? titleCase(fields.status_perkawinan) : undefined)
  putPrefill(out, 'occupation', fields.pekerjaan ? titleCase(fields.pekerjaan) : undefined)
  return out
}
