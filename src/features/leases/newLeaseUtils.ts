/**
 * Pure helpers of the check-in wizard (/sewa/baru, SPEC 5.3): payment choice and scan summary.
 */
import { formatRupiah } from '../../lib/format'
import { SCAN_FIELD_LABEL, type ScanPrefill, type ScanPrefillKey } from '../scanner/types'

/** 'Lunas sekarang' / 'DP (isi jumlah)' / 'Belum bayar' for the first invoice. */
export type PayMode = 'lunas' | 'dp' | 'none'

export const PAY_MODE_LABEL: Record<PayMode, string> = {
  lunas: 'Lunas sekarang',
  dp: 'DP (isi jumlah)',
  none: 'Belum bayar',
}

/**
 * Indonesian error for the payment step, or null: a choice is required; a DP must be > 0 and not more than
 * the first invoice's total (a DP equal to the total simply settles it).
 */
export function validatePayment(mode: PayMode | null, dpAmount: number, total: number): string | null {
  if (mode === null) return 'Pilih status pembayaran: Lunas, DP, atau Belum bayar.'
  if (mode === 'dp') {
    if (!Number.isFinite(dpAmount) || dpAmount <= 0) return 'Isi jumlah DP (lebih dari 0).'
    if (dpAmount > total) return `DP maksimal ${formatRupiah(total)} (total tagihan pertama).`
  }
  return null
}

/** Fields shown in the inline form; everything else a scan provides is stored silently and listed. */
const INLINE_FIELDS: ScanPrefillKey[] = ['full_name', 'nik', 'id_number', 'nationality']

/** Labels of scanned values that are saved but not shown in the short check-in form ('Jenis kelamin', …). */
export function scannedExtraFields(prefill: ScanPrefill): string[] {
  return (Object.keys(SCAN_FIELD_LABEL) as ScanPrefillKey[])
    .filter((k) => !INLINE_FIELDS.includes(k) && prefill[k] !== undefined && prefill[k] !== '')
    .map((k) => SCAN_FIELD_LABEL[k].toLowerCase())
}
