import { describe, expect, it } from 'vitest'
import type { Lease, Room } from '../types/db'
import {
  bucketEnd,
  expiringLeases,
  isLeaseActiveOn,
  occupancySeries,
  occupiedRoomIds,
  roomOccupancy,
  vacantRooms,
} from './occupancy'

// ---------- fixtures ----------

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: nextId('room'),
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'kos-a',
    name: 'A1',
    floor: null,
    price_daily: 100_000,
    price_weekly: 600_000,
    price_monthly: 1_500_000,
    status: 'active',
    notes: null,
    ...overrides,
  }
}

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: nextId('lease'),
    org_id: 'org',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'kos-a',
    room_id: 'room-1',
    tenant_id: 'tenant-1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 500_000,
    start_date: '2026-03-01',
    end_date: '2026-03-31',
    status: 'active',
    checkout_date: null,
    deposit_returned_amount: null,
    notes: null,
    ...overrides,
  }
}

// ---------- tests ----------

describe('isLeaseActiveOn', () => {
  const lease = makeLease({ start_date: '2026-03-01', end_date: '2026-03-31' })
  it('is inclusive on both ends', () => {
    expect(isLeaseActiveOn(lease, '2026-02-28')).toBe(false)
    expect(isLeaseActiveOn(lease, '2026-03-01')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-03-15')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-03-31')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-04-01')).toBe(false)
  })
  it('requires status active', () => {
    expect(isLeaseActiveOn(makeLease({ status: 'ended' }), '2026-03-15')).toBe(false)
    expect(isLeaseActiveOn(makeLease({ status: 'cancelled' }), '2026-03-15')).toBe(false)
  })
  it('accepts a timestamp and uses its date part', () => {
    expect(isLeaseActiveOn(lease, '2026-03-31T23:00:00Z')).toBe(true)
  })
})

describe('occupiedRoomIds', () => {
  it('empty leases gives empty set', () => {
    expect(occupiedRoomIds([], '2026-03-15').size).toBe(0)
  })
  it('collects room ids of active leases on the date only', () => {
    const leases = [
      makeLease({ room_id: 'r1' }),
      makeLease({ room_id: 'r2', status: 'ended' }),
      makeLease({ room_id: 'r3', start_date: '2026-04-01', end_date: '2026-04-30' }),
      makeLease({ room_id: 'r1', start_date: '2026-01-01', end_date: '2026-12-31' }), // duplicate room
    ]
    expect([...occupiedRoomIds(leases, '2026-03-15')]).toEqual(['r1'])
  })
})

describe('roomOccupancy', () => {
  it('empty rooms gives zeros and rate 0', () => {
    expect(roomOccupancy([], [], '2026-03-15')).toEqual({ total: 0, occupied: 0, available: 0, maintenance: 0, rate: 0 })
  })
  it('counts occupied, available and maintenance rooms', () => {
    const rooms = [
      makeRoom({ id: 'r1' }),
      makeRoom({ id: 'r2' }),
      makeRoom({ id: 'r3' }),
      makeRoom({ id: 'r4', status: 'maintenance' }),
      makeRoom({ id: 'r5', status: 'maintenance' }),
    ]
    const leases = [
      makeLease({ room_id: 'r1' }),
      makeLease({ room_id: 'r2' }),
      makeLease({ room_id: 'r5' }), // maintenance room with a lease stays maintenance
      makeLease({ room_id: 'r3', status: 'ended' }),
      makeLease({ room_id: 'ghost' }), // room not in list is ignored
    ]
    const snap = roomOccupancy(rooms, leases, '2026-03-15')
    expect(snap).toEqual({ total: 5, occupied: 2, available: 1, maintenance: 2, rate: 2 / 3 })
  })
  it('rate is 0 when every room is in maintenance', () => {
    const rooms = [makeRoom({ id: 'r1', status: 'maintenance' })]
    expect(roomOccupancy(rooms, [makeLease({ room_id: 'r1' })], '2026-03-15')).toEqual({
      total: 1,
      occupied: 0,
      available: 0,
      maintenance: 1,
      rate: 0,
    })
  })
  it('fully occupied gives rate 1', () => {
    const rooms = [makeRoom({ id: 'r1' }), makeRoom({ id: 'r2' })]
    const leases = [makeLease({ room_id: 'r1' }), makeLease({ room_id: 'r2' })]
    expect(roomOccupancy(rooms, leases, '2026-03-01').rate).toBe(1)
  })
})

describe('bucketEnd', () => {
  it('computes the inclusive last day per granularity', () => {
    expect(bucketEnd('2026-03-05', 'day')).toBe('2026-03-05')
    expect(bucketEnd('2026-W10', 'week')).toBe('2026-03-08') // Mon 2 Mar .. Sun 8 Mar
    expect(bucketEnd('2026-02', 'month')).toBe('2026-02-28')
    expect(bucketEnd('2024-02', 'month')).toBe('2024-02-29')
    expect(bucketEnd('2026-12', 'month')).toBe('2026-12-31')
    expect(bucketEnd('2026', 'year')).toBe('2026-12-31')
  })
})

describe('occupancySeries', () => {
  const rooms = [makeRoom({ id: 'r1' }), makeRoom({ id: 'r2' }), makeRoom({ id: 'r3', status: 'maintenance' })]

  it('inverted range gives empty series', () => {
    expect(occupancySeries(rooms, [], { start: '2026-03-31', end: '2026-03-01' }, 'month')).toEqual([])
  })

  it('samples on the last day of each month, clamped to range.end', () => {
    const leases = [
      makeLease({ room_id: 'r1', start_date: '2026-01-10', end_date: '2026-02-28' }), // ends exactly at Feb sample
      makeLease({ room_id: 'r2', start_date: '2026-03-15', end_date: '2026-06-30' }),
    ]
    const series = occupancySeries(rooms, leases, { start: '2026-01-01', end: '2026-03-20' }, 'month')
    expect(series.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(series[0]).toEqual({ key: '2026-01', label: 'Jan 2026', rate: 0.5, occupied: 1, rentable: 2 })
    expect(series[1]).toEqual({ key: '2026-02', label: 'Feb 2026', rate: 0.5, occupied: 1, rentable: 2 })
    // March sampled at 2026-03-20 (range end), r2 active, r1 ended
    expect(series[2]).toEqual({ key: '2026-03', label: 'Mar 2026', rate: 0.5, occupied: 1, rentable: 2 })
  })

  it('daily series reflects a lease ending mid-range', () => {
    const leases = [makeLease({ room_id: 'r1', start_date: '2026-03-01', end_date: '2026-03-02' })]
    const series = occupancySeries(rooms, leases, { start: '2026-03-01', end: '2026-03-03' }, 'day')
    expect(series.map((p) => [p.key, p.occupied])).toEqual([
      ['2026-03-01', 1],
      ['2026-03-02', 1],
      ['2026-03-03', 0],
    ])
  })

  it('weekly series samples on Sunday (or range end)', () => {
    const leases = [makeLease({ room_id: 'r1', start_date: '2026-03-07', end_date: '2026-03-08' })]
    // 2026-W10 = Mon 2 Mar .. Sun 8 Mar; 2026-W11 starts Mon 9 Mar
    const series = occupancySeries(rooms, leases, { start: '2026-03-02', end: '2026-03-10' }, 'week')
    expect(series.map((p) => [p.key, p.occupied])).toEqual([
      ['2026-W10', 1],
      ['2026-W11', 0],
    ])
  })

  it('all maintenance gives rate 0 and rentable 0', () => {
    const series = occupancySeries([makeRoom({ status: 'maintenance' })], [], { start: '2026-03-01', end: '2026-03-31' }, 'month')
    expect(series[0]).toMatchObject({ rate: 0, occupied: 0, rentable: 0 })
  })
})

describe('expiringLeases', () => {
  it('empty input gives empty array', () => {
    expect(expiringLeases([], '2026-03-15', 7)).toEqual([])
  })
  it('includes active leases ending today through today+withinDays, sorted by end_date then id', () => {
    const leases = [
      makeLease({ id: 'z', end_date: '2026-03-22' }), // today + 7 inclusive
      makeLease({ id: 'b', end_date: '2026-03-15' }), // ends exactly today
      makeLease({ id: 'a', end_date: '2026-03-15' }),
      makeLease({ id: 'past', end_date: '2026-03-14' }), // already past
      makeLease({ id: 'later', end_date: '2026-03-23' }), // today + 8
      makeLease({ id: 'ended', end_date: '2026-03-16', status: 'ended' }),
      makeLease({ id: 'cancelled', end_date: '2026-03-16', status: 'cancelled' }),
      makeLease({ id: 'm', end_date: '2026-03-18' }),
    ]
    expect(expiringLeases(leases, '2026-03-15', 7).map((l) => l.id)).toEqual(['a', 'b', 'm', 'z'])
  })
  it('withinDays 0 returns only leases ending today', () => {
    const leases = [makeLease({ id: 'today', end_date: '2026-03-15' }), makeLease({ id: 'tomorrow', end_date: '2026-03-16' })]
    expect(expiringLeases(leases, '2026-03-15', 0).map((l) => l.id)).toEqual(['today'])
  })
  it('handles month boundaries', () => {
    const leases = [makeLease({ id: 'x', end_date: '2026-04-02' })]
    expect(expiringLeases(leases, '2026-03-28', 7).map((l) => l.id)).toEqual(['x'])
    expect(expiringLeases(leases, '2026-03-25', 7)).toEqual([])
  })
})

describe('vacantRooms', () => {
  it('empty rooms gives empty array', () => {
    expect(vacantRooms([], [], '2026-03-15')).toEqual([])
  })
  it('lists active rooms without an active lease, sorted numerically by name', () => {
    const rooms = [
      makeRoom({ id: 'r10', name: 'A10' }),
      makeRoom({ id: 'r2', name: 'A2' }),
      makeRoom({ id: 'r1', name: 'A1' }),
      makeRoom({ id: 'r3', name: 'A3' }),
      makeRoom({ id: 'm', name: 'A0', status: 'maintenance' }),
    ]
    const leases = [
      makeLease({ room_id: 'r3' }),
      makeLease({ room_id: 'r1', status: 'ended' }),
      makeLease({ room_id: 'r2', start_date: '2026-04-01', end_date: '2026-04-30' }),
    ]
    expect(vacantRooms(rooms, leases, '2026-03-15').map((r) => r.name)).toEqual(['A1', 'A2', 'A10'])
  })
  it('a lease ending today still occupies the room today but not tomorrow', () => {
    const rooms = [makeRoom({ id: 'r1', name: 'Kamar 1' })]
    const leases = [makeLease({ room_id: 'r1', end_date: '2026-03-15' })]
    expect(vacantRooms(rooms, leases, '2026-03-15')).toEqual([])
    expect(vacantRooms(rooms, leases, '2026-03-16').map((r) => r.id)).toEqual(['r1'])
  })
})
