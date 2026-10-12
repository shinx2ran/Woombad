import { describe, expect, it } from 'vitest'
import { detectDocument, findMrzLines, mrzCheckDigit, parsePassportMrz, passportToTenant } from './passport'

const NOW = new Date(2026, 9, 12) // 2026-10-12 local

/** Build TD3 line 1: 'P<' + issuer + 'SURNAME<<GIVEN<NAMES' padded with '<' to 44. */
function line1(issuer: string, names: string): string {
  return `P<${issuer}${names}`.padEnd(44, '<')
}

interface Line2Input {
  number: string
  nationality: string
  birth: string
  sex: 'M' | 'F' | '<'
  expiry: string
  personal?: string
}

/** Build TD3 line 2 with every check digit computed by mrzCheckDigit (so fixtures are self-consistent). */
function line2({ number, nationality, birth, sex, expiry, personal = '' }: Line2Input): string {
  const num = number.padEnd(9, '<')
  const pers = personal.padEnd(14, '<')
  const head = num + mrzCheckDigit(num)
  const birthPart = birth + mrzCheckDigit(birth)
  const tail = expiry + mrzCheckDigit(expiry) + pers + mrzCheckDigit(pers)
  // ICAO TD3 composite covers number+check, birth+check, expiry+check, personal+check (not nationality or sex)
  const composite = mrzCheckDigit(head + birthPart + tail)
  const line = head + nationality + birthPart + sex + tail + composite
  if (line.length !== 44) throw new Error(`fixture line 2 is ${line.length} chars`)
  return line
}

// ICAO 9303 specimen (Utopia): the published check digits are 6, 2, 9, 1 and composite 0.
const ICAO_L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
const ICAO_L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'

const SMITH_L1 = line1('AUS', 'SMITH<<JOHN<ROBERT')
const SMITH_L2 = line2({ number: 'N1234567', nationality: 'AUS', birth: '900101', sex: 'M', expiry: '250101' })

const KTP_SAMPLE = `PROVINSI JAWA BARAT
KOTA BANDUNG
NIK : 3273010503900001
Nama : BUDI SANTOSO
Tempat/Tgl Lahir : BANDUNG, 05-03-1990
Jenis Kelamin : LAKI-LAKI Gol. Darah : O
Alamat : JL. MELATI NO. 12`

describe('mrzCheckDigit', () => {
  it('reproduces the ICAO 9303 specimen check digits', () => {
    expect(mrzCheckDigit('L898902C3')).toBe(6)
    expect(mrzCheckDigit('740812')).toBe(2)
    expect(mrzCheckDigit('120415')).toBe(9)
    expect(mrzCheckDigit('ZE184226B<<<<<')).toBe(1)
    expect(mrzCheckDigit(ICAO_L2.slice(0, 10) + ICAO_L2.slice(13, 20) + ICAO_L2.slice(21, 43))).toBe(0)
  })

  it("treats '<' as 0 and letters as 10..35 with 7-3-1 weights", () => {
    expect(mrzCheckDigit('<<<<<<<<<')).toBe(0)
    expect(mrzCheckDigit('A')).toBe(0) // 10 * 7 = 70
    expect(mrzCheckDigit('Z')).toBe(5) // 35 * 7 = 245
    expect(mrzCheckDigit('123')).toBe(6) // 7 + 6 + 3 = 16
  })
})

describe('findMrzLines', () => {
  it('finds two clean consecutive TD3 lines after surrounding text', () => {
    const text = `REPUBLIK INDONESIA\nPASSPORT\n${SMITH_L1}\n${SMITH_L2}\n`
    expect(findMrzLines(text)).toEqual([SMITH_L1, SMITH_L2])
  })

  it("removes spaces, uppercases, maps '«' and '(' to '<' and pads short lines to 44", () => {
    const noisy1 = 'P«AUSSMITH««JOHN<ROBERT«««««««««««««<<<<<' // 41 chars after cleanup
    const noisy2 = `${SMITH_L2.slice(0, 10)} ${SMITH_L2.slice(10, 20)} ${SMITH_L2.slice(20, 30)} ${SMITH_L2.slice(30, 40).replace(/</g, '(')}${SMITH_L2.slice(40)}`
    const found = findMrzLines(`${noisy1}\n${noisy2.toLowerCase()}`)
    expect(found).not.toBeNull()
    expect(found?.[0]).toBe(SMITH_L1)
    expect(found?.[0]).toHaveLength(44)
    expect(found?.[1]).toBe(SMITH_L2)
  })

  it('trims an over-long line (46 chars) at the end to 44', () => {
    const found = findMrzLines(`${SMITH_L1}<<\n${SMITH_L2}`)
    expect(found?.[0]).toBe(SMITH_L1)
  })

  it("rejects pairs whose first line does not start with 'P' and lines outside 40-46 chars", () => {
    expect(findMrzLines(`${SMITH_L2}\n${SMITH_L1}`)).toBeNull()
    expect(findMrzLines(`P<AUSSMITH<<JOHN\n${SMITH_L2}`)).toBeNull()
    expect(findMrzLines('Nama : BUDI SANTOSO\nNIK : 3273010503900001')).toBeNull()
    expect(findMrzLines('')).toBeNull()
  })
})

describe('parsePassportMrz', () => {
  it('parses the ICAO specimen with every check passing', () => {
    const r = parsePassportMrz(`${ICAO_L1}\n${ICAO_L2}`, NOW)
    expect(r).not.toBeNull()
    expect(r).toMatchObject({
      surname: 'Eriksson',
      givenNames: 'Anna Maria',
      passportNumber: 'L898902C3',
      nationality: 'UTO',
      issuingCountry: 'UTO',
      birthDate: '1974-08-12',
      sex: 'P',
      expiryDate: '2012-04-15',
      checks: { number: true, birth: true, expiry: true, composite: true },
      confidence: 1,
      lines: [ICAO_L1, ICAO_L2],
    })
  })

  it('parses a clean Australian TD3 (John Robert Smith, N1234567)', () => {
    const r = parsePassportMrz(`${SMITH_L1}\n${SMITH_L2}`, NOW)
    expect(r).toMatchObject({
      surname: 'Smith',
      givenNames: 'John Robert',
      passportNumber: 'N1234567',
      nationality: 'AUS',
      issuingCountry: 'AUS',
      birthDate: '1990-01-01',
      sex: 'L',
      expiryDate: '2025-01-01',
      confidence: 1,
    })
  })

  it("repairs OCR noise: spaces, '«' for '<', 'O' for '0' in the number and dates, digits in names", () => {
    const clean2 = line2({ number: 'N1230567', nationality: 'AUS', birth: '900101', sex: 'M', expiry: '250101' })
    // number 'N1230567' read as 'N123O567', birth '900101' as '9OO1O1', expiry '250101' as '25O1O1',
    // nationality 'AUS' as 'AU5', surname 'SMITH' as '5M1TH', separators as '«', spaces everywhere
    const noisy1 = 'P«AUS 5M1TH««JOHN«ROBERT ««««««««««««««««««««'
    const noisy2 = `N123O567< ${clean2.charAt(9)} AU5 9OO1O1 ${clean2.charAt(19)} M 25O1O1 ${clean2.charAt(27)} «««««««««««««« ${clean2.slice(42)}`
    const r = parsePassportMrz(`Some header text\n${noisy1}\n${noisy2}`, NOW)
    expect(r).not.toBeNull()
    expect(r).toMatchObject({
      surname: 'Smith',
      givenNames: 'John Robert',
      passportNumber: 'N1230567',
      nationality: 'AUS',
      birthDate: '1990-01-01',
      expiryDate: '2025-01-01',
      sex: 'L',
      checks: { number: true, birth: true, expiry: true, composite: true },
      confidence: 1,
    })
  })

  it('parses a female Indonesian passport whose whole name sits in the surname field', () => {
    const l1 = line1('IDN', 'SITI<NURHALIZA')
    const l2 = line2({ number: 'C1234567', nationality: 'IDN', birth: '950815', sex: 'F', expiry: '300815' })
    const r = parsePassportMrz(`${l1}\n${l2}`, NOW)
    expect(r).toMatchObject({
      surname: 'Siti Nurhaliza',
      givenNames: '',
      passportNumber: 'C1234567',
      nationality: 'IDN',
      issuingCountry: 'IDN',
      birthDate: '1995-08-15',
      sex: 'P',
      expiryDate: '2030-08-15',
      confidence: 1,
    })
    expect(passportToTenant(r!)).toEqual({
      full_name: 'Siti Nurhaliza',
      id_type: 'passport',
      id_number: 'C1234567',
      nationality: 'IDN',
      gender: 'P',
      birth_date: '1995-08-15',
    })
  })

  it('applies the century rule: birth YY > current year -> 19YY, else 20YY; expiry always 20YY', () => {
    const young = line2({ number: 'A0000001', nationality: 'IDN', birth: '260101', sex: 'M', expiry: '350101' })
    const old = line2({ number: 'A0000001', nationality: 'IDN', birth: '270101', sex: 'M', expiry: '990101' })
    expect(parsePassportMrz(`${line1('IDN', 'A<<B')}\n${young}`, NOW)?.birthDate).toBe('2026-01-01')
    expect(parsePassportMrz(`${line1('IDN', 'A<<B')}\n${young}`, NOW)?.expiryDate).toBe('2035-01-01')
    expect(parsePassportMrz(`${line1('IDN', 'A<<B')}\n${old}`, NOW)?.birthDate).toBe('1927-01-01')
    expect(parsePassportMrz(`${line1('IDN', 'A<<B')}\n${old}`, NOW)?.expiryDate).toBe('2099-01-01')
    // with a later "now" the same YY flips century
    expect(parsePassportMrz(`${line1('IDN', 'A<<B')}\n${old}`, new Date(2027, 0, 1))?.birthDate).toBe('2027-01-01')
  })

  it('still returns the fields when check digits are wrong, reporting them in checks and confidence', () => {
    // corrupt the passport-number check digit (position 9, +1) and the birth check digit (position 19, +2);
    // the composite sum moves by 7 + 2*3 = 13, so the composite check fails too
    const flip = (ch: string, by: number): string => String((Number(ch) + by) % 10)
    const bad = SMITH_L2.slice(0, 9) + flip(SMITH_L2.charAt(9), 1) + SMITH_L2.slice(10, 19) + flip(SMITH_L2.charAt(19), 2) + SMITH_L2.slice(20)
    const r = parsePassportMrz(`${SMITH_L1}\n${bad}`, NOW)
    expect(r).not.toBeNull()
    expect(r?.passportNumber).toBe('N1234567')
    expect(r?.birthDate).toBe('1990-01-01')
    expect(r?.expiryDate).toBe('2025-01-01')
    expect(r?.checks).toEqual({ number: false, birth: false, expiry: true, composite: false })
    expect(r?.confidence).toBe(0.25)
  })

  it('returns a letter-containing passport number as read when no OCR variant passes its check digit', () => {
    // Dutch-style number with L/B after the first digit; numeric-fixing would wrongly give 'NXB713K42'.
    const l1 = line1('NLD', 'DE<VRIES<<JAN')
    const good = line2({ number: 'NXB7L3K42', nationality: 'NLD', birth: '880505', sex: 'M', expiry: '290505' })
    // unreadable check digit (OCR gave 'A' at position 9)
    const unreadable = good.slice(0, 9) + 'A' + good.slice(10)
    const r1 = parsePassportMrz(`${l1}\n${unreadable}`, NOW)
    expect(r1?.passportNumber).toBe('NXB7L3K42')
    expect(r1?.checks.number).toBe(false)
    // wrong check digit (off by one)
    const offByOne = good.slice(0, 9) + String((Number(good.charAt(9)) + 1) % 10) + good.slice(10)
    const r2 = parsePassportMrz(`${l1}\n${offByOne}`, NOW)
    expect(r2?.passportNumber).toBe('NXB7L3K42')
    expect(r2?.checks.number).toBe(false)
    expect(r2?.checks.birth).toBe(true)
    expect(r2?.checks.expiry).toBe(true)
    // the same number with a correct check digit is accepted as read with checks.number = true
    const r3 = parsePassportMrz(`${l1}\n${good}`, NOW)
    expect(r3?.passportNumber).toBe('NXB7L3K42')
    expect(r3?.checks).toEqual({ number: true, birth: true, expiry: true, composite: true })
  })

  it('still applies a numeric OCR fix to the number when that fix makes the check digit pass', () => {
    // 'C1230567' read as 'C123O567' (0 -> O): only the fixed variant satisfies the check digit
    const good = line2({ number: 'C1230567', nationality: 'IDN', birth: '950815', sex: 'F', expiry: '300815' })
    const noisy = 'C123O567<' + good.slice(9)
    const r = parsePassportMrz(`${line1('IDN', 'A<<B')}\n${noisy}`, NOW)
    expect(r?.passportNumber).toBe('C1230567')
    expect(r?.checks.number).toBe(true)
  })

  it("returns null birthDate/expiryDate for impossible dates and null sex for '<'", () => {
    const l2 = line2({ number: 'A0000001', nationality: 'IDN', birth: '901301', sex: '<', expiry: '250230' })
    const r = parsePassportMrz(`${line1('IDN', 'A<<B')}\n${l2}`, NOW)
    expect(r?.birthDate).toBeNull()
    expect(r?.expiryDate).toBeNull()
    expect(r?.sex).toBeNull()
    expect(r?.checks.birth).toBe(true) // the digits themselves are consistent
  })

  it('handles a one-letter issuing code with filler (Germany: D<<)', () => {
    const l1 = line1('D<<', 'MUSTERMANN<<ERIKA')
    const l2 = line2({ number: 'C01X00T47', nationality: 'D<<', birth: '640812', sex: 'F', expiry: '271031' })
    const r = parsePassportMrz(`${l1}\n${l2}`, NOW)
    expect(r?.issuingCountry).toBe('D')
    expect(r?.nationality).toBe('D')
    expect(r?.passportNumber).toBe('C01X00T47')
    expect(r?.checks.number).toBe(true)
  })

  it('returns null for text without an MRZ', () => {
    expect(parsePassportMrz(KTP_SAMPLE, NOW)).toBeNull()
    expect(parsePassportMrz('', NOW)).toBeNull()
    expect(parsePassportMrz('hello world\nthis is not a passport', NOW)).toBeNull()
  })
})

describe('passportToTenant', () => {
  it('joins given names and surname, maps sex to gender and copies the dates', () => {
    const r = parsePassportMrz(`${SMITH_L1}\n${SMITH_L2}`, NOW)
    expect(passportToTenant(r!)).toEqual({
      full_name: 'John Robert Smith',
      id_type: 'passport',
      id_number: 'N1234567',
      nationality: 'AUS',
      gender: 'L',
      birth_date: '1990-01-01',
    })
  })

  it('omits gender and birth_date when unknown and falls back to the issuing country for nationality', () => {
    const l2 = line2({ number: 'A0000001', nationality: '<<<', birth: '901301', sex: '<', expiry: '250101' })
    const r = parsePassportMrz(`${line1('IDN', 'A<<B')}\n${l2}`, NOW)
    expect(passportToTenant(r!)).toEqual({ full_name: 'B A', id_type: 'passport', id_number: 'A0000001', nationality: 'IDN' })
  })
})

describe('detectDocument', () => {
  it("returns 'passport' when an MRZ is present", () => {
    expect(detectDocument(`PASSPORT\n${SMITH_L1}\n${SMITH_L2}`)).toBe('passport')
  })

  it("returns 'ktp' for a KTP sample (NIK found) and for label-only text", () => {
    expect(detectDocument(KTP_SAMPLE)).toBe('ktp')
    expect(detectDocument('Narna : BUDI SANTOSO\nAlamat : JL. MELATI')).toBe('ktp')
    expect(detectDocument('foo\n3273010503900001\nbar')).toBe('ktp')
  })

  it("returns 'unknown' otherwise", () => {
    expect(detectDocument('Struk belanja Rp 25.000')).toBe('unknown')
    expect(detectDocument('')).toBe('unknown')
  })
})
