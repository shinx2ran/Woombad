import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Property, Room } from '../../types/db'
import { boardLeavingOn, buildBoard } from './boardModel'

// SPEC 7.8: a tile whose tenant said he leaves reads 'Keluar 24 Nov'. Today: 24 Okt 2026.
const TODAY = '2026-10-24'
const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const prop: Property = { id: 'p1', name: 'Kos Melati', address: null, notes: null, payment_info: null, logo_path: null, ...ts }
const room = (id: string): Room => ({ id, property_id: 'p1', name: id, floor: null, price_daily: 100_000, price_weekly: null, price_monthly: 1_500_000, status: 'active', notes: null, ...ts })
const lease = (id: string, roomId: string, end: string, planned: string | null): Lease => ({
  id,
  property_id: 'p1',
  room_id: roomId,
  tenant_id: 't1',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date: '2026-06-01',
  end_date: end,
  status: 'active',
  checkout_date: null,
  planned_checkout_date: planned,
  notes: null,
  ...ts,
})
const paidInvoice = (id: string, leaseId: string, start: string, end: string): Invoice => ({
  id,
  property_id: 'p1',
  lease_id: leaseId,
  invoice_number: `INV-${id}`,
  period_type: null,
  period_start: start,
  period_end: end,
  quantity: 1,
  base_amount: 1_500_000,
  addons_amount: 0,
  extra_amount: 0,
  discount_amount: 0,
  total_amount: 1_500_000,
  due_date: start,
  status: 'paid',
  notes: null,
  ...ts,
})
const paid = (inv: Invoice): Payment => ({ id: `pay-${inv.id}`, property_id: 'p1', invoice_id: inv.id, lease_id: inv.lease_id, amount: inv.total_amount, paid_at: inv.period_start, method: 'cash', kind: 'rent', notes: null, created_by: null, org_id: 'org', created_at: ts.created_at })

describe('room board with a Rencana keluar', () => {
  // A1 paid to 30 Nov, leaving 1 Des; A2 paid to 28 Okt (due in 4 days), leaving that day; A3 the same but leaving in
  // December (still has to pay); A4 paid to 30 Nov without a plan; A5 planned 20 Okt, passed without a checkout
  const leases = [
    lease('l1', 'A1', '2026-11-30', '2026-12-01'),
    lease('l2', 'A2', '2026-10-27', '2026-10-28'),
    lease('l3', 'A3', '2026-10-27', '2026-12-15'),
    lease('l4', 'A4', '2026-11-30', null),
    lease('l5', 'A5', '2026-11-30', '2026-10-20'),
  ]
  const invoices = [
    paidInvoice('i1', 'l1', '2026-11-01', '2026-11-30'),
    paidInvoice('i2', 'l2', '2026-09-28', '2026-10-27'),
    paidInvoice('i3', 'l3', '2026-09-28', '2026-10-27'),
    paidInvoice('i4', 'l4', '2026-11-01', '2026-11-30'),
    paidInvoice('i5', 'l5', '2026-11-01', '2026-11-30'),
  ]
  const payments = invoices.map(paid)
  const board = buildBoard([prop], ['p1'], ['A1', 'A2', 'A3', 'A4', 'A5'].map(room), leases, new Map(), invoices, payments, TODAY)
  const tiles = Object.fromEntries(board[0].tiles.map((t) => [t.room.name, t]))

  it("shows 'Keluar <tgl>' instead of Terisi, and instead of the days left when he leaves by that due date", () => {
    expect([tiles.A1.tone, tiles.A1.caption, tiles.A1.leavingOn, tiles.A1.plannedCheckout]).toEqual(['occupied', 'Terisi', '1 Des', '2026-12-01'])
    expect([tiles.A2.tone, tiles.A2.caption, tiles.A2.leavingOn]).toEqual(['soon', '4 hari', '28 Okt'])
  })

  it('keeps the due warning when he still has nights to pay, and nothing changes without a plan or once it passed', () => {
    expect([tiles.A3.tone, tiles.A3.leavingOn, tiles.A3.plannedCheckout]).toEqual(['soon', null, '2026-12-15'])
    expect([tiles.A4.leavingOn, tiles.A4.plannedCheckout]).toEqual([null, null])
    expect([tiles.A5.leavingOn, tiles.A5.plannedCheckout]).toEqual([null, '2026-10-20'])
  })

  it('a past-due or due-today tile keeps its warning', () => {
    expect(boardLeavingOn('overdue', '2026-11-01', null, TODAY)).toBeNull()
    expect(boardLeavingOn('today', '2026-11-01', null, TODAY)).toBeNull()
    expect(boardLeavingOn('occupied', TODAY, null, TODAY)).toBe('24 Okt')
  })
})
