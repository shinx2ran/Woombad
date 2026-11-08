import { describe, expect, it } from 'vitest'
import { KTP_SCAN_SCHEMA, KtpScanOutputError, countFilledFields, parseKtpScanOutput } from './ktp'

// SPEC 7.19: what Claude must return for a photographed identity document, and the strict check of what came back.
const card = (over: Record<string, unknown> = {}) => ({
  nik: '3273011203900007',
  nama: 'BUDI SANTOSO',
  tempat_lahir: 'BANDUNG',
  tanggal_lahir: '1990-03-12',
  jenis_kelamin: 'L',
  gol_darah: 'O',
  alamat: 'JL. MELATI NO. 12',
  rt_rw: '003/005',
  kel_desa: 'SUKAJADI',
  kecamatan: 'COBLONG',
  kota: 'BANDUNG',
  provinsi: 'JAWA BARAT',
  agama: 'ISLAM',
  status_perkawinan: 'KAWIN',
  pekerjaan: 'KARYAWAN SWASTA',
  kewarganegaraan: 'WNI',
  ...over,
})
const reply = (kind: string, ktp: unknown = null, passport: unknown = null, extra: Record<string, unknown> = {}) => ({ kind, ktp, passport, unclear: [], notes: '', ...extra })

describe('KTP_SCAN_SCHEMA (structured outputs)', () => {
  it('closes every object and requires every property, with no numeric or string constraints', () => {
    const objects: Record<string, unknown>[] = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk)
      else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>
        if (o.type === 'object') objects.push(o)
        Object.values(o).forEach(walk)
      }
    }
    walk(KTP_SCAN_SCHEMA)
    expect(objects).toHaveLength(3)
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false)
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort())
    }
    const json = JSON.stringify(KTP_SCAN_SCHEMA)
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format']) expect(json).not.toContain(`"${key}"`)
  })
})

describe('parseKtpScanOutput', () => {
  it('keeps a well-read KTP as is, upper-cased and single-spaced', () => {
    const out = parseKtpScanOutput(reply('ktp', card({ nama: ' budi  santoso ', notes: 'x' }), null, { notes: ' Baris alamat agak buram. ', unclear: ['alamat'] }))
    expect(out.kind).toBe('ktp')
    expect(out.ktp).toEqual(card())
    expect(out.passport).toBeNull()
    expect(out.unclear).toEqual(['alamat'])
    expect(out.notes).toBe('Baris alamat agak buram.')
  })

  it('a value that would put a wrong number in the record becomes null, never a guess', () => {
    const out = parseKtpScanOutput(
      reply('ktp', card({ nik: '3273 0112 0390 000', tanggal_lahir: '1990-02-30', jenis_kelamin: 'X', gol_darah: 'C', rt_rw: '3/5x' })),
    )
    expect(out.ktp).toMatchObject({ nik: null, tanggal_lahir: null, jenis_kelamin: null, gol_darah: null, rt_rw: null })
    // the rest of the card is untouched
    expect(out.ktp).toMatchObject({ nama: 'BUDI SANTOSO', provinsi: 'JAWA BARAT' })
  })

  it('tolerates the forms Claude may use: spaced NIK digits, spelled-out gender, short RT/RW, a dash for no blood group, the printed date form', () => {
    const out = parseKtpScanOutput(reply('ktp', card({ nik: '3273 0112 0390 0007', jenis_kelamin: 'LAKI-LAKI', rt_rw: '3/5', gol_darah: '-', tanggal_lahir: '12-03-1990' })))
    expect(out.ktp).toMatchObject({ nik: '3273011203900007', jenis_kelamin: 'L', rt_rw: '003/005', gol_darah: null, tanggal_lahir: '1990-03-12' })
    expect(parseKtpScanOutput(reply('ktp', card({ jenis_kelamin: 'Perempuan' }))).ktp?.jenis_kelamin).toBe('P')
    expect(parseKtpScanOutput(reply('ktp', card({ tanggal_lahir: '12/03/1990' }))).ktp?.tanggal_lahir).toBe('1990-03-12')
    // a printed date that does not exist is still refused
    expect(parseKtpScanOutput(reply('ktp', card({ tanggal_lahir: '31-02-1990' }))).ktp?.tanggal_lahir).toBeNull()
  })

  it('every unambiguous way of writing a date becomes YYYY-MM-DD; anything else is null', () => {
    const date = (tanggal_lahir: string) => parseKtpScanOutput(reply('ktp', card({ tanggal_lahir }))).ktp?.tanggal_lahir
    for (const written of ['1990-05-25', '1990-5-25', '1990/05/25', '1990.5.25', '25-05-1990', '25-5-1990', '25/5/1990', '25.05.1990']) {
      expect(date(written), written).toBe('1990-05-25')
    }
    expect(date('5-3-1990')).toBe('1990-03-05')
    for (const written of ['1990-13-01', '90-05-25', '25 MEI 1990', '1990-05-25T00:00', '']) expect(date(written), written).toBeNull()
  })

  it('RT/RW as printed, with spaces or with the labels; a third number or other words are refused', () => {
    const rtRw = (rt_rw: string) => parseKtpScanOutput(reply('ktp', card({ rt_rw }))).ktp?.rt_rw
    for (const written of ['003/005', '3/5', '003 / 005', 'RT 003 RW 005', 'RT. 003/RW. 005', 'rt 3 rw 5', 'RT/RW : 003/005', 'RT/RW: 003/005', '003, 005']) {
      expect(rtRw(written), written).toBe('003/005')
    }
    // RW first would put the numbers the wrong way round: refused, not swapped
    for (const written of ['RW 005 RT 003', 'RW005/RT003', 'RW/RT 005/003', '005 RW 003 RT', '003/005 RW']) expect(rtRw(written), written).toBeNull()
    for (const written of ['003/005/007', '0003/005', 'DUSUN 3/5', '003', '-']) expect(rtRw(written), written).toBeNull()
  })

  it('a passport copied from the machine-readable lines: the fillers become spaces in names and go from the nationality', () => {
    const out = parseKtpScanOutput(
      reply('passport', null, { surname: 'MUSTERMANN', given_names: 'ERIKA<<MARIA<', passport_number: 'C01X00T47', nationality: 'D<<', birth_date: '1964-08-12', sex: '<', expiry_date: '2030-01-31' }),
    )
    expect(out.passport).toMatchObject({ surname: 'MUSTERMANN', given_names: 'ERIKA MARIA', nationality: 'D', sex: null })
  })

  it('a passport: the machine-readable fields, the number stripped of fillers', () => {
    const out = parseKtpScanOutput(
      reply('passport', null, { surname: 'SMITH', given_names: 'JOHN ANDREW', passport_number: 'N1234567<', nationality: 'AUS', birth_date: '1985-07-04', sex: 'M', expiry_date: '2030-01-31' }),
    )
    expect(out.kind).toBe('passport')
    expect(out.ktp).toBeNull()
    expect(out.passport).toEqual({ surname: 'SMITH', given_names: 'JOHN ANDREW', passport_number: 'N1234567', nationality: 'AUS', birth_date: '1985-07-04', sex: 'L', expiry_date: '2030-01-31' })
  })

  it('an unreadable photo: no fields, the reason in notes', () => {
    expect(parseKtpScanOutput(reply('unknown', null, null, { notes: 'Foto buram.' }))).toEqual({ kind: 'unknown', ktp: null, passport: null, unclear: [], notes: 'Foto buram.' })
  })

  it('refuses a shape that is not what was promised', () => {
    expect(() => parseKtpScanOutput(null)).toThrow(KtpScanOutputError)
    expect(() => parseKtpScanOutput(reply('menu'))).toThrow(KtpScanOutputError)
    expect(() => parseKtpScanOutput(reply('ktp', 'not an object'))).toThrow(KtpScanOutputError)
    expect(() => parseKtpScanOutput(reply('passport', null, 7))).toThrow(KtpScanOutputError)
  })

  it('countFilledFields counts what was read, for the usage log (never the values)', () => {
    expect(countFilledFields(parseKtpScanOutput(reply('ktp', card())))).toBe(16)
    expect(countFilledFields(parseKtpScanOutput(reply('ktp', card({ gol_darah: '-', pekerjaan: null }))))).toBe(14)
    expect(countFilledFields(parseKtpScanOutput(reply('unknown')))).toBe(0)
  })
})
