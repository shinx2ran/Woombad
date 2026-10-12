import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Room, Tenant } from '../../types/db'
import { buildInvoiceDraft, WARN_PERIOD_TYPE_CHANGED, WARN_PRICE_NOT_SET, type LeaseBillingSummary } from '../../domain/billing'
import {
  addonAmountUpdates,
  agreedPriceText,
  appendLeaseNote,
  applyAddonAmounts,
  invoicesToPinType,
  permanentSwitchAddonsAmount,
  rescaleAddonAmount,
  rescaledAddonDefaults,
  compareByNextDue,
  compareByRoom,
  compareByTenantName,
  defaultMakePermanent,
  dueLabel,
  extensionChangesTerms,
  extensionLeasePatch,
  extensionPriceFor,
  invoiceInsertFromDraft,
  matchesTenantQuery,
  parseLeaseSort,
  periodChangeNote,
  previewFollowingPeriod,
  priceDelta,
  priceDeltaText,
  relativeDays,
  sortLeaseItems,
  type LeaseListItem,
} from './leaseUtils'
import { scannedExtraFields, validatePayment } from './newLeaseUtils'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const room: Room = {
  id: 'R102',
  ...ts,
  property_id: 'PB',
  name: '102',
  floor: '1',
  price_daily: 130_000,
  price_weekly: 780_000,
  price_monthly: 1_800_000,
  status: 'active',
  notes: null,
}

/** The demo's daily guest: 8 nights 2026-10-08 .. 2026-10-15, paid. */
const dailyLease: Lease = {
  id: 'LH',
  ...ts,
  property_id: 'PB',
  room_id: 'R102',
  tenant_id: 'TH',
  period_type: 'daily',
  price_per_period: 130_000,
  deposit_amount: 0,
  start_date: '2026-10-08',
  end_date: '2026-10-15',
  status: 'active',
  checkout_date: null,
  notes: 'Tamu proyek',
}

const dailyInvoice: Invoice = {
  id: 'IH1',
  ...ts,
  property_id: 'PB',
  lease_id: 'LH',
  invoice_number: 'INV-202610-0007',
  period_type: 'daily',
  period_start: '2026-10-08',
  period_end: '2026-10-15',
  quantity: 8,
  base_amount: 1_040_000,
  addons_amount: 0,
  extra_amount: 0,
  discount_amount: 0,
  total_amount: 1_040_000,
  due_date: '2026-10-08',
  status: 'paid',
  notes: null,
}

function tenant(id: string, full_name: string): Tenant {
  return {
    id,
    ...ts,
    property_id: null,
    full_name,
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
  }
}

function summary(nextDueDate: string | null, state: LeaseBillingSummary['state'] = 'ok', daysUntilDue: number | null = null, outstanding = 0): LeaseBillingSummary {
  return { leaseId: 'x', coveredThrough: null, paidThrough: null, outstanding, nextDueDate, daysUntilDue, state }
}

function item(key: string, kos: string, roomName: string, tenantName: string | null, due: string | null): LeaseListItem {
  return {
    lease: { ...dailyLease, id: key },
    summary: summary(due),
    room: { ...room, id: `r-${key}`, name: roomName },
    tenant: tenantName ? tenant(`t-${key}`, tenantName) : undefined,
    propertyName: kos,
  }
}

describe('lease list sorting (SPEC 5.1)', () => {
  const items = [
    item('a', 'Kos Melati', 'A10', 'Budi Santoso', '2026-10-20'),
    item('b', 'Kos Melati', 'A2', 'agus Pratama', '2026-10-09'),
    item('c', 'Kos Anggrek', '102', 'Hendra Wijaya', '2026-10-16'),
    item('d', 'Kos Anggrek', '101', 'Rizky Maulana', '2026-10-20'),
    item('e', 'Kos Melati', 'B1', null, null),
  ]
  const keys = (list: LeaseListItem[]) => list.map((i) => i.lease.id)

  it('parses ?urut= with jatuh-tempo as the default', () => {
    expect(parseLeaseSort(null)).toBe('jatuh-tempo')
    expect(parseLeaseSort('kamar')).toBe('kamar')
    expect(parseLeaseSort('nama')).toBe('nama')
    expect(parseLeaseSort('apa')).toBe('jatuh-tempo')
  })

  it('jatuh tempo: earliest due first (overdue = past dates on top), ties by natural room name, no due date last', () => {
    expect(keys([...items].sort(compareByNextDue))).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(keys(sortLeaseItems(items, 'jatuh-tempo'))).toEqual(['b', 'c', 'd', 'a', 'e'])
  })

  it('nomor kamar: kos name first, then A2 < A10 < B1 (natural order)', () => {
    expect(keys([...items].sort(compareByRoom))).toEqual(['d', 'c', 'b', 'a', 'e'])
    // kos NAME decides, not property id: swapping ids does not change the order
    const swapped = items.map((i) => ({ ...i, lease: { ...i.lease, property_id: i.propertyName === 'Kos Anggrek' ? 'zzz' : 'aaa' } }))
    expect(keys(sortLeaseItems(swapped, 'kamar'))).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('nama penyewa: case-insensitive A-Z, missing tenant last', () => {
    expect(keys([...items].sort(compareByTenantName))).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('does not mutate the input and keeps finished lists by finish date for jatuh-tempo', () => {
    const before = keys(items)
    sortLeaseItems(items, 'nama')
    expect(keys(items)).toEqual(before)
    const finished = [
      { ...item('x', 'Kos Melati', 'A1', 'X', null), lease: { ...dailyLease, id: 'x', status: 'ended' as const, checkout_date: '2026-05-01' } },
      { ...item('y', 'Kos Melati', 'A2', 'Y', null), lease: { ...dailyLease, id: 'y', status: 'ended' as const, checkout_date: '2026-08-01' } },
    ]
    expect(keys(sortLeaseItems(finished, 'jatuh-tempo', true))).toEqual(['y', 'x'])
    expect(keys(sortLeaseItems(finished, 'kamar', true))).toEqual(['x', 'y'])
  })
})

describe('dueLabel', () => {
  const lease: Lease = { ...dailyLease, period_type: 'monthly', end_date: '2026-12-31' }

  it('shows date and relative days', () => {
    expect(dueLabel(lease, summary('2026-10-14', 'due_soon', 2), '2026-10-12')).toEqual({ text: 'Jatuh tempo 14 Okt · 2 hari lagi', tone: 'warning' })
    expect(dueLabel(lease, summary('2026-10-30', 'ok', 18), '2026-10-12')).toEqual({ text: 'Jatuh tempo 30 Okt · 18 hari lagi', tone: 'neutral' })
    expect(dueLabel(lease, summary('2026-10-12', 'due_soon', 0), '2026-10-12')?.text).toBe('Jatuh tempo hari ini · 12 Okt')
  })

  it('shows lateness; danger only once overdue', () => {
    expect(dueLabel(lease, summary('2026-10-09', 'due_soon', -3, 100), '2026-10-12')).toEqual({ text: 'Lewat 3 hari · tenggang · sejak 9 Okt', tone: 'warning' })
    expect(dueLabel(lease, summary('2026-10-02', 'overdue', -10, 100), '2026-10-12')?.tone).toBe('danger')
  })

  it('paid-up lease ending within a week says Berakhir; inactive leases get nothing', () => {
    const ending: Lease = { ...dailyLease, end_date: '2026-10-15' }
    expect(dueLabel(ending, summary('2026-10-16', 'ok', 4), '2026-10-12')).toEqual({ text: 'Berakhir 15 Okt · 3 hari lagi', tone: 'info' })
    expect(dueLabel({ ...lease, status: 'ended' }, summary('2026-10-14'), '2026-10-12')).toBeNull()
    expect(relativeDays(1)).toBe('besok')
    expect(relativeDays(-1)).toBe('kemarin')
    expect(relativeDays(-4)).toBe('4 hari lalu')
  })
})

describe('negotiated price (SPEC 5.4)', () => {
  it('computes the difference with the standard rate', () => {
    expect(priceDelta(1_700_000, 1_800_000)).toEqual({ kind: 'discount', amount: 100_000 })
    expect(priceDelta(1_850_000, 1_800_000)).toEqual({ kind: 'more', amount: 50_000 })
    expect(priceDelta(1_800_000, 1_800_000)).toEqual({ kind: 'same', amount: 0 })
    expect(priceDelta(1_800_000, null)).toEqual({ kind: 'none', amount: 0 })
    expect(priceDeltaText(priceDelta(1_700_000, 1_800_000))).toBe('Diskon Rp 100.000')
    expect(priceDeltaText(priceDelta(1_850_000, 1_800_000))).toBe('Lebih Rp 50.000')
    expect(priceDeltaText(priceDelta(1, 1))).toBe('')
  })

  it('formats the agreed vs standard line', () => {
    expect(agreedPriceText(1_700_000, 1_800_000)).toBe('Harga disepakati Rp 1.700.000 · standar Rp 1.800.000')
    expect(agreedPriceText(1_700_000, null)).toBe('Harga disepakati Rp 1.700.000')
  })
})

describe('extension with another period type (SPEC 5.2)', () => {
  const monthlyDraft = () =>
    buildInvoiceDraft({
      lease: dailyLease,
      addons: [],
      quantity: 1,
      periodType: 'monthly',
      pricePerPeriod: extensionPriceFor(dailyLease, room, 'monthly'),
      existingInvoices: [dailyInvoice],
      orgInvoices: [dailyInvoice],
    })

  it('prefills the room rate for a new type and keeps the agreed price for the lease type', () => {
    expect(extensionPriceFor(dailyLease, room, 'monthly')).toBe(1_800_000)
    expect(extensionPriceFor(dailyLease, room, 'weekly')).toBe(780_000)
    expect(extensionPriceFor({ ...dailyLease, price_per_period: 120_000 }, room, 'daily')).toBe(120_000)
    expect(extensionPriceFor(dailyLease, { ...room, price_monthly: null }, 'monthly')).toBe(0)
  })

  it('defaults the permanent checkbox on for a type change only', () => {
    expect(defaultMakePermanent(dailyLease, 'monthly')).toBe(true)
    expect(defaultMakePermanent(dailyLease, 'daily')).toBe(false)
    expect(extensionChangesTerms(dailyLease, 'daily', 130_000)).toBe(false)
    expect(extensionChangesTerms(dailyLease, 'daily', 120_000)).toBe(true)
    expect(extensionChangesTerms(dailyLease, 'monthly', 130_000)).toBe(true)
  })

  it('the draft for daily -> monthly starts the day after the last night and carries no price warning', () => {
    const draft = monthlyDraft()
    expect(draft.period_type).toBe('monthly')
    expect(draft.period_start).toBe('2026-10-16')
    expect(draft.period_end).toBe('2026-11-15')
    expect(draft.total_amount).toBe(1_800_000)
    expect(draft.warnings).toContain(WARN_PERIOD_TYPE_CHANGED)
    expect(draft.warnings).not.toContain(WARN_PRICE_NOT_SET)
  })

  it('stores the invoice with the draft period type', () => {
    const row = invoiceInsertFromDraft(dailyLease, monthlyDraft(), 'catatan')
    expect(row).toMatchObject({
      lease_id: 'LH',
      property_id: 'PB',
      period_type: 'monthly',
      period_start: '2026-10-16',
      period_end: '2026-11-15',
      quantity: 1,
      total_amount: 1_800_000,
      status: 'unpaid',
      notes: 'catatan',
      invoice_number: 'INV-202610-0008',
    })
  })

  it('makes type and price permanent with a note, or only extends end_date', () => {
    const draft = monthlyDraft()
    expect(extensionLeasePatch(dailyLease, draft, true)).toEqual({
      end_date: '2026-11-15',
      period_type: 'monthly',
      price_per_period: 1_800_000,
      notes: 'Tamu proyek\nGanti ke Bulanan Rp 1.800.000 mulai 16 Okt 2026',
    })
    expect(extensionLeasePatch(dailyLease, draft, false)).toEqual({ end_date: '2026-11-15' })
    expect(periodChangeNote('weekly', 780_000, '2026-10-16')).toBe('Ganti ke Mingguan Rp 780.000 mulai 16 Okt 2026')
    expect(appendLeaseNote(null, 'x')).toBe('x')
    expect(appendLeaseNote('  a  ', 'x')).toBe('a\nx')
  })

  it('a price-only change is written only when made permanent; an unchanged extension only moves end_date', () => {
    const cheaper = buildInvoiceDraft({ lease: dailyLease, addons: [], quantity: 3, pricePerPeriod: 120_000, existingInvoices: [dailyInvoice] })
    expect(cheaper.period_type).toBe('daily')
    expect(cheaper.base_amount).toBe(360_000)
    expect(extensionLeasePatch(dailyLease, cheaper, false)).toEqual({ end_date: '2026-10-18' })
    expect(extensionLeasePatch(dailyLease, cheaper, true)).toMatchObject({ period_type: 'daily', price_per_period: 120_000 })
    const same = buildInvoiceDraft({ lease: { ...dailyLease, end_date: '2026-10-20' }, addons: [], quantity: 1, existingInvoices: [dailyInvoice] })
    expect(extensionLeasePatch({ ...dailyLease, end_date: '2026-10-20' }, same, true)).toBeNull()
  })

  it('previews the period after the extension with chainAnchor', () => {
    const draft = monthlyDraft()
    // switched to monthly: the chain re-anchors on the new monthly invoice
    expect(previewFollowingPeriod(dailyLease, [dailyInvoice], draft, true)).toEqual({
      period_start: '2026-11-16',
      period_end: '2026-12-15',
      period_type: 'monthly',
      anchored: true,
      anchor: '2026-10-16',
    })
    // lease stays daily: no grid any more, next night counted from the end of this invoice
    expect(previewFollowingPeriod(dailyLease, [dailyInvoice], draft, false)).toEqual({
      period_start: '2026-11-16',
      period_end: '2026-11-16',
      period_type: 'daily',
      anchored: false,
      anchor: null,
    })
  })

  it('rescales per-period add-ons on a type change (domain) so the modal can show the amount', () => {
    const draft = buildInvoiceDraft({
      lease: dailyLease,
      addons: [{ id: 'a', org_id: 'o', created_at: '', lease_id: 'LH', name: 'Parkir motor', amount: 10_000, billing: 'per_period' }],
      quantity: 1,
      periodType: 'monthly',
      pricePerPeriod: 1_800_000,
      existingInvoices: [dailyInvoice],
    })
    expect(draft.addons_amount).toBe(310_000)
    expect(draft.total_amount).toBe(2_110_000)
  })
})

describe('making a type switch permanent (SPEC 5.2): add-ons and old invoices', () => {
  const parkir: LeaseAddon = { id: 'a', org_id: 'o', created_at: '', lease_id: 'LH', name: 'Parkir motor', amount: 10_000, billing: 'per_period' }
  const kasur: LeaseAddon = { id: 'b', org_id: 'o', created_at: '', lease_id: 'LH', name: 'Kasur tambahan', amount: 50_000, billing: 'one_time' }

  it('rescales per-period add-on amounts by the length of one period', () => {
    expect(rescaleAddonAmount(10_000, 'daily', 'monthly', '2026-10-16')).toBe(310_000)
    expect(rescaleAddonAmount(10_000, 'daily', 'monthly', '2026-11-16')).toBe(300_000)
    expect(rescaleAddonAmount(10_000, 'daily', 'weekly', '2026-10-16')).toBe(70_000)
    expect(rescaleAddonAmount(70_000, 'weekly', 'daily', '2026-10-16')).toBe(10_000)
    expect(rescaleAddonAmount(310_000, 'monthly', 'daily', '2026-10-01')).toBe(10_000)
    expect(rescaleAddonAmount(10_000, 'daily', 'daily', '2026-10-16')).toBe(10_000)
    expect(rescaledAddonDefaults([parkir, kasur], 'daily', 'monthly', '2026-10-16')).toEqual({ a: 310_000 })
  })

  it('bills the converted add-ons per new period, one_time add-ons only on the first invoice', () => {
    expect(permanentSwitchAddonsAmount([parkir, kasur], { a: 300_000 }, 1, [dailyInvoice])).toBe(300_000)
    expect(permanentSwitchAddonsAmount([parkir, kasur], { a: 300_000 }, 2, [dailyInvoice])).toBe(600_000)
    expect(permanentSwitchAddonsAmount([parkir, kasur], { a: 300_000 }, 1, [])).toBe(350_000)
    expect(permanentSwitchAddonsAmount([parkir, kasur], { a: 300_000 }, 1, [{ ...dailyInvoice, status: 'void' }])).toBe(350_000)
    expect(applyAddonAmounts([parkir, kasur], { a: 300_000, b: 1 })).toEqual([{ ...parkir, amount: 300_000 }, kasur])
    expect(addonAmountUpdates([parkir, kasur], { a: 300_000, b: 1 })).toEqual([{ id: 'a', amount: 300_000 }])
    expect(addonAmountUpdates([parkir], { a: 10_000 })).toEqual([])
  })

  it('daily -> monthly made permanent: the next monthly invoice bills the same add-on amount', () => {
    const amounts = rescaledAddonDefaults([parkir], 'daily', 'monthly', '2026-10-16')
    const first = buildInvoiceDraft({
      lease: dailyLease,
      addons: [parkir],
      quantity: 1,
      periodType: 'monthly',
      pricePerPeriod: 1_800_000,
      addonsAmount: permanentSwitchAddonsAmount([parkir], amounts, 1, [dailyInvoice]),
      existingInvoices: [dailyInvoice],
    })
    expect(first.addons_amount).toBe(310_000)
    // after saving: lease switched, add-on row updated, the new invoice stored with period_type monthly
    const lease: Lease = { ...dailyLease, ...extensionLeasePatch(dailyLease, first, true) }
    const addons = applyAddonAmounts([parkir], amounts)
    const saved: Invoice = { ...invoiceInsertFromDraft(dailyLease, first, null), id: 'IH2', ...ts }
    const second = buildInvoiceDraft({ lease, addons, quantity: 1, existingInvoices: [dailyInvoice, saved] })
    expect(second.period_type).toBe('monthly')
    expect(second.period_start).toBe('2026-11-16')
    expect(second.addons_amount).toBe(310_000)
    expect(second.warnings).toEqual([])
  })

  it('pins old invoices with period_type null to the old type only when the type changes', () => {
    const legacy: Invoice = { ...dailyInvoice, period_type: null }
    const other: Invoice = { ...dailyInvoice, id: 'X', lease_id: 'OTHER', period_type: null }
    expect(invoicesToPinType(dailyLease, [legacy, other, { ...dailyInvoice, id: 'IH9' }], 'monthly').map((i) => i.id)).toEqual(['IH1'])
    expect(invoicesToPinType(dailyLease, [legacy], 'daily')).toEqual([])
    expect(invoicesToPinType(dailyLease, [legacy], undefined)).toEqual([])
  })

  it('the following-period preview reads legacy null invoices as the old type', () => {
    const legacy: Invoice = { ...dailyInvoice, period_type: null }
    const draft = buildInvoiceDraft({ lease: dailyLease, addons: [], quantity: 1, periodType: 'monthly', pricePerPeriod: 1_800_000, existingInvoices: [legacy] })
    expect(previewFollowingPeriod(dailyLease, [legacy], draft, true)).toEqual(previewFollowingPeriod(dailyLease, [dailyInvoice], draft, true))
  })
})

describe('check-in wizard helpers (SPEC 5.3)', () => {
  it('requires a payment choice and a sensible DP', () => {
    expect(validatePayment(null, 0, 1_000)).toMatch(/Pilih status pembayaran/)
    expect(validatePayment('none', 0, 1_000)).toBeNull()
    expect(validatePayment('lunas', 0, 1_000)).toBeNull()
    expect(validatePayment('dp', 0, 1_000)).toBe('Isi jumlah DP (lebih dari 0).')
    expect(validatePayment('dp', 1_500, 1_000)).toBe('DP maksimal Rp 1.000 (total tagihan pertama).')
    expect(validatePayment('dp', 500, 1_000)).toBeNull()
  })

  it('lists scanned values that are saved without an inline field', () => {
    expect(scannedExtraFields({ id_type: 'ktp', full_name: 'A', nik: '1', gender: 'L', address: 'Jl. X', birth_date: '2000-01-01' })).toEqual([
      'jenis kelamin',
      'tanggal lahir',
      'alamat',
    ])
    expect(scannedExtraFields({ id_type: 'passport', full_name: 'A', id_number: 'X1', nationality: 'AUS' })).toEqual([])
  })

  it('finds tenants by passport number too', () => {
    const t = { ...tenant('t1', 'John Smith'), id_type: 'passport' as const, id_number: 'PA1234567' }
    expect(matchesTenantQuery(t, 'pa1234')).toBe(true)
    expect(matchesTenantQuery(t, 'zzz')).toBe(false)
  })
})
