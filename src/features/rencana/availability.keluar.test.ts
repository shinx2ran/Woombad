import { describe, expect, it } from 'vitest'
import type { Lease, PeriodType, Room, Tenant } from '../../types/db'
import { availabilityStrip, findAvailability, leaseHold, plannedStay, roomHolds, stayConflict, stripText } from './availability'
import { maybeFreeText, waitlistMatches } from './waitlist'

// SPEC 7.8 Rencana keluar & "Bisa kosong". Fixed dates: today is Saturday 24 Okt 2026.
const TODAY = '2026-10-24'
const ts = { org_id: 'org-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function room(id: string, extra: Partial<Room> = {}): Room {
  return {
    id,
    property_id: 'P1',
    name: id,
    floor: null,
    price_daily: 100_000,
    price_weekly: 600_000,
    price_monthly: 1_500_000,
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
    price_per_period: 1_500_000,
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

const tenantNames = (ids: string[]) => new Map<string, Pick<Tenant, 'full_name'>>(ids.map((n) => [n, { full_name: n }]))
const oneNight = (start: string) => ({ periodType: 'daily' as const, start, quantity: 1 })

describe("the owner's case: 31 rooms all occupied, 1 night on 24 Des 2026", () => {
  // 28 monthly tenants: 26 paid through late Oct – Nov 2026 (two of them already lapsed: their check-out day has
  // passed and the next month is not billed), 2 paid through June 2027; 2 weekly guests and 1 daily guest staying now.
  const monthlyEnds = [
    '2026-10-21', '2026-10-22', '2026-10-25', '2026-10-27', '2026-10-29', '2026-10-29', '2026-10-30', '2026-10-31',
    '2026-11-01', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-08', '2026-11-09', '2026-11-11', '2026-11-12',
    '2026-11-14', '2026-11-15', '2026-11-17', '2026-11-18', '2026-11-20', '2026-11-22', '2026-11-24', '2026-11-26',
    '2026-11-28', '2026-11-29',
  ]
  const monthlyRooms = monthlyEnds.map((_, i) => room(`M${i + 1}`))
  const longRooms = [room('Y1'), room('Y2')]
  const guestRooms = [room('W1'), room('W2'), room('H1')]
  const rooms = [...guestRooms, ...longRooms, ...monthlyRooms]
  const monthlyTenants = monthlyEnds.map((_, i) => `Bulanan${i + 1}`)
  const leases = [
    ...monthlyEnds.map((end, i) => lease(`M${i + 1}`, monthlyTenants[i], 'monthly', '2026-03-01', end)),
    lease('Y1', 'Panjang1', 'monthly', '2026-01-01', '2027-06-30'),
    lease('Y2', 'Panjang2', 'monthly', '2026-01-15', '2027-06-14'),
    lease('W1', 'Sari', 'weekly', '2026-10-16', '2026-10-29'),
    lease('W2', 'Tono', 'weekly', '2026-10-22', '2026-10-28'),
    lease('H1', 'Hendra', 'daily', '2026-10-22', '2026-10-26'),
  ]
  const names = tenantNames([...monthlyTenants, 'Panjang1', 'Panjang2', 'Sari', 'Tono', 'Hendra'])
  const result = findAvailability({ rooms, leases, request: oneNight('2026-12-24'), today: TODAY, tenants: names })!

  it('free: the daily and weekly rooms, each saying when it becomes empty, never "Kosong sampai seterusnya"', () => {
    // the ranking is unchanged (the fewest idle nights before the stay first)
    expect(result.free.map((f) => [f.room.name, f.reason, f.note])).toEqual([
      ['W1', 'Kosong mulai 30 Okt (setelah Sari check-out)', 'Sari masih menginap, jadwal check-out 30 Okt'],
      ['W2', 'Kosong mulai 29 Okt (setelah Tono check-out)', 'Tono masih menginap, jadwal check-out 29 Okt'],
      ['H1', 'Kosong mulai 27 Okt (setelah Hendra check-out)', 'Hendra masih menginap, jadwal check-out 27 Okt'],
    ])
    expect(result.free.every((f) => f.previous?.expectedLeave)).toBe(true)
  })

  it('"Bisa kosong": the 26 monthly rooms paid through before 24 Des, earliest paid-through first', () => {
    expect(result.maybeFree).toHaveLength(26)
    expect(result.maybeFree.map((m) => m.room.name)).toEqual(monthlyRooms.map((r) => r.name))
    expect(result.maybeFree.map((m) => m.paidThrough)).toEqual(monthlyEnds)
    expect(result.maybeFree[0]).toMatchObject({ lease: { tenant_id: 'Bulanan1' }, checkout: '2026-10-22', lapsedDays: 2, rate: 100_000, total: 100_000 })
    expect(result.maybeFree[1]).toMatchObject({ checkout: '2026-10-23', lapsedDays: 1 })
    // paid through 25 Okt: check-out 26 Okt, still ahead
    expect(result.maybeFree[2]).toMatchObject({ checkout: '2026-10-26', lapsedDays: null })
  })

  it('the two monthly tenants paid through June 2027 are offered nowhere', () => {
    const offered = [...result.free, ...result.maybeFree, ...result.partial].map((r) => r.room.name)
    expect(offered).not.toContain('Y1')
    expect(offered).not.toContain('Y2')
    expect(result.taken.filter((t) => t.room.name.startsWith('Y'))).toEqual([
      { room: longRooms[0], reason: 'Ditempati Panjang1 sampai check-out dicatat' },
      { room: longRooms[1], reason: 'Ditempati Panjang2 sampai check-out dicatat' },
    ])
  })

  it('a "Bisa kosong" room is still taken: listed under taken and refused by the booking re-check', () => {
    expect(result.taken).toHaveLength(28)
    expect(result.partial).toEqual([])
    expect(stayConflict(monthlyRooms[0], leases, result.stay, TODAY, names)?.message).toBe(
      'Kamar M1 sudah tidak kosong pada tanggal itu: ditempati Bulanan1 sampai check-out dicatat. Pilih kamar atau tanggal lain.',
    )
  })

  it('after his Rencana keluar is recorded on his check-out day the room is free, "<nama> akan keluar"', () => {
    const marked = leases.map((l) => (l.room_id === 'M5' ? { ...l, planned_checkout_date: '2026-10-30' } : l))
    const next = findAvailability({ rooms, leases: marked, request: oneNight('2026-12-24'), today: TODAY, tenants: names })!
    expect(next.maybeFree).toHaveLength(25)
    expect(next.maybeFree.some((m) => m.room.name === 'M5')).toBe(false)
    const m5 = next.free.find((f) => f.room.name === 'M5')!
    expect(m5).toMatchObject({ reason: 'Kosong mulai 30 Okt (Bulanan5 akan keluar)', note: 'Bulanan5 masih menginap, rencana keluar 30 Okt' })
    expect(stayConflict(monthlyRooms[4], marked, next.stay, TODAY, names)).toBeNull()
  })

  it('the daftar tunggu counts only the free rooms and hints at the rest', () => {
    const entry = {
      id: 'W', property_id: null, name: 'Tamu', phone: null, wanted_from: '2026-12-24', period_type: 'daily' as const, quantity: 1,
      max_price: null, room_note: null, notes: null, status: 'waiting' as const, lease_id: null, created_by: null, ...ts,
    }
    const match = waitlistMatches(entry, { rooms, leases, today: TODAY, propertyIds: ['P1'], tenants: names })
    expect(match.rooms.map((r) => r.room.name)).toEqual(['W1', 'W2', 'H1'])
    expect(match.maybeFree).toBe(26)
    expect(maybeFreeText(match)).toBe('+26 bisa kosong')
    expect(maybeFreeText({ maybeFree: 0 })).toBeNull()
  })
})

describe('leaseHold: a monthly tenant with a Rencana keluar (planned_checkout_date)', () => {
  it('holds the room through the night before his planned check-out day', () => {
    const l = lease('A1', 'Budi', 'monthly', '2026-06-01', '2026-11-30', { planned_checkout_date: '2026-12-01' })
    expect(leaseHold(l, TODAY)).toMatchObject({ start: '2026-06-01', end: '2026-11-30', kind: 'occupied', expectedLeave: true, plannedLeave: true })
    // leaving later than his billed period: still his nights until then
    expect(leaseHold({ ...l, planned_checkout_date: '2026-12-15' }, TODAY)).toMatchObject({ end: '2026-12-14', plannedLeave: true })
  })

  it('never less than his billed period: the database guard holds the room through end_date until the checkout', () => {
    const l = lease('A1', 'Budi', 'monthly', '2026-06-01', '2026-11-30', { planned_checkout_date: '2026-11-10' })
    expect(leaseHold(l, TODAY)).toMatchObject({ end: '2026-11-30', plannedLeave: true })
  })

  it('a planned day that passed without a recorded checkout rolls on (he is still in the room)', () => {
    const l = lease('A1', 'Budi', 'monthly', '2026-06-01', '2026-10-19', { planned_checkout_date: '2026-10-20' })
    expect(leaseHold(l, TODAY)).toMatchObject({ end: null, expectedLeave: false, plannedLeave: false })
    // his planned day is today: still expected to leave today
    expect(leaseHold({ ...l, planned_checkout_date: TODAY }, TODAY)).toMatchObject({ end: '2026-10-23', expectedLeave: true })
  })

  it('a monthly booking that has not started holds [start, planned check-out - 1]', () => {
    const l = lease('A1', 'Zaki', 'monthly', '2026-11-01', '2026-11-30', { planned_checkout_date: '2027-01-01' })
    expect(leaseHold(l, TODAY)).toMatchObject({ start: '2026-11-01', end: '2026-12-31', kind: 'reserved', expectedLeave: false, plannedLeave: true })
  })

  it('a plan on an ended lease or a daily/weekly stay changes nothing', () => {
    expect(leaseHold(lease('A1', 'Dodi', 'monthly', '2026-06-01', '2026-10-09', { status: 'ended', checkout_date: '2026-10-10', planned_checkout_date: '2026-11-01' }), TODAY)).toMatchObject({
      end: '2026-10-09',
      plannedLeave: false,
    })
    expect(leaseHold(lease('A1', 'Sari', 'weekly', '2026-10-20', '2026-10-26', { planned_checkout_date: '2026-11-15' }), TODAY)).toMatchObject({ end: '2026-10-26', plannedLeave: false })
  })
})

describe('findAvailability with a Rencana keluar', () => {
  const rooms = [room('A1'), room('A2')]
  const names = tenantNames(['Budi', 'Citra', 'Dodi'])
  const budi = lease('A1', 'Budi', 'monthly', '2026-06-01', '2026-11-30', { planned_checkout_date: '2026-12-01' })

  it('a planned check-out before the stay: free, "Kosong mulai 1 Des (Budi akan keluar)", amber note', () => {
    const r = findAvailability({ rooms: [rooms[0]], leases: [budi], request: oneNight('2026-12-10'), today: TODAY, tenants: names })!
    expect(r.free).toHaveLength(1)
    expect(r.free[0]).toMatchObject({ reason: 'Kosong mulai 1 Des (Budi akan keluar)', note: 'Budi masih menginap, rencana keluar 1 Des', gapBefore: 9 })
    expect(r.maybeFree).toEqual([])
  })

  it('the planned check-out day itself can be booked (check-out day reuse)', () => {
    const r = findAvailability({ rooms: [rooms[0]], leases: [budi], request: { periodType: 'weekly', start: '2026-12-01', quantity: 1 }, today: TODAY, tenants: names })!
    expect(r.free[0]).toMatchObject({ gapBefore: 0, reason: 'Kosong mulai 1 Des (Budi akan keluar)' })
    expect(stayConflict(rooms[0], [budi], plannedStay('2026-12-01', 'weekly', 1)!, TODAY, names)).toBeNull()
    // one night earlier is still his
    const earlier = findAvailability({ rooms: [rooms[0]], leases: [budi], request: oneNight('2026-11-30'), today: TODAY, tenants: names })!
    expect(earlier.free).toEqual([])
    expect(earlier.taken).toEqual([{ room: rooms[0], reason: 'Ditempati Budi sampai 1 Des' }])
    expect(earlier.maybeFree).toEqual([])
  })

  it('a planned check-out after the check-in day: "Hampir cocok" with the exact nights, never "Bisa kosong"', () => {
    const later = { ...budi, planned_checkout_date: '2026-12-03' }
    const r = findAvailability({ rooms: [rooms[0]], leases: [later], request: { periodType: 'daily', start: '2026-12-01', quantity: 5 }, today: TODAY, tenants: names })!
    expect(r.free).toEqual([])
    expect(r.maybeFree).toEqual([])
    expect(r.partial.map((p) => [p.freeNights, p.reason])).toEqual([[3, 'Ditempati Budi sampai 3 Des, lalu kosong 3–6 Des']])
  })

  it('a booking after the planned check-out is "Pas sebelum pesanan", and a planned day that passed is taken again', () => {
    const next = lease('A1', 'Citra', 'daily', '2026-12-05', '2026-12-06')
    const r = findAvailability({ rooms: [rooms[0]], leases: [budi, next], request: { periodType: 'daily', start: '2026-12-01', quantity: 4 }, today: TODAY, tenants: names })!
    expect(r.free[0]).toMatchObject({ gapAfter: 0, reason: 'Pas sebelum pesanan 5 Des', note: 'Budi masih menginap, rencana keluar 1 Des' })
    const lapsed = { ...budi, end_date: '2026-10-19', planned_checkout_date: '2026-10-20' }
    const t = findAvailability({ rooms: [rooms[0]], leases: [lapsed], request: oneNight('2026-12-10'), today: TODAY, tenants: names })!
    expect(t.free).toEqual([])
    // he has a plan, so he is not asked again: not "Bisa kosong"
    expect(t.maybeFree).toEqual([])
    expect(t.taken).toEqual([{ room: rooms[0], reason: 'Ditempati Budi sampai check-out dicatat' }])
  })

  it('a check-in today while his planned check-out day is today follows Check-in cepat: not until the checkout is recorded', () => {
    const today = { ...budi, end_date: '2026-10-23', planned_checkout_date: TODAY }
    const r = findAvailability({ rooms: [rooms[0]], leases: [today], request: oneNight(TODAY), today: TODAY, tenants: names })!
    expect(r.free).toEqual([])
    expect(r.taken).toEqual([{ room: rooms[0], reason: 'Ditempati Budi sampai check-out dicatat' }])
    expect(stayConflict(rooms[0], [today], plannedStay(TODAY, 'daily', 1)!, TODAY, names)?.message).toBe(
      'Kamar A1 masih ditempati Budi: check-out-nya belum dicatat. Catat check-out dulu, lalu coba lagi.',
    )
    expect(findAvailability({ rooms: [rooms[0]], leases: [today], request: oneNight('2026-10-25'), today: TODAY, tenants: names })!.free[0]).toMatchObject({
      reason: 'Kosong mulai 24 Okt (Budi akan keluar)',
    })
  })

  it('the 14-day strip shows his planned check-out day as "hari check-out"', () => {
    const cells = availabilityStrip(roomHolds('A1', [budi], TODAY), '2026-11-28')
    expect(stripText(cells)).toBe('28–30 Nov terisi; 1 Des hari check-out; 2–11 Des kosong')
  })
})

describe('"Bisa kosong": only a room that would be free for the whole stay', () => {
  const names = tenantNames(['Budi', 'Citra', 'Dodi', 'Zaki'])
  const budi = (roomId: string, end = '2026-11-30') => lease(roomId, 'Budi', 'monthly', '2026-06-01', end)

  it('his billed period must end before the check-in day (a stay on his check-out day counts)', () => {
    const rooms = [room('A1'), room('A2')]
    const leases = [budi('A1', '2026-11-30'), lease('A2', 'Dodi', 'monthly', '2026-06-01', '2026-12-01')]
    const r = findAvailability({ rooms, leases, request: oneNight('2026-12-01'), today: TODAY, tenants: names })!
    expect(r.maybeFree.map((m) => [m.room.name, m.checkout])).toEqual([['A1', '2026-12-01']])
  })

  it('not when another booking takes a night of the stay, nor above the budget; a room without a rate stays', () => {
    const rooms = [room('A1'), room('A2', { price_daily: 200_000 }), room('A3', { price_daily: null })]
    const leases = [budi('A1'), lease('A1', 'Citra', 'daily', '2026-12-10', '2026-12-11'), budi('A2'), budi('A3')]
    const r = findAvailability({ rooms, leases, request: { periodType: 'daily', start: '2026-12-10', quantity: 1, maxPrice: 150_000 }, today: TODAY, tenants: names })!
    expect(r.maybeFree.map((m) => [m.room.name, m.total])).toEqual([['A3', null]])
    // without a budget A2 is back; A1 is still blocked by Citra
    expect(findAvailability({ rooms, leases, request: oneNight('2026-12-10'), today: TODAY })!.maybeFree.map((m) => m.room.name)).toEqual(['A2', 'A3'])
  })

  it('a monthly booking whose first paid month ends before the stay may also not extend', () => {
    const zaki = lease('A1', 'Zaki', 'monthly', '2026-11-01', '2026-11-30')
    const r = findAvailability({ rooms: [room('A1')], leases: [zaki], request: oneNight('2026-12-10'), today: TODAY, tenants: names })!
    expect(r.taken).toEqual([{ room: r.maybeFree[0].room, reason: 'Dipesan Zaki mulai 1 Nov (bulanan)' }])
    expect(r.maybeFree[0]).toMatchObject({ paidThrough: '2026-11-30', checkout: '2026-12-01', lapsedDays: null })
  })

  it('sorted by paid-through, then room name; a guest past his check-out day is not "Bisa kosong"', () => {
    const rooms = [room('B2'), room('A10'), room('A2'), room('C1')]
    const leases = [budi('B2', '2026-11-10'), budi('A10', '2026-11-20'), budi('A2', '2026-11-20'), lease('C1', 'Dodi', 'daily', '2026-10-10', '2026-10-15')]
    const r = findAvailability({ rooms, leases, request: oneNight('2026-12-24'), today: TODAY, tenants: names })!
    expect(r.maybeFree.map((m) => m.room.name)).toEqual(['B2', 'A2', 'A10'])
    expect(r.taken.find((t) => t.room.name === 'C1')?.reason).toBe('Ditempati Dodi sampai check-out dicatat')
  })

  it('one room only (?kamar=): its "Bisa kosong" entry as well', () => {
    const r = findAvailability({ rooms: [room('A1'), room('A2')], leases: [budi('A1')], request: oneNight('2026-12-24'), today: TODAY, roomId: 'A1', tenants: names })!
    expect(r.maybeFree.map((m) => m.room.name)).toEqual(['A1'])
    expect(r.free).toEqual([])
  })
})

describe('free-room wording (SPEC 7.8 fix)', () => {
  it('a truly empty room, or one whose last guest left before today, keeps "Kosong sampai seterusnya"', () => {
    const rooms = [room('A1'), room('A2')]
    const leases = [lease('A2', 'Dodi', 'daily', '2026-10-01', '2026-10-05', { status: 'ended', checkout_date: '2026-10-06' })]
    const r = findAvailability({ rooms, leases, request: oneNight('2026-11-03'), today: TODAY })!
    expect(r.free.map((f) => [f.room.name, f.reason, f.note])).toEqual([
      ['A1', 'Kosong sampai seterusnya', null],
      ['A2', 'Kosong sampai seterusnya', null],
    ])
  })

  it('a booking ending before the stay: empty from its check-out day, after that guest', () => {
    const r = findAvailability({
      rooms: [room('A1')],
      leases: [lease('A1', 'Citra', 'daily', '2026-11-01', '2026-11-02')],
      request: oneNight('2026-11-03'),
      today: TODAY,
      tenants: tenantNames(['Citra']),
    })!
    expect(r.free[0]).toMatchObject({ reason: 'Kosong mulai 3 Nov (setelah Citra check-out)', note: 'Langsung setelah Citra check-out' })
  })
})
