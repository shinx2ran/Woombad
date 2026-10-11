/**
 * UI-side helpers for the properties module (pure, testable). Occupancy and billing figures come from
 * src/domain; this file only arranges them for the room cards and validates form input.
 */
import type { AddonBilling, Invoice, Lease, Payment, Room, Tenant } from '../../types/db'
import { isLeaseActiveOn, isLeaseReservedOn } from '../../domain/occupancy'
import { summarizeLeaseBilling } from '../../domain/billing'
import { formatRupiah } from '../../lib/format'

/** Collator used everywhere rooms are sorted: 'A1' < 'A2' < 'A10', case-insensitive. */
export function compareRoomNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** Rooms sorted naturally by name (new array). */
export function sortRoomsNatural<T extends { name: string }>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => compareRoomNames(a.name, b.name))
}

export type RoomStateKind = 'occupied' | 'reserved' | 'vacant' | 'maintenance'

export interface RoomDisplayState {
  kind: RoomStateKind
  /**
   * The lease situation underneath `kind`. Equals `kind` for occupied/reserved rooms; for a maintenance room it
   * tells whether a tenant still lives there ('occupied') or has booked it ('reserved') so the UI never hides them.
   * Null when there is no current or upcoming lease.
   */
  occupancy: 'occupied' | 'reserved' | null
  /** the lease behind an occupied / reserved state (also kept when the room is under maintenance) */
  lease: Lease | null
  tenant: Tenant | null
  /** occupied: latest settled period_end (summarizeLeaseBilling.paidThrough) */
  paidThrough: string | null
  /** occupied: open amount on the lease's invoices */
  outstanding: number
  /** reserved: start_date of the upcoming lease */
  startDate: string | null
}

/**
 * Single state per room for the card grid, mirroring the priority of `roomOccupancy`:
 * maintenance > occupied > reserved > vacant. Occupied uses the lease active on `todayISO`
 * (`isLeaseActiveOn`); reserved the earliest-starting future active lease (`isLeaseReservedOn`).
 * A maintenance room keeps its lease/tenant/billing fields (see `occupancy`) so the occupant stays visible.
 * `leases` may contain leases of other rooms; they are ignored.
 */
export function roomDisplayState(
  room: Room,
  leases: Lease[],
  tenantsById: Map<string, Tenant>,
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
): RoomDisplayState {
  const empty: RoomDisplayState = { kind: 'vacant', occupancy: null, lease: null, tenant: null, paidThrough: null, outstanding: 0, startDate: null }
  const leaseState = leaseDisplayState(room, leases, tenantsById, invoices, payments, todayISO, empty)
  if (room.status === 'maintenance') return { ...leaseState, kind: 'maintenance' }
  return leaseState
}

function leaseDisplayState(
  room: Room,
  leases: Lease[],
  tenantsById: Map<string, Tenant>,
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
  empty: RoomDisplayState,
): RoomDisplayState {
  const roomLeases = leases.filter((l) => l.room_id === room.id)
  const current = roomLeases.find((l) => isLeaseActiveOn(l, todayISO)) ?? null
  if (current) {
    const summary = summarizeLeaseBilling(current, invoices, payments, todayISO)
    return {
      kind: 'occupied',
      occupancy: 'occupied',
      lease: current,
      tenant: tenantsById.get(current.tenant_id) ?? null,
      paidThrough: summary.paidThrough,
      outstanding: summary.outstanding,
      startDate: current.start_date,
    }
  }
  const upcoming = roomLeases
    .filter((l) => isLeaseReservedOn(l, todayISO))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))[0]
  if (upcoming) {
    return {
      ...empty,
      kind: 'reserved',
      occupancy: 'reserved',
      lease: upcoming,
      tenant: tenantsById.get(upcoming.tenant_id) ?? null,
      startDate: upcoming.start_date,
    }
  }
  return empty
}

/** 'Rp 1.200.000 / bulan', falling back to weekly then daily; 'Harga belum diisi' when none. */
export function roomPriceLabel(room: Pick<Room, 'price_daily' | 'price_weekly' | 'price_monthly'>): string {
  if (room.price_monthly) return `${formatRupiah(room.price_monthly)} / bulan`
  if (room.price_weekly) return `${formatRupiah(room.price_weekly)} / minggu`
  if (room.price_daily) return `${formatRupiah(room.price_daily)} / malam`
  return 'Harga belum diisi'
}

export const BULK_ROOM_LIMIT = 100

/**
 * Names for the "Tambah banyak" mode: prefix + n for n in [from, to], e.g. ('A', 1, 6) -> A1..A6.
 * When `pad` is true numbers are zero-padded to the width of `to` ('A01'..'A12').
 * Throws with an Indonesian message when the range is invalid or exceeds BULK_ROOM_LIMIT.
 */
export function buildBulkRoomNames(prefix: string, from: number, to: number, pad = false): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Nomor awal dan akhir harus bilangan bulat.')
  if (from < 0 || to < 0) throw new Error('Nomor tidak boleh negatif.')
  if (to < from) throw new Error('Nomor akhir harus lebih besar atau sama dengan nomor awal.')
  const count = to - from + 1
  if (count > BULK_ROOM_LIMIT) throw new Error(`Maksimal ${BULK_ROOM_LIMIT} kamar sekaligus.`)
  const width = String(to).length
  const names: string[] = []
  for (let n = from; n <= to; n++) {
    const num = pad ? String(n).padStart(width, '0') : String(n)
    names.push(`${prefix.trim()}${num}`)
  }
  return names
}

/** Names (case-insensitive, trimmed) that already exist among `existing`; order preserved, no duplicates. */
export function findDuplicateRoomNames(names: string[], existing: string[]): string[] {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (taken.has(key) && !seen.has(key)) {
      seen.add(key)
      dupes.push(name.trim())
    }
  }
  return dupes
}

// ---------- form validation ----------

export interface PropertyFormValues {
  name: string
  address: string
  notes: string
  payment_info: string
}

export function validatePropertyForm(v: PropertyFormValues): Partial<Record<keyof PropertyFormValues, string>> {
  const errors: Partial<Record<keyof PropertyFormValues, string>> = {}
  if (!v.name.trim()) errors.name = 'Nama kos wajib diisi.'
  else if (v.name.trim().length > 80) errors.name = 'Nama kos maksimal 80 karakter.'
  return errors
}

export interface RoomFormValues {
  name: string
  floor: string
  price_daily: number
  price_weekly: number
  price_monthly: number
  status: Room['status']
  notes: string
}

export interface RoomFormOptions {
  /** names of other rooms in the same property (excluding the room being edited) */
  existingNames: string[]
}

export function validateRoomForm(v: RoomFormValues, opts: RoomFormOptions): Partial<Record<keyof RoomFormValues, string>> {
  const errors: Partial<Record<keyof RoomFormValues, string>> = {}
  const name = v.name.trim()
  if (!name) errors.name = 'Nama kamar wajib diisi.'
  else if (name.length > 40) errors.name = 'Nama kamar maksimal 40 karakter.'
  else if (findDuplicateRoomNames([name], opts.existingNames).length > 0) errors.name = `Kamar "${name}" sudah ada di kos ini.`
  for (const key of ['price_daily', 'price_weekly', 'price_monthly'] as const) {
    if (v[key] < 0) errors[key] = 'Harga tidak boleh negatif.'
  }
  if (!v.price_daily && !v.price_weekly && !v.price_monthly) {
    errors.price_monthly = 'Isi minimal satu harga (harian, mingguan, atau bulanan).'
  }
  return errors
}

export interface AddonFormValues {
  name: string
  default_price: number
  billing: AddonBilling
  scope: 'property' | 'org'
}

export function validateAddonForm(v: AddonFormValues): Partial<Record<keyof AddonFormValues, string>> {
  const errors: Partial<Record<keyof AddonFormValues, string>> = {}
  if (!v.name.trim()) errors.name = 'Nama add-on wajib diisi.'
  else if (v.name.trim().length > 60) errors.name = 'Nama add-on maksimal 60 karakter.'
  if (!Number.isFinite(v.default_price) || v.default_price < 0) errors.default_price = 'Harga tidak boleh negatif.'
  return errors
}

/** Null when blank so optional text columns are stored as NULL, not ''. */
export function blankToNull(value: string): string | null {
  const t = value.trim()
  return t ? t : null
}

/** 0 -> null for optional price columns. */
export function zeroToNull(value: number): number | null {
  return value > 0 ? Math.round(value) : null
}
