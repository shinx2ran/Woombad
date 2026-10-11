import { describe, expect, it } from 'vitest'
import {
  isValidNik,
  ktpFieldsToTenant,
  nikInfo,
  normalizeNik,
  parseKtpDate,
  parseKtpText,
  splitKtpLines,
  titleCase,
  type KtpFields,
} from './ktp'

const NOW = new Date(2026, 9, 11) // 2026-10-11 local

const makeFields = (overrides: Partial<KtpFields> = {}): KtpFields => ({
  nik: '3273010503900001',
  nama: 'BUDI SANTOSO',
  tempat_lahir: 'BANDUNG',
  tanggal_lahir: '1990-03-05',
  jenis_kelamin: 'L',
  gol_darah: 'O',
  alamat: 'JL. MELATI NO. 12',
  rt_rw: '003/005',
  kel_desa: 'SUKAJADI',
  kecamatan: 'SUKAJADI',
  kota: 'BANDUNG',
  provinsi: 'JAWA BARAT',
  agama: 'ISLAM',
  status_perkawinan: 'KAWIN',
  pekerjaan: 'KARYAWAN SWASTA',
  kewarganegaraan: 'WNI',
  ...overrides,
})

const SAMPLE_A = `PROVINSI JAWA BARAT
KOTA BANDUNG
NIK : 3273010503900001
Nama : BUDI SANTOSO
Tempat/Tgl Lahir : BANDUNG, 05-03-1990
Jenis Kelamin : LAKI-LAKI Gol. Darah : O
Alamat : JL. MELATI NO. 12
RT/RW : 003/005
Kel/Desa : SUKAJADI
Kecamatan : SUKAJADI
Agama : ISLAM
Status Perkawinan : KAWIN
Pekerjaan : KARYAWAN SWASTA
Kewarganegaraan : WNI
Berlaku Hingga : SEUMUR HIDUP`

const SAMPLE_B = `PROVINSI JAWA BARAT
KOTA BANDUNG
NIK ; 3273O145O39S0002
Narna ; SITI RAHAYU
Tempat/Tgi Lahir BANDUNG. 15-08-1995
Jenis Kelamin PEREMPUAN Gol Darah -
Alarnat JL ANGGREK NO 5
RTIRW 002/003
KeI/Desa CIHAMPELAS
Kecamatan COBLONG
Agama ISLAM
Status Perkawinan BELUM KAWIN
Pekerjaan MAHASISWA
Kewarganegaraan WNI`

const SAMPLE_C = `NIK 3273014503950002
Nama ANI`

describe('isValidNik', () => {
  it('accepts exactly 16 digits', () => {
    expect(isValidNik('3273010503900001')).toBe(true)
  })
  it('rejects wrong length or non-digits', () => {
    expect(isValidNik('327301050390000')).toBe(false)
    expect(isValidNik('32730105039000012')).toBe(false)
    expect(isValidNik('3273O10503900001')).toBe(false)
    expect(isValidNik('')).toBe(false)
  })
})

describe('normalizeNik', () => {
  it('strips spaces', () => {
    expect(normalizeNik('3273 0105 0390 0001')).toBe('3273010503900001')
    expect(normalizeNik('  3273010503900001 ')).toBe('3273010503900001')
  })
  it('maps OCR look-alike letters to digits', () => {
    expect(normalizeNik('3273O145O39S0002')).toBe('3273014503950002')
    expect(normalizeNik('327301O5O39OOOOl')).toBe('3273010503900001')
    expect(normalizeNik('IlSBZGOo12345678')).toBe('1158260012345678')
  })
  it('returns null when the result is not 16 digits', () => {
    expect(normalizeNik('32730105039000')).toBeNull()
    expect(normalizeNik('32730105039000012')).toBeNull()
    expect(normalizeNik('3273X10503900001')).toBeNull()
    expect(normalizeNik('')).toBeNull()
  })
})

describe('nikInfo', () => {
  it('decodes a male birth date', () => {
    expect(nikInfo('3273010503900001', NOW)).toEqual({ birthDate: '1990-03-05', gender: 'L' })
  })
  it('decodes a female birth date (DD + 40)', () => {
    expect(nikInfo('3273014503950002', NOW)).toEqual({ birthDate: '1995-03-05', gender: 'P' })
  })
  it('century rule: YY <= current 2-digit year -> 20YY, else 19YY', () => {
    expect(nikInfo('3273011201050001', NOW)?.birthDate).toBe('2005-01-12')
    expect(nikInfo('3273011201900001', NOW)?.birthDate).toBe('1990-01-12')
    expect(nikInfo('3273011201260001', NOW)?.birthDate).toBe('2026-01-12')
    expect(nikInfo('3273011201270001', NOW)?.birthDate).toBe('1927-01-12')
    // same NIK, a different "now" moves the boundary
    expect(nikInfo('3273011201050001', new Date(2004, 0, 1))?.birthDate).toBe('1905-01-12')
  })
  it('defaults now to the current date', () => {
    const r = nikInfo('3273010503900001')
    expect(r?.gender).toBe('L')
    expect(r?.birthDate.endsWith('-03-05')).toBe(true)
  })
  it('returns null for invalid NIK or impossible dates', () => {
    expect(nikInfo('abc', NOW)).toBeNull()
    expect(nikInfo('327301050390000', NOW)).toBeNull()
    expect(nikInfo('3273013102900001', NOW)).toBeNull() // 31 Feb
    expect(nikInfo('3273010013900001', NOW)).toBeNull() // month 13
    expect(nikInfo('3273010000900001', NOW)).toBeNull() // day 00 month 00
    expect(nikInfo('3273017102900001', NOW)).toBeNull() // female 31 Feb (71-40)
  })
})

describe('parseKtpDate', () => {
  it('accepts the common separators', () => {
    expect(parseKtpDate('05-03-1990')).toBe('1990-03-05')
    expect(parseKtpDate('05/03/1990')).toBe('1990-03-05')
    expect(parseKtpDate('05 03 1990')).toBe('1990-03-05')
    expect(parseKtpDate('5-3-1990')).toBe('1990-03-05')
    expect(parseKtpDate('05.03.1990')).toBe('1990-03-05')
    expect(parseKtpDate('05 - 03 - 1990')).toBe('1990-03-05')
  })
  it('finds the date inside surrounding text', () => {
    expect(parseKtpDate('BANDUNG, 15-08-1995')).toBe('1995-08-15')
    expect(parseKtpDate('Tgl 29/02/2024 x')).toBe('2024-02-29')
  })
  it('date regex has no left boundary: a digit run longer than the day must not yield a date', () => {
    expect(parseKtpDate('115-03-1990')).toBeNull()
    expect(parseKtpDate('2005-03-1990')).toBeNull()
    expect(parseKtpDate('1990-03-05')).toBeNull() // ISO order is not a KTP date
    // a non-digit boundary before the day is still fine
    expect(parseKtpDate('x15-03-1990')).toBe('1990-03-15')
    expect(parseKtpDate('BANDUNG,15-03-1990')).toBe('1990-03-15')
  })
  it('returns null for impossible or unparseable dates', () => {
    expect(parseKtpDate('31-02-1990')).toBeNull()
    expect(parseKtpDate('29-02-2023')).toBeNull()
    expect(parseKtpDate('00-03-1990')).toBeNull()
    expect(parseKtpDate('05-13-1990')).toBeNull()
    expect(parseKtpDate('05-03-90')).toBeNull()
    expect(parseKtpDate('BANDUNG')).toBeNull()
    expect(parseKtpDate('')).toBeNull()
  })
})

describe('parseKtpText', () => {
  it('parses the clean sample A completely', () => {
    const r = parseKtpText(SAMPLE_A, NOW)
    expect(r.fields).toEqual(makeFields())
    expect(r.confidence).toBe(1)
    expect(r.lines).toHaveLength(15)
    expect(r.lines[0]).toBe('PROVINSI JAWA BARAT')
  })

  it('parses the noisy sample B (OCR substitutions in labels and NIK)', () => {
    const r = parseKtpText(SAMPLE_B, NOW)
    expect(r.fields.nik).toBe('3273014503950002')
    expect(r.fields.nama).toBe('SITI RAHAYU')
    expect(r.fields.tempat_lahir).toBe('BANDUNG')
    // the printed date wins over the NIK-encoded one (NIK says 1995-03-05)
    expect(r.fields.tanggal_lahir).toBe('1995-08-15')
    expect(r.fields.jenis_kelamin).toBe('P')
    expect(r.fields.gol_darah).toBeUndefined() // '-' means unknown
    expect(r.fields.alamat).toBe('JL ANGGREK NO 5')
    expect(r.fields.rt_rw).toBe('002/003')
    expect(r.fields.kel_desa).toBe('CIHAMPELAS')
    expect(r.fields.kecamatan).toBe('COBLONG')
    expect(r.fields.kota).toBe('BANDUNG')
    expect(r.fields.provinsi).toBe('JAWA BARAT')
    expect(r.fields.agama).toBe('ISLAM')
    expect(r.fields.status_perkawinan).toBe('BELUM KAWIN')
    expect(r.fields.pekerjaan).toBe('MAHASISWA')
    expect(r.fields.kewarganegaraan).toBe('WNI')
    expect(r.confidence).toBe(1)
    expect('gol_darah' in r.fields).toBe(false)
  })

  it('infers gender and birth date from the NIK when the card lines are missing (sample C)', () => {
    const r = parseKtpText(SAMPLE_C, NOW)
    expect(r.fields).toEqual({
      nik: '3273014503950002',
      nama: 'ANI',
      jenis_kelamin: 'P',
      tanggal_lahir: '1995-03-05',
    })
    expect(r.confidence).toBe(0.8)
  })

  it('does not override a printed gender with the NIK gender', () => {
    const r = parseKtpText('NIK 3273014503950002\nJenis Kelamin : LAKI-LAKI', NOW)
    expect(r.fields.jenis_kelamin).toBe('L')
    expect(r.fields.tanggal_lahir).toBe('1995-03-05')
  })

  it('returns empty fields and confidence 0 for empty input', () => {
    expect(parseKtpText('', NOW)).toEqual({ fields: {}, confidence: 0, lines: [] })
    expect(parseKtpText('   \n\n  \t ', NOW)).toEqual({ fields: {}, confidence: 0, lines: [] })
  })

  it('returns confidence 0 for unrelated text', () => {
    const r = parseKtpText('hello world\nfoo bar', NOW)
    expect(r.fields).toEqual({})
    expect(r.confidence).toBe(0)
    expect(r.lines).toEqual(['hello world', 'foo bar'])
  })

  it('finds the NIK on an unlabelled line as a fallback', () => {
    const r = parseKtpText('PROVINSI DKI JAKARTA\n3173 0105 0390 0001\nNama : BUDI', NOW)
    expect(r.fields.nik).toBe('3173010503900001')
    expect(r.fields.provinsi).toBe('DKI JAKARTA')
  })

  it('keeps the first 16 digits when the NIK line has trailing noise', () => {
    const r = parseKtpText('NIK : 3273010503900001 0', NOW)
    expect(r.fields.nik).toBe('3273010503900001')
  })

  it('leading look-alike noise on the NIK line yields a wrong NIK (lenient truncation keeps the wrong 16 digits)', () => {
    // colon read as '1', 'l' or 'I' in front of the number -> 17 candidate chars
    expect(parseKtpText('NIK 1 3273010503900001\nNama : BUDI', NOW).fields.nik).toBe('3273010503900001')
    expect(parseKtpText('NIK l 3273010503900001\nNama : BUDI', NOW).fields.nik).toBe('3273010503900001')
    expect(parseKtpText('NIK I 3273010503900001\nNama : BUDI', NOW).fields.nik).toBe('3273010503900001')
    // sample B's NIK with the same noise: gender and birth date are still decoded from the right digits
    const r = parseKtpText('NIK 1 3273014503950002\nNama : SITI', NOW)
    expect(r.fields.nik).toBe('3273014503950002')
    expect(r.fields.jenis_kelamin).toBe('P')
    expect(r.fields.tanggal_lahir).toBe('1995-03-05')
    expect(r.confidence).toBe(0.8)
    // noise on both ends
    expect(parseKtpText('NIK : 1 3273010503900001 0', NOW).fields.nik).toBe('3273010503900001')
    // trailing noise still keeps the first 16 digits (the leading window decodes)
    expect(parseKtpText('NIK : 3273010503900001 0', NOW).fields.nik).toBe('3273010503900001')
  })

  it('keeps the first 16 digits when no window of a noisy NIK run decodes to a date', () => {
    // digits 7-12 of every window are an impossible date -> fall back to the first 16 so the user can correct
    expect(parseKtpText('NIK : 3273019999990001 7', NOW).fields.nik).toBe('3273019999990001')
  })

  it('date regex has no left boundary: a space-split digit before the day gives a wrong birth date and pollutes tempat_lahir', () => {
    // OCR split the day '15' with a space: the stranded digit is re-joined to the day
    const r = parseKtpText('Tempat/Tgl Lahir : BANDUNG, 1 5-03-1990', NOW)
    expect(r.fields.tempat_lahir).toBe('BANDUNG')
    expect(r.fields.tanggal_lahir).toBe('1990-03-15')
    const tenant = ktpFieldsToTenant(r.fields)
    expect(tenant.birth_place).toBe('Bandung')
    expect(tenant.birth_date).toBe('1990-03-15')
    // the stranded digit is still the start of the day, with no comma before it
    expect(parseKtpText('Tempat/Tgl Lahir : BANDUNG 0 5-03-1990', NOW).fields).toEqual({
      tempat_lahir: 'BANDUNG',
      tanggal_lahir: '1990-03-05',
    })
  })

  it('drops the printed date (NIK fallback applies) when the stranded digit cannot be re-joined into a real date', () => {
    // '3' + '5' = day 35 does not exist -> failed split: no printed date, place cleaned, NIK date fills in
    const r = parseKtpText('NIK 3273010503900001\nTempat/Tgl Lahir : BANDUNG, 3 5-03-1990', NOW)
    expect(r.fields.tempat_lahir).toBe('BANDUNG')
    expect(r.fields.tanggal_lahir).toBe('1990-03-05')
    // two stranded digits can never be part of a two-digit day
    const r2 = parseKtpText('Tempat/Tgl Lahir : BANDUNG, 12 5-03-1990', NOW)
    expect(r2.fields.tempat_lahir).toBe('BANDUNG')
    expect(r2.fields.tanggal_lahir).toBeUndefined()
    // a digit set off from the date by punctuation is place noise, not a split day: the date stands
    const r3 = parseKtpText('Tempat/Tgl Lahir : BANDUNG 2, 15-03-1990', NOW)
    expect(r3.fields.tempat_lahir).toBe('BANDUNG')
    expect(r3.fields.tanggal_lahir).toBe('1990-03-15')
  })

  it('leaves nik undefined when no 16-digit run exists', () => {
    const r = parseKtpText('NIK : 12345\nNama : X', NOW)
    expect(r.fields.nik).toBeUndefined()
    expect(r.fields.jenis_kelamin).toBeUndefined()
    expect(r.confidence).toBe(0.2)
  })

  it('handles label separators = and - and missing separators', () => {
    const r = parseKtpText('Nama = SITI\nAlamat - JL MAWAR 3\nAgama ISLAM', NOW)
    expect(r.fields.nama).toBe('SITI')
    expect(r.fields.alamat).toBe('JL MAWAR 3')
    expect(r.fields.agama).toBe('ISLAM')
  })

  it('handles Gol. Darah on its own line and recognises 0 as O', () => {
    const r = parseKtpText('Jenis Kelamin : PEREMPUAN\nGol. Darah : 0', NOW)
    expect(r.fields.jenis_kelamin).toBe('P')
    expect(r.fields.gol_darah).toBe('O')
    expect(parseKtpText('Gol. Darah : AB', NOW).fields.gol_darah).toBe('AB')
  })

  it('splits Tempat/Tgl Lahir on the last comma when the date is unreadable', () => {
    const r = parseKtpText('Tempat/Tgl Lahir : TANJUNG PINANG, KEPRI, 1990', NOW)
    expect(r.fields.tempat_lahir).toBe('TANJUNG PINANG, KEPRI')
    expect(r.fields.tanggal_lahir).toBeUndefined()
  })

  it('tolerates Tgl spelled with l/I/1 and other label variants', () => {
    expect(parseKtpText('Tempat/Tgl Lahir : BOGOR, 01-01-2000', NOW).fields.tempat_lahir).toBe('BOGOR')
    expect(parseKtpText('Tempat/Tg1 Lahir : BOGOR, 01-01-2000', NOW).fields.tanggal_lahir).toBe('2000-01-01')
    expect(parseKtpText('RT RW 001/002', NOW).fields.rt_rw).toBe('001/002')
    expect(parseKtpText('Kel Desa CIUMBULEUIT', NOW).fields.kel_desa).toBe('CIUMBULEUIT')
    expect(parseKtpText('KABUPATEN BOGOR', NOW).fields.kota).toBe('KAB. BOGOR')
  })

  it('first occurrence of a label wins', () => {
    const r = parseKtpText('Nama : BUDI\nNama : ANDI', NOW)
    expect(r.fields.nama).toBe('BUDI')
  })

  it('splitKtpLines trims and collapses whitespace', () => {
    expect(splitKtpLines('  a   b \r\n\n c\t d ')).toEqual(['a b', 'c d'])
  })
})

describe('titleCase', () => {
  it('title-cases names', () => {
    expect(titleCase('BUDI SANTOSO')).toBe('Budi Santoso')
    expect(titleCase("NUR'AINI")).toBe("Nur'aini")
    expect(titleCase('ABDUL-RAHMAN')).toBe('Abdul-Rahman')
    expect(titleCase('siti rahayu')).toBe('Siti Rahayu')
  })
  it('title-cases addresses with abbreviations', () => {
    expect(titleCase('JL. MELATI NO. 12')).toBe('Jl. Melati No. 12')
    expect(titleCase('KARYAWAN SWASTA')).toBe('Karyawan Swasta')
    expect(titleCase('KAB. BOGOR')).toBe('Kab. Bogor')
  })
})

describe('ktpFieldsToTenant', () => {
  it('maps the full sample A fields', () => {
    expect(ktpFieldsToTenant(makeFields())).toEqual({
      full_name: 'Budi Santoso',
      nik: '3273010503900001',
      gender: 'L',
      birth_place: 'Bandung',
      birth_date: '1990-03-05',
      address: 'Jl. Melati No. 12, RT/RW 003/005, Sukajadi, Sukajadi, Bandung, Jawa Barat',
      religion: 'Islam',
      marital_status: 'Kawin',
      occupation: 'Karyawan Swasta',
    })
  })

  it('keeps apostrophes and hyphens in names', () => {
    expect(ktpFieldsToTenant({ nama: "NUR'AINI" }).full_name).toBe("Nur'aini")
    expect(ktpFieldsToTenant({ nama: 'ABDUL-RAHMAN' }).full_name).toBe('Abdul-Rahman')
  })

  it('assembles the address skipping missing parts', () => {
    expect(ktpFieldsToTenant({ alamat: 'JL ANGGREK NO 5', kecamatan: 'COBLONG' }).address).toBe('Jl Anggrek No 5, Coblong')
    expect(ktpFieldsToTenant({ rt_rw: '002/003', provinsi: 'JAWA BARAT' }).address).toBe('RT/RW 002/003, Jawa Barat')
    expect(ktpFieldsToTenant({ kota: 'BANDUNG' }).address).toBe('Bandung')
  })

  it('omits undefined keys instead of setting them to undefined', () => {
    const out = ktpFieldsToTenant({ nama: 'ANI' })
    expect(out).toEqual({ full_name: 'Ani' })
    expect(Object.keys(out)).toEqual(['full_name'])
    expect(ktpFieldsToTenant({})).toEqual({})
    expect(Object.keys(ktpFieldsToTenant({}))).toHaveLength(0)
  })

  it('passes nik, gender and birth_date through unchanged', () => {
    const out = ktpFieldsToTenant({ nik: '3273014503950002', jenis_kelamin: 'P', tanggal_lahir: '1995-08-15' })
    expect(out).toEqual({ nik: '3273014503950002', gender: 'P', birth_date: '1995-08-15' })
  })

  it('round-trips sample B end to end', () => {
    const out = ktpFieldsToTenant(parseKtpText(SAMPLE_B, NOW).fields)
    expect(out.full_name).toBe('Siti Rahayu')
    expect(out.address).toBe('Jl Anggrek No 5, RT/RW 002/003, Cihampelas, Coblong, Bandung, Jawa Barat')
    expect(out.marital_status).toBe('Belum Kawin')
    expect(out.occupation).toBe('Mahasiswa')
  })
})
