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
  currentLeaseFor,
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
  return {
    id: nextId('kos'),
    org_id: 'org',
    created_at: TS,
    updated_at: TS,
    name: 'Kos',
    address: null,
    notes: null,
    payment_info: null,
    logo_path: null,
    ...overrides,
  }
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
    created_by: null,
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
    period_type: null,
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
    lease_id: null,
    category: 'wages',
    amount: 500_000,
    expense_date: '2026-03-15',
    description: 'Gaji penjaga',
    vendor: null,
    receipt_path: null,
    created_by: null,
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
/** Reference day for the tenant sheet: after every fixture lease started, before any booking. */
const TODAY = '2026-10-11'

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
    expect(headers(sheet)).toEqual(['Tanggal', 'Kos', 'Kamar', 'Penyewa', 'Jenis', 'Metode', 'No. Tagihan', 'Sewa', 'Jumlah', 'Catatan'])
    expect(sheet.columns.find((c) => c.key === 'paid_at')?.type).toBe('date')
    expect(sheet.columns.find((c) => c.key === 'amount')?.type).toBe('money')
    expect(sheet.columns.find((c) => c.key === 'lease')?.type).toBe('string')
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
        lease: '-',
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
    // unknown lease: nothing to join; the Sewa column stays '-' rather than '- - -'
    expect(sheet.rows[0]).toMatchObject({ property: '-', room: '-', tenant: '-', invoice_number: '-', lease: '-', kind: 'Pemasukan Lain', method: 'QRIS', notes: '-', amount: 50_000 })
    // no lease: kos still resolved from the payment's own property_id; kind uses the shared PAYMENT_KIND_LABEL vocabulary
    expect(sheet.rows[1]).toMatchObject({ property: 'Kos Melati', room: '-', tenant: '-', invoice_number: '-', lease: '-', kind: 'Deposit (Uang Jaminan)', amount: 500_000 })
  })

  it("'Sewa' = 'tenant - room' only for payments with a lease but no invoice (deposits / other income)", () => {
    const sheet = buildPaymentsSheet(
      [
        makePayment({ paid_at: '2026-03-01', lease_id: 'lease-budi', invoice_id: null, kind: 'deposit', amount: 500_000 }),
        makePayment({ paid_at: '2026-03-02', lease_id: 'lease-budi', invoice_id: 'inv-1', kind: 'rent', amount: 1_000_000 }),
        makePayment({ paid_at: '2026-03-03', lease_id: 'lease-sari', invoice_id: null, kind: 'other', method: 'deposit', property_id: 'kos-b', amount: 150_000, notes: 'Potongan jaminan: kerusakan' }),
        makePayment({ paid_at: '2026-03-04', lease_id: null, invoice_id: null, kind: 'other', amount: 20_000 }),
      ],
      invoices,
      ctx,
      MARCH,
    )
    expect(column(sheet, 'lease')).toEqual(['Budi Santoso - A1', '-', 'Sari Dewi - B1', '-'])
    expect(sheet.rows[0]).toMatchObject({ kind: 'Deposit (Uang Jaminan)', property: 'Kos Mawar', room: 'A1', tenant: 'Budi Santoso', invoice_number: '-' })
    expect(sheet.rows[2]).toMatchObject({ kind: 'Pemasukan Lain', method: 'Potong Jaminan', property: 'Kos Melati', notes: 'Potongan jaminan: kerusakan' })
  })

  it("'Sewa' renders unknown tenant / room parts as '-' inside the pair", () => {
    const ctx2 = makeContext()
    ctx2.leases.push(makeLease({ id: 'lease-orphan', room_id: 'room-ghost', tenant_id: 'tenant-ghost', property_id: 'kos-a' }))
    const sheet = buildPaymentsSheet([makePayment({ lease_id: 'lease-orphan', invoice_id: null, kind: 'deposit' })], invoices, ctx2, MARCH)
    expect(sheet.rows[0]).toMatchObject({ lease: '- - -', property: 'Kos Mawar', room: '-', tenant: '-' })
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

  it('labels the refund categories (rent_refund / deposit_refund) like any other expense', () => {
    const sheet = buildExpensesSheet(
      [
        makeExpense({ category: 'rent_refund', lease_id: 'lease-budi', amount: 200_000, expense_date: '2026-03-05', description: 'Sewa batal' }),
        makeExpense({ category: 'deposit_refund', lease_id: 'lease-sari', amount: 500_000, expense_date: '2026-03-06', property_id: 'kos-b' }),
      ],
      ctx,
      MARCH,
    )
    expect(column(sheet, 'category')).toEqual(['Pengembalian Sewa', 'Pengembalian Uang Jaminan'])
    expect(column(sheet, 'amount')).toEqual([200_000, 500_000])
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

  it('derives Status from rent payments, ignoring a stale stored status', () => {
    const invoices = [
      makeInvoice({ id: 'stale-paid', invoice_number: 'INV-001', total_amount: 1_000_000, status: 'paid', due_date: '2026-03-01' }),
      makeInvoice({ id: 'stale-unpaid', invoice_number: 'INV-002', total_amount: 1_000_000, status: 'unpaid', due_date: '2026-03-02' }),
      makeInvoice({ id: 'stale-partial', invoice_number: 'INV-003', total_amount: 1_000_000, status: 'partial', due_date: '2026-03-03' }),
      makeInvoice({ id: 'exact', invoice_number: 'INV-004', total_amount: 750_000, status: 'unpaid', due_date: '2026-03-04' }),
      makeInvoice({ id: 'zero', invoice_number: 'INV-005', total_amount: 0, status: 'unpaid', due_date: '2026-03-05' }),
    ]
    const payments = [
      makePayment({ invoice_id: 'stale-unpaid', kind: 'rent', amount: 1_000_000 }), // fully paid, stored says unpaid
      makePayment({ invoice_id: 'stale-partial', kind: 'deposit', amount: 500_000 }), // deposit does not pay rent
      makePayment({ invoice_id: 'exact', kind: 'rent', amount: 400_000 }),
      makePayment({ invoice_id: 'exact', kind: 'rent', amount: 350_000 }),
    ]
    const sheet = buildInvoicesSheet(invoices, payments, ctx, MARCH)
    expect(column(sheet, 'status')).toEqual(['Belum Bayar', 'Lunas', 'Belum Bayar', 'Lunas', 'Lunas'])
    expect(column(sheet, 'paid')).toEqual([0, 1_000_000, 0, 750_000, 0])
    expect(column(sheet, 'outstanding')).toEqual([1_000_000, 0, 1_000_000, 0, 0])
  })

  it('excludes void invoices by default; includeVoid lists them as Dibatalkan with Sisa 0', () => {
    const invoices = [
      makeInvoice({ id: 'v', invoice_number: 'INV-001', total_amount: 1_000_000, status: 'void', due_date: '2026-03-01' }),
      makeInvoice({ id: 'u', invoice_number: 'INV-002', total_amount: 1_000_000, status: 'unpaid', due_date: '2026-03-02' }),
      makeInvoice({ id: 'v-out', invoice_number: 'INV-003', status: 'void', due_date: '2026-04-01' }),
    ]
    // a void invoice should have no rent payments (SPEC §2b.2); if one slips through it is still reported as paid
    const payments = [makePayment({ invoice_id: 'v', kind: 'rent', amount: 250_000 })]
    expect(column(buildInvoicesSheet(invoices, payments, ctx, MARCH), 'invoice_number')).toEqual(['INV-002'])
    expect(column(buildInvoicesSheet(invoices, payments, ctx, MARCH, undefined, {}), 'invoice_number')).toEqual(['INV-002'])
    expect(column(buildInvoicesSheet(invoices, payments, ctx, MARCH, undefined, { includeVoid: false }), 'invoice_number')).toEqual(['INV-002'])

    const withVoid = buildInvoicesSheet(invoices, payments, ctx, MARCH, undefined, { includeVoid: true })
    expect(column(withVoid, 'invoice_number')).toEqual(['INV-001', 'INV-002'])
    expect(withVoid.rows[0]).toMatchObject({ status: 'Dibatalkan', total_amount: 1_000_000, paid: 250_000, outstanding: 0 })
    expect(withVoid.rows[1]).toMatchObject({ status: 'Belum Bayar', outstanding: 1_000_000 })
    // includeVoid still respects the due_date range and the property filter
    expect(column(buildInvoicesSheet(invoices, payments, ctx, MARCH, ['kos-b'], { includeVoid: true }), 'invoice_number')).toEqual([])
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
  it('lists every tenant sorted by name with the room occupied today, or fallbacks', () => {
    const ctx = makeContext()
    const sheet = buildTenantsSheet(ctx, undefined, TODAY)
    expect(sheet.name).toBe('Penyewa')
    expect(headers(sheet)).toEqual(['Nama', 'Telepon', 'NIK', 'Jenis Identitas', 'Nomor Identitas', 'Kewarganegaraan', 'Jenis Kelamin', 'Kos', 'Kamar', 'Status Sewa', 'Alamat', 'Pekerjaan'])
    expect(sheet.rows).toEqual([
      {
        full_name: 'Budi Santoso',
        phone: '0812',
        nik: '3171',
        id_type: 'KTP',
        id_number: '3171',
        nationality: '-',
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
        id_type: 'KTP',
        id_number: '-',
        nationality: '-',
        gender: 'Perempuan',
        // lease ended with checkout 2026-02-28 does not count today; kos comes from the tenant's home property
        property: 'Kos Melati',
        room: '-',
        lease_status: 'Tidak ada sewa aktif',
        address: '-',
        occupation: 'Guru',
      },
    ])
  })

  it('todayISO defaults to the current date (an old active lease is current, a far-future one is reserved)', () => {
    const ctx = makeContext()
    ctx.leases = [
      makeLease({ id: 'lease-old', room_id: 'room-a1', property_id: 'kos-a', tenant_id: 'tenant-budi', start_date: '2000-01-01', end_date: '2000-01-31' }),
      makeLease({ id: 'lease-far', room_id: 'room-b1', property_id: 'kos-b', tenant_id: 'tenant-budi', start_date: '2999-01-01', end_date: '2999-01-31' }),
    ]
    expect(buildTenantsSheet(ctx).rows[0]).toMatchObject({ property: 'Kos Mawar', room: 'A1', lease_status: 'Aktif' })
    expect(buildTenantsSheet(ctx, undefined).rows[0]).toMatchObject({ room: 'A1' })
  })

  it('sorts by full_name regardless of input order', () => {
    const ctx = makeContext()
    ctx.tenants.push(makeTenant({ id: 'tenant-andi', full_name: 'Andi', property_id: null }))
    expect(column(buildTenantsSheet(ctx, undefined, TODAY), 'full_name')).toEqual(['Andi', 'Budi Santoso', 'Sari Dewi'])
  })

  it('prefers the current lease kos over the home kos', () => {
    const ctx = makeContext()
    // Budi's home is kos-a but his only current lease is in B1 (kos-b)
    ctx.leases = [makeLease({ id: 'lease-budi-2', room_id: 'room-b1', property_id: 'kos-b', tenant_id: 'tenant-budi', start_date: '2026-03-01' })]
    const row = buildTenantsSheet(ctx, undefined, TODAY).rows[0]
    expect(row).toMatchObject({ full_name: 'Budi Santoso', property: 'Kos Melati', room: 'B1', lease_status: 'Aktif' })
  })

  it("reserved (future-start) active lease does not displace the tenant's current room; it becomes current once started", () => {
    const ctx = makeContext()
    // Budi lives in A1 (Kos Mawar) and has booked B1 (Kos Melati) from 2026-11-01 ('Dipesan').
    ctx.leases = [
      makeLease({ id: 'lease-budi-booking', room_id: 'room-b1', property_id: 'kos-b', tenant_id: 'tenant-budi', start_date: '2026-11-01', end_date: '2027-10-31' }),
      makeLease({ id: 'lease-budi-current', room_id: 'room-a1', property_id: 'kos-a', tenant_id: 'tenant-budi', start_date: '2026-01-01', end_date: '2026-10-31' }),
    ]
    expect(buildTenantsSheet(ctx, undefined, '2026-10-11').rows[0]).toMatchObject({ full_name: 'Budi Santoso', property: 'Kos Mawar', room: 'A1', lease_status: 'Aktif' })
    // the day before the booking starts: still A1 (the booking is reserved, not current)
    expect(buildTenantsSheet(ctx, undefined, '2026-10-31').rows[0]).toMatchObject({ room: 'A1' })
    // once the booking has started it is the latest-started lease occupying today, so it wins even though the old one was not ended
    expect(buildTenantsSheet(ctx, undefined, '2026-11-01').rows[0]).toMatchObject({ property: 'Kos Melati', room: 'B1', lease_status: 'Aktif' })
    // a timestamp is accepted as todayISO
    expect(buildTenantsSheet(ctx, undefined, '2026-10-11T23:59:00Z').rows[0]).toMatchObject({ room: 'A1' })
  })

  it("a tenant with only a reservation shows the booked room with status 'Dipesan'", () => {
    const ctx = makeContext()
    ctx.leases = [makeLease({ id: 'lease-booking', room_id: 'room-a2', property_id: 'kos-a', tenant_id: 'tenant-budi', start_date: '2026-12-01', end_date: '2026-12-31' })]
    expect(buildTenantsSheet(ctx, undefined, TODAY).rows[0]).toMatchObject({ property: 'Kos Mawar', room: 'A2', lease_status: 'Dipesan' })
    // the booking is current on its first day
    expect(buildTenantsSheet(ctx, undefined, '2026-12-01').rows[0]).toMatchObject({ room: 'A2', lease_status: 'Aktif' })
  })

  it("an ended lease occupies the room until the day before checkout ('Selesai'); cancelled never does", () => {
    const ctx = makeContext()
    ctx.leases = [
      makeLease({ id: 'lease-ending', room_id: 'room-a1', property_id: 'kos-a', tenant_id: 'tenant-budi', status: 'ended', start_date: '2026-01-01', end_date: '2026-10-31', checkout_date: '2026-10-15' }),
      makeLease({ id: 'lease-cancelled', room_id: 'room-a2', property_id: 'kos-a', tenant_id: 'tenant-sari', status: 'cancelled', start_date: '2026-01-01', end_date: '2026-12-31' }),
    ]
    const dayBefore = buildTenantsSheet(ctx, undefined, '2026-10-14')
    expect(dayBefore.rows[0]).toMatchObject({ full_name: 'Budi Santoso', room: 'A1', lease_status: 'Selesai' })
    expect(dayBefore.rows[1]).toMatchObject({ full_name: 'Sari Dewi', room: '-', property: 'Kos Melati', lease_status: 'Tidak ada sewa aktif' })
    expect(buildTenantsSheet(ctx, undefined, '2026-10-15').rows[0]).toMatchObject({ room: '-', property: 'Kos Mawar', lease_status: 'Tidak ada sewa aktif' })
  })

  it('an ongoing active lease beats a later-started ended lease whose checkout is still in the future', () => {
    const ctx = makeContext()
    // Budi lives in A1 (active since 2026-01-01, no end). He also had A2 from 2026-05-01, already marked ended
    // with a planned checkout on 2026-10-31 (recorded early, SPEC §2b.5). Today (2026-10-11) both leases
    // "occupy", but his current room is still A1 and he is still 'Aktif'.
    ctx.leases = [
      makeLease({ id: 'l-main', room_id: 'room-a1', property_id: 'kos-a', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' }),
      makeLease({ id: 'l-temp', room_id: 'room-a2', property_id: 'kos-a', tenant_id: 'tenant-budi', status: 'ended', start_date: '2026-05-01', end_date: '2026-10-31', checkout_date: '2026-10-31' }),
    ]
    expect(buildTenantsSheet(ctx, undefined, '2026-10-11').rows[0]).toMatchObject({ full_name: 'Budi Santoso', room: 'A1', lease_status: 'Aktif' })
    expect(currentLeaseFor('tenant-budi', ctx.leases, '2026-10-11')?.id).toBe('l-main')
    // the same holds on the checkout day itself; after it only A1 is left anyway
    expect(currentLeaseFor('tenant-budi', ctx.leases, '2026-10-31')?.id).toBe('l-main')
    expect(currentLeaseFor('tenant-budi', ctx.leases, '2026-11-01')?.id).toBe('l-main')
    // order of input does not matter
    expect(currentLeaseFor('tenant-budi', [...ctx.leases].reverse(), '2026-10-11')?.id).toBe('l-main')
    // when ONLY ended leases occupy (tenant already checked out of everything), the latest-started one wins
    const endedOnly = ctx.leases.map((l) => ({ ...l, status: 'ended' as const, checkout_date: '2026-10-31' }))
    expect(currentLeaseFor('tenant-budi', endedOnly, '2026-10-11')?.id).toBe('l-temp')
    expect(buildTenantsSheet({ ...ctx, leases: endedOnly }, undefined, '2026-10-11').rows[0]).toMatchObject({ room: 'A2', lease_status: 'Selesai' })
  })

  it('currentLeaseFor picks the lease occupying on the date, latest start wins, ties broken by id', () => {
    const leases = [
      makeLease({ id: 'l-ended', tenant_id: 'tenant-budi', status: 'ended', start_date: '2025-01-01', end_date: '2025-06-30', checkout_date: '2025-06-30' }),
      makeLease({ id: 'l-cancelled', tenant_id: 'tenant-budi', status: 'cancelled', start_date: '2025-06-01' }),
      makeLease({ id: 'l-other', tenant_id: 'tenant-sari', status: 'active', start_date: '2025-01-01' }),
      makeLease({ id: 'l-b', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-02-01' }),
      makeLease({ id: 'l-a', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-02-01' }),
      makeLease({ id: 'l-later', tenant_id: 'tenant-budi', status: 'active', start_date: '2026-05-01' }),
      makeLease({ id: 'l-future', tenant_id: 'tenant-budi', status: 'active', start_date: '2027-01-01' }),
    ]
    expect(currentLeaseFor('tenant-budi', leases, '2026-10-11')?.id).toBe('l-later')
    expect(currentLeaseFor('tenant-budi', leases, '2026-03-01')?.id).toBe('l-a')
    expect(currentLeaseFor('tenant-budi', leases, '2025-06-29')?.id).toBe('l-ended')
    expect(currentLeaseFor('tenant-budi', leases, '2025-06-30')).toBeUndefined() // checkout day
    expect(currentLeaseFor('tenant-sari', leases, '2026-10-11')?.id).toBe('l-other')
    expect(currentLeaseFor('tenant-nobody', leases, '2026-10-11')).toBeUndefined()
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

  it("tenant with no home kos and no lease renders '-' for kos and gender", () => {
    const ctx = makeContext()
    ctx.tenants = [makeTenant({ id: 'tenant-x', full_name: 'Tamu', property_id: null, gender: null })]
    ctx.leases = []
    expect(buildTenantsSheet(ctx, undefined, TODAY).rows[0]).toMatchObject({ property: '-', room: '-', gender: '-', lease_status: 'Tidak ada sewa aktif' })
  })

  it('current lease pointing at an unknown room still shows the lease kos and - for room', () => {
    const ctx = makeContext()
    ctx.leases = [makeLease({ id: 'l', room_id: 'room-ghost', property_id: 'kos-b', tenant_id: 'tenant-budi' })]
    expect(buildTenantsSheet(ctx, undefined, TODAY).rows[0]).toMatchObject({ property: 'Kos Melati', room: '-', lease_status: 'Aktif' })
  })

  it('property filter uses tenant.property_id; null home kos only when unfiltered', () => {
    const ctx = makeContext()
    ctx.tenants.push(makeTenant({ id: 'tenant-andi', full_name: 'Andi', property_id: null }))
    expect(column(buildTenantsSheet(ctx, undefined, TODAY), 'full_name')).toEqual(['Andi', 'Budi Santoso', 'Sari Dewi'])
    expect(column(buildTenantsSheet(ctx, ['kos-a'], TODAY), 'full_name')).toEqual(['Budi Santoso'])
    expect(column(buildTenantsSheet(ctx, ['kos-b'], TODAY), 'full_name')).toEqual(['Sari Dewi'])
    expect(column(buildTenantsSheet(ctx, ['kos-a', 'kos-b'], TODAY), 'full_name')).toEqual(['Budi Santoso', 'Sari Dewi'])
  })
})

// ---------- summary ----------

describe('buildSummarySheet', () => {
  /**
   * March: rent 4.800.000 (of which 300.000 was potong jaminan) + other 400.000 - rent refund 200.000 = revenue 5.000.000.
   * Opex 3.400.000 -> net profit 1.600.000 (32%). Deposits: received 500.000, refunded 250.000, held 1.200.000.
   */
  const summary: FinanceSummary = {
    revenue: 5_000_000,
    rentRevenue: 4_800_000,
    otherRevenue: 400_000,
    rentRefunds: 200_000,
    expenses: 3_400_000,
    netProfit: 1_600_000,
    margin: 0.32,
    depositsReceived: 500_000,
    depositsApplied: 300_000,
    depositRefunds: 250_000,
    depositsHeld: 1_200_000,
    sharedExpensesExcluded: 0,
    billed: 4_000_000,
    collected: 4_200_000,
    collectionRate: 1.05,
    rentReceived: 4_800_000,
    outstanding: 800_000,
    overdue: 650_000,
    notYetDue: 150_000,
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
  const blank = { label: '', value: null, note: '' }

  it('emits rows in the documented order with percent notes', () => {
    const sheet = buildSummarySheet(summary, cashflow, byCategory, byProperty, MARCH, 'Laporan Maret 2026')
    expect(sheet.name).toBe('Ringkasan')
    expect(sheet.columns).toEqual([
      { key: 'label', header: 'Keterangan', type: 'string' },
      { key: 'value', header: 'Nilai', type: 'money' },
      { key: 'note', header: 'Catatan', type: 'string' },
    ])
    expect(sheet.rows.slice(0, 13)).toEqual([
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
      { label: 'Rekonsiliasi Kas', value: null, note: '' },
    ])
    expect(sheet.rows.slice(29)).toEqual([
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

  it("'Rekonsiliasi Kas' lists the 16 rows with cash in/out computed from the components", () => {
    const sheet = buildSummarySheet(summary, cashflow, byCategory, byProperty, MARCH, 'Laporan Maret 2026')
    const section = sheet.rows.slice(13, 29).map((r) => [r.label, r.value])
    // kas masuk = 4.800.000 + 400.000 - 300.000 + 500.000 = 5.400.000; kas keluar = 3.400.000 + 200.000 + 250.000 = 3.850.000
    expect(section).toEqual([
      ['Pendapatan sewa bruto', 4_800_000],
      ['Pemasukan lain', 400_000],
      ['Pengembalian sewa', -200_000],
      ['Pendapatan bersih', 5_000_000],
      ['Uang jaminan diterima', 500_000],
      ['Potong jaminan (non-kas)', -300_000],
      ['Total kas masuk', 5_400_000],
      ['Pengeluaran operasional', 3_400_000],
      ['Pengembalian sewa (kas keluar)', 200_000],
      ['Pengembalian uang jaminan', 250_000],
      ['Total kas keluar', 3_850_000],
      ['Arus kas bersih', 1_550_000],
      ['Laba bersih', 1_600_000],
      ['Uang jaminan dipegang (akhir periode)', 1_200_000],
      ['Piutang jatuh tempo', 650_000],
      ['Piutang belum jatuh tempo', 150_000],
    ])
    // the visible rows add up: bruto + lain + (negative) pengembalian = pendapatan bersih
    expect(4_800_000 + 400_000 + -200_000).toBe(5_000_000)
    // arus kas bersih differs from laba bersih by the non-cash / non-P&L items: -300.000 (potong) +500.000 (jaminan) -250.000 (refund)
    expect(1_600_000 - 300_000 + 500_000 - 250_000).toBe(1_550_000)
    // every reconciliation row is a money cell (never null) and notes are strings
    for (const r of sheet.rows.slice(13, 29)) {
      expect(typeof r.value).toBe('number')
      expect(typeof r.note).toBe('string')
    }
  })

  it('reconciliation with zero deposits and refunds: kas masuk = pendapatan, kas keluar = opex, arus kas = laba', () => {
    const plain: FinanceSummary = {
      ...summary,
      rentRevenue: 2_000_000,
      otherRevenue: 0,
      rentRefunds: 0,
      revenue: 2_000_000,
      expenses: 750_000,
      netProfit: 1_250_000,
      depositsReceived: 0,
      depositsApplied: 0,
      depositRefunds: 0,
      depositsHeld: 0,
      overdue: 0,
      notYetDue: 0,
    }
    const sheet = buildSummarySheet(plain, [], [], [], MARCH, 'Polos')
    const byLabel = new Map(sheet.rows.map((r) => [r.label, r.value]))
    expect(byLabel.get('Total kas masuk')).toBe(2_000_000)
    expect(byLabel.get('Total kas keluar')).toBe(750_000)
    expect(byLabel.get('Arus kas bersih')).toBe(1_250_000)
    expect(byLabel.get('Laba bersih')).toBe(1_250_000)
    expect(byLabel.get('Pengembalian sewa')).toBe(0)
    expect(byLabel.get('Potong jaminan (non-kas)')).toBe(0)
    expect(byLabel.get('Uang jaminan dipegang (akhir periode)')).toBe(0)
  })

  it("renders '-' for null ratios and keeps section headers when sections are empty", () => {
    const empty: FinanceSummary = { ...summary, revenue: 0, netProfit: -3_400_000, margin: null, billed: 0, collectionRate: null }
    const sheet = buildSummarySheet(empty, [], [], [], MARCH, 'Kosong')
    expect(sheet.rows.find((r) => r.label === 'Margin')?.note).toBe('-')
    expect(sheet.rows.find((r) => r.label === 'Tingkat Penagihan')?.note).toBe('-')
    expect(column(sheet, 'label').slice(11, 13)).toEqual(['', 'Rekonsiliasi Kas'])
    expect(column(sheet, 'label').slice(29)).toEqual(['', 'Arus Kas', '', 'Pengeluaran per Kategori', '', 'Laba per Kos'])
    expect(sheet.rows).toHaveLength(35)
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

  it("guards formula injection: string cells starting with = + - @ \\t \\r get a leading ', numbers do not", () => {
    const risky: ExportSheet = {
      name: 'x',
      columns: [
        { key: 's', header: 'Teks', type: 'string' },
        { key: 'n', header: 'Jumlah', type: 'money' },
      ],
      rows: [
        { s: '=HYPERLINK("http://evil";"klik")', n: -200_000 },
        { s: '+62 812', n: 0 },
        { s: '-5 ribu', n: -5 },
        { s: '@budi', n: 1 },
        { s: '\tx', n: 2 },
        { s: '\rx', n: 3 },
        { s: 'a=b', n: 4 },
        { s: '', n: 5 },
        { s: '-A1+B2', n: 6 },
        { s: '+SUM(A1:A9)', n: 7 },
      ],
    }
    expect(toCsv(risky).slice(1).split('\r\n')).toEqual([
      'Teks;Jumlah',
      `"'=HYPERLINK(""http://evil"";""klik"")";-200000`,
      `'+62 812;0`,
      `'-5 ribu;-5`,
      `'@budi;1`,
      `'\tx;2`,
      `"'\rx";3`,
      'a=b;4',
      ';5',
      `'-A1+B2;6`,
      `'+SUM(A1:A9);7`,
    ])
    expect(csvCell('=1+1')).toBe(`'=1+1`)
    expect(csvCell('=a;b')).toBe(`"'=a;b"`)
    expect(csvCell('=a;b', ',')).toBe(`'=a;b`)
    expect(csvCell(-1_000)).toBe('-1000')
  })

  it("does not guard the '-' placeholder or plain signed numbers / percents (they can never be formulas)", () => {
    expect(csvCell('-')).toBe('-')
    expect(csvCell('-68%')).toBe('-68%')
    expect(csvCell('+5%')).toBe('+5%')
    expect(csvCell('+62812')).toBe('+62812')
    expect(csvCell('-1.500,5')).toBe('-1.500,5')
    // anything else after the sign is still guarded
    expect(csvCell('--')).toBe(`'--`)
    expect(csvCell('-%')).toBe(`'-%`)
    expect(csvCell('-68% rugi')).toBe(`'-68% rugi`)
    expect(csvCell('-1e5')).toBe(`'-1e5`)
    expect(csvCell('+62 812')).toBe(`'+62 812`)
    expect(csvCell('=-5')).toBe(`'=-5`)
    expect(csvCell('@-5')).toBe(`'@-5`)
  })

  it('a loss month exports its negative margin and null ratios verbatim', () => {
    const loss: FinanceSummary = {
      revenue: 1_000_000,
      rentRevenue: 1_000_000,
      otherRevenue: 0,
      rentRefunds: 0,
      expenses: 1_680_000,
      netProfit: -680_000,
      margin: -0.68,
      depositsReceived: 0,
      depositsApplied: 0,
      depositRefunds: 0,
      depositsHeld: 0,
      sharedExpensesExcluded: 0,
      billed: 0,
      collected: 0,
      collectionRate: null,
      rentReceived: 1_000_000,
      outstanding: 0,
      overdue: 0,
      notYetDue: 0,
      paymentCount: 1,
      expenseCount: 2,
    }
    const lines = toCsv(buildSummarySheet(loss, [], [], [], MARCH, 'Rugi')).slice(1).split('\r\n')
    expect(lines).toContain('Laba Bersih;-680000;')
    expect(lines).toContain('Margin;;-68%')
    expect(lines).toContain('Tingkat Penagihan;;-')
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

  it("round-trips a built sheet (the '-' placeholder for a missing vendor is written verbatim, not guarded)", () => {
    const ctx = makeContext()
    const csv = toCsv(buildExpensesSheet([makeExpense({ description: 'Beli sapu; pel', amount: 35_000, expense_date: '2026-03-02' })], ctx, MARCH))
    expect(csv.slice(1).split('\r\n')[1]).toBe(`2026-03-02;Kos Mawar;Gaji & Upah;"Beli sapu; pel";-;35000`)
    // a vendor that starts with a sign is still guarded
    const guarded = toCsv(buildExpensesSheet([makeExpense({ vendor: '-Toko Jaya-', amount: 1, expense_date: '2026-03-02' })], ctx, MARCH))
    expect(guarded.slice(1).split('\r\n')[1]).toBe(`2026-03-02;Kos Mawar;Gaji & Upah;Gaji penjaga;'-Toko Jaya-;1`)
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


describe('buildTenantsSheet identity columns', () => {
  it('exports the document type, number and nationality for KTP and passport tenants', () => {
    const ctx = makeContext()
    ctx.leases = []
    ctx.tenants = [
      makeTenant({ id: 't-ktp', full_name: 'Budi Santoso', nik: '3273010101900001', id_type: 'ktp', id_number: null, nationality: null }),
      makeTenant({ id: 't-pass', full_name: 'John Smith', nik: null, id_type: 'passport', id_number: 'PA1234567', nationality: 'AUS' }),
    ]
    const sheet = buildTenantsSheet(ctx, undefined, '2026-10-12')
    const headers = sheet.columns.map((c) => c.header)
    expect(headers).toEqual(expect.arrayContaining(['Jenis Identitas', 'Nomor Identitas', 'Kewarganegaraan']))
    const budi = sheet.rows.find((r) => r.full_name === 'Budi Santoso')!
    const john = sheet.rows.find((r) => r.full_name === 'John Smith')!
    expect(budi).toMatchObject({ id_type: 'KTP', id_number: '3273010101900001', nationality: '-' })
    expect(john).toMatchObject({ id_type: 'Paspor', id_number: 'PA1234567', nationality: 'AUS', nik: '-' })
  })
})
