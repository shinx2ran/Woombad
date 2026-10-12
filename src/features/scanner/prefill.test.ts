import { describe, expect, it } from 'vitest'
import { countPrefillFields, diffScanPrefill, displayPrefillValue, selectedPrefill } from './prefill'
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
