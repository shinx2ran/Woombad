/**
 * Shared contract of the document scanner (SPEC 5.3). `ScanPrefill` is what a scan can fill into a tenant
 * form: the KTP fields (`TenantPrefill` from src/domain/ktp) plus the identity-document columns that a
 * passport provides (`id_type`, `id_number`, `nationality`).
 */
import type { Gender, IdType } from '../../types/db'
import type { DocumentKind } from '../../domain/passport'

export type { DocumentKind }

export interface ScanPrefill {
  full_name?: string
  /** always set: the kind of document the values came from ('ktp' for a KTP, 'passport' for an MRZ) */
  id_type: IdType
  /** 16-digit KTP number (id_type 'ktp') */
  nik?: string
  /** passport (or other document) number (id_type 'passport' / 'other') */
  id_number?: string
  /** ISO 3166-1 alpha-3 / ICAO code from the MRZ, e.g. 'AUS' */
  nationality?: string
  gender?: Gender
  birth_place?: string
  /** 'YYYY-MM-DD' */
  birth_date?: string
  address?: string
  religion?: string
  marital_status?: string
  occupation?: string
}

/** Value fields of a prefill (everything except the structural `id_type`). */
export type ScanPrefillKey = Exclude<keyof ScanPrefill, 'id_type'>

/** Indonesian labels for the review list. */
export const SCAN_FIELD_LABEL: Record<ScanPrefillKey, string> = {
  full_name: 'Nama lengkap',
  nik: 'NIK',
  id_number: 'Nomor paspor',
  nationality: 'Kewarganegaraan',
  gender: 'Jenis kelamin',
  birth_place: 'Tempat lahir',
  birth_date: 'Tanggal lahir',
  address: 'Alamat',
  religion: 'Agama',
  marital_status: 'Status perkawinan',
  occupation: 'Pekerjaan',
}

/** Display order of the review list (identity number right after the name). */
export const SCAN_PREFILL_ORDER: ScanPrefillKey[] = [
  'full_name',
  'nik',
  'id_number',
  'nationality',
  'gender',
  'birth_place',
  'birth_date',
  'address',
  'religion',
  'marital_status',
  'occupation',
]

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  ktp: 'KTP',
  passport: 'Paspor',
  unknown: 'Tidak dikenali',
}
