import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Room } from '../../types/db'
import {
  allocateAcrossInvoices,
  appendMoveNote,
  cancelledLeaseEndDate,
  compareLeaseItems,
  composeInvoiceNotes,
  futureInvoicesAtCheckout,
  invoiceTimeline,
  matchesLeaseSearch,
  openInvoicesSorted,
  proRataSuggestion,
  roomAvailability,
  roomPriceFor,
  splitInvoiceNotes,
  sumExtraBreakdown,
  validateSettlement,
  type LeaseListItem,
} from './leaseUtils'
import type { LeaseBillingSummary } from '../../domain/billing'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const lease: Lease = {
  id: 'L1',
  ...ts,
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_000_000,
  deposit_amount: 500_000,
  start_date: '2026-01-10',
  end_date: '2026-04-09',
  status: 'active',
  checkout_date: null,
  notes: null,
}

function inv(id: string, start: string, end: string, total = 1_000_000, status: Invoice['status'] = 'unpaid'): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P1',
    lease_id: 'L1',
    invoice_number: `INV-${start.slice(0, 7).replace('-', '')}-${id}`,
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
  }
}

function pay(invoice_id: string, amount: number): Payment {
  return { id: `pay-${invoice_id}-${amount}`, org_id: 'o', created_at: ts.created_at, property_id: 'P1', invoice_id, lease_id: 'L1', amount, paid_at: '2026-01-10', method: 'cash', kind: 'rent', notes: null, created_by: null }
}

describe('invoiceTimeline', () => {
  it('marks paid/partial/unpaid invoices, gaps and the unbilled tail', () => {
    const invoices = [inv('a', '2026-01-10', '2026-02-09'), inv('b', '2026-03-10', '2026-04-09')]
    const payments = [pay('a', 1_000_000), pay('b', 400_000)]
    const segs = invoiceTimeline(lease, invoices, payments, '2026-04-20')
    expect(segs.map((s) => s.kind)).toEqual(['paid', 'gap', 'partial', 'unbilled'])
    expect(segs[1]).toMatchObject({ start: '2026-02-10', end: '2026-03-09', days: 28 })
    expect(segs[3]).toMatchObject({ start: '2026-04-10', end: '2026-04-20', days: 11 })
  })

  it('ignores void invoices and stops at checkout for ended leases', () => {
    const ended: Lease = { ...lease, status: 'ended', checkout_date: '2026-02-20' }
    const invoices = [inv('a', '2026-01-10', '2026-02-09', 1_000_000, 'paid'), inv('v', '2026-02-10', '2026-03-09', 1_000_000, 'void')]
    const segs = invoiceTimeline(ended, invoices, [pay('a', 1_000_000)], '2026-06-01')
    expect(segs.map((s) => s.kind)).toEqual(['paid', 'unbilled'])
    expect(segs[1].end).toBe('2026-02-20')
  })

  it('flags overlapping invoices', () => {
    const invoices = [inv('a', '2026-01-10', '2026-02-09'), inv('b', '2026-02-01', '2026-02-28')]
    const segs = invoiceTimeline(lease, invoices, [], '2026-02-01')
    expect(segs[1].overlap).toBe(true)
  })
})

describe('invoice notes convention', () => {
  it('round-trips breakdown and free text', () => {
    const notes = composeInvoiceNotes({ listrik: 125_000, denda: 0, lainnya: 10_000 }, 'Token bulan Maret')
    expect(notes).toBe('Listrik: 125000; Lainnya: 10000\nToken bulan Maret')
    const split = splitInvoiceNotes(notes)
    expect(split.breakdown).toEqual({ listrik: 125_000, lainnya: 10_000 })
    expect(split.text).toBe('Token bulan Maret')
    expect(sumExtraBreakdown(split.breakdown)).toBe(135_000)
  })

  it('returns null when nothing to store and keeps plain text as text', () => {
    expect(composeInvoiceNotes({}, '  ')).toBeNull()
    expect(composeInvoiceNotes({}, 'catatan')).toBe('catatan')
    expect(splitInvoiceNotes('catatan saja')).toEqual({ breakdown: {}, text: 'catatan saja' })
    expect(splitInvoiceNotes(null)).toEqual({ breakdown: {}, text: '' })
  })
})

describe('open invoices & allocation', () => {
  const invoices = [inv('b', '2026-02-10', '2026-03-09'), inv('a', '2026-01-10', '2026-02-09'), inv('v', '2026-03-10', '2026-04-09', 1_000_000, 'void')]
  const payments = [pay('a', 600_000)]

  it('sorts open invoices by due date and skips void / settled', () => {
    expect(openInvoicesSorted('L1', invoices, payments).map((i) => i.id)).toEqual(['a', 'b'])
    expect(openInvoicesSorted('L1', invoices, [pay('a', 1_000_000)]).map((i) => i.id)).toEqual(['b'])
  })

  it('allocates oldest first and throws when the amount cannot be absorbed', () => {
    const open = openInvoicesSorted('L1', invoices, payments)
    expect(allocateAcrossInvoices(500_000, open, payments)).toEqual([
      { invoice: open[0], amount: 400_000 },
      { invoice: open[1], amount: 100_000 },
    ])
    expect(() => allocateAcrossInvoices(2_000_000, open, payments)).toThrow('Jumlah melebihi total sisa tagihan.')
  })
})

describe('proRataSuggestion', () => {
  it('scales the period price by inclusive days and rounds', () => {
    // monthly period 8 Nov – 7 Dec (30 days); 14 days -> 1.500.000 * 14 / 30 = 700.000
    expect(proRataSuggestion(1_500_000, '2026-11-08', '2026-12-07', '2026-11-21')).toEqual({ amount: 700_000, days: 14, fullDays: 30 })
    // full period -> full price; single day -> price / days rounded
    expect(proRataSuggestion(1_200_000, '2026-11-01', '2026-11-30', '2026-11-30')?.amount).toBe(1_200_000)
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '2026-11-01')).toEqual({ amount: 33_333, days: 1, fullDays: 30 })
  })

  it('returns null for missing or inverted dates', () => {
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '')).toBeNull()
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '2026-10-31')).toBeNull()
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', 'bukan-tanggal')).toBeNull()
  })
})

describe('cancelledLeaseEndDate', () => {
  it('cuts end_date to the cancellation date but never before start_date', () => {
    expect(cancelledLeaseEndDate(lease, '2026-02-15')).toBe('2026-02-15')
    expect(cancelledLeaseEndDate(lease, '2026-06-01')).toBe('2026-04-09')
    // lease that has not started yet, cancelled today
    expect(cancelledLeaseEndDate({ ...lease, start_date: '2026-11-01', end_date: '2026-11-30' }, '2026-10-11')).toBe('2026-11-01')
    expect(cancelledLeaseEndDate(lease, '2026-01-10')).toBe('2026-01-10')
  })
})

describe('futureInvoicesAtCheckout', () => {
  const invoices = [
    inv('cur', '2026-01-10', '2026-02-09'),
    inv('u', '2026-02-10', '2026-03-09'),
    inv('p', '2026-03-10', '2026-04-09'),
    inv('f', '2026-04-10', '2026-05-09', 1_000_000, 'paid'),
    inv('v', '2026-05-10', '2026-06-09', 1_000_000, 'void'),
    { ...inv('other', '2026-02-10', '2026-03-09'), lease_id: 'L2' },
  ]
  const payments = [pay('p', 500_000), pay('f', 1_000_000)]

  it('splits invoices starting after checkout into void / partial / paid and ignores the rest', () => {
    const r = futureInvoicesAtCheckout('L1', invoices, payments, '2026-01-20')
    expect(r.toVoid.map((i) => i.id)).toEqual(['u'])
    expect(r.partial.map((i) => i.id)).toEqual(['p'])
    expect(r.paid.map((i) => i.id)).toEqual(['f'])
  })

  it('treats an invoice starting on the checkout date as current and handles an empty date', () => {
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '2026-02-10').toVoid.map((i) => i.id)).toEqual([])
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '2026-02-10').partial.map((i) => i.id)).toEqual(['p'])
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '')).toEqual({ toVoid: [], partial: [], paid: [] })
  })
})

describe('validateSettlement', () => {
  it('requires the parts to sum to the held deposit', () => {
    expect(validateSettlement({ refund: 500_000, rent: 0, damage: 0, damageNotes: '' }, 500_000, 0)).toBeNull()
    expect(validateSettlement({ refund: 300_000, rent: 0, damage: 0, damageNotes: '' }, 500_000, 0)).toMatch(/harus sama/)
    expect(validateSettlement({ refund: 0, rent: 600_000, damage: 0, damageNotes: '' }, 600_000, 400_000)).toMatch(/melebihi sisa tagihan/)
    expect(validateSettlement({ refund: 0, rent: 0, damage: 500_000, damageNotes: '' }, 500_000, 0)).toMatch(/keterangan/)
    expect(validateSettlement({ refund: 0, rent: 0, damage: 500_000, damageNotes: 'kunci hilang' }, 500_000, 0)).toBeNull()
    expect(validateSettlement({ refund: -1, rent: 0, damage: 1, damageNotes: '' }, 0, 0)).toMatch(/negatif/)
  })
})

describe('roomAvailability', () => {
  const room: Room = { id: 'R2', ...ts, property_id: 'P1', name: 'A2', floor: '1', price_daily: 90_000, price_weekly: 540_000, price_monthly: 1_200_000, status: 'active', notes: null }
  const occupying: Lease = { ...lease, id: 'L9', room_id: 'R2', start_date: '2026-01-01', end_date: '2026-01-31' }

  it('distinguishes terisi / dipesan / bentrok / kosong / perbaikan', () => {
    expect(roomAvailability(room, [occupying], '2026-01-15', '2026-02-14')).toBe('terisi')
    expect(roomAvailability(room, [{ ...occupying, start_date: '2026-03-01', end_date: '2026-03-31' }], '2026-02-01', '2026-02-28')).toBe('dipesan')
    // a future active lease is always "Dipesan" (SPEC 2a); "bentrok" is left for non-reserving overlaps
    expect(roomAvailability(room, [{ ...occupying, status: 'ended', start_date: '2026-02-20', end_date: '2026-03-19', checkout_date: '2026-03-19' }], '2026-02-01', '2026-02-28')).toBe('bentrok')
    expect(roomAvailability(room, [{ ...occupying, status: 'cancelled' }], '2026-01-15', '2026-02-14')).toBe('kosong')
    expect(roomAvailability({ ...room, status: 'maintenance' }, [], '2026-01-15', '2026-02-14')).toBe('perbaikan')
    // the lease being edited is excluded
    expect(roomAvailability(room, [occupying], '2026-01-15', '2026-02-14', 'L9')).toBe('kosong')
  })

  it('reads the room price for a period type', () => {
    expect(roomPriceFor(room, 'daily')).toBe(90_000)
    expect(roomPriceFor(room, 'monthly')).toBe(1_200_000)
    expect(roomPriceFor(undefined, 'weekly')).toBeNull()
  })
})

describe('list helpers', () => {
  const summary = (state: LeaseBillingSummary['state'], nextDueDate: string): LeaseBillingSummary => ({
    leaseId: 'x',
    coveredThrough: null,
    paidThrough: null,
    outstanding: 0,
    nextDueDate,
    daysUntilDue: 0,
    state,
  })
  const item = (state: LeaseBillingSummary['state'], due: string, roomName: string, tenantName = 'Budi'): LeaseListItem => ({
    lease,
    summary: summary(state, due),
    room: { id: 'r', ...ts, property_id: 'P1', name: roomName, floor: null, price_daily: null, price_weekly: null, price_monthly: null, status: 'active', notes: null },
    tenant: {
      id: 't',
      ...ts,
      property_id: 'P1',
      full_name: tenantName,
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
    },
    propertyName: 'Kos Melati',
  })

  it('sorts overdue first, then due soon, then by date and room', () => {
    const items = [item('ok', '2026-05-01', 'B1'), item('due_soon', '2026-04-02', 'A2'), item('overdue', '2026-03-01', 'A10'), item('overdue', '2026-03-01', 'A2')]
    expect(items.sort(compareLeaseItems).map((i) => i.room?.name)).toEqual(['A2', 'A10', 'A2', 'B1'])
  })

  it('searches tenant, room and kos names', () => {
    const it1 = item('ok', '2026-05-01', 'B1', 'Siti Rahayu')
    expect(matchesLeaseSearch(it1, 'siti')).toBe(true)
    expect(matchesLeaseSearch(it1, 'b1')).toBe(true)
    expect(matchesLeaseSearch(it1, 'melati')).toBe(true)
    expect(matchesLeaseSearch(it1, 'anggrek')).toBe(false)
    expect(matchesLeaseSearch(it1, '')).toBe(true)
  })

  it('appends the move note', () => {
    expect(appendMoveNote(null, 'A1', 'B2', '2026-03-05')).toBe('Pindah dari A1 ke B2 pada 2026-03-05')
    expect(appendMoveNote('Tamu proyek', 'A1', 'B2', '2026-03-05')).toBe('Tamu proyek\nPindah dari A1 ke B2 pada 2026-03-05')
  })
})
