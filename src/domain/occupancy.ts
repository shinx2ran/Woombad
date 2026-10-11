/**
 * Occupancy (tingkat hunian) derived from leases; rooms only carry a maintenance flag.
 *
 * Historical occupancy follows SPEC §2a ("hunian historis"):
 * - `ended` leases occupy the room from start_date through `checkout_date ?? end_date`;
 * - `active` leases occupy from start_date with NO upper bound (the tenant is in the room until
 *   checkout is recorded, even when end_date has passed and the next invoice is not issued yet);
 * - `cancelled` leases never occupy.
 * A room whose only active lease starts in the future is "Dipesan" (reserved), not vacant.
 */
import type { Lease, Room } from '../types/db'
import type { DateRange, Granularity } from './period'
import { addDaysISO, addPeriods, bucketKeysInRange, bucketLabel, bucketStart } from './period'

/** Last day (inclusive) a lease occupies its room, or null for an open-ended active lease. */
export function leaseOccupiedUntil(lease: Lease): string | null {
  if (lease.status === 'ended') return lease.checkout_date ?? lease.end_date
  return null
}

/**
 * True when the tenant occupies the room on the date (SPEC §2a):
 * ended -> start_date <= date <= (checkout_date ?? end_date); active -> start_date <= date; cancelled -> never.
 */
export function isLeaseActiveOn(lease: Lease, dateISO: string): boolean {
  if (lease.status === 'cancelled') return false
  const d = dateISO.slice(0, 10)
  if (d < lease.start_date) return false
  const until = leaseOccupiedUntil(lease)
  return until === null || d <= until
}

/** Active lease whose start_date is after the date: the room is booked ("Dipesan") but not yet occupied. */
export function isLeaseReservedOn(lease: Lease, dateISO: string): boolean {
  return lease.status === 'active' && dateISO.slice(0, 10) < lease.start_date
}

export function occupiedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  const ids = new Set<string>()
  for (const lease of leases) if (isLeaseActiveOn(lease, dateISO)) ids.add(lease.room_id)
  return ids
}

/** Rooms with a future-start active lease and no occupant on the date. */
export function reservedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  const occupied = occupiedRoomIds(leases, dateISO)
  const ids = new Set<string>()
  for (const lease of leases) {
    if (isLeaseReservedOn(lease, dateISO) && !occupied.has(lease.room_id)) ids.add(lease.room_id)
  }
  return ids
}

export interface OccupancySnapshot {
  total: number
  occupied: number
  /** active rooms without an occupant on the date (includes reserved rooms) */
  available: number
  maintenance: number
  /** occupied / (total - maintenance); 0 when no rentable rooms */
  rate: number
}

export function roomOccupancy(rooms: Room[], leases: Lease[], dateISO: string): OccupancySnapshot {
  const occupiedIds = occupiedRoomIds(leases, dateISO)
  let maintenance = 0
  let occupied = 0
  for (const room of rooms) {
    if (room.status === 'maintenance') {
      // a maintenance room with a lease is still counted as maintenance, not occupied
      maintenance += 1
    } else if (occupiedIds.has(room.id)) {
      occupied += 1
    }
  }
  const total = rooms.length
  const rentable = total - maintenance
  return {
    total,
    occupied,
    available: total - maintenance - occupied,
    maintenance,
    rate: rentable > 0 ? occupied / rentable : 0,
  }
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

/** Active leases whose end_date is within [today, today + withinDays], sorted by end_date. */
export function expiringLeases(leases: Lease[], todayISO: string, withinDays: number): Lease[] {
  const today = todayISO.slice(0, 10)
  const limit = addDaysISO(today, withinDays)
  return leases
    .filter((l) => l.status === 'active' && l.end_date >= today && l.end_date <= limit)
    .sort((a, b) => {
      if (a.end_date !== b.end_date) return a.end_date < b.end_date ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * Rooms with status 'active' that have neither an occupant nor a reservation on the date, for the
 * "kamar kosong" list. Decision (SPEC §2a / §2b.8): a room booked by a future-start active lease is
 * "Dipesan", not kosong, so it is left out here; `reservedRoomIds` lists those rooms.
 */
export function vacantRooms(rooms: Room[], leases: Lease[], dateISO: string): Room[] {
  const occupiedIds = occupiedRoomIds(leases, dateISO)
  const reservedIds = reservedRoomIds(leases, dateISO)
  return rooms
    .filter((r) => r.status === 'active' && !occupiedIds.has(r.id) && !reservedIds.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}
