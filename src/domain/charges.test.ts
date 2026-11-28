import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../types/db'
import {
  activeInvoicesSorted,
  billedPeriodCount,
  buildInvoiceDraft,
  chainAnchor,
  chargeNote,
  latestCoveredThrough,
  nextPeriodBounds,
  nextPeriodStart,
  paymentIsForCharge,
  paymentKindLabel,
  summarizeLeaseBilling,
} from './billing'
import { outstandingInvoices, summarizeFinance } from './finance'
import { buildInvoicesSheet, buildPaymentsSheet, buildSummarySheet, type ExportContext } from './export'
import { buildInvoiceDocument, chargeLineLabel, invoiceShareText } from './invoiceDocument'

// SPEC 7.31: a one-off charge (biaya tambahan) is owed money on one day, never rent coverage. Every rent rule must give
// the same answer with or without a charge, wherever the charge sits and whether it is paid.

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

// a month-end monthly lease (the grid matters): Jan 31 – Feb 27 paid, Feb 28 – Mar 30 open; check-out day 31 Mar
const lease: Lease = {
  id: 'L',
  ...ts,
  property_id: 'P',
  room_id: 'R',
  tenant_id: 'T',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 500_000,
  start_date: '2026-01-31',
  end_date: '2026-03-30',
  status: 'active',
  checkout_date: null,
  notes: null,
}

function rentInv(id: string, start: string, end: string, status: Invoice['status'] = 'unpaid', number = `INV-${start.slice(0, 7).replace('-', '')}-0001`): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P',
    lease_id: 'L',
    invoice_number: number,
    invoice_type: 'rent',
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
    status,
    notes: null,
  }
}

/** The stored shape of a charge (invoices_charge_shape_check). */
function charge(id: string, date: string, amount: number, status: Invoice['status'] = 'unpaid', notes: string | null = 'Late checkout', number = `INV-${date.slice(0, 7).replace('-', '')}-0009`): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P',
    lease_id: 'L',
    invoice_number: number,
    invoice_type: 'charge',
    period_type: null,
    period_start: date,
    period_end: date,
    quantity: 1,
    base_amount: 0,
    addons_amount: 0,
    extra_amount: amount,
    discount_amount: 0,
    total_amount: amount,
    due_date: date,
    status,
    notes,
  }
}

function pay(id: string, invoiceId: string | null, amount: number, over: Partial<Payment> = {}): Payment {
  return { id, org_id: 'o', created_at: ts.created_at, property_id: 'P', invoice_id: invoiceId, lease_id: 'L', amount, paid_at: '2026-03-31', method: 'cash', kind: 'rent', notes: null, created_by: null, ...over }
}

const r1 = rentInv('r1', '2026-01-31', '2026-02-27', 'paid', 'INV-202601-0001')
const r2 = rentInv('r2', '2026-02-28', '2026-03-30', 'unpaid', 'INV-202602-0001')
const rent = [r1, r2]
const rentPayments = [pay('p1', 'r1', 1_500_000, { paid_at: '2026-01-31' })]

// inside the coverage, on the check-out day (end_date + 1) and after it; unpaid and paid
const CASES = [
  { where: 'inside the coverage', date: '2026-02-10' },
  { where: 'on the check-out day', date: '2026-03-31' },
  { where: 'after the check-out day', date: '2026-04-15' },
].flatMap(({ where, date }) => [
  { name: `unpaid, ${where}`, inv: charge('c', date, 100_000, 'unpaid'), payments: rentPayments },
  { name: `paid, ${where}`, inv: charge('c', date, 100_000, 'paid'), payments: [...rentPayments, pay('pc', 'c', 100_000)] },
])

describe('rent coverage never sees a charge (SPEC 7.31)', () => {
  it.each(CASES)('$name: periods, chain and coverage are those of the rent alone', ({ inv }) => {
    const all = [...rent, inv]
    expect(activeInvoicesSorted(all)).toEqual(activeInvoicesSorted(rent))
    expect(latestCoveredThrough(all)).toBe('2026-03-30')
    expect(billedPeriodCount(lease, all)).toBe(billedPeriodCount(lease, rent))
    expect(billedPeriodCount(lease, all)).toBe(2)
    expect(chainAnchor(lease, all)).toEqual({ anchor: '2026-01-31', count: 2 })
    expect(nextPeriodBounds(lease, all, 1)).toEqual(nextPeriodBounds(lease, rent, 1))
    expect(nextPeriodBounds(lease, all, 1)).toEqual({ period_start: '2026-03-31', period_end: '2026-04-29' })
    expect(nextPeriodBounds(lease, all, 3)).toEqual(nextPeriodBounds(lease, rent, 3))
    expect(nextPeriodBounds(lease, all, 2, 'daily')).toEqual(nextPeriodBounds(lease, rent, 2, 'daily'))
    expect(nextPeriodStart(lease, all)).toBe('2026-03-31')
  })

  it.each(CASES)('$name: the next rent draft is the same (only its number counts the charge)', ({ inv }) => {
    const addons: LeaseAddon[] = [{ id: 'a', org_id: 'o', created_at: ts.created_at, lease_id: 'L', name: 'Parkir', amount: 50_000, billing: 'per_period' }]
    const { invoice_number: n1, ...withCharge } = buildInvoiceDraft({ lease, addons, quantity: 1, existingInvoices: [...rent, inv] })
    const { invoice_number: n2, ...withoutCharge } = buildInvoiceDraft({ lease, addons, quantity: 1, existingInvoices: rent })
    expect(withCharge).toEqual(withoutCharge)
    expect(withCharge).toMatchObject({ period_start: '2026-03-31', period_end: '2026-04-29', new_lease_end_date: '2026-04-29', total_amount: 1_550_000, warnings: [] })
    expect(n2).toBe('INV-202603-0001')
    // charges share the INV-YYYYMM-NNNN sequence: one in March takes 0009, so the next March number is 0010
    expect(n1).toBe(inv.period_start.startsWith('2026-03') ? 'INV-202603-0010' : 'INV-202603-0001')
  })

  it.each(CASES)('$name: the billing summary is the rent one, the charge only in chargesOutstanding', ({ inv, payments }) => {
    const today = '2026-03-25'
    const { chargesOutstanding, ...withCharge } = summarizeLeaseBilling(lease, [...rent, inv], payments, today)
    const { chargesOutstanding: none, ...withoutCharge } = summarizeLeaseBilling(lease, rent, rentPayments, today)
    expect(withCharge).toEqual(withoutCharge)
    expect(withCharge).toMatchObject({ coveredThrough: '2026-03-30', paidThrough: '2026-02-27', outstanding: 1_500_000, nextDueDate: '2026-02-28', state: 'overdue' })
    expect(none).toBe(0)
    expect(chargesOutstanding).toBe(inv.status === 'paid' ? 0 : 100_000)
  })

  it('a charge booked before the first rent bill leaves the lease unbilled and the one_time add-ons on the first rent invoice', () => {
    const fresh: Lease = { ...lease, end_date: '2026-01-31' }
    const only = [charge('c', '2026-01-31', 75_000)]
    expect(activeInvoicesSorted(only)).toEqual([])
    expect(latestCoveredThrough(only)).toBeNull()
    expect(billedPeriodCount(fresh, only)).toBe(0)
    expect(nextPeriodBounds(fresh, only, 1)).toEqual({ period_start: '2026-01-31', period_end: '2026-02-27' })
    const addons: LeaseAddon[] = [{ id: 'k', org_id: 'o', created_at: ts.created_at, lease_id: 'L', name: 'Kunci', amount: 25_000, billing: 'one_time' }]
    const draft = buildInvoiceDraft({ lease: fresh, addons, quantity: 1, existingInvoices: only })
    expect(draft.addons_amount).toBe(25_000)
    expect(summarizeLeaseBilling(fresh, only, [], '2026-01-01')).toMatchObject({ coveredThrough: null, outstanding: 0, chargesOutstanding: 75_000, nextDueDate: '2026-01-31', state: 'unbilled' })
  })

  it('voiding the last rent invoice pulls the coverage back to the rent before it, past any charge (end_date shrink)', () => {
    // useLeaseActions.shrinkLeaseEnd: end_date follows latestCoveredThrough of the invoices that remain
    const remaining = [r1, { ...r2, status: 'void' as const }, charge('c', '2026-03-31', 100_000), charge('d', '2026-03-10', 50_000, 'paid')]
    expect(latestCoveredThrough(remaining)).toBe('2026-02-27')
    expect(nextPeriodBounds(lease, remaining, 1)).toEqual({ period_start: '2026-02-28', period_end: '2026-03-30' })
  })

  it('an off-grid chain still re-anchors on the rent: a charge after the pro-rata period does not move the next start', () => {
    // pro-rata: Jan 31 – Feb 14 (15 nights), so the chain falls back to "latest period_end + 1"
    const proRata = [rentInv('r1', '2026-01-31', '2026-02-14', 'paid')]
    const late = charge('c', '2026-03-05', 50_000)
    expect(chainAnchor(lease, [...proRata, late])).toBeNull()
    expect(nextPeriodBounds(lease, [...proRata, late], 1)).toEqual({ period_start: '2026-02-15', period_end: '2026-03-14' })
  })
})

describe('charge helpers', () => {
  const byId = new Map([[r1.id, r1], ['c', charge('c', '2026-03-31', 100_000)]])

  it('paymentIsForCharge: a rent-kind payment on a charge; never a payment on rent, a deposit or other income, or an unknown invoice', () => {
    expect(paymentIsForCharge(pay('a', 'c', 100_000), byId)).toBe(true)
    expect(paymentIsForCharge(pay('b', 'c', 100_000, { method: 'deposit' }), byId)).toBe(true)
    expect(paymentIsForCharge(pay('c1', 'r1', 1_500_000), byId)).toBe(false)
    expect(paymentIsForCharge(pay('d', null, 500_000, { kind: 'deposit' }), byId)).toBe(false)
    expect(paymentIsForCharge(pay('e', null, 20_000, { kind: 'other' }), byId)).toBe(false)
    expect(paymentIsForCharge(pay('f', 'gone', 20_000), byId)).toBe(false)
  })

  it('paymentKindLabel: Biaya tambahan on a charge, else the kind label', () => {
    expect(paymentKindLabel(pay('a', 'c', 100_000), byId)).toBe('Biaya tambahan')
    expect(paymentKindLabel(pay('b', 'r1', 1_500_000), byId)).toBe('Sewa')
    expect(paymentKindLabel(pay('c2', null, 20_000, { kind: 'other' }), byId)).toBe('Pemasukan Lain')
  })

  it('chargeNote: the trimmed notes of a charge; empty for rent or a charge without notes', () => {
    expect(chargeNote(charge('c', '2026-03-31', 1, 'unpaid', '  Kerusakan kipas  '))).toBe('Kerusakan kipas')
    expect(chargeNote(charge('c', '2026-03-31', 1, 'unpaid', null))).toBe('')
    expect(chargeNote({ ...r1, notes: 'Listrik: 50000' })).toBe('')
  })
})

describe('finance classifies charges (SPEC 7.31)', () => {
  const MARCH = { start: '2026-03-01', end: '2026-03-31' }
  const lateOut = charge('c1', '2026-03-31', 100_000, 'paid')
  const damage = charge('c2', '2026-03-20', 80_000, 'unpaid', 'Kerusakan', 'INV-202603-0010')
  const fromDeposit = charge('c3', '2026-03-21', 50_000, 'paid', 'Kebersihan', 'INV-202603-0011')
  const invoices = [r1, { ...r2, status: 'paid' as const }, lateOut, damage, fromDeposit]
  const rentOnly = [
    ...rentPayments,
    pay('p2', 'r2', 1_500_000, { paid_at: '2026-03-02' }),
    pay('dep', null, 500_000, { kind: 'deposit', paid_at: '2026-03-02' }),
    pay('oth', null, 20_000, { kind: 'other', paid_at: '2026-03-10' }),
  ]
  const payments = [...rentOnly, pay('pc1', 'c1', 100_000, { paid_at: '2026-03-31' }), pay('pc3', 'c3', 50_000, { method: 'deposit', paid_at: '2026-03-21' })]

  it('a payment on a charge is Pendapatan lain, not Sewa; rent figures equal the lease without charges', () => {
    const s = summarizeFinance(payments, [], invoices, MARCH)
    const base = summarizeFinance(rentOnly, [], [r1, { ...r2, status: 'paid' as const }], MARCH)
    expect(s.rentRevenue).toBe(base.rentRevenue)
    expect(s.rentRevenue).toBe(1_500_000)
    expect(s.rentReceived).toBe(1_500_000)
    expect(s.otherRevenue).toBe(20_000 + 100_000 + 50_000)
    expect(s.revenue).toBe(1_500_000 + 170_000)
    // potong jaminan for a charge is revenue converted from the deposit, like rent from the deposit
    expect(s.depositsApplied).toBe(50_000)
    expect(s.depositsHeld).toBe(450_000)
    expect(s.paymentCount).toBe(4)
  })

  it('charges are billed and owed like any invoice: in billed, collected and the receivables', () => {
    const s = summarizeFinance(payments, [], invoices, MARCH, undefined, '2026-03-31')
    // due in March: the three charges (the rent invoice r2 fell due on 28 Feb)
    expect(s.billed).toBe(100_000 + 80_000 + 50_000)
    expect(s.collected).toBe(100_000 + 50_000)
    expect(s.outstanding).toBe(80_000)
    expect(s.overdue).toBe(80_000)
    const open = outstandingInvoices(invoices, payments, '2026-03-31')
    expect(open.map((o) => [o.invoice.id, o.outstanding, o.daysOverdue])).toEqual([['c2', 80_000, 11]])
  })
})

describe('export marks charges (SPEC 7.31)', () => {
  const RANGE = { start: '2026-03-01', end: '2026-04-30' }
  const ctx: ExportContext = {
    properties: [{ id: 'P', ...ts, name: 'Kos Mawar', address: null, notes: null, payment_info: null, logo_path: null } as Property],
    rooms: [{ id: 'R', ...ts, property_id: 'P', name: 'A1', floor: null, price_daily: null, price_weekly: null, price_monthly: null, status: 'active', notes: null } as Room],
    tenants: [{ id: 'T', ...ts, property_id: 'P', full_name: 'Budi Santoso' } as Tenant],
    leases: [lease],
  }
  const late = charge('c', '2026-03-31', 100_000, 'paid', 'Late checkout', 'INV-202603-0009')

  it('payments sheet: Jenis Biaya tambahan for a payment on a charge, Sewa for rent', () => {
    const payments = [pay('p2', 'r2', 1_500_000, { paid_at: '2026-03-02' }), pay('pc', 'c', 100_000, { paid_at: '2026-03-31' }), pay('o', null, 20_000, { kind: 'other', paid_at: '2026-03-10' })]
    const sheet = buildPaymentsSheet(payments, [r2, late], ctx, RANGE)
    expect(sheet.rows.map((r) => [r.invoice_number, r.kind])).toEqual([
      ['INV-202602-0001', 'Sewa'],
      ['-', 'Pemasukan Lain'],
      ['INV-202603-0009', 'Biaya tambahan'],
    ])
  })

  it('invoices sheet: a Jenis column; a charge has its date and no check-out day', () => {
    const next = rentInv('r3', '2026-03-31', '2026-04-29', 'unpaid', 'INV-202603-0001')
    const sheet = buildInvoicesSheet([next, late], [pay('pc', 'c', 100_000)], ctx, RANGE)
    expect(sheet.columns[1]).toEqual({ key: 'invoice_type', header: 'Jenis', type: 'string' })
    expect(sheet.rows.map((r) => [r.invoice_number, r.invoice_type, r.period_start, r.period_checkout, r.total_amount, r.status])).toEqual([
      ['INV-202603-0001', 'Sewa', '2026-03-31', '2026-04-30', 1_500_000, 'Belum Bayar'],
      ['INV-202603-0009', 'Biaya tambahan', '2026-03-31', null, 100_000, 'Lunas'],
    ])
  })

  it('summary sheet: Pemasukan lain says it holds the charges', () => {
    const s = summarizeFinance([pay('pc', 'c', 100_000)], [], [late], RANGE)
    const sheet = buildSummarySheet(s, [], [], [], RANGE, 'Laporan')
    expect(sheet.rows.find((r) => r.label === 'Pemasukan lain')).toEqual({ label: 'Pemasukan lain', value: 100_000, note: 'Termasuk biaya tambahan' })
  })
})

describe('Kirim tagihan for a charge (SPEC 7.31)', () => {
  const tenant = { id: 'T', full_name: 'Budi Santoso', phone: '0812' } as Tenant
  const room = { id: 'R', name: 'A1' } as Room
  const property = { id: 'P', name: 'Kos Mawar', address: null, payment_info: 'BCA 123', logo_path: null } as Property
  const late = charge('c', '2026-11-28', 100_000, 'unpaid', 'Late checkout')

  it('one line "Biaya tambahan: <keterangan>" with its date: no rent line, period, nights or notes', () => {
    const doc = buildInvoiceDocument({ invoice: late, lease, tenant, room, property, payments: [], leaseAddons: [] })
    expect(doc.charge).toEqual({ note: 'Late checkout', date: '2026-11-28' })
    expect(doc.lines).toEqual([{ label: 'Biaya tambahan: Late checkout', detail: '28 Nov 2026', amount: 100_000 }])
    expect(doc.notes).toBeNull()
    expect(doc.period).toEqual({ start: '2026-11-28', end: '2026-11-28', checkout: '2026-11-28', quantity: 1, unit: '', typeLabel: 'Biaya tambahan' })
    expect(doc).toMatchObject({ total: 100_000, remaining: 100_000, statusLabel: 'BELUM BAYAR', dueDate: '2026-11-28' })
  })

  it('a rent invoice has no charge', () => {
    expect(buildInvoiceDocument({ invoice: r2, lease, tenant, room, property, payments: [], leaseAddons: [] }).charge).toBeNull()
  })

  it('the WhatsApp text names the charge and its date, never a period, nights or "sewa kamar"', () => {
    const doc = buildInvoiceDocument({ invoice: late, lease, tenant, room, property, payments: [], leaseAddons: [] })
    const text = invoiceShareText(doc)
    expect(text.split('\n')).toEqual([
      'Halo Kak Budi, berikut tagihan kamar A1 Kos Mawar.',
      `No. tagihan: ${late.invoice_number}`,
      'Biaya tambahan: Late checkout · 28 Nov 2026',
      'Total: *Rp 100.000*',
      'Sisa *Rp 100.000* jatuh tempo 28 Nov 2026.',
      'Pembayaran dapat dilakukan ke: BCA 123',
      'Rincian lengkap ada di gambar terlampir. Terima kasih 🙏',
    ])
    expect(text).not.toMatch(/Periode|malam|sewa kamar/i)
  })

  it('paid from the deposit it says LUNAS; without a keterangan the line is just Biaya tambahan', () => {
    const paid = buildInvoiceDocument({ invoice: { ...late, notes: null, status: 'paid' }, lease, tenant, room, property, payments: [pay('pc', 'c', 100_000, { method: 'deposit' })], leaseAddons: [] })
    expect(paid.lines[0].label).toBe('Biaya tambahan')
    expect(chargeLineLabel('')).toBe('Biaya tambahan')
    expect(paid.payments).toEqual([{ date: '2026-03-31', amount: 100_000, methodLabel: 'Potong Jaminan' }])
    expect(invoiceShareText(paid)).toContain('Status: *LUNAS*')
  })
})
