import { describe, expect, it } from 'vitest'
import type { Lease, PeriodType, Room, Tenant } from '../../types/db'
import {
  availabilityStrip,
  dayRange,
  findAvailability,
  holdText,
  leaseHold,
  plannedStay,
  rateText,
  roomHolds,
  shortStay,
  stayConflict,
  stripText,
  type AvailabilityInput,
} from './availability'

const TODAY = '2026-11-01'
const ts = { org_id: 'org-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function room(id: string, prices: { d?: number | null; w?: number | null; m?: number | null } = {}, extra: Partial<Room> = {}): Room {
  return {
    id,
    property_id: 'P1',
    name: id,
    floor: null,
    price_daily: prices.d === undefined ? 100_000 : prices.d,
    price_weekly: prices.w === undefined ? 600_000 : prices.w,
    price_monthly: prices.m === undefined ? 1_500_000 : prices.m,
    status: 'active',
    notes: null,
    ...ts,
    ...extra,
  }
}

let seq = 0
function lease(roomId: string, tenantId: string, type: PeriodType, start: string, end: string, extra: Partial<Lease> = {}): Lease {
  seq += 1
  return {
    id: `L${seq}`,
    property_id: 'P1',
    room_id: roomId,
    tenant_id: tenantId,
    period_type: type,
    price_per_period: 100_000,
    deposit_amount: 0,
    start_date: start,
    end_date: end,
    status: 'active',
    checkout_date: null,
    notes: null,
    ...ts,
    ...extra,
  }
}

const names = new Map<string, Pick<Tenant, 'full_name'>>(
  ['Budi', 'Citra', 'Sari', 'Dodi', 'Eka', 'Fajar', 'Gita', 'Hana', 'Indra'].map((n) => [n, { full_name: n }]),
)

const daily = (start: string, quantity: number, maxPrice?: number | null) => ({ periodType: 'daily' as const, start, quantity, maxPrice })

describe('plannedStay', () => {
  it('daily, weekly and monthly spans: the last night is stored, the check-out day is the day after', () => {
    expect(plannedStay('2026-11-05', 'daily', 2)).toEqual({ start: '2026-11-05', end: '2026-11-06', checkout: '2026-11-07', nights: 2, periodType: 'daily', quantity: 2 })
    expect(plannedStay('2026-11-05', 'weekly', 2)).toMatchObject({ end: '2026-11-18', checkout: '2026-11-19', nights: 14 })
    expect(plannedStay('2026-11-05', 'monthly', 1)).toMatchObject({ end: '2026-12-04', checkout: '2026-12-05', nights: 30 })
  })

  it('month ends follow the billing grid (31 Jan + 1 month = 28 Feb; leap years)', () => {
    expect(plannedStay('2027-01-31', 'monthly', 1)).toMatchObject({ end: '2027-02-27', checkout: '2027-02-28', nights: 28 })
    expect(plannedStay('2028-01-31', 'monthly', 1)).toMatchObject({ end: '2028-02-28', checkout: '2028-02-29', nights: 29 })
    expect(plannedStay('2026-10-31', 'monthly', 2)).toMatchObject({ end: '2026-12-30', checkout: '2026-12-31' })
    expect(plannedStay('2026-12-30', 'daily', 3)).toMatchObject({ end: '2027-01-01', checkout: '2027-01-02', nights: 3 })
  })

  it('has no stay without a valid date or at least one period', () => {
    expect(plannedStay('', 'daily', 2)).toBeNull()
    expect(plannedStay('2026-02-30', 'daily', 2)).toBeNull()
    expect(plannedStay('2026-11-05', 'daily', 0)).toBeNull()
    expect(plannedStay('2026-11-05', 'weekly', 1.5)).toBeNull()
  })
})

describe('leaseHold: what holds a room', () => {
  it('a cancelled lease holds nothing', () => {
    expect(leaseHold(lease('R', 'Budi', 'daily', '2026-11-05', '2026-11-06', { status: 'cancelled' }), TODAY)).toBeNull()
  })

  it('an ended lease holds until the night before its checkout date, or its end date without one', () => {
    expect(leaseHold(lease('R', 'Dodi', 'monthly', '2026-10-01', '2026-10-31', { status: 'ended', checkout_date: '2026-11-05' }), TODAY)).toMatchObject({
      start: '2026-10-01',
      end: '2026-11-04',
      kind: 'occupied',
      expectedLeave: false,
    })
    expect(leaseHold(lease('R', 'Dodi', 'monthly', '2026-09-01', '2026-09-30', { status: 'ended' }), TODAY)).toMatchObject({ end: '2026-09-30' })
    // checked out on its first day: not a single night
    expect(leaseHold(lease('R', 'Dodi', 'daily', '2026-10-20', '2026-10-20', { status: 'ended', checkout_date: '2026-10-20' }), TODAY)).toBeNull()
  })

  it('a booking that has not started holds its nights ("Dipesan")', () => {
    expect(leaseHold(lease('R', 'Budi', 'monthly', '2026-11-07', '2026-12-06'), TODAY)).toMatchObject({ start: '2026-11-07', end: '2026-12-06', kind: 'reserved' })
  })

  it('a daily/weekly guest staying now is expected to leave on the check-out day', () => {
    expect(leaseHold(lease('R', 'Sari', 'weekly', '2026-10-29', '2026-11-04'), TODAY)).toMatchObject({ end: '2026-11-04', kind: 'occupied', expectedLeave: true })
    // on the check-out day itself the guest still leaves today
    expect(leaseHold(lease('R', 'Sari', 'daily', '2026-10-28', '2026-10-31'), TODAY)).toMatchObject({ end: '2026-10-31', expectedLeave: true })
  })

  it('a monthly tenant, or a guest past the check-out day without a checkout, holds the room until the checkout is recorded', () => {
    expect(leaseHold(lease('R', 'Eka', 'monthly', '2026-08-01', '2026-11-30'), TODAY)).toMatchObject({ end: null, kind: 'occupied' })
    expect(leaseHold(lease('R', 'Sari', 'daily', '2026-10-25', '2026-10-29'), TODAY)).toMatchObject({ end: null, expectedLeave: false })
  })
})

describe('findAvailability: daily, 2 nights from 5 Nov (check-out 7 Nov)', () => {
  const rooms = [
    room('A1'),
    room('A2'),
    room('A3', { d: 90_000 }),
    room('B1', { d: 120_000 }),
    room('B2', { d: 110_000 }),
    room('B3'),
    room('C1', {}, { status: 'maintenance' }),
    room('C2', { d: null }),
    room('C3'),
    room('C4'),
    room('Z9', {}, { property_id: 'P2' }),
  ]
  const leases = [
    lease('A2', 'Budi', 'daily', '2026-11-07', '2026-11-09'),
    lease('A3', 'Citra', 'daily', '2026-11-10', '2026-11-12'),
    lease('B1', 'Sari', 'weekly', '2026-10-29', '2026-11-04'),
    lease('B2', 'Dodi', 'monthly', '2026-10-01', '2026-10-31', { status: 'ended', checkout_date: '2026-11-05' }),
    lease('B3', 'Eka', 'monthly', '2026-08-01', '2026-10-31'),
    lease('C3', 'Fajar', 'daily', '2026-11-06', '2026-11-08'),
    lease('C4', 'Gita', 'daily', '2026-11-04', '2026-11-08', { status: 'cancelled' }),
  ]
  const input: AvailabilityInput = { rooms, leases, request: daily('2026-11-05', 2), today: TODAY, propertyIds: ['P1'], tenants: names }

  it('lists rooms free for every night, best fit first', () => {
    const result = findAvailability(input)!
    expect(result.stay).toMatchObject({ start: '2026-11-05', end: '2026-11-06', checkout: '2026-11-07' })
    // A2 fills the gap right before a booking, A3 leaves 3 nights; then the rooms with nothing after the stay: guests
    // leaving on the check-in day (B2 cheaper than B1) before rooms idle since today (A1, C4 by name, C2 without a rate last)
    expect(result.free.map((f) => f.room.name)).toEqual(['A2', 'A3', 'B2', 'B1', 'A1', 'C4', 'C2'])
    expect(result.free.map((f) => [f.room.name, f.gapAfter, f.gapBefore])).toEqual([
      ['A2', 0, 4],
      ['A3', 3, 4],
      ['B2', null, 0],
      ['B1', null, 0],
      ['A1', null, 4],
      ['C4', null, 4],
      ['C2', null, 4],
    ])
  })

  it('gives each free room a one-line reason, a note about the guest before and the price of the stay', () => {
    const byName = new Map(findAvailability(input)!.free.map((f) => [f.room.name, f]))
    expect(byName.get('A2')).toMatchObject({ reason: 'Pas sebelum pesanan 7 Nov', note: null, rate: 100_000, total: 200_000 })
    expect(byName.get('A3')).toMatchObject({ reason: 'Sisa 3 malam sebelum pesanan 10 Nov', rate: 90_000, total: 180_000 })
    expect(byName.get('A1')).toMatchObject({ reason: 'Kosong sampai seterusnya', note: null })
    // check-out-day reuse: the room is free on the day the previous guest leaves
    expect(byName.get('B1')!.note).toBe('Sari masih menginap, jadwal check-out 5 Nov')
    expect(byName.get('B2')!.note).toBe('Langsung setelah Dodi check-out')
    expect(byName.get('B2')).toMatchObject({ total: 220_000 })
    expect(byName.get('C2')).toMatchObject({ rate: null, total: null })
  })

  it('"Hampir cocok" says exactly which nights are free and who comes next', () => {
    const result = findAvailability(input)!
    expect(result.partial).toEqual([{ room: rooms[8], rate: 100_000, total: 200_000, freeNights: 1, reason: 'Kosong 5–6 Nov, lalu dipesan Fajar' }])
  })

  it('a monthly tenant staying now and a room under maintenance are not offered; other kos are left out', () => {
    const result = findAvailability(input)!
    expect(result.taken).toEqual([
      { room: rooms[5], reason: 'Ditempati Eka sampai check-out dicatat' },
      { room: rooms[6], reason: 'Sedang perbaikan' },
    ])
    expect([...result.free, ...result.partial, ...result.taken].some((r) => r.room.name === 'Z9')).toBe(false)
    expect(findAvailability({ ...input, propertyIds: undefined })!.free.some((f) => f.room.name === 'Z9')).toBe(true)
  })

  it('a budget per night leaves out dearer rooms but keeps rooms without a rate', () => {
    const result = findAvailability({ ...input, request: daily('2026-11-05', 2, 100_000) })!
    expect(result.free.map((f) => f.room.name)).toEqual(['A2', 'A3', 'A1', 'C4', 'C2'])
    expect(result.overBudget).toBe(2)
  })

  it('one room only (Pesan tanggal lain): its state whatever it is', () => {
    expect(findAvailability({ ...input, roomId: 'B3' })).toMatchObject({ free: [], partial: [], taken: [{ reason: 'Ditempati Eka sampai check-out dicatat' }] })
    expect(findAvailability({ ...input, roomId: 'A2' })!.free.map((f) => f.room.name)).toEqual(['A2'])
  })

  it('names an unknown tenant "penyewa lain"', () => {
    expect(findAvailability({ ...input, tenants: undefined })!.partial[0].reason).toBe('Kosong 5–6 Nov, lalu dipesan penyewa lain')
  })

  it('returns null for a stay that cannot be computed', () => {
    expect(findAvailability({ ...input, request: daily('', 2) })).toBeNull()
  })
})

describe('findAvailability: future bookings, partial stays and longer periods', () => {
  it('a booking ending the night before the check-in day leaves the room free on its check-out day', () => {
    const rooms = [room('A1')]
    const leases = [lease('A1', 'Budi', 'daily', '2026-11-02', '2026-11-04')]
    const result = findAvailability({ rooms, leases, request: daily('2026-11-05', 1), today: TODAY, tenants: names })!
    expect(result.free).toHaveLength(1)
    expect(result.free[0]).toMatchObject({ gapBefore: 0, note: 'Langsung setelah Budi check-out' })
    // one night earlier collides
    expect(findAvailability({ rooms, leases, request: daily('2026-11-04', 1), today: TODAY, tenants: names })!.taken[0].reason).toBe('Dipesan Budi 2–5 Nov')
  })

  it('partial: a guest leaving mid-stay, then a booking', () => {
    const rooms = [room('A1'), room('A2')]
    const leases = [
      lease('A1', 'Gita', 'daily', '2026-10-30', '2026-11-06'),
      lease('A2', 'Gita', 'daily', '2026-10-30', '2026-11-06'),
      lease('A2', 'Hana', 'daily', '2026-11-09', '2026-11-12'),
    ]
    const result = findAvailability({ rooms, leases, request: daily('2026-11-05', 6), today: TODAY, tenants: names })!
    expect(result.free).toEqual([])
    expect(result.partial.map((p) => [p.room.name, p.freeNights, p.reason])).toEqual([
      ['A1', 4, 'Ditempati Gita sampai 7 Nov, lalu kosong 7–11 Nov'],
      ['A2', 2, 'Ditempati Gita sampai 7 Nov, lalu kosong 7–9 Nov, lalu dipesan Hana'],
    ])
  })

  it('partial: the longest free run is described; at most five rooms, most free nights first', () => {
    const rooms = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((n) => room(n))
    // room Pk is booked from the (k+1)th night of a 10-night stay from 5 Nov: k free nights
    const leases = rooms.map((r, k) => lease(r.id, 'Indra', 'daily', `2026-11-${String(6 + k).padStart(2, '0')}`, '2026-11-30'))
    const result = findAvailability({ rooms, leases, request: daily('2026-11-05', 10), today: TODAY, tenants: names })!
    expect(result.partial.map((p) => [p.room.name, p.freeNights])).toEqual([
      ['P7', 7],
      ['P6', 6],
      ['P5', 5],
      ['P4', 4],
      ['P3', 3],
    ])
    expect(result.partial[0].reason).toBe('Kosong 5–12 Nov, lalu dipesan Indra')
    expect(findAvailability({ rooms, leases, request: daily('2026-11-05', 10), today: TODAY, maxPartial: 2 })!.partial).toHaveLength(2)
    // two free runs: the longer one is named, every free night counts
    const split = findAvailability({
      rooms: [room('Q1')],
      leases: [lease('Q1', 'Budi', 'daily', '2026-11-06', '2026-11-06'), lease('Q1', 'Citra', 'daily', '2026-11-11', '2026-11-20')],
      request: daily('2026-11-05', 10),
      today: TODAY,
      tenants: names,
    })!
    expect(split.partial[0]).toMatchObject({ freeNights: 5, reason: 'Dipesan Budi 6–7 Nov, lalu kosong 7–11 Nov, lalu dipesan Citra' })
  })

  it('partial across a month end', () => {
    const rooms = [room('A1')]
    const leases = [lease('A1', 'Budi', 'daily', '2026-11-02', '2026-11-05')]
    const result = findAvailability({ rooms, leases, request: daily('2026-10-30', 5), today: '2026-10-20', tenants: names })!
    expect(result.partial[0].reason).toBe('Kosong 30 Okt – 2 Nov, lalu dipesan Budi')
  })

  it('weekly: the price is the weekly rate x weeks and the fit is measured on the week grid', () => {
    const rooms = [room('A1', { w: 650_000 }), room('A2', { w: null })]
    const leases = [lease('A1', 'Budi', 'monthly', '2026-11-19', '2026-12-18')]
    const result = findAvailability({ rooms, leases, request: { periodType: 'weekly', start: '2026-11-05', quantity: 2 }, today: TODAY })!
    expect(result.free.map((f) => [f.room.name, f.rate, f.total, f.reason])).toEqual([
      ['A1', 650_000, 1_300_000, 'Pas sebelum pesanan 19 Nov'],
      ['A2', null, null, 'Kosong sampai seterusnya'],
    ])
    expect(rateText(650_000, 'weekly')).toBe('Rp 650.000 / minggu')
    expect(rateText(null, 'weekly')).toBe('Harga belum diatur')
  })

  it('monthly from 31 Jan: check-out 28 Feb, so a booking from 28 Feb fits exactly', () => {
    const rooms = [room('A1', { m: 1_800_000 })]
    const leases = [lease('A1', 'Budi', 'daily', '2027-02-28', '2027-03-02')]
    const result = findAvailability({ rooms, leases, request: { periodType: 'monthly', start: '2027-01-31', quantity: 1 }, today: '2027-01-20' })!
    expect(result.free[0]).toMatchObject({ total: 1_800_000, gapAfter: 0, reason: 'Pas sebelum pesanan 28 Feb' })
    expect(findAvailability({ rooms, leases, request: { periodType: 'monthly', start: '2027-02-01', quantity: 1 }, today: '2027-01-20', tenants: names })!.partial[0].reason).toBe(
      'Kosong 1–28 Feb, lalu dipesan Budi',
    )
  })

  it('an ended lease without a checkout date holds through its end date', () => {
    const rooms = [room('A1')]
    const leases = [lease('A1', 'Dodi', 'daily', '2026-11-01', '2026-11-05', { status: 'ended' })]
    expect(findAvailability({ rooms, leases, request: daily('2026-11-05', 1), today: TODAY, tenants: names })!.taken[0].reason).toBe('Ditempati Dodi sampai 6 Nov')
    expect(findAvailability({ rooms, leases, request: daily('2026-11-06', 1), today: TODAY })!.free).toHaveLength(1)
  })

  it('the idle gap before the stay never counts nights in the past', () => {
    const rooms = [room('A1'), room('A2')]
    const leases = [lease('A2', 'Dodi', 'daily', '2026-10-01', '2026-10-05', { status: 'ended', checkout_date: '2026-10-06' })]
    const result = findAvailability({ rooms, leases, request: daily('2026-11-03', 1), today: TODAY })!
    expect(result.free.map((f) => [f.room.name, f.gapBefore])).toEqual([
      ['A1', 2],
      ['A2', 2],
    ])
  })
})

describe('stayConflict: the re-check right before a booking is written', () => {
  it('names the booking in the way', () => {
    const r = room('A3')
    const stay = plannedStay('2026-11-05', 'daily', 2)!
    const leases = [lease('A3', 'Budi', 'daily', '2026-11-06', '2026-11-08')]
    expect(stayConflict(r, leases, stay, TODAY, names)?.message).toBe('Kamar A3 sudah tidak kosong pada tanggal itu: dipesan Budi 6–9 Nov. Pilih kamar atau tanggal lain.')
    expect(stayConflict(r, [], stay, TODAY, names)).toBeNull()
    expect(stayConflict(r, [{ ...leases[0], status: 'cancelled' }], stay, TODAY, names)).toBeNull()
  })
})

describe('texts', () => {
  it('stays and day ranges', () => {
    expect(shortStay('2026-11-05', '2026-11-08')).toBe('5–9 Nov')
    expect(shortStay('2026-10-30', '2026-11-01')).toBe('30 Okt – 2 Nov')
    expect(shortStay('2026-10-30', '2026-10-30')).toBe('30–31 Okt')
    expect(dayRange('2026-11-13', '2026-11-13')).toBe('13 Nov')
    expect(dayRange('2026-11-05', '2026-11-08')).toBe('5–8 Nov')
    expect(dayRange('2026-10-30', '2026-11-02')).toBe('30 Okt – 2 Nov')
  })

  it('hold texts', () => {
    const holds = roomHolds(
      'A1',
      [lease('A1', 'Sari', 'daily', '2026-10-30', '2026-11-04'), lease('A1', 'Budi', 'daily', '2026-11-09', '2026-11-12'), lease('A2', 'Eka', 'monthly', '2026-01-01', '2026-01-31')],
      TODAY,
    )
    expect(holds.map((h) => holdText(h, names))).toEqual(['ditempati Sari sampai 5 Nov', 'dipesan Budi 9–13 Nov'])
  })
})

describe('availabilityStrip: 14 days from the check-in day', () => {
  const holds = roomHolds(
    'A1',
    [lease('A1', 'Sari', 'weekly', '2026-10-29', '2026-11-04'), lease('A1', 'Budi', 'daily', '2026-11-09', '2026-11-12'), lease('A1', 'Eka', 'daily', '2026-11-14', '2026-11-30', { status: 'cancelled' })],
    TODAY,
  )

  it('one cell per day: free, occupied, reserved, check-out day; the planned nights marked', () => {
    const stay = plannedStay('2026-11-05', 'daily', 2)!
    const cells = availabilityStrip(holds, '2026-11-03', stay)
    expect(cells).toHaveLength(14)
    expect(cells.map((c) => c.state)).toEqual([
      'occupied',
      'occupied',
      'checkout',
      'free',
      'free',
      'free',
      'reserved',
      'reserved',
      'reserved',
      'reserved',
      'checkout',
      'free',
      'free',
      'free',
    ])
    expect(cells.filter((c) => c.inStay).map((c) => c.date)).toEqual(['2026-11-05', '2026-11-06'])
    expect(availabilityStrip(holds, '2026-11-03').some((c) => c.inStay)).toBe(false)
  })

  it('has a text alternative', () => {
    expect(stripText(availabilityStrip(holds, '2026-11-03'))).toBe('3–4 Nov terisi; 5 Nov hari check-out; 6–8 Nov kosong; 9–12 Nov dipesan; 13 Nov hari check-out; 14–16 Nov kosong')
  })
})
