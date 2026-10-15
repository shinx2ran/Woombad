import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { buildBoard, countTones, leaseActionLink } from './boardModel'

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
    room('rX1', 'X1', { property_id: 'p2' }),
  ]
  const okInv = invoice('ok', 'lA2', '2026-10-01', '2026-10-31', 1_500_000, 'paid')
  const endingInv = invoice('end', 'lA10', '2026-10-10', '2026-10-16', 910_000, 'paid')
  const overdueInv = invoice('late', 'lD1', '2026-09-01', '2026-09-30', 1_500_000, 'unpaid')
  const dueInv = invoice('due', 'lD4', '2026-10-15', '2026-11-14', 1_500_000, 'unpaid')
  const leases = [
    lease('lA2', 'rA2', {}),
    // a daily guest whose last paid night is 16 Okt: check-out 17 Okt, within the week
    lease('lA10', 'rA10', { period_type: 'daily', price_per_period: 130_000, start_date: '2026-10-10', end_date: '2026-10-16' }),
    lease('lC1', 'rC1', { start_date: '2026-10-20', end_date: '2026-11-19' }),
    lease('lD1', 'rD1', { start_date: '2026-09-01', end_date: '2026-09-30' }),
    lease('lD3', 'rD3', { start_date: '2026-10-10', end_date: '2026-11-09' }),
    lease('lD4', 'rD4', { start_date: '2026-10-15', end_date: '2026-11-14' }),
  ]
  const invoices = [okInv, endingInv, overdueInv, dueInv]
  const payments = [payment('pay-ok', okInv), payment('pay-end', endingInv)]
  const tenants = new Map([['t1', tenant]])
  const properties = [prop('p1', 'Kos Melati'), prop('p2', 'Kos Anggrek'), prop('p3', 'Kos Kosong')]

  const board = buildBoard(properties, ['p1', 'p3'], rooms, leases, tenants, invoices, payments, TODAY)
  const tones = Object.fromEntries(board[0].tiles.map((t) => [t.room.name, t.tone]))

  it('colours each room by what needs doing', () => {
    expect(tones).toEqual({
      A1: 'vacant',
      A2: 'occupied',
      A10: 'ending',
      B1: 'maintenance',
      C1: 'reserved',
      D1: 'overdue',
      // no invoice yet since 10 Okt: due from the start, past the grace days (as on the lease list)
      D3: 'overdue',
      D4: 'due',
    })
  })

  it('keeps the chosen kos only, sorts rooms naturally and skips a kos without rooms', () => {
    expect(board.map((g) => g.property.id)).toEqual(['p1'])
    expect(board[0].tiles.map((t) => t.room.name)).toEqual(['A1', 'A2', 'A10', 'B1', 'C1', 'D1', 'D3', 'D4'])
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
    expect(countTones(board)).toEqual({ overdue: 2, due: 1, ending: 1, occupied: 1, vacant: 1, reserved: 1, maintenance: 1 })
    expect(countTones([])).toEqual({ overdue: 0, due: 0, ending: 0, occupied: 0, vacant: 0, reserved: 0, maintenance: 0 })
  })

  it('links into the lease page that opens the existing dialog', () => {
    expect(leaseActionLink('l1', 'checkout')).toBe('/sewa/l1?action=checkout')
    expect(leaseActionLink('l1', 'bayar')).toBe('/sewa/l1?action=bayar')
    expect(leaseActionLink('l1', 'tagih')).toBe('/sewa/l1?action=tagih')
  })
})
