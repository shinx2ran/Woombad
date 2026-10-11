import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Lease, Payment, Property, Room, Tenant } from '../types/db'
import type { CashflowPoint, CategoryBreakdown, FinanceSummary, PropertyBreakdown } from './finance'
import {
  activeLeaseFor,
  buildExpensesSheet,
  buildInvoicesSheet,
  buildPaymentsSheet,
  buildSummarySheet,
  buildTenantsSheet,
  csvCell,
  exportFileName,
  formatPercent,
  slugify,
  toCsv,
  type ExportContext,
  type ExportSheet,
} from './export'

// ---------- fixtures ----------

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`
const TS = '2026-01-01T00:00:00Z'

function makeProperty(overrides: Partial<Property> = {}): Property {
  return { id: nextId('kos'), org_id: 'org', created_at: TS, updated_at: TS, name: 'Kos', address: null, notes: null, ...overrides }
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: nextId('room'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    property_id: 'kos-a',
    name: 'A1',
    floor: null,
    price_daily: null,
    price_weekly: null,
    price_monthly: 1_000_000,
    status: 'active',
    notes: null,
    ...overrides,
  }
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: nextId('tenant'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    property_id: 'kos-a',
    full_name: 'Budi',
    nik: null,
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
    ...overrides,
  }
}

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: nextId('lease'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    property_id: 'kos-a',
    room_id: 'room-a1',
    tenant_id: 'tenant-budi',
    period_type: 'monthly',
    price_per_period: 1_000_000,
    deposit_amount: 500_000,
    start_date: '2026-01-01',
    end_date: '2026-03-31',
    status: 'active',
    checkout_date: null,
    deposit_returned_amount: null,
    notes: null,
    ...overrides,
  }
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId('pay'),
    org_id: 'org',
    created_at: TS,
    property_id: 'kos-a',
    invoice_id: 'inv-1',
    lease_id: 'lease-budi',
    amount: 1_000_000,
    paid_at: '2026-03-10',
    method: 'cash',
    kind: 'rent',
    notes: null,
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: nextId('inv'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    property_id: 'kos-a',
    lease_id: 'lease-budi',
    invoice_number: 'INV-001',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    quantity: 1,
    base_amount: 1_000_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_000_000,
    due_date: '2026-03-01',
    status: 'unpaid',
    notes: null,
    ...overrides,
  }
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: nextId('exp'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    property_id: 'kos-a',
    category: 'wages',
    amount: 500_000,
    expense_date: '2026-03-15',
    description: 'Gaji penjaga',
    vendor: null,
    receipt_path: null,
    ...overrides,
  }
}

/** 2 properties, 3 rooms, 2 tenants, 2 leases (Budi active in A1, Sari ended in B1). */
function makeContext(): ExportContext {
  return {
    properties: [makeProperty({ id: 'kos-a', name: 'Kos Mawar' }), makeProperty({ id: 'kos-b', name: 'Kos Melati' })],
    rooms: [
      makeRoom({ id: 'room-a1', property_id: 'kos-a', name: 'A1' }),
      makeRoom({ id: 'room-a2', property_id: 'kos-a', name: 'A2' }),
      makeRoom({ id: 'room-b1', property_id: 'kos-b', name: 'B1' }),
    ],
    tenants: [
      makeTenant({ id: 'tenant-budi', full_name: 'Budi Santoso', phone: '0812', nik: '3171', gender: 'L', property_id: 'kos-a' }),
      makeTenant({ id: 'tenant-sari', full_name: 'Sari Dewi', gender: 'P', property_id: 'kos-b', occupation: 'Guru' }),
    ],
    leases: [
      makeLease({ id: 'lease-budi', room_id: 'room-a1', tenant_id: 'tenant-budi', property_id: 'kos-a' }),
      makeLease({ id: 'lease-sari', room_id: 'room-b1', tenant_id: 'tenant-sari', property_id: 'kos-b', status: 'ended', checkout_date: '2026-02-28' }),
    ],
  }
}

const MARCH = { start: '2026-03-01', end: '2026-03-31' }

function headers(sheet: ExportSheet): string[] {
  return sheet.columns.map((c) => c.header)
}
function column(sheet: ExportSheet, key: string): unknown[] {
  return sheet.rows.map((r) => r[key])
}

// ---------- payments ----------

describe('buildPaymentsSheet', () => {
  const ctx = makeContext()
  const invoices = [makeInvoice({ id: 'inv-1', invoice_number: 'INV-2026-001' })]

  it('has the Indonesian headers and column types', () => {
    const sheet = buildPaymentsSheet([], invoices, ctx, MARCH)
    expect(sheet.name).toBe('Pembayaran')
    expect(headers(sheet)).toEqual(['Tanggal', 'Kos', 'Kamar', 'Penyewa', 'Jenis', 'Metode', 'No. Tagihan', 'Jumlah', 'Catatan'])
    expect(sheet.columns.find((c) => c.key === 'paid_at')?.type).toBe('date')
    expect(sheet.columns.find((c) => c.key === 'amount')?.type).toBe('money')
    expect(sheet.rows).toEqual([])
  })

  it('joins lease -> room -> property and tenant, labels kind/method, resolves invoice number', () => {
    const sheet = buildPaymentsSheet(
      [makePayment({ paid_at: '2026-03-10', method: 'transfer', amount: 750_000, notes: 'DP' })],
      invoices,
      ctx,
      MARCH,
    )
    expect(sheet.rows).toEqual([
      {
        paid_at: '2026-03-10',
        property: 'Kos Mawar',
        room: 'A1',
        tenant: 'Budi Santoso',
        kind: 'Sewa',
        method: 'Transfer',
        invoice_number: 'INV-2026-001',
        amount: 750_000,
        notes: 'DP',
      },
    ])
  })

  it("renders '-' for missing joins but keeps amount numeric", () => {
    const sheet = buildPaymentsSheet(
      [
        makePayment({ lease_id: 'lease-ghost', invoice_id: null, kind: 'other', method: 'qris', property_id: 'kos-ghost', amount: 50_000 }),
        makePayment({ lease_id: null, invoice_id: 'inv-missing', kind: 'deposit', property_id: 'kos-b', amount: 500_000 }),
      ],
      invoices,
      ctx,
      MARCH,
    )
    expect(sheet.rows[0]).toMatchObject({ property: '-', room: '-', tenant: '-', invoice_number: '-', kind: 'Pemasukan Lain', method: 'QRIS', notes: '-', amount: 50_000 })
    // no lease: kos still resolved from the payment's own property_id
    expect(sheet.rows[1]).toMatchObject({ property: 'Kos Melati', room: '-', tenant: '-', invoice_number: '-', kind: 'Uang Jaminan', amount: 500_000 })
  })

  it('filters by paid_at range (inclusive) and property', () => {
    const payments = [
      makePayment({ paid_at: '2026-02-28', amount: 1 }),
      makePayment({ paid_at: '2026-03-01', amount: 2 }),
      makePayment({ paid_at: '2026-03-31', amount: 3, property_id: 'kos-b', lease_id: 'lease-sari' }),
      makePayment({ paid_at: '2026-04-01', amount: 4 }),
    ]
    expect(column(buildPaymentsSheet(payments, invoices, ctx, MARCH), 'amount')).toEqual([2, 3])
    expect(column(buildPaymentsSheet(payments, invoices, ctx, MARCH, ['kos-b']), 'amount')).toEqual([3])
    expect(column(buildPaymentsSheet(payments, invoices, ctx, MARCH, ['kos-a']), 'amount')).toEqual([2])
    expect(column(buildPaymentsSheet(payments, invoices, ctx, MARCH, []), 'amount')).toEqual([])
  })

  it('sorts by paid_at then created_at', () => {
    const payments = [
      makePayment({ paid_at: '2026-03-20', created_at: '2026-03-20T10:00:00Z', amount: 3 }),
      makePayment({ paid_at: '2026-03-05', created_at: '2026-03-05T12:00:00Z', amount: 2 }),
      makePayment({ paid_at: '2026-03-05', created_at: '2026-03-05T08:00:00Z', amount: 1 }),
    ]
    expect(column(buildPaymentsSheet(payments, invoices, ctx, MARCH), 'amount')).toEqual([1, 2, 3])
  })
})

// ---------- expenses ----------

describe('buildExpensesSheet', () => {
  const ctx = makeContext()

  it('has headers, labels and vendor fallback', () => {
    const sheet = buildExpensesSheet(
      [makeExpense({ category: 'maintenance', description: 'Ganti keran', vendor: 'Toko Jaya', amount: 120_000, expense_date: '2026-03-03' })],
      ctx,
      MARCH,
    )
    expect(sheet.name).toBe('Pengeluaran')
    expect(headers(sheet)).toEqual(['Tanggal', 'Kos', 'Kategori', 'Deskripsi', 'Vendor', 'Jumlah'])
    expect(sheet.rows).toEqual([
      { expense_date: '2026-03-03', property: 'Kos Mawar', category: 'Perbaikan & Perawatan', description: 'Ganti keran', vendor: 'Toko Jaya', amount: 120_000 },
    ])
    expect(buildExpensesSheet([makeExpense({ vendor: null })], ctx, MARCH).rows[0]?.vendor).toBe('-')
    expect(buildExpensesSheet([makeExpense({ property_id: 'kos-ghost' })], ctx, MARCH).rows[0]?.property).toBe('-')
  })

  it("shared expenses show 'Bersama' and are included only without a property filter", () => {
    const expenses = [
      makeExpense({ property_id: null, amount: 1, expense_date: '2026-03-02' }),
      makeExpense({ property_id: 'kos-a', amount: 2, expense_date: '2026-03-03' }),
      makeExpense({ property_id: 'kos-b', amount: 3, expense_date: '2026-03-04' }),
    ]
    const all = buildExpensesSheet(expenses, ctx, MARCH)
    expect(column(all, 'property')).toEqual(['Bersama', 'Kos Mawar', 'Kos Melati'])
    expect(column(buildExpensesSheet(expenses, ctx, MARCH, ['kos-a']), 'amount')).toEqual([2])
    expect(column(buildExpensesSheet(expenses, ctx, MARCH, ['kos-a', 'kos-b']), 'amount')).toEqual([2, 3])
  })

  it('filters by expense_date and sorts ascending', () => {
    const expenses = [
      makeExpense({ expense_date: '2026-03-31', amount: 3 }),
      makeExpense({ expense_date: '2026-04-01', amount: 9 }),
      makeExpense({ expense_date: '2026-03-01', amount: 1 }),
      makeExpense({ expense_date: '2026-02-28', amount: 9 }),
      makeExpense({ expense_date: '2026-03-15', amount: 2 }),
    ]
    expect(column(buildExpensesSheet(expenses, ctx, MARCH), 'amount')).toEqual([1, 2, 3])
  })
})

// ---------- invoices ----------

describe('buildInvoicesSheet', () => {
  const ctx = makeContext()

  it('has headers and computes paid / outstanding from rent payments only', () => {
    const inv = makeInvoice({ id: 'inv-1', invoice_number: 'INV-001', total_amount: 1_000_000, status: 'partial', due_date: '2026-03-01' })
    const payments = [
      makePayment({ invoice_id: 'inv-1', kind: 'rent', amount: 300_000 }),
      makePayment({ invoice_id: 'inv-1', kind: 'rent', amount: 200_000, paid_at: '2026-05-01' }), // outside range still counts
      makePayment({ invoice_id: 'inv-1', kind: 'deposit', amount: 500_000 }), // deposit never counts
      makePayment({ invoice_id: 'inv-other', kind: 'rent', amount: 999 }),
    ]
    const sheet = buildInvoicesSheet([inv], payments, ctx, MARCH)
    expect(sheet.name).toBe('Tagihan')
    expect(headers(sheet)).toEqual(['No. Tagihan', 'Kos', 'Kamar', 'Penyewa', 'Periode Awal', 'Periode Akhir', 'Jatuh Tempo', 'Total', 'Dibayar', 'Sisa', 'Status'])
    expect(sheet.rows).toEqual([
      {
        invoice_number: 'INV-001',
        property: 'Kos Mawar',
        room: 'A1',
        tenant: 'Budi Santoso',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        due_date: '2026-03-01',
        total_amount: 1_000_000,
        paid: 500_000,
        outstanding: 500_000,
        status: 'DP / Sebagian',
      },
    ])
  })

  it('outstanding is floored at 0 when over-paid', () => {
    const inv = makeInvoice({ id: 'inv-1', total_amount: 100_000, status: 'paid' })
    const sheet = buildInvoicesSheet([inv], [makePayment({ invoice_id: 'inv-1', amount: 150_000 })], ctx, MARCH)
    expect(sheet.rows[0]).toMatchObject({ paid: 150_000, outstanding: 0, status: 'Lunas' })
  })

  it('excludes void invoices, filters by due_date and property, falls back to -', () => {
    const invoices = [
      makeInvoice({ id: 'i1', invoice_number: 'INV-003', due_date: '2026-03-31', status: 'void' }),
      makeInvoice({ id: 'i2', invoice_number: 'INV-002', due_date: '2026-03-15', lease_id: 'lease-ghost' }),
      makeInvoice({ id: 'i3', invoice_number: 'INV-001', due_date: '2026-03-01', lease_id: 'lease-sari', property_id: 'kos-b' }),
      makeInvoice({ id: 'i4', invoice_number: 'INV-000', due_date: '2026-02-28' }),
      makeInvoice({ id: 'i5', invoice_number: 'INV-004', due_date: '2026-04-01' }),
    ]
    const sheet = buildInvoicesSheet(invoices, [], ctx, MARCH)
    expect(column(sheet, 'invoice_number')).toEqual(['INV-001', 'INV-002'])
    expect(sheet.rows[0]).toMatchObject({ property: 'Kos Melati', room: 'B1', tenant: 'Sari Dewi', status: 'Belum Bayar' })
    // unknown lease: kos from the invoice's own property_id, the rest '-'
    expect(sheet.rows[1]).toMatchObject({ property: 'Kos Mawar', room: '-', tenant: '-', paid: 0, outstanding: 1_000_000 })
    expect(column(buildInvoicesSheet(invoices, [], ctx, MARCH, ['kos-b']), 'invoice_number')).toEqual(['INV-001'])
  })

  it('sorts by due_date then invoice number (numeric aware)', () => {
    const invoices = [
      makeInvoice({ id: 'a', invoice_number: 'INV-10', due_date: '2026-03-05' }),
      makeInvoice({ id: 'b', invoice_number: 'INV-2', due_date: '2026-03-05' }),
      makeInvoice({ id: 'c', invoice_number: 'INV-1', due_date: '2026-03-20' }),
      makeInvoice({ id: 'd', invoice_number: 'INV-9', due_date: '2026-03-01' }),
    ]
    expect(column(buildInvoicesSheet(invoices, [], ctx, MARCH), 'invoice_number')).toEqual(['INV-9', 'INV-2', 'INV-10', 'INV-1'])
  })
})

// ---------- tenants ----------

describe('buildTenantsSheet', () => {
  it('lists every tenant sorted by name with active lease room/kos, or fallbacks', () => {
    const ctx = makeContext()
    const sheet = buildTenantsSheet(ctx)
    expect(sheet.name).toBe('Penyewa')
    expect(headers(sheet)).toEqual(['Nama', 'Telepon', 'NIK', 'Jenis Kelamin', 'Kos', 'Kamar', 'Status Sewa', 'Alamat', 'Pekerjaan'])
    expect(sheet.rows).toEqual([
      {
        full_name: 'Budi Santoso',
        phone: '0812',
        nik: '3171',
        gender: 'Laki-laki',
        property: 'Kos Mawar',
        room: 'A1',
        lease_status: 'Aktif',
        address: '-',
        occupation: '-',
      },
      {
        full_name: 'Sari Dewi',
        phone: '-',
        nik: '-',
        gender: 'Perempuan',
        // ended lease does not count; kos comes from the tenant's home property
        property: 'Kos Melati',
        room: '-',
        lease_status: 'Tidak ada sewa aktif',
        address: '-',
        occupation: 'Guru',
      },
    ])
  })

  it('sorts by full_name regardless of input order', () => {
    const ctx = makeContext()
    ctx.tenants.push(makeTenant({ id: 'tenant-andi', full_name: 'Andi', property_id: null }))
    expect(column(buildTenantsSheet(ctx), 'full_name')).toEqual(['Andi', 'Budi Santoso', 'Sari Dewi'])
  })

  it('prefers the active lease kos over the home kos', () => {
    const ctx = makeContext()
    // Budi's home is kos-a but his only active lease is in B1 (kos-b)
    ctx.leases = [makeLease({ id: 'lease-budi-2', room_id: 'room-b1', property_id: 'kos-b', tenant_id: 'tenant-budi', start_date: '2026-03-01' })]
    const row = buildTenantsSheet(ctx).rows[0]
    expect(row).toMatchObject({ full_name: 'Budi Santoso', property: 'Kos Melati', room: 'B1', lease_status: 'Aktif' })
  })

  it('reserved (future-start) active lease does not displace the tenant\'s current room in Penyewa sheet', () => {
    const ctx = makeContext()
    // Budi lives in A1 (Kos Mawar) until 2026-10-31 and has booked B1 (Kos Melati) from 2026-11-01 ('Dipesan').
    ctx.leases = [
      makeLease({ id: 'lease-budi-booking', room_id: 'room-b1', property_id: 'kos-b', tenant_id: 'tenant-budi', start_date: '2026-11-01', end_date: '2027-10-31' }),
      makeLease({ id: 'lease-budi-current', room_id: 'room-a1', property_id: 'kos-a', tenant_id: 'tenant-budi', start_date: '2026-01-01', end_date: '2026-10-31' }),
    ]
    const row = buildTenantsSheet(ctx).rows[0]
    expect(row).toMatchObject({ full_name: 'Budi Santoso', property: 'Kos Mawar', room: 'A1', lease_status: 'Aktif' })
  })

  it('activeLeaseFor ignores ended/cancelled leases and other tenants, picks earliest start, ties broken by id', () => {
    const leases = [
      makeLease({ id: 'l-ended', tenant_id: 'tenant-budi', status: 'ended', start_date: '2025-01-01' }),
      makeLease({ id: 'l-cancelled', tenant_id: 'tenant-budi', status: 'cancelled', start_date: '2025-06-01' }),
      makeLease({ id: 'l-other', tenant_id: 'tenant-sari', status: 'active', start_date: '2025-01-01' }),
      makeLease({ id: 'l-b', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-02-01' }),
      makeLease({ id: 'l-a', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-02-01' }),
      makeLease({ id: 'l-later', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-05-01' }),
    ]
    expect(activeLeaseFor('tenant-budi', leases)?.id).toBe('l-a')
    expect(activeLeaseFor('tenant-sari', leases)?.id).toBe('l-other')
    expect(activeLeaseFor('tenant-nobody', leases)).toBeUndefined()
  })

  it("tenant with no home kos and no active lease renders '-' for kos and gender", () => {
    const ctx = makeContext()
    ctx.tenants = [makeTenant({ id: 'tenant-x', full_name: 'Tamu', property_id: null, gender: null })]
    ctx.leases = []
    expect(buildTenantsSheet(ctx).rows[0]).toMatchObject({ property: '-', room: '-', gender: '-', lease_status: 'Tidak ada sewa aktif' })
  })

  it('active lease pointing at an unknown room still shows the lease kos and - for room', () => {
    const ctx = makeContext()
    ctx.leases = [makeLease({ id: 'l', room_id: 'room-ghost', property_id: 'kos-b', tenant_id: 'tenant-budi' })]
    expect(buildTenantsSheet(ctx).rows[0]).toMatchObject({ property: 'Kos Melati', room: '-', lease_status: 'Aktif' })
  })

  it('property filter uses tenant.property_id; null home kos only when unfiltered', () => {
    const ctx = makeContext()
    ctx.tenants.push(makeTenant({ id: 'tenant-andi', full_name: 'Andi', property_id: null }))
    expect(column(buildTenantsSheet(ctx), 'full_name')).toEqual(['Andi', 'Budi Santoso', 'Sari Dewi'])
    expect(column(buildTenantsSheet(ctx, ['kos-a']), 'full_name')).toEqual(['Budi Santoso'])
    expect(column(buildTenantsSheet(ctx, ['kos-b']), 'full_name')).toEqual(['Sari Dewi'])
    expect(column(buildTenantsSheet(ctx, ['kos-a', 'kos-b']), 'full_name')).toEqual(['Budi Santoso', 'Sari Dewi'])
  })
})

// ---------- summary ----------

describe('buildSummarySheet', () => {
  const summary: FinanceSummary = {
    revenue: 5_000_000,
    expenses: 3_400_000,
    netProfit: 1_600_000,
    margin: 0.32,
    depositsReceived: 500_000,
    depositRefunds: 250_000,
    billed: 4_000_000,
    collected: 4_200_000,
    collectionRate: 1.05,
    outstanding: 800_000,
    paymentCount: 4,
    expenseCount: 3,
  }
  const cashflow: CashflowPoint[] = [
    { key: '2026-03-01', label: '1 Mar', revenue: 1_500_000, expenses: 500_000, net: 1_000_000 },
    { key: '2026-03-02', label: '2 Mar', revenue: 0, expenses: 200_000, net: -200_000 },
  ]
  const byCategory: CategoryBreakdown[] = [
    { category: 'wages', label: 'Gaji & Upah', amount: 2_000_000, share: 0.588 },
    { category: 'utilities', label: 'Listrik, Air & Internet', amount: 1_400_000, share: 0.412 },
  ]
  const byProperty: PropertyBreakdown[] = [
    { propertyId: 'kos-a', name: 'Kos Mawar', revenue: 5_000_000, expenses: 3_000_000, net: 2_000_000 },
    { propertyId: 'shared', name: 'Bersama', revenue: 0, expenses: 400_000, net: -400_000 },
  ]

  it('emits rows in the documented order with percent notes', () => {
    const sheet = buildSummarySheet(summary, cashflow, byCategory, byProperty, MARCH, 'Laporan Maret 2026')
    expect(sheet.name).toBe('Ringkasan')
    expect(sheet.columns).toEqual([
      { key: 'label', header: 'Keterangan', type: 'string' },
      { key: 'value', header: 'Nilai', type: 'money' },
      { key: 'note', header: 'Catatan', type: 'string' },
    ])
    const blank = { label: '', value: null, note: '' }
    expect(sheet.rows).toEqual([
      { label: 'Laporan Maret 2026', value: null, note: '2026-03-01 s/d 2026-03-31' },
      { label: 'Pendapatan', value: 5_000_000, note: '' },
      { label: 'Pengeluaran', value: 3_400_000, note: '' },
      { label: 'Laba Bersih', value: 1_600_000, note: '' },
      { label: 'Margin', value: null, note: '32%' },
      { label: 'Uang Jaminan Diterima', value: 500_000, note: '' },
      { label: 'Pengembalian Uang Jaminan', value: 250_000, note: '' },
      { label: 'Ditagihkan', value: 4_000_000, note: '' },
      { label: 'Terkumpul', value: 4_200_000, note: '' },
      { label: 'Tingkat Penagihan', value: null, note: '105%' },
      { label: 'Piutang', value: 800_000, note: '' },
      blank,
      { label: 'Arus Kas', value: null, note: '' },
      { label: '1 Mar', value: 1_000_000, note: 'Masuk 1500000 / Keluar 500000' },
      { label: '2 Mar', value: -200_000, note: 'Masuk 0 / Keluar 200000' },
      blank,
      { label: 'Pengeluaran per Kategori', value: null, note: '' },
      { label: 'Gaji & Upah', value: 2_000_000, note: '59%' },
      { label: 'Listrik, Air & Internet', value: 1_400_000, note: '41%' },
      blank,
      { label: 'Laba per Kos', value: null, note: '' },
      { label: 'Kos Mawar', value: 2_000_000, note: 'Masuk 5000000 / Keluar 3000000' },
      { label: 'Bersama', value: -400_000, note: 'Masuk 0 / Keluar 400000' },
    ])
  })

  it("renders '-' for null ratios and keeps section headers when sections are empty", () => {
    const empty: FinanceSummary = { ...summary, revenue: 0, netProfit: -3_400_000, margin: null, billed: 0, collectionRate: null }
    const sheet = buildSummarySheet(empty, [], [], [], MARCH, 'Kosong')
    expect(sheet.rows.find((r) => r.label === 'Margin')?.note).toBe('-')
    expect(sheet.rows.find((r) => r.label === 'Tingkat Penagihan')?.note).toBe('-')
    expect(column(sheet, 'label').slice(11)).toEqual(['', 'Arus Kas', '', 'Pengeluaran per Kategori', '', 'Laba per Kos'])
  })

  it('formatPercent rounds to a whole percent', () => {
    expect(formatPercent(0.3249)).toBe('32%')
    expect(formatPercent(0.325)).toBe('33%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(-0.5)).toBe('-50%')
    expect(formatPercent(null)).toBe('-')
    expect(formatPercent(Number.NaN)).toBe('-')
  })
})

// ---------- CSV ----------

describe('toCsv', () => {
  const sheet: ExportSheet = {
    name: 'Uji',
    columns: [
      { key: 'date', header: 'Tanggal', type: 'date' },
      { key: 'name', header: 'Nama', type: 'string' },
      { key: 'amount', header: 'Jumlah', type: 'money' },
      { key: 'note', header: 'Catatan', type: 'string' },
    ],
    rows: [
      { date: '2026-03-01', name: 'Budi', amount: 1_500_000, note: null },
      { date: '2026-03-02', name: 'Sari; "Dewi"', amount: 0, note: 'baris\nbaru' },
    ],
  }

  it('prefixes a BOM, uses ; by default, CRLF line endings and no trailing newline', () => {
    const csv = toCsv(sheet)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1)).toBe(
      ['Tanggal;Nama;Jumlah;Catatan', '2026-03-01;Budi;1500000;', '2026-03-02;"Sari; ""Dewi""";0;"baris\nbaru"'].join('\r\n'),
    )
    expect(csv.endsWith('\r\n')).toBe(false)
  })

  it('quotes only what the chosen delimiter requires', () => {
    const csv = toCsv(sheet, ',').slice(1)
    // ';' is no longer special with the ',' delimiter, but the embedded quotes still force quoting
    expect(csv.split('\r\n')[2]).toBe('2026-03-02,"Sari; ""Dewi""",0,"baris\nbaru"')
    const comma: ExportSheet = { name: 'x', columns: [{ key: 'a', header: 'A', type: 'string' }], rows: [{ a: 'satu, dua' }] }
    expect(toCsv(comma, ',').slice(1)).toBe('A\r\n"satu, dua"')
    expect(toCsv(comma, ';').slice(1)).toBe('A\r\nsatu, dua')
  })

  it('quotes headers and cells containing \\r; writes numbers as plain digits; missing keys are empty', () => {
    const odd: ExportSheet = {
      name: 'x',
      columns: [
        { key: 'h', header: 'Nilai; Rp', type: 'money' },
        { key: 'missing', header: 'Kosong', type: 'string' },
      ],
      rows: [{ h: 12_345_678 }, { h: -5, missing: 'a\rb' }],
    }
    expect(toCsv(odd).slice(1)).toBe('"Nilai; Rp";Kosong\r\n12345678;\r\n-5;"a\rb"')
  })

  it('csvCell handles null, numbers and strings', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(2_500_000)).toBe('2500000')
    expect(csvCell('biasa')).toBe('biasa')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('a;b', ',')).toBe('a;b')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('round-trips a built sheet', () => {
    const ctx = makeContext()
    const csv = toCsv(buildExpensesSheet([makeExpense({ description: 'Beli sapu; pel', amount: 35_000, expense_date: '2026-03-02' })], ctx, MARCH))
    expect(csv.slice(1).split('\r\n')[1]).toBe('2026-03-02;Kos Mawar;Gaji & Upah;"Beli sapu; pel";-;35000')
  })
})

// ---------- file names ----------

describe('exportFileName', () => {
  it('builds the documented name', () => {
    expect(exportFileName('Pembayaran', MARCH, 'csv')).toBe('woombad-pembayaran-2026-03-01_2026-03-31.csv')
    expect(exportFileName('Ringkasan', { start: '2026-01-01', end: '2026-12-31' }, 'xlsx')).toBe('woombad-ringkasan-2026-01-01_2026-12-31.xlsx')
  })

  it('lowercases and collapses non [a-z0-9] runs into single dashes', () => {
    expect(exportFileName('Laporan  Keuangan (Kos Mawar)!', MARCH, 'csv')).toBe('woombad-laporan-keuangan-kos-mawar-2026-03-01_2026-03-31.csv')
    expect(exportFileName('  Tagihan 2026 ', MARCH, 'xlsx')).toBe('woombad-tagihan-2026-2026-03-01_2026-03-31.xlsx')
    expect(exportFileName('', MARCH, 'csv')).toBe('woombad-2026-03-01_2026-03-31.csv')
  })

  it('slugify', () => {
    expect(slugify('Kos Mawar & Melati')).toBe('kos-mawar-melati')
    expect(slugify('---')).toBe('')
    expect(slugify('ABC123')).toBe('abc123')
  })
})
