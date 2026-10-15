import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { boardStatusText, buildBoard, countTones, leaseActionLink } from './boardModel'

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
      D4: 'soon:Hari ini',
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

  it('counts tiles per colour for the legend', () => {
    expect(countTones(board)).toEqual({ overdue: 3, soon: 2, occupied: 2, vacant: 1, reserved: 1, maintenance: 1 })
    expect(countTones([])).toEqual({ overdue: 0, soon: 0, occupied: 0, vacant: 0, reserved: 0, maintenance: 0 })
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
