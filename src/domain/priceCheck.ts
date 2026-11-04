import { formatRupiah } from '../lib/format'

/**
 * SPEC 7.14 Cek harga: a price per period this far from the room's rate is a typo more often than a deal. Room A13 was
 * saved at Rp 1 a month (25 Okt 2026) and its yearly invoice came out at Rp 12; 17.000 for 1.700.000 or 17.000.000
 * for 1.700.000 are the same slip of a zero. The forms only ask for a confirmation tap; nothing is refused.
 */
/** below this, any price per night / week / month is questioned */
export const PRICE_FLOOR = 50_000
/** below this share of the room's rate for the same period type */
export const PRICE_LOW_SHARE = 0.1
/** above this multiple of the room's rate */
export const PRICE_HIGH_MULTIPLE = 5

export interface PriceCheck {
  kind: 'low' | 'high'
  /** what looks wrong, e.g. 'Harga Rp 1 / bulan jauh di bawah tarif kamar (Rp 1.800.000). Kurang angka nol?' */
  message: string
}

/**
 * The question to ask about `price` per `unit` ('malam' | 'minggu' | 'bulan'), or null when it looks normal.
 * `standard` is the room's rate for the same period type (null / 0 = not set: only the floor applies). A price of 0 or
 * less is left to the forms' own 'harus lebih dari 0' check.
 */
export function implausiblePrice(price: number, standard: number | null | undefined, unit: string): PriceCheck | null {
  if (!Number.isFinite(price) || price <= 0) return null
  const rate = standard != null && standard > 0 ? standard : null
  const per = `${formatRupiah(price)} / ${unit}`
  if (rate !== null && price > rate * PRICE_HIGH_MULTIPLE) {
    return { kind: 'high', message: `Harga ${per} lebih dari ${PRICE_HIGH_MULTIPLE}× tarif kamar (${formatRupiah(rate)}). Kelebihan angka nol?` }
  }
  if (rate !== null && price < rate * PRICE_LOW_SHARE) {
    return { kind: 'low', message: `Harga ${per} jauh di bawah tarif kamar (${formatRupiah(rate)}). Kurang angka nol?` }
  }
  if (price < PRICE_FLOOR) return { kind: 'low', message: `Harga ${per} sangat kecil. Kurang angka nol?` }
  return null
}
