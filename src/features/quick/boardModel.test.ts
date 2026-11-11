import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { boardStatusText, buildBoard, countTones, leaseActionLink, shortTenantName } from './boardModel'

const TODAY = '2026-10-15'
const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const prop = (id: string, name: string): Property => ({ id, name, address: null, notes: null, payment_info: null, logo_path: null, ...ts })
const room = (id: string, name: string, over: Partial<Room> = {}): Room => ({
  id,
  property_id: 'p1',
  name,
  floor: null,
  price_daily: 130_000,
  price_weekly: null,
  price_monthly: 1_500_000,
  status: 'active',
  notes: null,
  ...ts,
  ...over,
})
const lease = (id: string, roomId: string, over: Partial<Lease>): Lease => ({
  id,
  property_id: 'p1',
  room_id: roomId,
  tenant_id: 't1',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'active',
  checkout_date: null,
  notes: null,
  ...ts,
  ...over,
})
const invoice = (id: string, leaseId: string, start: string, end: string, total: number, status: Invoice['status']): Invoice => ({
  id,
  property_id: 'p1',
  lease_id: leaseId,
  invoice_number: `INV-${id}`,
  period_type: null,
  period_start: start,
  period_end: end,
  quantity: 1,
  base_amount: total,
  addons_amount: 0,
  extra_amount: 0,
  discount_amount: 0,
  total_amount: total,
  due_date: start,
  status,
  notes: null,
  ...ts,
})
const payment = (id: string, inv: Invoice): Payment => ({
  id,
  property_id: 'p1',
  invoice_id: inv.id,
  lease_id: inv.lease_id,
  amount: inv.total_amount,
  paid_at: inv.period_start,
  method: 'cash',
  kind: 'rent',
  notes: null,
  created_by: null,
  org_id: 'org',
  created_at: ts.created_at,
})
const tenant: Tenant = {
  id: 't1',
  property_id: 'p1',
  full_name: 'Budi',
  nik: null,
  id_type: 'ktp',
  id_number: null,
  nationality: null,
  phone: null,
  gender: null,
  birth_place: null,
  birth_date: null,
  address: null,
  religion: null,
  marital_status: null,
  occupation: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  ktp_image_path: null,
  notes: null,
  ...ts,
}

describe('Papan kamar (SPEC 7.4)', () => {
  const rooms = [
    room('rA10', 'A10'),
    room('rA2', 'A2'),
    room('rA1', 'A1'),
    room('rB1', 'B1', { status: 'maintenance' }),
    room('rC1', 'C1'),
    room('rD1', 'D1'),
    room('rD3', 'D3'),
    room('rD4', 'D4'),
    room('rD5', 'D5'),
    room('rD6', 'D6'),
    room('rX1', 'X1', { property_id: 'p2' }),
  ]
  const okInv = invoice('ok', 'lA2', '2026-10-01', '2026-10-31', 1_500_000, 'paid')
  const endingInv = invoice('end', 'lA10', '2026-10-10', '2026-10-16', 910_000, 'paid')
  const overdueInv = invoice('late', 'lD1', '2026-09-01', '2026-09-30', 1_500_000, 'unpaid')
  const dueInv = invoice('due', 'lD4', '2026-10-15', '2026-11-14', 1_500_000, 'unpaid')
  const lateInv = invoice('late1', 'lD5', '2026-10-14', '2026-11-13', 1_500_000, 'unpaid')
  const paidD6 = invoice('d6', 'lD6', '2026-09-23', '2026-10-22', 1_500_000, 'paid')
  const leases = [
    lease('lA2', 'rA2', {}),
    // a daily guest whose last paid night is 16 Okt: check-out 17 Okt, within the week
    lease('lA10', 'rA10', { period_type: 'daily', price_per_period: 130_000, start_date: '2026-10-10', end_date: '2026-10-16' }),
    lease('lC1', 'rC1', { start_date: '2026-10-20', end_date: '2026-11-19' }),
    lease('lD1', 'rD1', { start_date: '2026-09-01', end_date: '2026-09-30' }),
    lease('lD3', 'rD3', { start_date: '2026-10-10', end_date: '2026-11-09' }),
    lease('lD4', 'rD4', { start_date: '2026-10-15', end_date: '2026-11-14' }),
    lease('lD5', 'rD5', { start_date: '2026-10-14', end_date: '2026-11-13' }),
    lease('lD6', 'rD6', { start_date: '2026-09-23', end_date: '2026-10-22' }),
  ]
  const invoices = [okInv, endingInv, overdueInv, dueInv, lateInv, paidD6]
  const payments = [payment('pay-ok', okInv), payment('pay-end', endingInv), payment('pay-d6', paidD6)]
  const tenants = new Map([['t1', tenant]])
  const properties = [prop('p1', 'Kos Melati'), prop('p2', 'Kos Anggrek'), prop('p3', 'Kos Kosong')]

  const board = buildBoard(properties, ['p1', 'p3'], rooms, leases, tenants, invoices, payments, TODAY)

  it('colours each room by what needs doing: red from the first day past due, orange with the days left within a week', () => {
    const shown = Object.fromEntries(board[0].tiles.map((t) => [t.room.name, `${t.tone}:${t.caption}`]))
    expect(shown).toEqual({
      A1: 'vacant:Kosong',
      // next due 1 Nov: 17 days away
      A2: 'occupied:Terisi',
      // paid up to the night of 16 Okt: next due (check-out) 17 Okt, 2 days left — not "leaving"
      A10: 'soon:2 hari',
      B1: 'maintenance:Perbaikan',
      C1: 'reserved:Dipesan',
      D1: 'overdue:Telat',
      // no invoice yet since 10 Okt: due from the start
      D3: 'overdue:Telat',
      D4: 'today:Hari ini',
      // 1 day past due: the lease list still says "tenggang", the board is already red
      D5: 'overdue:Telat',
      // paid to 22 Okt: next due 23 Okt, 8 days away
      D6: 'occupied:Terisi',
    })
    expect(board[0].tiles.find((t) => t.room.name === 'A10')?.days).toBe(2)
    expect(board[0].tiles.find((t) => t.room.name === 'D5')?.days).toBe(-1)
  })

  it('keeps the chosen kos only, sorts rooms naturally and skips a kos without rooms', () => {
    expect(board.map((g) => g.property.id)).toEqual(['p1'])
    expect(board[0].tiles.map((t) => t.room.name)).toEqual(['A1', 'A2', 'A10', 'B1', 'C1', 'D1', 'D3', 'D4', 'D5', 'D6'])
  })

  it('carries the lease, tenant and billing of occupied rooms only', () => {
    const a10 = board[0].tiles.find((t) => t.room.name === 'A10')!
    expect(a10.lease?.id).toBe('lA10')
    expect(a10.tenant?.full_name).toBe('Budi')
    expect(a10.summary?.outstanding).toBe(0)
    const c1 = board[0].tiles.find((t) => t.room.name === 'C1')!
    expect(c1.lease?.id).toBe('lC1')
    expect(c1.summary).toBeNull()
    const a1 = board[0].tiles.find((t) => t.room.name === 'A1')!
    expect(a1.lease).toBeNull()
  })

  // SPEC 7.20: a room booked for later shows when, and how many nights it can still be let
  it('a reserved tile carries the booking day and the nights free before it; other tiles carry none', () => {
    const c1 = board[0].tiles.find((t) => t.room.name === 'C1')!
    // booked from 20 Okt, today 15 Okt: 5 nights, check-out 20 Okt
    expect(c1.bookedFrom).toBe('20 Okt')
    expect(c1.freeUntil).toBe('2026-10-20')
    expect(c1.freeNights).toBe(5)
    for (const name of ['A1', 'A2', 'A10', 'B1', 'D1']) {
      const t = board[0].tiles.find((x) => x.room.name === name)!
      expect([t.bookedFrom, t.freeUntil, t.freeNights], name).toEqual([null, null, null])
    }
  })

  it('a booking checked out ahead of time that still holds nights shortens the free nights', () => {
    const early = lease('lC1x', 'rC1', { period_type: 'daily', start_date: '2026-10-17', end_date: '2026-10-17', status: 'ended', checkout_date: '2026-10-18' })
    const withEarly = buildBoard(properties, ['p1'], rooms, [...leases, early], tenants, invoices, payments, TODAY)
    const c1 = withEarly[0].tiles.find((t) => t.room.name === 'C1')!
    expect([c1.tone, c1.bookedFrom, c1.freeUntil, c1.freeNights]).toEqual(['reserved', '20 Okt', '2026-10-17', 2])
  })

  it('names the tenant on the tile; an empty room has no name', () => {
    expect(board[0].tiles.find((t) => t.room.name === 'A10')!.name).toBe('Budi')
    expect(board[0].tiles.find((t) => t.room.name === 'A1')!.name).toBeNull()
  })

  it('counts tiles per colour for the legend', () => {
    expect(countTones(board)).toEqual({ overdue: 3, today: 1, soon: 1, occupied: 2, vacant: 1, reserved: 1, maintenance: 1 })
    expect(countTones([])).toEqual({ overdue: 0, today: 0, soon: 0, occupied: 0, vacant: 0, reserved: 0, maintenance: 0 })
  })

  it('tells the room sheet when rent is due', () => {
    const at = (name: string) => board[0].tiles.find((t) => t.room.name === name)!.summary
    expect(boardStatusText(at('D5'), TODAY)).toBe('Telat 1 hari · jatuh tempo 14 Okt')
    expect(boardStatusText(at('D4'), TODAY)).toBe('Jatuh tempo hari ini · 15 Okt')
    expect(boardStatusText(at('A10'), TODAY)).toBe('Jatuh tempo 17 Okt · 2 hari lagi')
    expect(boardStatusText(null, TODAY)).toBeNull()
  })

  it('links into the lease page that opens the existing dialog', () => {
    expect(leaseActionLink('l1', 'checkout')).toBe('/sewa/l1?action=checkout')
    expect(leaseActionLink('l1', 'bayar')).toBe('/sewa/l1?action=bayar')
    expect(leaseActionLink('l1', 'tagih')).toBe('/sewa/l1?action=tagih')
  })
})

describe('shortTenantName (the name on a board tile)', () => {
  it('shows the first name', () => {
    expect(shortTenantName('Budi Santoso')).toBe('Budi')
    expect(shortTenantName('  Ica  ')).toBe('Ica')
    expect(shortTenantName('Erikafloren Maria Putri')).toBe('Erikafloren')
  })

  it('skips titles typed in front of the name, in any case and with or without a dot', () => {
    expect(shortTenantName('Pak Budi Santoso')).toBe('Budi')
    expect(shortTenantName('Kak Rina')).toBe('Rina')
    expect(shortTenantName('Bang Togar')).toBe('Togar')
    expect(shortTenantName('bu siti')).toBe('siti')
    expect(shortTenantName('Ibu Hj. Sri Wahyuni')).toBe('Sri')
    expect(shortTenantName('Mbak Ayu')).toBe('Ayu')
  })

  it('keeps two words when the first is an initial or a two-letter name', () => {
    expect(shortTenantName('M. Rizki Pratama')).toBe('M. Rizki')
    expect(shortTenantName('Ho Wei Lun')).toBe('Ho Wei')
    expect(shortTenantName('Pak M. Yusuf')).toBe('M. Yusuf')
  })

  it('never ends up empty: a lone title or a lone short word stays as typed', () => {
    expect(shortTenantName('Pak')).toBe('Pak')
    expect(shortTenantName('Ho')).toBe('Ho')
    expect(shortTenantName('Kak Bu')).toBe('Bu')
    expect(shortTenantName('')).toBe('')
  })
})

// SPEC 7.25, the owner's A10 on 11 Nov 2026: the daily guest of the 10th has no check-out recorded, the weekly booking starts today
describe('a booking whose stay has begun while the guest before has no check-out recorded', () => {
  const DAY = '2026-11-11'
  const before = lease('l-before', 'r1', { tenant_id: 'ta', period_type: 'daily', start_date: '2026-11-10', end_date: '2026-11-10' })
  const booked = lease('l-booked', 'r1', { tenant_id: 'tb', period_type: 'weekly', start_date: '2026-11-11', end_date: '2026-11-17' })
  const people = new Map<string, Tenant>([
    ['ta', { id: 'ta', full_name: 'Ersitha' } as Tenant],
    ['tb', { id: 'tb', full_name: 'Syahril' } as Tenant],
  ])

  it('keeps the earlier guest as the occupant and names the booked guest as waiting, whatever the order of the leases', () => {
    for (const list of [[before, booked], [booked, before]]) {
      const [tile] = buildBoard([prop('p1', 'Kos')], ['p1'], [room('r1', 'A10')], list, people, [], [], DAY)[0].tiles
      expect(tile.lease?.id).toBe('l-before')
      expect(tile.tenant?.full_name).toBe('Ersitha')
      expect(tile.tone).not.toBe('reserved')
      expect(tile.upcoming?.lease.id).toBe('l-booked')
      expect(tile.upcoming?.tenant?.full_name).toBe('Syahril')
      expect(tile.upcoming?.waiting).toBe(true)
    }
  })

  it('the day before, the same booking is an ordinary next booking', () => {
    const [tile] = buildBoard([prop('p1', 'Kos')], ['p1'], [room('r1', 'A10')], [booked, before], people, [], [], '2026-11-10')[0].tiles
    expect([tile.lease?.id, tile.upcoming?.lease.id, tile.upcoming?.waiting]).toEqual(['l-before', 'l-booked', false])
  })

  it('once the earlier guest is checked out, the booked guest is the occupant and nothing is waiting', () => {
    const out = { ...before, status: 'ended' as const, checkout_date: '2026-11-11' }
    const [tile] = buildBoard([prop('p1', 'Kos')], ['p1'], [room('r1', 'A10')], [out, booked], people, [], [], DAY)[0].tiles
    expect([tile.lease?.id, tile.upcoming]).toEqual(['l-booked', null])
  })
})

