import { describe, expect, it } from 'vitest'
import { nikInfo } from '../../domain/ktp'
import type { KtpScanResult } from '../../../supabase/functions/scan-ktp/ktp'
import { DEMO_KTP_SCAN_RESULT, DEMO_KTP_SCAN_USAGE, interpretClaudeScan } from './claudeScan'

// SPEC 7.19: what Claude read becomes the same review rows the on-device reader produces
const card = (over: Partial<NonNullable<KtpScanResult['ktp']>> = {}): NonNullable<KtpScanResult['ktp']> => ({ ...DEMO_KTP_SCAN_RESULT.ktp!, ...over })
const ktp = (fields: NonNullable<KtpScanResult['ktp']>, unclear: string[] = [], notes = ''): KtpScanResult => ({ kind: 'ktp', ktp: fields, passport: null, unclear, notes })

describe('interpretClaudeScan: KTP', () => {
  it('fills the form values through ktpFieldsToTenant (title case, the address joined), confidence 1 when every key field is sure', () => {
    const out = interpretClaudeScan(ktp(card()))
    expect(out.kind).toBe('ktp')
    expect(out.prefill).toEqual({
      id_type: 'ktp',
      full_name: 'Budi Santoso',
      nik: '3273012505900002',
      gender: 'L',
      birth_place: 'Bandung',
      birth_date: '1990-05-25',
      address: 'Jl. Melati No. 12, RT/RW 003/005, Sukajadi, Coblong, Bandung, Jawa Barat',
      religion: 'Islam',
      marital_status: 'Belum Kawin',
      occupation: 'Karyawan Swasta',
    })
    expect(out.confidence).toBe(1)
    expect(out.unclear).toEqual([])
    expect(out.passport).toBeNull()
    expect(out.ktp?.fields).toMatchObject({ nik: '3273012505900002', gol_darah: 'O', kewarganegaraan: 'WNI' })
    expect(out.lines[0]).toBe('NIK: 3273012505900002')
    expect(out.lines).toContain('Alamat: JL. MELATI NO. 12')
  })

  it('a field Claude was unsure of lowers the confidence and marks its review row (every address part marks "address" once)', () => {
    const out = interpretClaudeScan(ktp(card(), ['alamat', 'kota', 'nik'], 'Alamat buram.'))
    expect(out.confidence).toBeCloseTo(0.6)
    expect(out.unclear).toEqual(['address', 'nik'])
    expect(out.notes).toBe('Alamat buram.')
  })

  it('fields not read stay out of the form and the parse details (no undefined keys), and count against the confidence', () => {
    const out = interpretClaudeScan(ktp(card({ nik: null, jenis_kelamin: null, gol_darah: null, pekerjaan: null })))
    expect(out.prefill.nik).toBeUndefined()
    expect(out.prefill.gender).toBeUndefined()
    expect(out.prefill.occupation).toBeUndefined()
    expect(Object.keys(out.ktp!.fields)).not.toContain('nik')
    expect(out.confidence).toBeCloseTo(0.6)
    expect(out.lines).not.toContain('NIK: ')
  })

  it('a birth date or gender the photo did not yield comes from the NIK, marked for checking (as the on-device parser derives them)', () => {
    const out = interpretClaudeScan(ktp(card({ tanggal_lahir: null, jenis_kelamin: null })))
    expect(out.prefill).toMatchObject({ birth_date: '1990-05-25', gender: 'L' })
    expect(out.unclear).toEqual(['birth_date', 'gender'])
    expect(out.confidence).toBeCloseTo(0.6)
    // the raw lines show only what was on the photo
    expect(out.lines).not.toContain('Tgl lahir: 1990-05-25')
  })
})

describe('interpretClaudeScan: passport and unknown', () => {
  const passport = (unclear: string[] = []): KtpScanResult => ({
    kind: 'passport',
    ktp: null,
    passport: { surname: 'SMITH', given_names: 'JOHN ANDREW', passport_number: 'N1234567', nationality: 'AUS', birth_date: '1985-07-04', sex: 'L', expiry_date: '2030-01-31' },
    unclear,
    notes: '',
  })

  it('a passport: given names then surname, number, nationality, gender and birth date; no MRZ check digits to show', () => {
    const out = interpretClaudeScan(passport())
    expect(out.kind).toBe('passport')
    expect(out.prefill).toEqual({ id_type: 'passport', full_name: 'John Andrew Smith', id_number: 'N1234567', nationality: 'AUS', gender: 'L', birth_date: '1985-07-04' })
    expect(out.passport).toBeNull()
    expect(out.ktp).toBeNull()
    expect(out.confidence).toBe(1)
    expect(out.lines).toEqual(['Nama belakang: SMITH', 'Nama depan: JOHN ANDREW', 'No. paspor: N1234567', 'Kewarganegaraan: AUS', 'Tgl lahir: 1985-07-04', 'Jenis kelamin: L', 'Berlaku s/d: 2030-01-31'])
  })

  it('an unsure passport number marks the number row and lowers the confidence', () => {
    const out = interpretClaudeScan(passport(['passport_number']))
    expect(out.unclear).toEqual(['id_number'])
    expect(out.confidence).toBe(0.75)
  })

  it('an unrecognised photo: an empty prefill with the form default, Claude\'s reason kept', () => {
    const out = interpretClaudeScan({ kind: 'unknown', ktp: null, passport: null, unclear: [], notes: 'Foto buram.' })
    expect(out).toEqual({ kind: 'unknown', prefill: { id_type: 'ktp' }, ktp: null, passport: null, confidence: 0, lines: [], unclear: [], notes: 'Foto buram.' })
  })
})

describe('the Mode Demo sample', () => {
  it('is a consistent synthetic card: the NIK encodes the printed birth date and gender', () => {
    const k = DEMO_KTP_SCAN_RESULT.ktp!
    expect(nikInfo(k.nik!, new Date(2026, 10, 8))).toEqual({ birthDate: k.tanggal_lahir, gender: k.jenis_kelamin })
  })

  it('costs what its tokens cost: 3,000 × $4 + 900 × $20 per million = US$0.03', () => {
    expect((DEMO_KTP_SCAN_USAGE.input_tokens * 4 + DEMO_KTP_SCAN_USAGE.output_tokens * 20) / 1_000_000).toBeCloseTo(DEMO_KTP_SCAN_USAGE.cost_usd, 6)
  })
})
