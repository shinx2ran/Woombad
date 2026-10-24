/**
 * Occupancy (tingkat hunian) derived from leases; rooms only carry a maintenance flag.
 *
 * Historical occupancy follows SPEC §2a ("hunian historis"):
 * - `ended` leases occupy the room from start_date through `checkout_date ?? end_date`;
 * - `active` leases occupy from start_date with NO upper bound (the tenant is in the room until
 *   checkout is recorded, even when end_date has passed and the next invoice is not issued yet);
 * - `cancelled` leases never occupy.
 * A room whose only active lease starts in the future is "Dipesan" (reserved), not vacant.
 * Room `status = 'maintenance'` is not historical: it applies to every date.
 */
import type { Lease, Room } from '../types/db'
import type { DateRange, Granularity } from './period'
import { addDaysISO, addPeriods, bucketKeysInRange, bucketLabel, bucketStart } from './period'

const day = (iso: string): string => iso.slice(0, 10)

/** Last day (inclusive) a lease occupies its room, or null for an open-ended active lease. */
export function leaseOccupiedUntil(lease: Lease): string | null {
  if (lease.status !== 'ended') return null
  // checkout_date is the move-out day: the room is free again from that day (same-day turnover),
  // so the last occupied night is the day before. Without a recorded checkout, end_date (inclusive).
  return lease.checkout_date ? addDaysISO(day(lease.checkout_date), -1) : day(lease.end_date)
}

/**
 * True when the tenant occupies the room on the date (SPEC §2a). Both the probe date and the lease dates
 * are compared on their first 10 characters ('YYYY-MM-DD'), so timestamps are accepted.
 * - cancelled -> false
 * - date < start_date -> false
 * - active -> true for every date >= start_date (even past end_date, until checkout is recorded)
 * - ended -> date <= (checkout_date ?? end_date)
 */
export function isLeaseActiveOn(lease: Lease, dateISO: string): boolean {
  if (lease.status === 'cancelled') return false
  const d = day(dateISO)
  if (d < day(lease.start_date)) return false
  const until = leaseOccupiedUntil(lease)
  return until === null || d <= until
}

/**
 * Rencana keluar (SPEC 7.8): the check-out day an active lease's tenant said he will leave ('YYYY-MM-DD'), or null
 * when there is no plan or the lease is no longer active (an ended lease has its real checkout_date).
 */
export function plannedCheckoutOf(lease: Pick<Lease, 'status' | 'planned_checkout_date'>): string | null {
  return lease.status === 'active' && lease.planned_checkout_date ? day(lease.planned_checkout_date) : null
}

/** Active lease whose start_date is after the date: the room is booked ("Dipesan") but not yet occupied. */
export function isLeaseReservedOn(lease: Lease, dateISO: string): boolean {
  return lease.status === 'active' && day(dateISO) < day(lease.start_date)
}

/**
 * A cancelled lease with no night to show (SPEC 7.3): a cancel dated on or before the start day keeps end_date =
 * start_date only for the DB check (end_date >= start_date, cancelledLeaseEndDate), so on a cancelled row
 * end_date <= start_date means no check-out day: its end is shown as the start day, never end_date + 1. A cancel
 * dated the day after the start stores the same row and reads the same (a tenant who stayed is checked out instead).
 */
export function isCancelledWithoutStay(lease: Pick<Lease, 'status' | 'start_date' | 'end_date'>): boolean {
  return lease.status === 'cancelled' && day(lease.end_date) <= day(lease.start_date)
}

/** Room ids with a lease occupying them on the date (`isLeaseActiveOn`). */
export function occupiedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  const ids = new Set<string>()
  for (const lease of leases) if (isLeaseActiveOn(lease, dateISO)) ids.add(lease.room_id)
  return ids
}

/**
 * Room ids with a status 'active' lease whose start_date > date ("Dipesan"), regardless of whether the
 * room is also occupied on the date by another lease (e.g. the current tenant checks out 2026-03-31 and
 * the next lease starts 2026-04-01: on 2026-03-15 the room is both occupied and reserved). Callers that
 * need a single state per room (`roomOccupancy`, `vacantRooms`) give occupied priority over reserved.
 */
export function reservedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  const ids = new Set<string>()
  for (const lease of leases) if (isLeaseReservedOn(lease, dateISO)) ids.add(lease.room_id)
  return ids
}

/**
 * True when another lease blocks the room for any day of [startISO, endISO] (inclusive), for the
 * double-booking check (SPEC §2b.8). Considered: leases with room_id === roomId, status !== 'cancelled',
 * id !== excludeLeaseId (pass the lease being edited). A lease occupies [start_date, X] where X =
 * checkout_date ?? end_date for 'ended' leases and end_date for 'active' leases; intervals touching on
 * a single day overlap. Dates are compared on their first 10 characters.
 */
export function leaseOverlaps(leases: Lease[], roomId: string, startISO: string, endISO: string, excludeLeaseId?: string): boolean {
  const start = day(startISO)
  const end = day(endISO)
  for (const l of leases) {
    if (l.room_id !== roomId || l.status === 'cancelled' || l.id === excludeLeaseId) continue
    const lStart = day(l.start_date)
    const lEnd = l.status === 'ended' ? leaseOccupiedUntil(l)! : day(l.end_date)
    if (lStart <= end && lEnd >= start) return true
  }
  return false
}

/**
 * The database's double-booking guard (public.leases_overlap_guard, SPEC 7.7), for LocalRepo and the app's checks
 * before a write: the first other lease of the room, not cancelled, that holds a night of [fromISO, toISO] (inclusive),
 * or null. Same rule as leaseOverlaps (an ended lease holds until checkout_date - 1, an active lease until end_date),
 * except that a lease without a night (an ended lease checked out on its first day) holds none.
 */
export function overlappingLease(leases: readonly Lease[], roomId: string, fromISO: string, toISO: string, excludeLeaseId?: string): Lease | null {
  const from = day(fromISO)
  const to = day(toISO)
  for (const l of leases) {
    if (l.room_id !== roomId || l.status === 'cancelled' || l.id === excludeLeaseId) continue
    const lStart = day(l.start_date)
    const lEnd = l.status === 'ended' ? leaseOccupiedUntil(l)! : day(l.end_date)
    if (lEnd >= lStart && lStart <= to && lEnd >= from) return l
  }
  return null
}

/**
 * The nights leases_overlap_guard checks for a lease write (SPEC 7.7), or null when it checks none. Only future nights
 * (from today) are checked, so history and existing flows keep working:
 *  - insert (`before` null) of an active lease: [max(start_date, today), end_date]; ended/cancelled rows (history) none;
 *  - update that keeps the room, the start date and status active and moves end_date later (Perpanjang / Tagih):
 *    [max(old end_date + 1, today), new end_date]. A room move (checked by the app, SPEC 2b.9), a start-date correction
 *    (redate_lease checks itself), a shorter end, a checkout or a cancel are not checked.
 */
export function guardedNights(before: Lease | null, after: Lease, todayISO: string): { from: string; to: string } | null {
  const today = day(todayISO)
  let from: string
  if (before === null) {
    if (after.status !== 'active') return null
    from = day(after.start_date) > today ? day(after.start_date) : today
  } else {
    if (
      after.room_id !== before.room_id ||
      day(after.start_date) !== day(before.start_date) ||
      before.status !== 'active' ||
      after.status !== 'active' ||
      day(after.end_date) <= day(before.end_date)
    ) {
      return null
    }
    const next = addDaysISO(day(before.end_date), 1)
    from = next > today ? next : today
  }
  const to = day(after.end_date)
  return from <= to ? { from, to } : null
}

export interface OccupancySnapshot {
  /** all rooms given (any status) */
  total: number
  /** status 'active' rooms with an occupant on the date */
  occupied: number
  /** status 'active' rooms with no occupant but a future-start active lease ("Dipesan") */
  reserved: number
  /** status 'active' rooms with neither occupant nor reservation: total - maintenance - occupied - reserved */
  available: number
  /** rooms with status 'maintenance' (counted here even when they have a lease) */
  maintenance: number
  /** occupied / (total - maintenance); 0 when no rentable rooms */
  rate: number
}

/** Snapshot of the given rooms on the date. Leases for rooms not in `rooms` are ignored. */
export function roomOccupancy(rooms: Room[], leases: Lease[], dateISO: string): OccupancySnapshot {
  const occupiedIds = occupiedRoomIds(leases, dateISO)
  const reservedIds = reservedRoomIds(leases, dateISO)
  let maintenance = 0
  let occupied = 0
  let reserved = 0
  for (const room of rooms) {
    if (room.status === 'maintenance') {
      // a maintenance room with a lease is still counted as maintenance, not occupied
      maintenance += 1
    } else if (occupiedIds.has(room.id)) {
      occupied += 1
    } else if (reservedIds.has(room.id)) {
      reserved += 1
    }
  }
  const total = rooms.length
  const rentable = total - maintenance
  return {
    total,
    occupied,
    reserved,
    available: total - maintenance - occupied - reserved,
    maintenance,
    rate: rentable > 0 ? occupied / rentable : 0,
  }
}

/**
 * One `roomOccupancy` snapshot per property_id found in `rooms` (insertion order of first room seen).
 * Properties without rooms are absent from the map.
 */
export function roomOccupancyByProperty(rooms: Room[], leases: Lease[], dateISO: string): Map<string, OccupancySnapshot> {
  const grouped = new Map<string, Room[]>()
  for (const room of rooms) {
    const list = grouped.get(room.property_id)
    if (list) list.push(room)
    else grouped.set(room.property_id, [room])
  }
  const result = new Map<string, OccupancySnapshot>()
  for (const [propertyId, propertyRooms] of grouped) {
    result.set(propertyId, roomOccupancy(propertyRooms, leases, dateISO))
  }
  return result
}

export interface OccupancyPoint {
  key: string
  label: string
  rate: number
  occupied: number
  rentable: number
}

/** Last day (inclusive) of the bucket identified by key. */
export function bucketEnd(key: string, granularity: Granularity): string {
  const start = bucketStart(key, granularity)
  switch (granularity) {
    case 'day':
      return start
    case 'week':
      return addDaysISO(start, 6)
    case 'month':
      return addDaysISO(addPeriods(start, 'monthly', 1), -1)
    case 'year':
      return `${key}-12-31`
  }
}

/**
 * One point per bucket in the range, sampled on the bucket's last day (clamped to range.end).
 * Rooms are assumed to exist for the whole range (no room history is tracked).
 */
export function occupancySeries(rooms: Room[], leases: Lease[], range: DateRange, granularity: Granularity): OccupancyPoint[] {
  return bucketKeysInRange(range, granularity).map((key) => {
    const end = bucketEnd(key, granularity)
    const sampleDate = end < range.end ? end : range.end
    const snap = roomOccupancy(rooms, leases, sampleDate)
    return {
      key,
      label: bucketLabel(key, granularity),
      rate: snap.rate,
      occupied: snap.occupied,
      rentable: snap.total - snap.maintenance,
    }
  })
}

/** Active leases whose end_date is within [today, today + withinDays], sorted by end_date then id. */
export function expiringLeases(leases: Lease[], todayISO: string, withinDays: number): Lease[] {
  const today = day(todayISO)
  const limit = addDaysISO(today, withinDays)
  return leases
    .filter((l) => l.status === 'active' && l.end_date >= today && l.end_date <= limit)
    .sort((a, b) => {
      if (a.end_date !== b.end_date) return a.end_date < b.end_date ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * Natural room-name order for sorting (SPEC 5.1): localeCompare with numeric: true and sensitivity 'base',
 * so 'A1' < 'A2' < 'A10' and 'a1' equals 'A1' (returns 0). Negative when a sorts before b.
 */
export function compareRoomNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Room comparator for lists spanning several properties: by property_id (plain string compare) first, then
 * compareRoomNames on the names. Callers that want "nama kos lalu nama kamar" and have the properties at
 * hand can map property_id to its name before comparing; this keeps the domain free of property lookups.
 */
export function compareRooms(a: Room, b: Room): number {
  if (a.property_id !== b.property_id) return a.property_id < b.property_id ? -1 : 1
  return compareRoomNames(a.name, b.name)
}

/**
 * Rooms with status 'active' that have neither an occupant nor a reservation on the date, for the
 * "kamar kosong" list, sorted by name with compareRoomNames (A1 < A2 < A10). A room booked by a
 * future-start active lease is "Dipesan", not kosong (SPEC §2a / §2b.8), so it is left out;
 * `reservedRoomIds` lists those rooms.
 */
export function vacantRooms(rooms: Room[], leases: Lease[], dateISO: string): Room[] {
  const occupiedIds = occupiedRoomIds(leases, dateISO)
  const reservedIds = reservedRoomIds(leases, dateISO)
  return rooms
    .filter((r) => r.status === 'active' && !occupiedIds.has(r.id) && !reservedIds.has(r.id))
    .sort((a, b) => compareRoomNames(a.name, b.name))
}
