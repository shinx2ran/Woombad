/** Occupancy (tingkat hunian) derived from leases; rooms only carry a maintenance flag. */
import type { Lease, Room } from '../types/db'
import type { DateRange, Granularity } from './period'
import { addDaysISO, addPeriods, bucketKeysInRange, bucketLabel, bucketStart } from './period'

/** status === 'active' && start_date <= date <= end_date */
export function isLeaseActiveOn(lease: Lease, dateISO: string): boolean {
  if (lease.status !== 'active') return false
  const d = dateISO.slice(0, 10)
  return lease.start_date <= d && d <= lease.end_date
}

export function occupiedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  const ids = new Set<string>()
  for (const lease of leases) if (isLeaseActiveOn(lease, dateISO)) ids.add(lease.room_id)
  return ids
}

export interface OccupancySnapshot {
  total: number
  occupied: number
  /** active rooms without an active lease */
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

/** Rooms with status 'active' that have no active lease on the date, for the "kamar kosong" list. */
export function vacantRooms(rooms: Room[], leases: Lease[], dateISO: string): Room[] {
  const occupiedIds = occupiedRoomIds(leases, dateISO)
  return rooms
    .filter((r) => r.status === 'active' && !occupiedIds.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}
