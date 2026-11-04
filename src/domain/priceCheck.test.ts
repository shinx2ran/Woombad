import { describe, expect, it } from 'vitest'
import { PRICE_FLOOR, PRICE_HIGH_MULTIPLE, PRICE_LOW_SHARE, implausiblePrice } from './priceCheck'

// SPEC 7.14 Cek harga: the forms ask for one tap when a price per period looks like a typo; nothing is refused.
describe('implausiblePrice', () => {
  it('questions the A13 case: Rp 1 a month against a Rp 1.800.000 room', () => {
    expect(implausiblePrice(1, 1_800_000, 'bulan')).toEqual({
      kind: 'low',
      message: 'Harga Rp 1 / bulan jauh di bawah tarif kamar (Rp 1.800.000). Kurang angka nol?',
    })
  })

  it('a zero too few or too many on a monthly rate is questioned; the live range of real rents is not', () => {
    expect(implausiblePrice(170_000, 1_800_000, 'bulan')?.kind).toBe('low')
    expect(implausiblePrice(17_000_000, 1_800_000, 'bulan')).toEqual({
      kind: 'high',
      message: 'Harga Rp 17.000.000 / bulan lebih dari 5× tarif kamar (Rp 1.800.000). Kelebihan angka nol?',
    })
    // the rents EG Kost actually agreed (1,5 - 2,8 jt against a 1,8 jt list price) pass without a question
    for (const rent of [1_500_000, 1_600_000, 1_700_000, 2_000_000, 2_800_000]) expect(implausiblePrice(rent, 1_800_000, 'bulan')).toBeNull()
  })

  it('the bounds are exclusive: exactly 10 % and exactly 5x the rate pass', () => {
    expect(implausiblePrice(1_800_000 * PRICE_LOW_SHARE, 1_800_000, 'bulan')).toBeNull()
    expect(implausiblePrice(1_800_000 * PRICE_LOW_SHARE - 1, 1_800_000, 'bulan')?.kind).toBe('low')
    expect(implausiblePrice(1_800_000 * PRICE_HIGH_MULTIPLE, 1_800_000, 'bulan')).toBeNull()
    expect(implausiblePrice(1_800_000 * PRICE_HIGH_MULTIPLE + 1, 1_800_000, 'bulan')?.kind).toBe('high')
  })

  it('below Rp 50.000 per period is questioned even when the rate is low or not set', () => {
    // daily 180.000: 10 % is 18.000, so the floor is what catches 18.000 typed for 180.000
    expect(implausiblePrice(18_000, 180_000, 'malam')).toEqual({ kind: 'low', message: 'Harga Rp 18.000 / malam sangat kecil. Kurang angka nol?' })
    expect(implausiblePrice(PRICE_FLOOR - 1, null, 'malam')?.kind).toBe('low')
    expect(implausiblePrice(PRICE_FLOOR, null, 'malam')).toBeNull()
    expect(implausiblePrice(150_000, 180_000, 'malam')).toBeNull()
  })

  it('without a room rate only the floor applies: no "too high" question can be asked', () => {
    expect(implausiblePrice(90_000_000, null, 'bulan')).toBeNull()
    expect(implausiblePrice(90_000_000, 0, 'bulan')).toBeNull()
    expect(implausiblePrice(90_000_000, undefined, 'bulan')).toBeNull()
  })

  it('0 or less (and not a number) is left to the forms\' own "harus lebih dari 0" check', () => {
    expect(implausiblePrice(0, 1_800_000, 'bulan')).toBeNull()
    expect(implausiblePrice(-5, 1_800_000, 'bulan')).toBeNull()
    expect(implausiblePrice(Number.NaN, 1_800_000, 'bulan')).toBeNull()
  })
})
