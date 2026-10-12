/**
 * Passport MRZ (machine-readable zone) parsing for TD3 documents (the two 44-character lines at the bottom
 * of a passport data page). Input is raw OCR text (tesseract.js), output is best-effort structured fields
 * the user can correct in the tenant form, plus the ICAO check-digit results so the UI can flag doubtful
 * fields.
 *
 * TD3 layout (0-based positions):
 *   line 1: [0] 'P', [1] type/filler, [2..5) issuing country (alpha-3), [5..44) names
 *           (SURNAME<<GIVEN<NAMES, '<' padding)
 *   line 2: [0..9) passport number, [9] check, [10..13) nationality, [13..19) birth YYMMDD, [19] check,
 *           [20] sex (M/F/<), [21..27) expiry YYMMDD, [27] check, [28..42) personal number, [42] check,
 *           [43] composite check over [0..10) + [13..20) + [21..43) (the sex character is not included)
 *
 * OCR is noisy: spaces get inserted, '<' is read as '«', '(' or similar, digits and letters are confused
 * (O/0, I/1, S/5, B/8, Z/2, G/6). Fixes are applied per field according to what that field may contain.
 */
import type { Gender } from '../types/db'
import { parseKtpText, titleCase } from './ktp'
import { parseISODate } from './period'

export const MRZ_LINE_LENGTH = 44

export interface PassportChecks {
  /** passport number check digit (line 2 position 9) matches */
  number: boolean
  /** birth date check digit (line 2 position 19) matches */
  birth: boolean
  /** expiry date check digit (line 2 position 27) matches */
  expiry: boolean
  /** composite check digit (line 2 position 43) matches */
  composite: boolean
}

export interface PassportParseResult {
  /** title-cased; '' when the surname field is empty */
  surname: string
  /** title-cased, single spaces; '' when the passport has no given-names field (Indonesian passports often
   *  print the whole name in the surname field) */
  givenNames: string
  /** padding stripped; OCR fixes applied only when they make the check digit pass, otherwise exactly as read
   *  (see parsePassportMrz) */
  passportNumber: string
  /** ISO 3166-1 alpha-3 (ICAO code, e.g. 'IDN', 'AUS', 'D' for Germany), padding stripped */
  nationality: string
  /** 'YYYY-MM-DD'; null when the MRZ date is not a real date (e.g. month 13) */
  birthDate: string | null
  /** 'L' (MRZ 'M'), 'P' (MRZ 'F'), null when '<' or unreadable */
  sex: Gender | null
  /** 'YYYY-MM-DD'; null when the MRZ date is not a real date */
  expiryDate: string | null
  /** ICAO code of the issuing state, padding stripped */
  issuingCountry: string
  checks: PassportChecks
  /** 0..1: share of the four check digits that pass (1 = clean read, 0.75 = one field doubtful, ...) */
  confidence: number
  /** the two normalised 44-character MRZ lines the result was parsed from */
  lines: [string, string]
}

const MRZ_CANDIDATE_RE = /^[A-Z0-9<]{40,46}$/
/** characters OCR substitutes for '<' */
const FILLER_NOISE_RE = /[«»‹›({[]/g
/** stray punctuation OCR sprinkles into an MRZ line that can never be part of it */
const JUNK_RE = /[\s.,'"`\-_:;|]/g

/**
 * Normalise one OCR line into an MRZ candidate: uppercase, '«' '»' '‹' '›' '(' '{' '[' -> '<', whitespace
 * and stray punctuation (. , ' " ` - _ : ; |) removed. Returns null unless the result is 40-46 characters
 * of [A-Z0-9<].
 */
function mrzCandidate(rawLine: string): string | null {
  const cleaned = rawLine.toUpperCase().replace(FILLER_NOISE_RE, '<').replace(JUNK_RE, '')
  return MRZ_CANDIDATE_RE.test(cleaned) ? cleaned : null
}

/** Pad with '<' / trim trailing characters to exactly 44. */
function fitMrzLine(candidate: string): string {
  return candidate.length >= MRZ_LINE_LENGTH
    ? candidate.slice(0, MRZ_LINE_LENGTH)
    : candidate.padEnd(MRZ_LINE_LENGTH, '<')
}

/**
 * Find the two consecutive non-empty lines of `ocrText` that form a TD3 MRZ: after normalisation
 * (see mrzCandidate) each is 40-46 characters of [A-Z0-9<] and the first starts with 'P'. Each line is
 * padded with '<' or trimmed at the end to exactly 44 characters. Returns null when no such pair exists.
 * Letter/digit confusions are NOT fixed here; parsePassportMrz does that per field.
 */
export function findMrzLines(ocrText: string): [string, string] | null {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  for (let i = 0; i + 1 < lines.length; i++) {
    const first = mrzCandidate(lines[i])
    if (!first || !first.startsWith('P')) continue
    const second = mrzCandidate(lines[i + 1])
    if (!second) continue
    return [fitMrzLine(first), fitMrzLine(second)]
  }
  return null
}

const CHECK_WEIGHTS = [7, 3, 1] as const

/**
 * ICAO 9303 check digit of an MRZ field: characters weighted 7-3-1 repeating, summed mod 10, where
 * '<' = 0, '0'-'9' = face value, 'A'-'Z' = 10..35. Any other character counts as 0.
 * mrzCheckDigit('L898902C3') === 6 (ICAO specimen).
 */
export function mrzCheckDigit(s: string): number {
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    let value = 0
    if (code >= 48 && code <= 57) value = code - 48
    else if (code >= 65 && code <= 90) value = code - 55
    total += value * CHECK_WEIGHTS[i % 3]
  }
  return total % 10
}

/** OCR letter -> digit confusions, applied inside fields that can only hold digits. */
const NUMERIC_FIX: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' }
/** OCR digit -> letter confusions, applied inside fields that can only hold letters. */
const ALPHA_FIX: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' }

function mapChars(s: string, table: Record<string, string>): string {
  let out = ''
  for (const ch of s) out += table[ch] ?? ch
  return out
}

/** O->0, I/L->1, S->5, B->8, Z->2, G->6 ('<' kept). */
function fixNumeric(s: string): string {
  return mapChars(s, NUMERIC_FIX)
}

/** 0->O, 1->I, 5->S, 8->B, 2->Z, 6->G ('<' kept). */
function fixAlpha(s: string): string {
  return mapChars(s, ALPHA_FIX)
}

/** Numeric-fix a single check-digit character; null when it is still not a digit (e.g. '<'). */
function checkDigitAt(line: string, pos: number): number | null {
  const ch = fixNumeric(line.charAt(pos))
  return /^[0-9]$/.test(ch) ? Number(ch) : null
}

function checkPasses(field: string, digit: number | null): boolean {
  return digit !== null && mrzCheckDigit(field) === digit
}

/**
 * Variants of an alphanumeric MRZ field (passport number, personal number), most likely first:
 * as read; leading letters kept and the rest numeric-fixed (the common 'C1234567' / 'N123O567' shape);
 * everything numeric-fixed. Duplicates removed.
 */
function alnumVariants(field: string): string[] {
  const m = /^[A-Z]*/.exec(field)
  const prefix = m ? m[0] : ''
  const variants = [field, prefix + fixNumeric(field.slice(prefix.length)), fixNumeric(field)]
  return variants.filter((v, i) => variants.indexOf(v) === i)
}

/** First variant that satisfies `ok`, otherwise `fallback` (index into the variants). */
function pickVariant(variants: string[], ok: (v: string) => boolean, fallback: number): string {
  return variants.find(ok) ?? variants[Math.min(fallback, variants.length - 1)]
}

/** Strip '<' padding (anywhere). */
function stripFiller(s: string): string {
  return s.replace(/</g, '')
}

/** 'SMITH<JONES' -> 'Smith Jones'; runs of '<' collapse to one space, leading/trailing filler dropped. */
function mrzName(field: string): string {
  const spaced = fixAlpha(field).replace(/<+/g, ' ').trim()
  return spaced ? titleCase(spaced) : ''
}

/**
 * YYMMDD -> 'YYYY-MM-DD'. `century` decides the first two digits; null when the result is not a real date.
 */
function mrzDate(yymmdd: string, century: (yy: number) => number): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null
  const yy = Number(yymmdd.slice(0, 2))
  const iso = `${century(yy)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
  try {
    parseISODate(iso)
  } catch {
    return null
  }
  return iso
}

function parseSex(ch: string): Gender | null {
  if (ch === 'M') return 'L'
  if (ch === 'F') return 'P'
  return null
}

/**
 * Parse the TD3 MRZ found in `ocrText` (see findMrzLines). Returns null when no MRZ is found; otherwise
 * every field is returned even when its check digit fails, with the failures reported in `checks`.
 *
 * - Names (line 1, positions 5-43): split on the first '<<' into surname and given names; a single '<' is
 *   a space; digits are mapped back to letters (0->O, 1->I, 5->S, 8->B, 2->Z, 6->G); title-cased.
 * - Passport number: alphanumeric, so OCR fixes are only trusted when they make the check digit pass:
 *   tried in order as read, leading letters + numeric-fixed rest, all numeric-fixed. When none passes
 *   (check digit wrong or unreadable) the field is returned exactly as read, never rewritten, and
 *   checks.number = false, so a number that legitimately contains letters after the first digit
 *   (e.g. 'NXB7L3K42') is not altered when its check digit cannot confirm a fix.
 * - Nationality / issuing country: digits mapped to letters, '<' padding stripped.
 * - Birth / expiry: numeric-fixed (O->0, I/L->1, S->5, B->8, Z->2, G->6). Century rule: birth YY greater
 *   than the current 2-digit year (`now`, default today) -> 19YY, else 20YY; expiry always 20YY.
 * - Sex: 'M' -> 'L', 'F' -> 'P', anything else -> null.
 * - checks.composite is evaluated over the corrected line 2 (the personal-number field, positions 28-41,
 *   is tried as read and numeric-fixed; whichever makes the composite pass is used, otherwise as read).
 * - confidence = passing checks / 4.
 */
export function parsePassportMrz(ocrText: string, now?: Date): PassportParseResult | null {
  const lines = findMrzLines(ocrText)
  if (!lines) return null
  const [l1, l2] = lines

  const issuingCountry = stripFiller(fixAlpha(l1.slice(2, 5)))
  const nameField = l1.slice(5)
  const sep = nameField.indexOf('<<')
  const surname = mrzName(sep >= 0 ? nameField.slice(0, sep) : nameField)
  const givenNames = sep >= 0 ? mrzName(nameField.slice(sep + 2)) : ''

  const numberDigit = checkDigitAt(l2, 9)
  const numberField = pickVariant(alnumVariants(l2.slice(0, 9)), (v) => checkPasses(v, numberDigit), 0)
  const nationality = stripFiller(fixAlpha(l2.slice(10, 13)))
  const birthField = fixNumeric(l2.slice(13, 19))
  const birthDigit = checkDigitAt(l2, 19)
  const sex = parseSex(l2.charAt(20))
  const expiryField = fixNumeric(l2.slice(21, 27))
  const expiryDigit = checkDigitAt(l2, 27)
  const personalDigit = checkDigitAt(l2, 42)
  const compositeDigit = checkDigitAt(l2, 43)

  const digitChar = (d: number | null): string => (d === null ? '<' : String(d))
  // composite = [0..10) + [13..20) + [21..43): number+check, birth+check, expiry+check, personal+check (sex excluded)
  const compositeFor = (personal: string): string =>
    numberField + digitChar(numberDigit) + birthField + digitChar(birthDigit) + expiryField + digitChar(expiryDigit) + personal + digitChar(personalDigit)
  const personalField = pickVariant(
    alnumVariants(l2.slice(28, 42)),
    (v) => checkPasses(compositeFor(v), compositeDigit),
    0,
  )

  const nowYY = (now ?? new Date()).getFullYear() % 100
  const checks: PassportChecks = {
    number: checkPasses(numberField, numberDigit),
    birth: checkPasses(birthField, birthDigit),
    expiry: checkPasses(expiryField, expiryDigit),
    composite: checkPasses(compositeFor(personalField), compositeDigit),
  }
  const passed = [checks.number, checks.birth, checks.expiry, checks.composite].filter(Boolean).length

  return {
    surname,
    givenNames,
    passportNumber: stripFiller(numberField),
    nationality,
    birthDate: mrzDate(birthField, (yy) => (yy > nowYY ? 1900 + yy : 2000 + yy)),
    sex,
    expiryDate: mrzDate(expiryField, (yy) => 2000 + yy),
    issuingCountry,
    checks,
    confidence: passed / 4,
    lines,
  }
}

/** Tenant columns prefilled from a passport; assignable to `TenantPrefill & { id_type; id_number; nationality }`. */
export interface PassportTenantPrefill {
  /** given names followed by surname ('John Robert Smith'); surname alone when there are no given names */
  full_name: string
  id_type: 'passport'
  /** passport number, '<' padding stripped */
  id_number: string
  /** alpha-3 nationality from the MRZ; falls back to the issuing country when the field is unreadable */
  nationality: string
  gender?: Gender
  /** 'YYYY-MM-DD' */
  birth_date?: string
}

/** Map a parsed MRZ to tenant columns (fields are returned regardless of the check-digit results). */
export function passportToTenant(parsed: PassportParseResult): PassportTenantPrefill {
  const out: PassportTenantPrefill = {
    full_name: [parsed.givenNames, parsed.surname].filter((p) => p.length > 0).join(' '),
    id_type: 'passport',
    id_number: parsed.passportNumber,
    nationality: parsed.nationality || parsed.issuingCountry,
  }
  if (parsed.sex) out.gender = parsed.sex
  if (parsed.birthDate) out.birth_date = parsed.birthDate
  return out
}

export type DocumentKind = 'ktp' | 'passport' | 'unknown'

/** 'NIK' or 'Nama' label at the start of a line, with the same OCR tolerance as the KTP parser. */
const KTP_LABEL_RE = /^(?:N[I1l]K|Na(?:m|rn)a)\b/im

/**
 * Decide which document an OCR text is: 'passport' when findMrzLines succeeds, otherwise 'ktp' when the
 * KTP parser finds a NIK or the text has a 'NIK' / 'Nama' label line, otherwise 'unknown'.
 */
export function detectDocument(ocrText: string): DocumentKind {
  if (findMrzLines(ocrText)) return 'passport'
  if (parseKtpText(ocrText).fields.nik !== undefined || KTP_LABEL_RE.test(ocrText)) return 'ktp'
  return 'unknown'
}
