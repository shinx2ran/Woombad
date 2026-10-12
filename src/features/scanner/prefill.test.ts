import { describe, expect, it } from 'vitest'
import { countPrefillFields, diffScanPrefill, displayPrefillValue, idTypeChange, lockIdentityRows, selectedPrefill } from './prefill'
import type { ScanPrefill } from './types'

describe('diffScanPrefill', () => {
  it('pre-checks empty fields and leaves typed, different values unchecked', () => {
    const prefill: ScanPrefill = { id_type: 'ktp', full_name: 'Budi Santoso', nik: '3273010503900001', gender: 'L', birth_date: '1990-03-05' }
    const diff = diffScanPrefill(prefill, { full_name: 'Budi S', nik: '3273010503900001' })
    expect(diff.map((d) => d.key)).toEqual(['full_name', 'nik', 'gender', 'birth_date'])
    expect(diff.find((d) => d.key === 'full_name')?.apply).toBe(false) // user typed something else
    expect(diff.find((d) => d.key === 'nik')?.apply).toBe(true) // equal
    expect(diff.find((d) => d.key === 'gender')?.apply).toBe(true) // empty
    expect(diff.find((d) => d.key === 'gender')?.label).toBe('Jenis kelamin')
  })

  it('orders passport fields after the name and treats a missing current as empty', () => {
    const prefill: ScanPrefill = { id_type: 'passport', nationality: 'AUS', id_number: 'N1234567', full_name: 'John Smith' }
    expect(diffScanPrefill(prefill, undefined).map((d) => d.key)).toEqual(['full_name', 'id_number', 'nationality'])
    expect(diffScanPrefill(prefill, undefined).every((d) => d.apply)).toBe(true)
  })

  it('skips empty detected values', () => {
    expect(diffScanPrefill({ id_type: 'ktp', full_name: '', occupation: 'Guru' }, {}).map((d) => d.key)).toEqual(['occupation'])
  })
})

describe('selectedPrefill', () => {
  it('keeps id_type and only the checked entries, mapping gender back to L/P', () => {
    const prefill: ScanPrefill = { id_type: 'passport', full_name: 'John Smith', id_number: 'N1', nationality: 'AUS', gender: 'P' }
    const diff = diffScanPrefill(prefill, { full_name: 'Johnny' })
    const out = selectedPrefill(prefill, diff)
    expect(out).toEqual({ id_type: 'passport', id_number: 'N1', nationality: 'AUS', gender: 'P' })
    const forced = selectedPrefill(prefill, diff.map((d) => ({ ...d, apply: true })))
    expect(forced.full_name).toBe('John Smith')
  })
})

describe('idTypeChange / lockIdentityRows / selectedPrefill with a type switch', () => {
  const passport: ScanPrefill = { id_type: 'passport', full_name: 'John Smith', id_number: 'N1234567', nationality: 'AUS', gender: 'L' }

  it('is null when the form has no type or already has the scanned type', () => {
    expect(idTypeChange(passport, undefined)).toBeNull()
    expect(idTypeChange(passport, { id_type: 'passport', id_number: 'X1' })).toBeNull()
  })

  it('switches by default when the current number is empty', () => {
    expect(idTypeChange(passport, { id_type: 'ktp' })).toEqual({ from: 'ktp', to: 'passport', dropped: null, apply: true })
    expect(idTypeChange(passport, { id_type: 'ktp', nik: '  ' })?.apply).toBe(true)
  })

  it('starts unchecked and names the number that would be dropped', () => {
    const change = idTypeChange(passport, { id_type: 'ktp', nik: '3273011501900003' })
    expect(change).toEqual({ from: 'ktp', to: 'passport', dropped: { label: 'NIK', value: '3273011501900003' }, apply: false })
    const back = idTypeChange({ id_type: 'ktp', nik: '3273010503900001' }, { id_type: 'passport', id_number: 'N1', nationality: 'AUS' })
    expect(back?.dropped).toEqual({ label: 'Nomor paspor', value: 'N1' })
    expect(back?.apply).toBe(false)
    expect(idTypeChange(passport, { id_type: 'other', id_number: 'SIM9' })?.dropped).toEqual({ label: 'Nomor identitas', value: 'SIM9' })
  })

  it('declined: keeps the current type, locks and drops the scanned number fields, applies the rest', () => {
    const current: Partial<ScanPrefill> = { id_type: 'ktp', nik: '3273011501900003' }
    const change = idTypeChange(passport, current)
    const diff = lockIdentityRows(passport, diffScanPrefill(passport, current), change)
    expect(diff.filter((d) => d.locked).map((d) => d.key)).toEqual(['id_number', 'nationality'])
    expect(diff.find((d) => d.key === 'id_number')?.apply).toBe(false)
    expect(selectedPrefill(passport, diff, change)).toEqual({ id_type: 'ktp', full_name: 'John Smith', gender: 'L' })
    // rows forced on are still not applied while the switch is declined
    expect(selectedPrefill(passport, diff.map((d) => ({ ...d, apply: true })), change)).toEqual({ id_type: 'ktp', full_name: 'John Smith', gender: 'L' })
  })

  it('accepted: follows the scanned type with its number fields', () => {
    const current: Partial<ScanPrefill> = { id_type: 'ktp', nik: '3273011501900003' }
    const declined = idTypeChange(passport, current)
    expect(declined).not.toBeNull()
    const change = declined ? { ...declined, apply: true } : null
    const diff = lockIdentityRows(passport, diffScanPrefill(passport, current), change)
    expect(diff.some((d) => d.locked)).toBe(false)
    expect(selectedPrefill(passport, diff, change)).toEqual({ id_type: 'passport', full_name: 'John Smith', id_number: 'N1234567', nationality: 'AUS', gender: 'L' })
  })
})

describe('displayPrefillValue / countPrefillFields', () => {
  it('localises gender and dates and dashes empty values', () => {
    expect(displayPrefillValue('gender', 'L')).toBe('Laki-laki')
    expect(displayPrefillValue('gender', 'P')).toBe('Perempuan')
    expect(displayPrefillValue('birth_date', '1990-03-05')).toMatch(/1990/)
    expect(displayPrefillValue('full_name', '')).toBe('—')
    expect(displayPrefillValue('nationality', 'AUS')).toBe('AUS')
  })
  it('counts value fields but not id_type', () => {
    expect(countPrefillFields({ id_type: 'ktp' })).toBe(0)
    expect(countPrefillFields({ id_type: 'passport', id_number: 'X', nationality: '' })).toBe(1)
  })
})
