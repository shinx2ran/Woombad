/**
 * Pure helpers around `ScanPrefill`: comparing a scan result with what a form already holds (so typed data
 * is never overwritten silently) and reducing the review list to the values the user accepted.
 */
import { GENDER_LABEL, type IdType } from '../../types/db'
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

/** The number / nationality fields that belong to an identity type (only these are kept on save). */
export const IDENTITY_KEYS: Record<IdType, ScanPrefillKey[]> = {
  ktp: ['nik'],
  passport: ['id_number', 'nationality'],
  other: ['id_number'],
}

/** Label of the number field of an identity type ('NIK' / 'Nomor paspor' / 'Nomor identitas'). */
export const IDENTITY_NUMBER_LABEL: Record<IdType, string> = {
  ktp: 'NIK',
  passport: 'Nomor paspor',
  other: 'Nomor identitas',
}

/** A scan of another document type than the form currently holds (KTP -> Paspor and so on). */
export interface IdTypeChange {
  from: IdType
  to: IdType
  /** the current number that will no longer be saved, e.g. { label: 'NIK', value: '3273…' }; null when empty */
  dropped: { label: string; value: string } | null
  /** default checkbox state: switch automatically only when nothing typed or stored is lost */
  apply: boolean
}

/**
 * The identity-type switch a scan implies, or null when the form has no type yet or already has the scanned
 * type. Pre-checked only when the current number field is empty; when switching would drop a NIK or
 * passport number the user typed (or that is stored), it starts unchecked so nothing is lost silently.
 */
export function idTypeChange(prefill: ScanPrefill, current: Partial<ScanPrefill> | undefined): IdTypeChange | null {
  const from = current?.id_type
  if (!from || from === prefill.id_type) return null
  const value = (from === 'ktp' ? current?.nik : current?.id_number)?.trim() ?? ''
  const dropped = value ? { label: IDENTITY_NUMBER_LABEL[from], value } : null
  return { from, to: prefill.id_type, dropped, apply: dropped === null }
}

/**
 * The diff as the review list shows it once the identity-type choice is known: when the type switch is
 * declined, the scanned document's own number fields cannot be used (the form keeps its type) and are
 * forced off and `locked`.
 */
export function lockIdentityRows(prefill: ScanPrefill, diff: PrefillDiff[], change: IdTypeChange | null): (PrefillDiff & { locked: boolean })[] {
  const keys = change && !change.apply ? IDENTITY_KEYS[prefill.id_type] : []
  return diff.map((d) => (keys.includes(d.key) ? { ...d, apply: false, locked: true } : { ...d, locked: false }))
}

/**
 * The accepted subset of a diff as a prefill. `id_type` follows the scan unless `change` (from idTypeChange)
 * was declined; then the form's current type is kept and the scanned document's number fields are dropped.
 */
export function selectedPrefill(prefill: ScanPrefill, diff: PrefillDiff[], change?: IdTypeChange | null): ScanPrefill {
  const keepType = change !== undefined && change !== null && !change.apply
  const out: ScanPrefill = { id_type: keepType ? change.from : prefill.id_type }
  const skip = keepType ? IDENTITY_KEYS[prefill.id_type] : []
  for (const d of diff) {
    if (!d.apply || skip.includes(d.key)) continue
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
