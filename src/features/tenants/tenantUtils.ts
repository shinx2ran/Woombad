/**
 * Pure helpers for the tenants module: form <-> row mapping, validation, search and the
 * "current room" lookup. No React, no I/O, so everything here is unit-tested in node.
 */
import type { Gender, IdType, Lease, OrgInsert, Payment, Property, Room, Tenant } from '../../types/db'
import { ID_TYPE_LABEL } from '../../types/db'
import { isValidNik } from '../../domain/ktp'
import type { ScanPrefill } from '../scanner/types'
import { isLeaseActiveOn, isLeaseReservedOn } from '../../domain/occupancy'
import { parseISODate } from '../../domain/period'
import { normalizePhone } from '../../lib/format'

/** Form state: every column as a string so inputs stay controlled; '' means "empty". */
export interface TenantFormValues {
  full_name: string
  phone: string
  gender: '' | Gender
  birth_place: string
  birth_date: string
  /** which identity document the tenant showed; decides which number field is shown/persisted */
  id_type: IdType
  /** KTP number (id_type 'ktp') */
  nik: string
  /** passport / other document number (id_type 'passport' | 'other') */
  id_number: string
  /** alpha-3 / ICAO code from the passport MRZ, e.g. 'AUS' (id_type 'passport') */
  nationality: string
  address: string
  religion: string
  marital_status: string
  occupation: string
  emergency_contact_name: string
  emergency_contact_phone: string
  property_id: string
  notes: string
}

export type TenantFormErrors = Partial<Record<keyof TenantFormValues, string>>

export const EMPTY_TENANT_FORM: TenantFormValues = {
  full_name: '',
  phone: '',
  gender: '',
  birth_place: '',
  birth_date: '',
  id_type: 'ktp',
  nik: '',
  id_number: '',
  nationality: '',
  address: '',
  religion: '',
  marital_status: '',
  occupation: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  property_id: '',
  notes: '',
}

/** Indonesian labels for the form fields (also used by the OCR diff preview). */
export const TENANT_FIELD_LABEL: Record<keyof TenantFormValues, string> = {
  full_name: 'Nama lengkap',
  phone: 'Nomor HP / WhatsApp',
  gender: 'Jenis kelamin',
  birth_place: 'Tempat lahir',
  birth_date: 'Tanggal lahir',
  id_type: 'Jenis identitas',
  nik: 'NIK',
  id_number: 'Nomor identitas',
  nationality: 'Kewarganegaraan',
  address: 'Alamat',
  religion: 'Agama',
  marital_status: 'Status perkawinan',
  occupation: 'Pekerjaan',
  emergency_contact_name: 'Nama kontak darurat',
  emergency_contact_phone: 'Telepon kontak darurat',
  property_id: 'Kos',
  notes: 'Catatan',
}

/** Row -> form values (nulls become ''). */
export function tenantToForm(tenant: Tenant): TenantFormValues {
  return {
    full_name: tenant.full_name,
    phone: tenant.phone ?? '',
    gender: tenant.gender ?? '',
    birth_place: tenant.birth_place ?? '',
    birth_date: tenant.birth_date ?? '',
    id_type: tenant.id_type,
    nik: tenant.nik ?? '',
    id_number: tenant.id_number ?? '',
    nationality: tenant.nationality ?? '',
    address: tenant.address ?? '',
    religion: tenant.religion ?? '',
    marital_status: tenant.marital_status ?? '',
    occupation: tenant.occupation ?? '',
    emergency_contact_name: tenant.emergency_contact_name ?? '',
    emergency_contact_phone: tenant.emergency_contact_phone ?? '',
    property_id: tenant.property_id ?? '',
    notes: tenant.notes ?? '',
  }
}

/**
 * Initial form for a new tenant. With one kos selected globally, that kos is preselected; with "Semua kos"
 * the user must pick explicitly (unless the organisation has exactly one kos).
 */
export function initialTenantForm(selectedPropertyId: string, properties: Pick<Property, 'id'>[]): TenantFormValues {
  let property_id = ''
  if (selectedPropertyId !== 'all' && properties.some((p) => p.id === selectedPropertyId)) property_id = selectedPropertyId
  else if (properties.length === 1) property_id = properties[0].id
  return { ...EMPTY_TENANT_FORM, property_id }
}

function clean(value: string): string | null {
  const t = value.trim()
  return t === '' ? null : t
}

/** Only '+' and digits may remain after normalisation, and Indonesian numbers have 9..15 digits. */
export function isPlausiblePhone(normalized: string): boolean {
  const digits = normalized.replace(/[^0-9]/g, '')
  return /^\+?\d+$/.test(normalized) && digits.length >= 9 && digits.length <= 15
}

/** Validation messages in Indonesian; empty object means valid. */
export function validateTenantForm(values: TenantFormValues): TenantFormErrors {
  const errors: TenantFormErrors = {}
  if (!values.full_name.trim()) errors.full_name = 'Nama wajib diisi.'
  else if (values.full_name.trim().length < 2) errors.full_name = 'Nama terlalu pendek.'

  if (values.id_type === 'ktp') {
    const nik = values.nik.replace(/\s+/g, '')
    if (nik && !isValidNik(nik)) {
      errors.nik = /^\d+$/.test(nik) ? `NIK harus 16 digit (saat ini ${nik.length} digit).` : 'NIK hanya boleh berisi angka.'
    }
  } else {
    const idNumber = values.id_number.replace(/\s+/g, '')
    if (idNumber && !/^[A-Za-z0-9-]{3,20}$/.test(idNumber)) {
      errors.id_number = values.id_type === 'passport' ? 'Nomor paspor hanya huruf dan angka (3–20 karakter).' : 'Nomor identitas hanya huruf dan angka (3–20 karakter).'
    }
    if (values.id_type === 'passport') {
      const nat = values.nationality.trim()
      if (nat && !/^[A-Za-z][A-Za-z .'-]{0,39}$/.test(nat)) errors.nationality = 'Kewarganegaraan diisi dengan kode 3 huruf (mis. AUS) atau nama negara.'
    }
  }

  const phone = normalizePhone(values.phone)
  if (values.phone.trim() && (!phone || !isPlausiblePhone(phone))) errors.phone = 'Nomor HP tidak valid. Contoh: 0812-3456-7890.'

  const emergency = normalizePhone(values.emergency_contact_phone)
  if (values.emergency_contact_phone.trim() && (!emergency || !isPlausiblePhone(emergency))) {
    errors.emergency_contact_phone = 'Nomor telepon kontak darurat tidak valid.'
  }

  if (values.birth_date) {
    try {
      parseISODate(values.birth_date)
    } catch {
      errors.birth_date = 'Tanggal lahir tidak valid.'
    }
  }

  if (!values.property_id) errors.property_id = 'Pilih kos tempat penyewa terdaftar.'
  return errors
}

/**
 * Identity columns for a form: KTP keeps its number in `nik` (id_number/nationality null); a passport keeps
 * its number in `id_number` with the nationality upper-cased when it is a 1-3 letter code; 'Lainnya' keeps
 * only `id_number`. The columns of the other document types are always cleared so a row never carries two
 * numbers.
 */
export function identityColumns(values: Pick<TenantFormValues, 'id_type' | 'nik' | 'id_number' | 'nationality'>): Pick<Tenant, 'id_type' | 'nik' | 'id_number' | 'nationality'> {
  if (values.id_type === 'ktp') {
    return { id_type: 'ktp', nik: clean(values.nik.replace(/\s+/g, '')), id_number: null, nationality: null }
  }
  const id_number = clean(values.id_number.replace(/\s+/g, '').toUpperCase())
  if (values.id_type === 'passport') {
    const nat = values.nationality.trim()
    return { id_type: 'passport', nik: null, id_number, nationality: nat === '' ? null : /^[A-Za-z]{1,3}$/.test(nat) ? nat.toUpperCase() : nat }
  }
  return { id_type: 'other', nik: null, id_number, nationality: null }
}

/** Form values -> insert payload. Phones are normalised to +62…; blanks become null. */
export function formToTenantPayload(values: TenantFormValues): OrgInsert<'tenants'> {
  return {
    property_id: clean(values.property_id),
    full_name: values.full_name.trim(),
    ...identityColumns(values),
    phone: normalizePhone(values.phone),
    gender: values.gender === '' ? null : values.gender,
    birth_place: clean(values.birth_place),
    birth_date: clean(values.birth_date),
    address: clean(values.address),
    religion: clean(values.religion),
    marital_status: clean(values.marital_status),
    occupation: clean(values.occupation),
    emergency_contact_name: clean(values.emergency_contact_name),
    emergency_contact_phone: normalizePhone(values.emergency_contact_phone),
    ktp_image_path: null,
    notes: clean(values.notes),
  }
}

/** Case-insensitive search over name, NIK / passport number and phone (digits compared without separators / country code). */
export function matchesTenantSearch(tenant: Pick<Tenant, 'full_name' | 'nik' | 'phone'> & Partial<Pick<Tenant, 'id_number'>>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (tenant.full_name.toLowerCase().includes(q)) return true
  if (tenant.nik && tenant.nik.includes(q)) return true
  if (tenant.id_number && tenant.id_number.toLowerCase().includes(q)) return true
  const qDigits = q.replace(/[^0-9]/g, '')
  if (qDigits && tenant.phone) {
    const phoneDigits = tenant.phone.replace(/[^0-9]/g, '')
    // Allow searching "0812…" against a stored "+62812…".
    const local = phoneDigits.startsWith('62') ? `0${phoneDigits.slice(2)}` : phoneDigits
    if (phoneDigits.includes(qDigits) || local.includes(qDigits)) return true
  }
  return false
}

/**
 * Global kos filter for the tenant list: tenants of the selected kos; with "Semua kos" tenants that are not
 * assigned to any kos (property_id null) are shown too.
 */
export function filterTenantsByProperty<T extends Pick<Tenant, 'property_id'>>(
  tenants: T[],
  propertyFilterIds: string[],
  selectedPropertyId: string,
): T[] {
  const ids = new Set(propertyFilterIds)
  return tenants.filter((t) => (t.property_id === null ? selectedPropertyId === 'all' : ids.has(t.property_id)))
}

export interface CurrentStay {
  lease: Lease
  /** 'occupied' = in the room today; 'reserved' = active lease starting in the future */
  kind: 'occupied' | 'reserved'
}

/**
 * The lease that explains where the tenant is today: an active lease occupying a room today wins, otherwise
 * an active lease that starts in the future ("Dipesan"). Null when the tenant is not renting.
 */
export function currentStayFor(tenantId: string, leases: Lease[], todayISO: string): CurrentStay | null {
  const own = leases.filter((l) => l.tenant_id === tenantId)
  const occupied = own
    .filter((l) => l.status === 'active' && isLeaseActiveOn(l, todayISO))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
  if (occupied) return { lease: occupied, kind: 'occupied' }
  const reserved = own.filter((l) => isLeaseReservedOn(l, todayISO)).sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
  if (reserved) return { lease: reserved, kind: 'reserved' }
  return null
}

/** 'A1 · Kos Melati' (falls back gracefully when the room or kos was deleted). */
export function describeRoom(lease: Pick<Lease, 'room_id' | 'property_id'>, rooms: Pick<Room, 'id' | 'name'>[], properties: Pick<Property, 'id' | 'name'>[]): string {
  const room = rooms.find((r) => r.id === lease.room_id)?.name ?? 'Kamar?'
  const kos = properties.find((p) => p.id === lease.property_id)?.name
  return kos ? `${room} · ${kos}` : room
}

/** Leases of a tenant, newest first (by start_date, then created_at). */
export function leasesOfTenant(tenantId: string, leases: Lease[]): Lease[] {
  return leases
    .filter((l) => l.tenant_id === tenantId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at))
}

/** Payments belonging to any of the given leases, newest first. */
export function paymentsOfLeases(leaseIds: string[], payments: Payment[]): Payment[] {
  const ids = new Set(leaseIds)
  return payments
    .filter((p) => p.lease_id !== null && ids.has(p.lease_id))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.created_at.localeCompare(a.created_at))
}

// ---------------------------------------------------------------- identity & scanner glue

export interface IdentityDescription {
  /** 'KTP' | 'Paspor' | 'Lainnya' */
  label: string
  /** the document number, or null when none is recorded */
  number: string | null
  /** 'KTP 3273…' / 'Paspor N1234567 · AUS' / 'Lainnya 123'; null when no number is recorded */
  text: string | null
}

/** How the tenant list / detail show the identity document. */
export function describeIdentity(tenant: Pick<Tenant, 'id_type' | 'nik' | 'id_number' | 'nationality'>): IdentityDescription {
  const label = ID_TYPE_LABEL[tenant.id_type]
  const number = tenant.id_type === 'ktp' ? tenant.nik : tenant.id_number
  if (!number) return { label, number: null, text: null }
  const nat = tenant.id_type === 'passport' && tenant.nationality ? ` · ${tenant.nationality}` : ''
  return { label, number, text: `${label} ${number}${nat}` }
}

/** The form as the scanner's `current` prop ('' -> undefined so empty fields count as empty). */
export function formToScanPrefill(values: TenantFormValues): Partial<ScanPrefill> {
  return {
    id_type: values.id_type,
    full_name: values.full_name || undefined,
    nik: values.nik || undefined,
    id_number: values.id_number || undefined,
    nationality: values.nationality || undefined,
    gender: values.gender || undefined,
    birth_place: values.birth_place || undefined,
    birth_date: values.birth_date || undefined,
    address: values.address || undefined,
    religion: values.religion || undefined,
    marital_status: values.marital_status || undefined,
    occupation: values.occupation || undefined,
  }
}

/**
 * Merge the values the user accepted in the scanner into the form. `id_type` always follows the scanned
 * document (a passport scan switches the form to Paspor), every other field is written only when present;
 * phone and the other manual fields are untouched.
 */
export function applyScanPrefill(current: TenantFormValues, prefill: ScanPrefill): TenantFormValues {
  const next: TenantFormValues = { ...current, id_type: prefill.id_type }
  if (prefill.full_name !== undefined) next.full_name = prefill.full_name
  if (prefill.nik !== undefined) next.nik = prefill.nik
  if (prefill.id_number !== undefined) next.id_number = prefill.id_number
  if (prefill.nationality !== undefined) next.nationality = prefill.nationality
  if (prefill.gender !== undefined) next.gender = prefill.gender
  if (prefill.birth_place !== undefined) next.birth_place = prefill.birth_place
  if (prefill.birth_date !== undefined) next.birth_date = prefill.birth_date
  if (prefill.address !== undefined) next.address = prefill.address
  if (prefill.religion !== undefined) next.religion = prefill.religion
  if (prefill.marital_status !== undefined) next.marital_status = prefill.marital_status
  if (prefill.occupation !== undefined) next.occupation = prefill.occupation
  return next
}

/** Rupiah-free initials for the avatar: 'Budi Santoso' -> 'BS'. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}
