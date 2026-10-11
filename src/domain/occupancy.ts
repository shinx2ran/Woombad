/** Occupancy (tingkat hunian) derived from leases; rooms only carry a maintenance flag. */
import type { Lease, Room } from '../types/db'
import type { DateRange, Granularity } from './period'

const notImplemented = (name: string): never => {
  throw new Error(`${name} belum diimplementasikan`)
}

/** status === 'active' && start_date <= date <= end_date */
export function isLeaseActiveOn(lease: Lease, dateISO: string): boolean {
  return notImplemented('isLeaseActiveOn') as never ?? [lease, dateISO]
}

export function occupiedRoomIds(leases: Lease[], dateISO: string): Set<string> {
  return notImplemented('occupiedRoomIds') as never ?? [leases, dateISO]
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
  return notImplemented('roomOccupancy') as never ?? [rooms, leases, dateISO]
}

export interface OccupancyPoint {
  key: string
  label: string
  rate: number
  occupied: number
  rentable: number
}

/**
 * One point per bucket in the range, sampled on the bucket's last day (clamped to range.end).
 * Rooms are assumed to exist for the whole range (no room history is tracked).
 */
export function occupancySeries(rooms: Room[], leases: Lease[], range: DateRange, granularity: Granularity): OccupancyPoint[] {
  return notImplemented('occupancySeries') as never ?? [rooms, leases, range, granularity]
}

/** Active leases whose end_date is within [today, today + withinDays], sorted by end_date. */
export function expiringLeases(leases: Lease[], todayISO: string, withinDays: number): Lease[] {
  return notImplemented('expiringLeases') as never ?? [leases, todayISO, withinDays]
}

/** Rooms with status 'active' that have no active lease on the date, for the "kamar kosong" list. */
export function vacantRooms(rooms: Room[], leases: Lease[], dateISO: string): Room[] {
  return notImplemented('vacantRooms') as never ?? [rooms, leases, dateISO]
}
