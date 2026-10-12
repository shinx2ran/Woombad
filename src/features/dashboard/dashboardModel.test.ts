import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'
import {
  buildAttentionSections,
  buildExpiringItems,
  buildLookups,
  buildRecentPayments,
  buildVacantGroups,
  deltaText,
  dueLabel,
  extensionQuestionText,
  formatCompactRupiah,
  greetingFor,
  isPaidUpAndEnding,
  lastSixMonthsRange,
} from './dashboardModel'
import { summarizeLeaseBilling } from '../../domain/billing'

const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const TODAY = '2026-10-11'

const properties: Property[] = [
  { id: 'pA', name: 'Kos Melati', address: null, notes: null, payment_info: null, ...ts },
  { id: 'pB', name: 'Kos Anggrek', address: null, notes: null, payment_info: null, ...ts },
]
const room = (id: string, property_id: string, name: string, status: Room['status'] = 'active'): Room => ({
  id,
  property_id,
  name,
  floor: null,
  price_daily: 100_000,
  price_weekly: 600_000,
  price_monthly: 1_500_000,
  status,
  notes: null,
  ...ts,
})
const rooms: Room[] = [room('r1', 'pA', 'A1'), room('r2', 'pA', 'A2'), room('r3', 'pB', '101'), room('r4', 'pB', '102', 'maintenance'), room('r5', 'pB', '103')]
const tenant = (id: string, full_name: string): Tenant => ({
  id,
  property_id: null,
  full_name,
  nik: null,
  id_type: 'ktp',
  id_number: null,
  nationality: null,
  phone: '0812',
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
})
const tenants = [tenant('t1', 'Budi'), tenant('t2', 'Siti'), tenant('t3', 'Agus'), tenant('t4', 'Dewi')]
const lease = (id: string, room_id: string, tenant_id: string, start_date: string, end_date: string, status: Lease['status'] = 'active'): Lease => ({
  id,
  property_id: rooms.find((r) => r.id === room_id)!.property_id,
  room_id,
  tenant_id,
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date,
  end_date,
  status,
  checkout_date: null,
  notes: null,
  ...ts,
})
const invoice = (id: string, lease_id: string, period_start: string, period_end: string, status: Invoice['status'], total = 1_500_000): Invoice => ({
  id,
  property_id: 'pA',
  lease_id,
  invoice_number: id,
  period_type: null,
  period_start,
  period_end,
  quantity: 1,
  base_amount: total,
  addons_amount: 0,
  extra_amount: 0,
  discount_amount: 0,
  total_amount: total,
  due_date: period_start,
  status,
  notes: null,
  ...ts,
})
const payment = (id: string, invoice_id: string | null, lease_id: string, amount: number, paid_at: string, created_at = ts.created_at): Payment => ({
  id,
  property_id: 'pA',
  invoice_id,
  lease_id,
  amount,
  paid_at,
  method: 'cash',
  kind: invoice_id ? 'rent' : 'deposit',
  notes: null,
  created_by: null,
  org_id: 'org',
  created_at,
})

const lookups = buildLookups(tenants, rooms, properties)

describe('buildAttentionSections', () => {
  // l1: overdue (due 10 days ago, unpaid); l2: due_soon within grace (paid through 2026-10-09, still in the room,
  // next period due yesterday); l3: unbilled (starts in 10 days, no invoice); l4: ok (paid through next month); l5: ended
  const leases = [
    lease('l1', 'r1', 't1', '2026-09-01', '2026-10-31'),
    lease('l2', 'r2', 't2', '2026-09-10', '2026-10-09'),
    lease('l3', 'r3', 't3', '2026-10-21', '2026-11-20'),
    lease('l4', 'r5', 't4', '2026-10-01', '2026-11-30'),
    lease('l5', 'r1', 't1', '2026-01-01', '2026-02-01', 'ended'),
  ]
  const invoices = [
    invoice('i1', 'l1', '2026-10-01', '2026-10-31', 'unpaid'),
    invoice('i2', 'l2', '2026-09-10', '2026-10-09', 'paid'),
    invoice('i4', 'l4', '2026-10-01', '2026-11-30', 'paid', 3_000_000),
  ]
  const payments = [payment('p2', 'i2', 'l2', 1_500_000, '2026-09-10'), payment('p4', 'i4', 'l4', 3_000_000, '2026-10-01')]

  it('groups overdue, due_soon and unbilled in order and skips ok/ended leases', () => {
    const sections = buildAttentionSections(leases, invoices, payments, [], lookups, TODAY)
    expect(sections.map((s) => s.group)).toEqual(['overdue', 'due_soon', 'unbilled'])
    expect(sections[0].items.map((i) => i.lease.id)).toEqual(['l1'])
    expect(sections[1].items.map((i) => i.lease.id)).toEqual(['l2'])
    expect(sections[2].items.map((i) => i.lease.id)).toEqual(['l3'])
  })

  it('resolves tenant, room, property and the open invoice; amount falls back to price per period', () => {
    const sections = buildAttentionSections(leases, invoices, payments, [], lookups, TODAY)
    const overdue = sections[0].items[0]
    expect(overdue.tenant?.full_name).toBe('Budi')
    expect(overdue.room?.name).toBe('A1')
    expect(overdue.property?.name).toBe('Kos Melati')
    expect(overdue.openInvoice?.id).toBe('i1')
    expect(overdue.openInvoiceCount).toBe(1)
    expect(overdue.amount).toBe(1_500_000)
    const dueSoon = sections[1].items[0]
    expect(dueSoon.openInvoice).toBeNull()
    expect(dueSoon.summary.outstanding).toBe(0)
    expect(dueSoon.summary.daysUntilDue).toBe(-1)
    expect(dueSoon.amount).toBe(1_500_000)
  })

  // Paid short stay that is leaving (the review's "Tamu Harian" case): 3 nights 2026-10-11..13, first invoice
  // paid in full. summarizeLeaseBilling says due_soon (next period would start 14 Okt) but nothing is owed and
  // the stay ends within the "Akan berakhir" window, so it must not be flagged "Jatuh tempo" with Bayar/Tagih.
  const guest = { ...lease('l7', 'r2', 't2', '2026-10-11', '2026-10-13'), period_type: 'daily' as const, price_per_period: 100_000 }
  const guestInvoice = invoice('i7', 'l7', '2026-10-11', '2026-10-13', 'paid', 300_000)
  const guestPayment = payment('p7', 'i7', 'l7', 300_000, '2026-10-11')

  it('leaves a paid-up lease that ends within 7 days to the "Akan berakhir" list (SPEC 2b.12, not shown twice)', () => {
    const sections = buildAttentionSections([guest], [guestInvoice], [guestPayment], [], lookups, TODAY)
    expect(sections).toEqual([])
    const summary = summarizeLeaseBilling(guest, [guestInvoice], [guestPayment], TODAY)
    expect(summary.state).toBe('due_soon')
    expect(isPaidUpAndEnding(guest, summary, TODAY)).toBe(true)
    const expiring = buildExpiringItems([guest], new Set(), lookups, TODAY)
    expect(expiring.map((i) => [i.lease.id, i.daysLeft])).toEqual([['l7', 2]])
  })

  it('keeps a lease whose last invoice is still partly unpaid under attention even though the stay is ending', () => {
    const partial = { ...guestInvoice, status: 'partial' as const }
    const dp = { ...guestPayment, amount: 100_000 }
    const sections = buildAttentionSections([guest], [partial], [dp], [], lookups, TODAY)
    expect(sections.map((s) => s.group)).toEqual(['due_soon'])
    expect(sections[0].items[0].amount).toBe(200_000)
    expect(isPaidUpAndEnding(guest, sections[0].items[0].summary, TODAY)).toBe(false)
  })

  it('keeps a paid-up tenant who stays on past end_date under attention (the next invoice is due)', () => {
    const summary = summarizeLeaseBilling(leases[1], invoices, payments, TODAY)
    expect(summary.outstanding).toBe(0)
    expect(isPaidUpAndEnding(leases[1], summary, TODAY)).toBe(false)
    const sections = buildAttentionSections([leases[1]], invoices, payments, [], lookups, TODAY)
    expect(sections.map((s) => s.group)).toEqual(['due_soon'])
  })

  it('keeps an unbilled short reservation under "Belum ditagih" even when it ends within 7 days', () => {
    const reservation = { ...guest, id: 'l8', start_date: '2026-10-15', end_date: '2026-10-17' }
    const sections = buildAttentionSections([reservation], [], [], [], lookups, TODAY)
    expect(sections.map((s) => s.group)).toEqual(['unbilled'])
  })

  it('a paid-up lease ending today is still "Akan berakhir", not "Jatuh tempo"', () => {
    const today = { ...guest, start_date: '2026-10-09', end_date: TODAY }
    const inv = { ...guestInvoice, period_start: '2026-10-09', period_end: TODAY }
    expect(buildAttentionSections([today], [inv], [guestPayment], [], lookups, TODAY)).toEqual([])
    expect(buildExpiringItems([today], new Set(), lookups, TODAY)[0]?.daysLeft).toBe(0)
  })

  it('sorts the most overdue first', () => {
    const more = [...leases, lease('l6', 'r5', 't4', '2026-08-01', '2026-10-31')]
    const inv = [...invoices, invoice('i6', 'l6', '2026-09-01', '2026-09-30', 'unpaid')]
    const sections = buildAttentionSections(more, inv, payments, [], lookups, TODAY)
    expect(sections[0].items.map((i) => i.lease.id)).toEqual(['l6', 'l1'])
  })

  it('counts every open invoice and sums their outstanding', () => {
    const inv = [...invoices, invoice('i1b', 'l1', '2026-09-01', '2026-09-30', 'partial')]
    const pays = [...payments, payment('p1b', 'i1b', 'l1', 500_000, '2026-09-01')]
    const sections = buildAttentionSections(leases, inv, pays, [], lookups, TODAY)
    const overdue = sections[0].items[0]
    expect(overdue.openInvoiceCount).toBe(2)
    expect(overdue.openInvoice?.id).toBe('i1b')
    expect(overdue.amount).toBe(2_500_000)
  })

  it('adds per-period add-ons to the next-period amount, and one-time add-ons only when nothing was billed yet', () => {
    const addon = (id: string, lease_id: string, amount: number, billing: LeaseAddon['billing']): LeaseAddon => ({
      id,
      lease_id,
      name: 'Parkir motor',
      amount,
      billing,
      org_id: 'org',
      created_at: ts.created_at,
    })
    const addons = [addon('a1', 'l2', 50_000, 'per_period'), addon('a2', 'l2', 300_000, 'one_time'), addon('a3', 'l3', 75_000, 'per_period'), addon('a4', 'l3', 100_000, 'one_time')]
    const sections = buildAttentionSections(leases, invoices, payments, addons, lookups, TODAY)
    const dueSoon = sections[1].items[0] // l2 already has a paid invoice: one_time add-on excluded
    expect(dueSoon.nextPeriodAmount).toBe(1_550_000)
    expect(dueSoon.amount).toBe(1_550_000)
    const unbilled = sections[2].items[0] // l3 has no invoice yet: one_time add-on included
    expect(unbilled.nextPeriodAmount).toBe(1_675_000)
    expect(unbilled.amount).toBe(1_675_000)
    const overdue = sections[0].items[0] // outstanding wins over the next-period amount
    expect(overdue.amount).toBe(1_500_000)
  })

  it('returns no sections when everything is paid ahead', () => {
    expect(buildAttentionSections([leases[3]], invoices, payments, [], lookups, TODAY)).toEqual([])
  })
})

describe('buildExpiringItems', () => {
  it('lists leases ending within 7 days minus those already in attention', () => {
    const leases = [
      lease('l1', 'r1', 't1', '2026-09-01', '2026-10-13'),
      lease('l2', 'r2', 't2', '2026-09-01', '2026-10-18'),
      lease('l3', 'r3', 't3', '2026-09-01', '2026-10-19'),
      lease('l4', 'r5', 't4', '2026-09-01', '2026-10-10'),
    ]
    const items = buildExpiringItems(leases, new Set(['l1']), lookups, TODAY)
    expect(items.map((i) => i.lease.id)).toEqual(['l2'])
    expect(items[0].daysLeft).toBe(7)
    expect(items[0].tenant?.full_name).toBe('Siti')
  })
})

describe('buildVacantGroups', () => {
  it('groups vacant rooms by kos, marks reserved rooms with the start date and skips maintenance rooms', () => {
    const leases = [
      lease('l1', 'r1', 't1', '2026-09-01', '2026-10-31'), // occupied
      lease('l3', 'r3', 't3', '2026-10-21', '2026-11-20'), // reserved
    ]
    const groups = buildVacantGroups(rooms, leases, lookups, properties, TODAY)
    expect(groups.map((g) => g.property?.name)).toEqual(['Kos Melati', 'Kos Anggrek'])
    expect(groups[0].rooms.map((r) => r.room.name)).toEqual(['A2'])
    expect(groups[1].rooms.map((r) => [r.room.name, r.reservedFrom])).toEqual([
      ['101', '2026-10-21'],
      ['103', null],
    ])
    expect(groups[1].rooms[0].reservedTenant?.full_name).toBe('Agus')
  })

  it('does not list a room that is occupied today and reserved for later', () => {
    const leases = [lease('l1', 'r1', 't1', '2026-09-01', '2026-10-31'), lease('l2', 'r1', 't2', '2026-11-01', '2026-11-30')]
    const groups = buildVacantGroups([rooms[0]], leases, lookups, properties, TODAY)
    expect(groups).toEqual([])
  })
})

describe('buildRecentPayments', () => {
  it('returns the newest payments first with tenant and room, capped at the limit', () => {
    const leases = [lease('l1', 'r1', 't1', '2026-09-01', '2026-10-31')]
    const payments = [
      payment('p1', 'i1', 'l1', 100, '2026-10-01'),
      payment('p2', 'i1', 'l1', 200, '2026-10-05', '2026-01-01T00:00:00Z'),
      payment('p3', 'i1', 'l1', 300, '2026-10-05', '2026-01-02T00:00:00Z'),
      payment('p4', null, 'l1', 400, '2026-09-01'),
    ]
    const items = buildRecentPayments(payments, leases, lookups, 3)
    expect(items.map((i) => i.payment.id)).toEqual(['p3', 'p2', 'p1'])
    expect(items[0].tenant?.full_name).toBe('Budi')
    expect(items[0].room?.name).toBe('A1')
  })
})

describe('formatting helpers', () => {
  it('lastSixMonthsRange spans six calendar months including the current one', () => {
    expect(lastSixMonthsRange('2026-10-11')).toEqual({ start: '2026-05-01', end: '2026-10-31' })
    expect(lastSixMonthsRange('2026-02-28')).toEqual({ start: '2025-09-01', end: '2026-02-28' })
  })

  it('formatCompactRupiah abbreviates with Indonesian decimal comma', () => {
    expect(formatCompactRupiah(0)).toBe('0')
    expect(formatCompactRupiah(850_000)).toBe('850 rb')
    expect(formatCompactRupiah(1_200_000)).toBe('1,2 jt')
    expect(formatCompactRupiah(3_000_000)).toBe('3 jt')
    expect(formatCompactRupiah(-450_000)).toBe('-450 rb')
    expect(formatCompactRupiah(2_500_000_000)).toBe('2,5 M')
  })

  it('extensionQuestionText asks about extending without mentioning a bill', () => {
    const text = extensionQuestionText({ tenantName: 'Tamu Harian Uji', roomName: 'A3', propertyName: 'Kos Melati', endDate: '2026-10-13' })
    expect(text).toContain('Halo Kak Tamu, ini pesan dari Kos Melati.')
    expect(text).toContain('kamar A3 berakhir pada 13 Okt 2026')
    expect(text).toContain('memperpanjang')
    expect(text).not.toMatch(/Tagihan|jatuh tempo|Rp/)
    expect(extensionQuestionText({ tenantName: '  ', roomName: 'B1', propertyName: 'Kos', endDate: '2026-10-13' })).toContain('Halo Kak,')
  })

  it('dueLabel describes the due date relative to today', () => {
    expect(dueLabel(-5)).toBe('Terlambat 5 hari')
    expect(dueLabel(-2, true)).toBe('Lewat 2 hari · tenggang')
    expect(dueLabel(0)).toBe('Jatuh tempo hari ini')
    expect(dueLabel(1)).toBe('Jatuh tempo besok')
    expect(dueLabel(3)).toBe('3 hari lagi')
    expect(dueLabel(null)).toBe('-')
  })

  it('greetingFor follows the hour of day', () => {
    expect(greetingFor(6)).toBe('Selamat pagi')
    expect(greetingFor(12)).toBe('Selamat siang')
    expect(greetingFor(16)).toBe('Selamat sore')
    expect(greetingFor(21)).toBe('Selamat malam')
  })

  it('deltaText shows sign, money and percentage', () => {
    const money = (n: number) => `Rp ${n}`
    expect(deltaText(1500, 0.12, money)).toBe('+Rp 1500 (+12%)')
    expect(deltaText(-300, -0.051, money)).toBe('-Rp 300 (-5%)')
    expect(deltaText(0, null, money)).toBe('Rp 0')
  })
})
