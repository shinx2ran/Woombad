import { describe, expect, it } from 'vitest'
import { checkoutISO, formatCheckout, formatStay, lastNightISO } from './format'

describe('stay dates: stored last night <-> shown check-out day (SPEC 7.3)', () => {
  it('2 nights from 15 Okt end on the night of 16 Okt and check out on 17 Okt', () => {
    expect(checkoutISO('2026-10-16')).toBe('2026-10-17')
    expect(lastNightISO('2026-10-17')).toBe('2026-10-16')
    expect(formatStay('2026-10-15', '2026-10-16')).toBe('15 Okt – 17 Okt 2026')
  })

  it('a month from 15 Okt reads 15 Okt – 15 Nov', () => {
    expect(formatStay('2026-10-15', '2026-11-14')).toBe('15 Okt – 15 Nov 2026')
    expect(formatCheckout('2026-11-14')).toBe('15 Nov 2026')
  })

  it('crosses month and year ends', () => {
    expect(checkoutISO('2026-10-31')).toBe('2026-11-01')
    expect(checkoutISO('2026-12-31')).toBe('2027-01-01')
    expect(lastNightISO('2027-01-01')).toBe('2026-12-31')
    expect(checkoutISO('2028-02-28')).toBe('2028-02-29')
    expect(formatStay('2026-12-28', '2027-01-01')).toBe('28 Des 2026 – 2 Jan 2027')
  })

  it('round-trips and handles missing values', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-03-31', '2026-12-31']) expect(lastNightISO(checkoutISO(d))).toBe(d)
    expect(checkoutISO(null)).toBeNull()
    expect(lastNightISO(undefined)).toBeNull()
    expect(formatCheckout(null)).toBe('-')
    expect(formatStay(null, '2026-10-16')).toBe('-')
    expect(formatStay('2026-10-15', null)).toBe('-')
  })

  it('writes both years on request', () => {
    expect(formatStay('2026-10-15', '2026-10-16', { full: true })).toBe('15 Okt 2026 – 17 Okt 2026')
  })
})
