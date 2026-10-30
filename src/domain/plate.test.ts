import { describe, expect, it } from 'vitest'
import { normalizePlate, plateMatches, splitPlates } from './plate'

describe('normalizePlate', () => {
  it('writes a plate the way plates are written, however it was typed', () => {
    expect(normalizePlate('KB.1442.Gz.')).toBe('KB 1442 GZ')
    expect(normalizePlate('KB .1450.QR.')).toBe('KB 1450 QR')
    expect(normalizePlate('B.2845 TYY.')).toBe('B 2845 TYY')
    expect(normalizePlate('kb1442gz')).toBe('KB 1442 GZ')
    expect(normalizePlate('  b-1251-sga ')).toBe('B 1251 SGA')
    expect(normalizePlate('KB 1442 GZ')).toBe('KB 1442 GZ')
  })

  it('keeps several vehicles apart with a comma', () => {
    expect(normalizePlate('KB.1442.GZ / b1251sga')).toBe('KB 1442 GZ, B 1251 SGA')
    expect(normalizePlate('KB 1442 GZ;B 1251 SGA,')).toBe('KB 1442 GZ, B 1251 SGA')
    expect(normalizePlate('KB 1442 GZ\nB 1251 SGA')).toBe('KB 1442 GZ, B 1251 SGA')
  })

  it('a plate typed twice is kept once', () => {
    expect(normalizePlate('KB 1442 GZ, kb1442gz')).toBe('KB 1442 GZ')
    expect(normalizePlate('B 1 A, KB 2 B, b.1.a')).toBe('B 1 A, KB 2 B')
  })

  it('plateMatches finds a plate typed with or without spaces, never a short room search', () => {
    const v = 'KB 1442 GZ, B 1251 SGA'
    expect(plateMatches(v, 'kb1442')).toBe(true)
    expect(plateMatches(v, '1442 gz')).toBe(true)
    expect(plateMatches(v, 'B.1251')).toBe(true)
    expect(plateMatches(v, '1251SGA')).toBe(true)
    // each plate on its own: the end of one and the start of the next are not one plate
    expect(plateMatches(v, 'gzb1')).toBe(false)
    expect(plateMatches(v, 'b1')).toBe(false)
    expect(plateMatches(v, '144')).toBe(false)
    expect(plateMatches(v, 'kb 9999')).toBe(false)
    expect(plateMatches(null, 'kb1442')).toBe(false)
  })

  it('splitPlates gives one plate per vehicle', () => {
    expect(splitPlates('KB 1442 GZ, B 1251 SGA')).toEqual(['KB 1442 GZ', 'B 1251 SGA'])
    expect(splitPlates('KB 1442 GZ')).toEqual(['KB 1442 GZ'])
    expect(splitPlates('')).toEqual([])
    expect(splitPlates(null)).toEqual([])
    expect(splitPlates(undefined)).toEqual([])
  })

  it('an empty field is no plate', () => {
    expect(normalizePlate('')).toBeNull()
    expect(normalizePlate('   ')).toBeNull()
    expect(normalizePlate(' . , - ')).toBeNull()
    expect(normalizePlate(null)).toBeNull()
    expect(normalizePlate(undefined)).toBeNull()
  })
})
