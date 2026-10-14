import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../types/db'
import { toDateISO } from '../lib/format'
import {
  FALLBACK_PROPERTY_NAME,
  FALLBACK_ROOM_NAME,
  FALLBACK_TENANT_NAME,
  buildInvoiceDocument,
  invoiceFileName,
  invoiceFreeText,
  invoiceShareText,
  invoiceStatusLabel,
  type InvoiceDocumentInput,
} from './invoiceDocument'

// ---------- fixtures ----------

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`
const TS = '2026-10-01T03:00:00+00:00'
const base = { org_id: 'org', created_at: TS, updated_at: TS }

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    ...base,
    property_id: 'kos-1',
    room_id: 'room-1',
    tenant_id: 'tenant-1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 500_000,
    start_date: '2026-10-01',
    end_date: '2026-10-31',
    status: 'active',
    checkout_date: null,
    notes: null,
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const inv: Invoice = {
    id: 'inv-1',
    ...base,
    property_id: 'kos-1',
    lease_id: 'lease-1',
    invoice_number: 'INV-202610-0001',
    period_type: 'monthly',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    quantity: 1,
    base_amount: 1_500_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_500_000,
    due_date: '2026-10-01',
    status: 'unpaid',
    notes: null,
    ...overrides,
  }
  if (overrides.total_amount === undefined) inv.total_amount = inv.base_amount + inv.addons_amount + inv.extra_amount - inv.discount_amount
  return inv
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId('pay'),
    org_id: 'org',
    created_at: TS,
    property_id: 'kos-1',
    invoice_id: 'inv-1',
    lease_id: 'lease-1',
    amount: 500_000,
    paid_at: '2026-10-02',
    method: 'transfer',
    kind: 'rent',
    notes: null,
    created_by: null,
    ...overrides,
  }
}

function makeAddon(name: string, amount: number, billing: LeaseAddon['billing'] = 'per_period'): LeaseAddon {
  return { id: nextId('addon'), org_id: 'org', created_at: TS, lease_id: 'lease-1', name, amount, billing }
}

const tenant: Tenant = {
  id: 'tenant-1',
  ...base,
  property_id: 'kos-1',
  full_name: 'Budi Santoso',
  nik: null,
  id_type: 'ktp',
  id_number: null,
  nationality: null,
  phone: '081234567890',
  gender: 'L',
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
}

const room: Room = {
  id: 'room-1',
  ...base,
  property_id: 'kos-1',
  name: 'A1',
  floor: '1',
  price_daily: 100_000,
  price_weekly: 600_000,
  price_monthly: 1_500_000,
  status: 'active',
  notes: null,
}

const property: Property = {
  id: 'kos-1',
  ...base,
  name: 'Kos Melati',
  address: 'Jl. Melati No. 12, Bandung',
  notes: null,
  payment_info: 'BCA 1234567890 a.n. Ibu Sari',
  logo_path: 'org/logo.png',
}

function build(overrides: Partial<InvoiceDocumentInput> = {}) {
  return buildInvoiceDocument({
    invoice: makeInvoice(),
    lease: makeLease(),
    tenant,
    room,
    property,
    payments: [],
    leaseAddons: [],
    ...overrides,
  })
}

// ---------- tests ----------

describe('buildInvoiceDocument: full breakdown', () => {
  const leaseAddons = [makeAddon('Parkir motor', 50_000), makeAddon('Kasur tambahan', 150_000)]
  const invoice = makeInvoice({
    addons_amount: 200_000,
    extra_amount: 175_000,
    discount_amount: 25_000,
    notes: 'Listrik: 125000; Denda: 50000\nToken bulan Oktober',
    status: 'partial',
  })
  const payments = [
    makePayment({ amount: 350_000, paid_at: '2026-10-05', method: 'cash' }),
    makePayment({ amount: 500_000, paid_at: '2026-10-02', method: 'transfer' }),
    makePayment({ amount: 999_999, kind: 'deposit', invoice_id: null }),
    makePayment({ amount: 777_777, invoice_id: 'inv-other' }),
  ]
  const doc = build({ invoice, leaseAddons, payments })

  it('copies header, parties and period', () => {
    expect(doc.title).toBe('TAGIHAN')
    expect(doc.number).toBe('INV-202610-0001')
    expect(doc.issuedDate).toBe(toDateISO(new Date(TS)))
    expect(doc.dueDate).toBe('2026-10-01')
    expect(doc.status).toBe('partial')
    expect(doc.property).toEqual({
      name: 'Kos Melati',
      address: 'Jl. Melati No. 12, Bandung',
      paymentInfo: 'BCA 1234567890 a.n. Ibu Sari',
      logoPath: 'org/logo.png',
    })
    expect(doc.tenant).toEqual({ name: 'Budi Santoso', phone: '081234567890' })
    expect(doc.room).toBe('A1')
    expect(doc.period).toEqual({ start: '2026-10-01', end: '2026-10-31', quantity: 1, unit: 'bulan', typeLabel: 'Bulanan' })
  })

  it('lists rent, named add-ons and the extras from the notes convention', () => {
    expect(doc.lines).toEqual([
      { label: 'Sewa kamar A1', detail: 'Bulanan · 1 bulan · 1 Okt – 31 Okt 2026', amount: 1_500_000 },
      { label: 'Parkir motor', detail: '1 × Rp 50.000', amount: 50_000 },
      { label: 'Kasur tambahan', detail: '1 × Rp 150.000', amount: 150_000 },
      { label: 'Listrik / token', amount: 125_000 },
      { label: 'Denda', amount: 50_000 },
    ])
    const sum = doc.lines.reduce((s, l) => s + l.amount, 0)
    expect(sum - doc.discount).toBe(doc.total)
  })

  it('amounts come from the stored row; paid / remaining from the rent payments of this invoice only', () => {
    expect(doc.discount).toBe(25_000)
    expect(doc.total).toBe(1_850_000)
    expect(doc.paid).toBe(850_000)
    expect(doc.remaining).toBe(1_000_000)
    expect(doc.statusLabel).toBe('DP / SEBAGIAN')
  })

  it('lists the rent payments oldest first with Indonesian method labels', () => {
    expect(doc.payments).toEqual([
      { date: '2026-10-02', amount: 500_000, methodLabel: 'Transfer' },
      { date: '2026-10-05', amount: 350_000, methodLabel: 'Tunai' },
    ])
  })

  it('keeps only the free text of the notes', () => {
    expect(doc.notes).toBe('Token bulan Oktober')
  })
})

describe('buildInvoiceDocument: add-on lines', () => {
  const leaseAddons = [makeAddon('Parkir motor', 50_000), makeAddon('Kasur tambahan', 150_000), makeAddon('Kunci cadangan', 25_000, 'one_time')]
  const quantity3 = { quantity: 3, period_end: '2026-12-31', base_amount: 4_500_000 }

  it('names the per_period add-ons when they alone explain addons_amount (later invoice)', () => {
    const doc = build({ invoice: makeInvoice({ ...quantity3, addons_amount: 600_000 }), leaseAddons })
    expect(doc.lines.slice(1)).toEqual([
      { label: 'Parkir motor', detail: '3 × Rp 50.000', amount: 150_000 },
      { label: 'Kasur tambahan', detail: '3 × Rp 150.000', amount: 450_000 },
    ])
  })

  it('adds the one_time add-ons when the first-invoice combination matches', () => {
    const doc = build({ invoice: makeInvoice({ ...quantity3, addons_amount: 625_000 }), leaseAddons })
    expect(doc.lines.slice(1)).toEqual([
      { label: 'Parkir motor', detail: '3 × Rp 50.000', amount: 150_000 },
      { label: 'Kasur tambahan', detail: '3 × Rp 150.000', amount: 450_000 },
      { label: 'Kunci cadangan', detail: 'Sekali bayar', amount: 25_000 },
    ])
  })

  it('falls back to a single Add-on line when neither combination matches', () => {
    const doc = build({ invoice: makeInvoice({ ...quantity3, addons_amount: 999_999 }), leaseAddons })
    expect(doc.lines.slice(1)).toEqual([{ label: 'Add-on', amount: 999_999 }])
  })

  it('falls back to a single Add-on line when the lease has no add-ons on record', () => {
    const doc = build({ invoice: makeInvoice({ addons_amount: 100_000 }), leaseAddons: [] })
    expect(doc.lines.slice(1)).toEqual([{ label: 'Add-on', amount: 100_000 }])
  })

  it('skips add-ons entirely when addons_amount is 0', () => {
    const doc = build({ invoice: makeInvoice({ addons_amount: 0 }), leaseAddons })
    expect(doc.lines).toHaveLength(1)
  })

  it('prefers the per_period-only combination when both match (one_time add-on of Rp 0)', () => {
    const addons = [makeAddon('Parkir motor', 50_000), makeAddon('Gratis', 0, 'one_time')]
    const doc = build({ invoice: makeInvoice({ addons_amount: 50_000 }), leaseAddons: addons })
    expect(doc.lines.slice(1)).toEqual([{ label: 'Parkir motor', detail: '1 × Rp 50.000', amount: 50_000 }])
  })
})

describe('buildInvoiceDocument: extra lines', () => {
  it('shows one line per part, including Lainnya, when the breakdown adds up', () => {
    const doc = build({ invoice: makeInvoice({ extra_amount: 135_000, notes: 'Listrik: 125000; Lainnya: 10000' }) })
    expect(doc.lines.slice(1)).toEqual([
      { label: 'Listrik / token', amount: 125_000 },
      { label: 'Lainnya', amount: 10_000 },
    ])
    expect(doc.notes).toBeNull()
  })

  it('parses a hand-typed breakdown (dots, Rp) for the lines but keeps the non-canonical text as notes', () => {
    const doc = build({ invoice: makeInvoice({ extra_amount: 135_000, notes: 'Listrik: 125.000; Lainnya: Rp 10000' }) })
    expect(doc.lines.slice(1).map((l) => l.amount)).toEqual([125_000, 10_000])
    expect(doc.notes).toBe('Listrik: 125.000; Lainnya: Rp 10000')
  })

  it('falls back to Tambahan when the breakdown does not add up', () => {
    const doc = build({ invoice: makeInvoice({ extra_amount: 200_000, notes: 'Listrik: 125000; Denda: 50000' }) })
    expect(doc.lines.slice(1)).toEqual([{ label: 'Tambahan', amount: 200_000 }])
  })

  it('falls back to Tambahan when there is no breakdown at all', () => {
    const doc = build({ invoice: makeInvoice({ extra_amount: 80_000, notes: 'Kerusakan kunci' }) })
    expect(doc.lines.slice(1)).toEqual([{ label: 'Tambahan', amount: 80_000 }])
    expect(doc.notes).toBe('Kerusakan kunci')
  })

  it('shows nothing when extra_amount is 0, even with a stale breakdown line', () => {
    const doc = build({ invoice: makeInvoice({ extra_amount: 0, notes: 'Listrik: 125000\nCatatan' }) })
    expect(doc.lines).toHaveLength(1)
    expect(doc.notes).toBe('Catatan')
  })
})

describe('buildInvoiceDocument: status derived from payments', () => {
  it('unpaid: no rent payment', () => {
    const doc = build({ payments: [makePayment({ kind: 'deposit', invoice_id: null })] })
    expect(doc.paid).toBe(0)
    expect(doc.remaining).toBe(1_500_000)
    expect(doc.statusLabel).toBe('BELUM BAYAR')
    expect(doc.payments).toEqual([])
  })

  it('partial: some rent paid', () => {
    const doc = build({ payments: [makePayment({ amount: 600_000 })] })
    expect(doc.statusLabel).toBe('DP / SEBAGIAN')
    expect(doc.remaining).toBe(900_000)
  })

  it('paid: rent payments reach the total, deposit deduction included, whatever the stored status says', () => {
    const doc = build({
      invoice: makeInvoice({ status: 'partial' }),
      payments: [makePayment({ amount: 1_000_000 }), makePayment({ amount: 500_000, method: 'deposit', paid_at: '2026-10-03' })],
    })
    expect(doc.statusLabel).toBe('LUNAS')
    expect(doc.remaining).toBe(0)
    expect(doc.payments[1]).toEqual({ date: '2026-10-03', amount: 500_000, methodLabel: 'Potong Jaminan' })
  })

  it('overpayment never yields a negative remaining', () => {
    const doc = build({ payments: [makePayment({ amount: 2_000_000 })] })
    expect(doc.remaining).toBe(0)
    expect(doc.statusLabel).toBe('LUNAS')
  })

  it('a free period (total 0) is LUNAS', () => {
    const doc = build({ invoice: makeInvoice({ base_amount: 0 }) })
    expect(doc.total).toBe(0)
    expect(doc.statusLabel).toBe('LUNAS')
  })

  it('void wins over payments', () => {
    const doc = build({ invoice: makeInvoice({ status: 'void' }), payments: [makePayment({ amount: 1_500_000 })] })
    expect(doc.status).toBe('void')
    expect(doc.statusLabel).toBe('DIBATALKAN')
  })

  it('invoiceStatusLabel covers every branch', () => {
    expect(invoiceStatusLabel('void', 0, 100)).toBe('DIBATALKAN')
    expect(invoiceStatusLabel('unpaid', 100, 0)).toBe('LUNAS')
    expect(invoiceStatusLabel('unpaid', 50, 50)).toBe('DP / SEBAGIAN')
    expect(invoiceStatusLabel('paid', 0, 100)).toBe('BELUM BAYAR')
  })
})

describe('buildInvoiceDocument: missing lookups and fallbacks', () => {
  it('falls back to Penyewa / - / Kos when the rows are missing', () => {
    const doc = build({ tenant: null, room: undefined, property: null })
    expect(doc.tenant).toEqual({ name: FALLBACK_TENANT_NAME, phone: null })
    expect(doc.room).toBe(FALLBACK_ROOM_NAME)
    expect(doc.property).toEqual({ name: FALLBACK_PROPERTY_NAME, address: null, paymentInfo: null, logoPath: null })
    expect(doc.lines[0].label).toBe('Sewa kamar -')
  })

  it('treats blank names and blank payment info as missing', () => {
    const doc = build({
      tenant: { ...tenant, full_name: '  ' },
      room: { ...room, name: '' },
      property: { ...property, name: ' ', payment_info: '  ', logo_path: null },
    })
    expect(doc.tenant.name).toBe(FALLBACK_TENANT_NAME)
    expect(doc.room).toBe(FALLBACK_ROOM_NAME)
    expect(doc.property.name).toBe(FALLBACK_PROPERTY_NAME)
    expect(doc.property.paymentInfo).toBeNull()
    expect(doc.property.logoPath).toBeNull()
  })

  it('issuedDate uses created_at in local time and falls back to period_start', () => {
    expect(build({ invoice: makeInvoice({ created_at: '2026-10-13T23:30:00' }) }).issuedDate).toBe('2026-10-13')
    expect(build({ invoice: makeInvoice({ created_at: '' }) }).issuedDate).toBe('2026-10-01')
    expect(build({ invoice: makeInvoice({ created_at: 'kemarin' }) }).issuedDate).toBe('2026-10-01')
  })

  it('period type comes from the invoice, else from the lease (older rows)', () => {
    const daily = build({ invoice: makeInvoice({ period_type: 'daily', quantity: 3, period_end: '2026-10-03', base_amount: 300_000 }) })
    expect(daily.period).toMatchObject({ quantity: 3, unit: 'malam', typeLabel: 'Harian' })
    expect(daily.lines[0].detail).toBe('Harian · 3 malam · 1 Okt – 3 Okt 2026')
    const legacy = build({ invoice: makeInvoice({ period_type: null }), lease: makeLease({ period_type: 'weekly' }) })
    expect(legacy.period).toMatchObject({ unit: 'minggu', typeLabel: 'Mingguan' })
  })

  it('invoiceFreeText drops only an exact breakdown first line', () => {
    expect(invoiceFreeText(null)).toBeNull()
    expect(invoiceFreeText('  ')).toBeNull()
    expect(invoiceFreeText('Listrik: 125000')).toBeNull()
    expect(invoiceFreeText('Listrik: 125000\nToken Maret')).toBe('Token Maret')
    expect(invoiceFreeText('Bayar listrik: 125000 ya')).toBe('Bayar listrik: 125000 ya')
    expect(invoiceFreeText('catatan saja')).toBe('catatan saja')
  })
})

describe('invoiceShareText', () => {
  const invoice = makeInvoice({ addons_amount: 200_000, extra_amount: 175_000, discount_amount: 25_000, due_date: '2026-10-05' })

  it('unpaid: greeting, number, room + kos, period, total, remaining with due date, payment info, thanks', () => {
    const text = invoiceShareText(build({ invoice }))
    expect(text.startsWith('Halo Kak Budi,')).toBe(true)
    expect(text).toContain('kamar A1 Kos Melati')
    expect(text).toContain('INV-202610-0001')
    expect(text).toContain('Bulanan · 1 bulan · 1 Okt 2026 s/d 31 Okt 2026')
    expect(text).toContain('Total: *Rp 1.850.000*')
    expect(text).toContain('Sisa *Rp 1.850.000* jatuh tempo 5 Okt 2026')
    expect(text).toContain('Pembayaran dapat dilakukan ke: BCA 1234567890 a.n. Ibu Sari')
    expect(text.endsWith('Terima kasih 🙏')).toBe(true)
  })

  it('partial: mentions what was paid and the remaining amount', () => {
    const text = invoiceShareText(build({ invoice, payments: [makePayment({ amount: 850_000 })] }))
    expect(text).toContain('Sudah dibayar Rp 850.000, sisa *Rp 1.000.000* jatuh tempo 5 Okt 2026')
    expect(text).toContain('Pembayaran dapat dilakukan ke')
  })

  it('omits the payment info line when the kos has none', () => {
    const text = invoiceShareText(build({ invoice, property: { ...property, payment_info: null } }))
    expect(text).not.toContain('Pembayaran dapat dilakukan ke')
    expect(text).toContain('Sisa *Rp 1.850.000*')
  })

  it('paid: says LUNAS and leaves out the bank details', () => {
    const text = invoiceShareText(build({ invoice, payments: [makePayment({ amount: 1_850_000 })] }))
    expect(text).toContain('Status: *LUNAS*')
    expect(text).not.toContain('Sisa')
    expect(text).not.toContain('Pembayaran dapat dilakukan ke')
  })

  it('void: says DIBATALKAN', () => {
    const text = invoiceShareText(build({ invoice: makeInvoice({ status: 'void' }) }))
    expect(text).toContain('Status: *DIBATALKAN*')
    expect(text).not.toContain('jatuh tempo')
    expect(text).not.toContain('Pembayaran dapat dilakukan ke')
  })

  it('greets without a name for the fallback tenant', () => {
    const text = invoiceShareText(build({ tenant: null }))
    expect(text.startsWith('Halo Kak, ')).toBe(true)
    expect(text).not.toContain('Kak Penyewa')
  })
})

describe('invoiceFileName', () => {
  it('builds Tagihan-<number>-Kamar-<room>.png', () => {
    expect(invoiceFileName(build())).toBe('Tagihan-INV-202610-0001-Kamar-A1.png')
  })

  it('replaces every character outside [A-Za-z0-9._-] with a dash', () => {
    const doc = build({ invoice: makeInvoice({ invoice_number: 'INV 2026/10 #1' }), room: { ...room, name: 'Kamar 3/B (atas)' } })
    expect(invoiceFileName(doc)).toBe('Tagihan-INV-2026-10--1-Kamar-Kamar-3-B--atas-.png')
    expect(invoiceFileName(build({ room: { ...room, name: 'Ruang Ñ.1' } }))).toBe('Tagihan-INV-202610-0001-Kamar-Ruang--.1.png')
  })
})
