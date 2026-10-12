/**
 * Pure helpers around `ScanPrefill`: comparing a scan result with what a form already holds (so typed data
 * is never overwritten silently) and reducing the review list to the values the user accepted.
 */
import { GENDER_LABEL } from '../../types/db'
import { formatDate } from '../../lib/format'
import { SCAN_FIELD_LABEL, SCAN_PREFILL_ORDER, type ScanPrefill, type ScanPrefillKey } from './types'

export interface PrefillDiff {
  key: ScanPrefillKey
  label: string
  /** value read from the document */
  detected: string
  /** what the form holds now ('' when empty) */
  current: string
  /** default checkbox state: checked when the form field is empty or already equal */
  apply: boolean
}

/**
 * One entry per detected (non-empty) field, in `SCAN_PREFILL_ORDER`. Pre-checked only when the form field
 * is empty or already equal; fields the user typed differently default to unchecked so the user decides.
 */
export function diffScanPrefill(prefill: ScanPrefill, current: Partial<ScanPrefill> | undefined): PrefillDiff[] {
  const out: PrefillDiff[] = []
  for (const key of SCAN_PREFILL_ORDER) {
    const detected = prefill[key]
    if (detected === undefined || detected === '') continue
    const cur = current?.[key] ?? ''
    out.push({ key, label: SCAN_FIELD_LABEL[key], detected, current: cur, apply: cur === '' || cur === detected })
  }
  return out
}

/** The accepted subset of a diff as a prefill (keeps `id_type` from the scan). */
export function selectedPrefill(prefill: ScanPrefill, diff: PrefillDiff[]): ScanPrefill {
  const out: ScanPrefill = { id_type: prefill.id_type }
  for (const d of diff) {
    if (!d.apply) continue
    if (d.key === 'gender') out.gender = d.detected === 'P' ? 'P' : 'L'
    else out[d.key] = d.detected
  }
  return out
}

/** Human-readable value for the review list ('—' when empty; gender and dates localised). */
export function displayPrefillValue(key: ScanPrefillKey, value: string): string {
  if (!value) return '—'
  if (key === 'gender') return value === 'L' || value === 'P' ? GENDER_LABEL[value] : value
  if (key === 'birth_date') return formatDate(value)
  return value
}

/** Number of value fields (excluding `id_type`) a prefill carries. */
export function countPrefillFields(prefill: ScanPrefill): number {
  return SCAN_PREFILL_ORDER.filter((k) => prefill[k] !== undefined && prefill[k] !== '').length
}
