import { describe, expect, it } from 'vitest'
import type { Lease, Room } from '../types/db'
import {
  bucketEnd,
  expiringLeases,
  isLeaseActiveOn,
  isLeaseReservedOn,
  leaseOccupiedUntil,
  leaseOverlaps,
  occupancySeries,
  occupiedRoomIds,
  reservedRoomIds,
  roomOccupancy,
  roomOccupancyByProperty,
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
    notes: null,
    ...overrides,
  }
}

// ---------- tests ----------

describe('isLeaseActiveOn', () => {
  const lease = makeLease({ start_date: '2026-03-01', end_date: '2026-03-31' })
  it('active lease starts on start_date (inclusive) and has no upper bound', () => {
    expect(isLeaseActiveOn(lease, '2026-02-28')).toBe(false)
    expect(isLeaseActiveOn(lease, '2026-03-01')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-03-15')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-03-31')).toBe(true)
    // tenant still in the room after end_date until checkout is recorded
    expect(isLeaseActiveOn(lease, '2026-04-01')).toBe(true)
    expect(isLeaseActiveOn(lease, '2027-01-01')).toBe(true)
  })
  it('ended lease occupies start_date up to the day before checkout_date (checkout day is free)', () => {
    const ended = makeLease({ status: 'ended', start_date: '2026-03-01', end_date: '2026-03-31', checkout_date: '2026-03-20' })
    expect(isLeaseActiveOn(ended, '2026-02-28')).toBe(false)
    expect(isLeaseActiveOn(ended, '2026-03-01')).toBe(true)
    expect(isLeaseActiveOn(ended, '2026-03-19')).toBe(true)
    expect(isLeaseActiveOn(ended, '2026-03-20')).toBe(false)
    expect(isLeaseActiveOn(ended, '2026-03-31')).toBe(false)
  })
  it('ended lease without checkout_date falls back to end_date', () => {
    const ended = makeLease({ status: 'ended', start_date: '2026-03-01', end_date: '2026-03-31', checkout_date: null })
    expect(isLeaseActiveOn(ended, '2026-03-31')).toBe(true)
    expect(isLeaseActiveOn(ended, '2026-04-01')).toBe(false)
  })
  it('cancelled lease never occupies', () => {
    const cancelled = makeLease({ status: 'cancelled', start_date: '2026-03-01', end_date: '2026-03-31' })
    expect(isLeaseActiveOn(cancelled, '2026-03-01')).toBe(false)
    expect(isLeaseActiveOn(cancelled, '2026-03-15')).toBe(false)
  })
  it('accepts a timestamp and uses its date part', () => {
    expect(isLeaseActiveOn(lease, '2026-03-31T23:00:00Z')).toBe(true)
    expect(isLeaseActiveOn(lease, '2026-02-28T23:00:00Z')).toBe(false)
  })
  it('slices lease dates to 10 chars too (timestamps stored in date columns)', () => {
    const ts = makeLease({ start_date: '2026-03-01T00:00:00Z', end_date: '2026-03-31T00:00:00Z', status: 'ended', checkout_date: '2026-03-20T12:00:00Z' })
    expect(isLeaseActiveOn(ts, '2026-03-01')).toBe(true)
    expect(isLeaseActiveOn(ts, '2026-03-19')).toBe(true)
    expect(isLeaseActiveOn(ts, '2026-03-20')).toBe(false)
    expect(leaseOccupiedUntil(ts)).toBe('2026-03-19')
    expect(isLeaseReservedOn(makeLease({ start_date: '2026-04-01T00:00:00Z' }), '2026-03-31T23:59:59Z')).toBe(true)
  })
})

describe('leaseOverlaps', () => {
  const existing = [
    makeLease({ id: 'L1', room_id: 'r1', status: 'active', start_date: '2026-03-10', end_date: '2026-03-20' }),
    makeLease({ id: 'L2', room_id: 'r1', status: 'ended', start_date: '2026-01-01', end_date: '2026-02-28', checkout_date: '2026-02-10' }),
    makeLease({ id: 'L3', room_id: 'r1', status: 'cancelled', start_date: '2026-05-01', end_date: '2026-05-31' }),
    makeLease({ id: 'L4', room_id: 'r2', status: 'active', start_date: '2026-03-01', end_date: '2026-12-31' }),
  ]
  it('is edge-inclusive on both ends of the existing lease', () => {
    expect(leaseOverlaps(existing, 'r1', '2026-03-20', '2026-03-25')).toBe(true) // touches L1 end
    expect(leaseOverlaps(existing, 'r1', '2026-03-21', '2026-03-25')).toBe(false)
    expect(leaseOverlaps(existing, 'r1', '2026-03-01', '2026-03-10')).toBe(true) // touches L1 start
    expect(leaseOverlaps(existing, 'r1', '2026-03-01', '2026-03-09')).toBe(false)
    expect(leaseOverlaps(existing, 'r1', '2026-03-12', '2026-03-15')).toBe(true) // inside
    expect(leaseOverlaps(existing, 'r1', '2026-03-01', '2026-03-31')).toBe(true) // contains
  })
  it('an ended lease blocks only until the day before checkout_date, a cancelled lease never blocks', () => {
    expect(leaseOverlaps(existing, 'r1', '2026-02-09', '2026-02-12')).toBe(true) // last occupied night 02-09
    expect(leaseOverlaps(existing, 'r1', '2026-02-10', '2026-02-12')).toBe(false) // checkout day: room is free (same-day turnover)
    expect(leaseOverlaps(existing, 'r1', '2026-02-11', '2026-03-09')).toBe(false) // after checkout, before L1 (end_date 02-28 ignored)
    expect(leaseOverlaps(existing, 'r1', '2026-05-01', '2026-05-31')).toBe(false) // L3 cancelled
  })
  it('only looks at the given room and can exclude the lease being edited', () => {
    expect(leaseOverlaps(existing, 'r2', '2026-06-01', '2026-06-30')).toBe(true)
    expect(leaseOverlaps(existing, 'r3', '2026-03-10', '2026-03-20')).toBe(false)
    expect(leaseOverlaps(existing, 'r1', '2026-03-10', '2026-03-25', 'L1')).toBe(false)
    expect(leaseOverlaps([], 'r1', '2026-03-10', '2026-03-25')).toBe(false)
  })
  it('an active lease past end_date does not block beyond end_date (the overlap check uses the contract, not occupancy)', () => {
    expect(leaseOverlaps(existing, 'r1', '2026-04-01', '2026-04-30')).toBe(false)
  })
  it('compares on the date part of timestamps', () => {
    expect(leaseOverlaps(existing, 'r1', '2026-03-20T08:00:00Z', '2026-03-25T08:00:00Z')).toBe(true)
  })
})

describe('leaseOccupiedUntil', () => {
  it('is null for active, day before checkout_date (or end_date) for ended', () => {
    expect(leaseOccupiedUntil(makeLease({ status: 'active' }))).toBeNull()
    expect(leaseOccupiedUntil(makeLease({ status: 'ended', end_date: '2026-03-31', checkout_date: '2026-03-10' }))).toBe('2026-03-09')
    expect(leaseOccupiedUntil(makeLease({ status: 'ended', end_date: '2026-03-31', checkout_date: null }))).toBe('2026-03-31')
  })
})

describe('isLeaseReservedOn / reservedRoomIds', () => {
  it('only an active lease with a future start_date is reserved', () => {
    const future = makeLease({ room_id: 'r1', start_date: '2026-04-01', end_date: '2026-04-30' })
    expect(isLeaseReservedOn(future, '2026-03-31')).toBe(true)
    expect(isLeaseReservedOn(future, '2026-04-01')).toBe(false)
    expect(isLeaseReservedOn(makeLease({ ...future, status: 'ended' }), '2026-03-31')).toBe(false)
    expect(isLeaseReservedOn(makeLease({ ...future, status: 'cancelled' }), '2026-03-31')).toBe(false)
  })
  it('lists every room with a future-start active lease, even one that is occupied today (brief item 7)', () => {
    const leases = [
      // r1: current tenant until 2026-03-31, next tenant booked from 2026-04-01 -> occupied AND reserved on 2026-03-15
      makeLease({ room_id: 'r1', start_date: '2026-04-01', end_date: '2026-04-30' }),
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-03-01', end_date: '2026-03-31', checkout_date: '2026-03-31' }),
      makeLease({ room_id: 'r2', start_date: '2026-05-01', end_date: '2026-05-31' }),
      // r3: lease already started -> occupied, not reserved
      makeLease({ room_id: 'r3', start_date: '2026-03-01', end_date: '2026-03-31' }),
    ]
    expect([...reservedRoomIds(leases, '2026-03-15')]).toEqual(['r1', 'r2'])
    expect(reservedRoomIds(leases, '2026-03-15').has('r3')).toBe(false)
    // once the first lease has started, r1 is no longer reserved
    expect([...reservedRoomIds(leases, '2026-04-01')]).toEqual(['r2'])
    expect([...reservedRoomIds([], '2026-03-15')]).toEqual([])
  })
  it('roomOccupancy and vacantRooms still give occupied priority over reserved for the same room', () => {
    const rooms = [makeRoom({ id: 'r1', name: 'A1' })]
    const leases = [
      makeLease({ room_id: 'r1', start_date: '2026-04-01', end_date: '2026-04-30' }),
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-03-01', end_date: '2026-03-31', checkout_date: '2026-03-31' }),
    ]
    const snap = roomOccupancy(rooms, leases, '2026-03-15')
    expect(snap.occupied).toBe(1)
    expect(snap.reserved).toBe(0)
    expect(snap.available).toBe(0)
    expect(vacantRooms(rooms, leases, '2026-03-15')).toEqual([])
  })
})

describe('occupiedRoomIds', () => {
  it('empty leases gives empty set', () => {
    expect(occupiedRoomIds([], '2026-03-15').size).toBe(0)
  })
  it('collects room ids of leases occupying on the date only', () => {
    const leases = [
      makeLease({ room_id: 'r1' }),
      makeLease({ room_id: 'r2', status: 'ended', checkout_date: '2026-03-10' }), // checked out before the date
      makeLease({ room_id: 'r3', start_date: '2026-04-01', end_date: '2026-04-30' }), // reserved, not yet occupied
      makeLease({ room_id: 'r4', status: 'cancelled' }),
      makeLease({ room_id: 'r1', start_date: '2026-01-01', end_date: '2026-12-31' }), // duplicate room
    ]
    expect([...occupiedRoomIds(leases, '2026-03-15')]).toEqual(['r1'])
  })
  it('ended lease no longer occupies on its checkout day', () => {
    const leases = [makeLease({ room_id: 'r2', status: 'ended', checkout_date: '2026-03-15' })]
    expect([...occupiedRoomIds(leases, '2026-03-14')]).toEqual(['r2'])
    expect([...occupiedRoomIds(leases, '2026-03-15')]).toEqual([])
  })
})

describe('roomOccupancy', () => {
  it('empty rooms gives zeros and rate 0', () => {
    expect(roomOccupancy([], [], '2026-03-15')).toEqual({ total: 0, occupied: 0, reserved: 0, available: 0, maintenance: 0, rate: 0 })
  })
  it('counts occupied, reserved, available and maintenance rooms', () => {
    const rooms = [
      makeRoom({ id: 'r1' }),
      makeRoom({ id: 'r2' }),
      makeRoom({ id: 'r3' }),
      makeRoom({ id: 'r4', status: 'maintenance' }),
      makeRoom({ id: 'r5', status: 'maintenance' }),
      makeRoom({ id: 'r6' }),
    ]
    const leases = [
      makeLease({ room_id: 'r1' }),
      makeLease({ room_id: 'r2' }),
      makeLease({ room_id: 'r5' }), // maintenance room with a lease stays maintenance
      makeLease({ room_id: 'r3', status: 'ended', checkout_date: '2026-03-10' }),
      makeLease({ room_id: 'r6', start_date: '2026-04-01', end_date: '2026-04-30' }), // reserved
      makeLease({ room_id: 'r4', start_date: '2026-04-01', end_date: '2026-04-30' }), // reserved but maintenance: stays maintenance
      makeLease({ room_id: 'ghost' }), // room not in list is ignored
    ]
    const snap = roomOccupancy(rooms, leases, '2026-03-15')
    expect(snap).toEqual({ total: 6, occupied: 2, reserved: 1, available: 1, maintenance: 2, rate: 2 / 4 })
    expect(snap.total - snap.maintenance - snap.occupied - snap.reserved).toBe(snap.available)
  })
  it('a room occupied today with a future lease is occupied, not reserved', () => {
    const rooms = [makeRoom({ id: 'r1' })]
    const leases = [
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-03-01', end_date: '2026-03-31', checkout_date: '2026-03-31' }),
      makeLease({ room_id: 'r1', start_date: '2026-04-01', end_date: '2026-04-30' }),
    ]
    expect(roomOccupancy(rooms, leases, '2026-03-15')).toMatchObject({ occupied: 1, reserved: 0, available: 0 })
    expect(roomOccupancy(rooms, leases, '2026-04-01')).toMatchObject({ occupied: 1, reserved: 0, available: 0 })
  })
  it('historical occupancy counts ended leases and active leases past end_date (SPEC 2a hunian historis)', () => {
    const rooms = [makeRoom({ id: 'r1' }), makeRoom({ id: 'r2' })]
    const leases = [
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-01-01', end_date: '2026-06-30', checkout_date: '2026-06-30' }),
      // active lease whose end_date passed with no new invoice yet: the tenant is still in the room
      makeLease({ room_id: 'r2', status: 'active', start_date: '2026-09-01', end_date: '2026-09-30' }),
    ]
    // 2026-03-15: ended lease on r1 counted on a historical date; r2 lease not started yet -> reserved
    expect(roomOccupancy(rooms, leases, '2026-03-15')).toEqual({ total: 2, occupied: 1, reserved: 1, available: 0, maintenance: 0, rate: 0.5 })
    // today: r2 occupied past end_date, r1 checked out
    expect(roomOccupancy(rooms, leases, '2026-10-11')).toEqual({ total: 2, occupied: 1, reserved: 0, available: 1, maintenance: 0, rate: 0.5 })
    expect(roomOccupancy(rooms, leases, '2026-07-01')).toMatchObject({ occupied: 0, reserved: 1, available: 1 })
  })
  it('rate is 0 when every room is in maintenance', () => {
    const rooms = [makeRoom({ id: 'r1', status: 'maintenance' })]
    expect(roomOccupancy(rooms, [makeLease({ room_id: 'r1' })], '2026-03-15')).toEqual({
      total: 1,
      occupied: 0,
      reserved: 0,
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

describe('roomOccupancyByProperty', () => {
  it('empty rooms gives an empty map', () => {
    expect(roomOccupancyByProperty([], [], '2026-03-15').size).toBe(0)
  })
  it('one snapshot per property in first-seen order; leases of other properties do not leak', () => {
    const rooms = [
      makeRoom({ id: 'a1', property_id: 'kos-a' }),
      makeRoom({ id: 'b1', property_id: 'kos-b' }),
      makeRoom({ id: 'a2', property_id: 'kos-a' }),
      makeRoom({ id: 'b2', property_id: 'kos-b', status: 'maintenance' }),
      makeRoom({ id: 'b3', property_id: 'kos-b' }),
    ]
    const leases = [
      makeLease({ room_id: 'a1', property_id: 'kos-a' }),
      makeLease({ room_id: 'b3', property_id: 'kos-b', start_date: '2026-05-01', end_date: '2026-05-31' }), // reserved
    ]
    const byProp = roomOccupancyByProperty(rooms, leases, '2026-03-15')
    expect([...byProp.keys()]).toEqual(['kos-a', 'kos-b'])
    expect(byProp.get('kos-a')).toEqual({ total: 2, occupied: 1, reserved: 0, available: 1, maintenance: 0, rate: 0.5 })
    expect(byProp.get('kos-b')).toEqual({ total: 3, occupied: 0, reserved: 1, available: 1, maintenance: 1, rate: 0 })
    expect(byProp.has('kos-c')).toBe(false)
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
      // moves out the day after the Feb sample day (still occupied on 2026-02-28)
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-01-10', end_date: '2026-02-28', checkout_date: '2026-03-01' }),
      makeLease({ room_id: 'r2', start_date: '2026-03-15', end_date: '2026-06-30' }),
    ]
    const series = occupancySeries(rooms, leases, { start: '2026-01-01', end: '2026-03-20' }, 'month')
    expect(series.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(series[0]).toEqual({ key: '2026-01', label: 'Jan 2026', rate: 0.5, occupied: 1, rentable: 2 })
    expect(series[1]).toEqual({ key: '2026-02', label: 'Feb 2026', rate: 0.5, occupied: 1, rentable: 2 })
    // March sampled at 2026-03-20 (range end), r2 active, r1 ended
    expect(series[2]).toEqual({ key: '2026-03', label: 'Mar 2026', rate: 0.5, occupied: 1, rentable: 2 })
  })

  it('daily series reflects a lease checked out mid-range', () => {
    const leases = [makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-03-01', end_date: '2026-03-02', checkout_date: '2026-03-02' })]
    const series = occupancySeries(rooms, leases, { start: '2026-03-01', end: '2026-03-03' }, 'day')
    expect(series.map((p) => [p.key, p.occupied])).toEqual([
      ['2026-03-01', 1],
      ['2026-03-02', 0], // checkout day: room already free
      ['2026-03-03', 0],
    ])
  })

  it('weekly series samples on Sunday (or range end)', () => {
    const leases = [makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-03-07', end_date: '2026-03-08', checkout_date: '2026-03-09' })]
    // 2026-W10 = Mon 2 Mar .. Sun 8 Mar (last night 8 Mar occupied); 2026-W11 starts Mon 9 Mar (checkout day)
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

  it('historical series counts ended leases through checkout and active leases past end_date (SPEC 2a hunian historis)', () => {
    const oneRoom = [makeRoom({ id: 'r1' })]
    const leases = [
      makeLease({ room_id: 'r1', status: 'ended', start_date: '2026-01-01', end_date: '2026-06-30', checkout_date: '2026-07-01' }),
    ]
    const series = occupancySeries(oneRoom, leases, { start: '2026-01-01', end: '2026-10-31' }, 'month')
    expect(series.map((p) => p.occupied)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
    expect(series.map((p) => p.rate)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0])

    // active lease past its end_date keeps the room occupied until checkout is recorded
    const overdue = [makeLease({ room_id: 'r1', status: 'active', start_date: '2026-09-01', end_date: '2026-09-30' })]
    const late = occupancySeries(oneRoom, overdue, { start: '2026-08-01', end: '2026-10-31' }, 'month')
    expect(late.map((p) => [p.key, p.occupied])).toEqual([
      ['2026-08', 0],
      ['2026-09', 1],
      ['2026-10', 1],
    ])
    expect(vacantRooms(oneRoom, overdue, '2026-10-11')).toEqual([])

    // cancelled never occupies
    const cancelled = [makeLease({ room_id: 'r1', status: 'cancelled', start_date: '2026-01-01', end_date: '2026-12-31' })]
    expect(occupancySeries(oneRoom, cancelled, { start: '2026-01-01', end: '2026-03-31' }, 'month').map((p) => p.occupied)).toEqual([0, 0, 0])
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
  it('lists active rooms without an occupant, sorted numerically by name', () => {
    const rooms = [
      makeRoom({ id: 'r10', name: 'A10' }),
      makeRoom({ id: 'r2', name: 'A2' }),
      makeRoom({ id: 'r1', name: 'A1' }),
      makeRoom({ id: 'r3', name: 'A3' }),
      makeRoom({ id: 'r4', name: 'A4' }),
      makeRoom({ id: 'm', name: 'A0', status: 'maintenance' }),
    ]
    const leases = [
      makeLease({ room_id: 'r3' }),
      makeLease({ room_id: 'r1', status: 'ended', checkout_date: '2026-03-10' }),
      makeLease({ room_id: 'r4', status: 'cancelled' }),
      makeLease({ room_id: 'r2', status: 'ended', start_date: '2026-01-01', end_date: '2026-01-31', checkout_date: null }),
    ]
    expect(vacantRooms(rooms, leases, '2026-03-15').map((r) => r.name)).toEqual(['A1', 'A2', 'A4', 'A10'])
  })
  it('a room booked by a future-start active lease is Dipesan, not vacant', () => {
    const rooms = [makeRoom({ id: 'r1', name: 'A1' }), makeRoom({ id: 'r2', name: 'A2' })]
    const leases = [makeLease({ room_id: 'r2', start_date: '2026-04-01', end_date: '2026-04-30' })]
    expect(vacantRooms(rooms, leases, '2026-03-15').map((r) => r.id)).toEqual(['r1'])
    expect([...reservedRoomIds(leases, '2026-03-15')]).toEqual(['r2'])
    // the snapshot reports it as reserved, not available
    expect(roomOccupancy(rooms, leases, '2026-03-15')).toMatchObject({ occupied: 0, reserved: 1, available: 1 })
    // once the lease starts the room is occupied
    expect(vacantRooms(rooms, leases, '2026-04-01').map((r) => r.id)).toEqual(['r1'])
    expect(roomOccupancy(rooms, leases, '2026-04-01')).toMatchObject({ occupied: 1, reserved: 0, available: 1 })
    // the day before the start it is still reserved; a cancelled future lease does not reserve
    expect(vacantRooms(rooms, leases, '2026-03-31').map((r) => r.id)).toEqual(['r1'])
    const cancelled = [makeLease({ room_id: 'r2', status: 'cancelled', start_date: '2026-04-01', end_date: '2026-04-30' })]
    expect(vacantRooms(rooms, cancelled, '2026-03-15').map((r) => r.id)).toEqual(['r1', 'r2'])
  })
  it('a lease checked out today frees the room today (same-day turnover), yesterday it was occupied', () => {
    const rooms = [makeRoom({ id: 'r1', name: 'Kamar 1' })]
    const leases = [makeLease({ room_id: 'r1', status: 'ended', end_date: '2026-03-15', checkout_date: '2026-03-15' })]
    expect(vacantRooms(rooms, leases, '2026-03-14')).toEqual([])
    expect(vacantRooms(rooms, leases, '2026-03-15').map((r) => r.id)).toEqual(['r1'])
  })
  it('an active lease whose end_date is today keeps the room occupied tomorrow (no checkout yet)', () => {
    const rooms = [makeRoom({ id: 'r1', name: 'Kamar 1' })]
    const leases = [makeLease({ room_id: 'r1', end_date: '2026-03-15' })]
    expect(vacantRooms(rooms, leases, '2026-03-15')).toEqual([])
    expect(vacantRooms(rooms, leases, '2026-03-16')).toEqual([])
  })
})
