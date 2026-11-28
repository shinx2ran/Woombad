import { describe, expect, it } from 'vitest'
import type { Expense, Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { buildAiSnapshot, buildAiSnapshotText, expectedRenewals, monthRange } from './snapshot'
import { demoAnswer } from './tanyaAi'

// SPEC 7.29: the data summary that goes to Claude. A small kos on 19 Nov 2026, shaped like the owner's own month.
const TODAY = '2026-11-19'
const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const prop: Property = { id: 'p1', name: 'EG Kost', address: null, notes: null, payment_info: null, logo_path: null, ...ts }
const room = (id: string): Room => ({ id, property_id: 'p1', name: id, floor: null, price_daily: 150_000, price_weekly: 850_000, price_monthly: 1_700_000, status: 'active', notes: null, ...ts })
const tenant = (id: string, name: string): Tenant => ({ id, full_name: name, phone: '0812-0000-9999', nik: '3273011203900007', address: 'Jl. Rahasia 1' }) as unknown as Tenant
const lease = (id: string, roomId: string, over: Partial<Lease>): Lease => ({
  id, property_id: 'p1', room_id: roomId, tenant_id: `t-${roomId}`, period_type: 'monthly', price_per_period: 1_700_000, deposit_amount: 0,
  start_date: '2026-10-21', end_date: '2026-11-20', status: 'active', checkout_date: null, planned_checkout_date: null, notes: null, ...ts, ...over,
} as Lease)
const invoice = (id: string, leaseId: string, start: string, end: string, total: number, status: Invoice['status'] = 'paid'): Invoice => ({
  id, property_id: 'p1', lease_id: leaseId, invoice_number: id, period_type: null, period_start: start, period_end: end, quantity: 1,
  base_amount: total, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: total, due_date: start, status, notes: null, ...ts,
})
const pay = (id: string, inv: Invoice | null, leaseId: string, amount: number, paidAt: string, kind: Payment['kind'] = 'rent'): Payment => ({
  id, property_id: 'p1', invoice_id: inv?.id ?? null, lease_id: leaseId, amount, paid_at: paidAt, method: 'cash', kind, notes: null, created_by: null, ...ts,
} as Payment)

// A monthly, paid to 20 Nov -> due 21 Nov; B weekly, paid to 24 -> due 25; C weekly, paid to 19 -> due 20 and 27;
// D daily, paid to 22 Nov; E monthly, paid to 12 Des (nothing due this month); F monthly, its November bill unpaid
const leases = [
  lease('lA', 'A', {}),
  lease('lB', 'B', { period_type: 'weekly', price_per_period: 850_000, start_date: '2026-11-11', end_date: '2026-11-24' }),
  lease('lC', 'C', { period_type: 'weekly', price_per_period: 500_000, start_date: '2026-11-13', end_date: '2026-11-19' }),
  lease('lD', 'D', { period_type: 'daily', price_per_period: 150_000, start_date: '2026-11-17', end_date: '2026-11-22' }),
  lease('lE', 'E', { start_date: '2026-10-13', end_date: '2026-12-12' }),
  lease('lF', 'F', { price_per_period: 1_600_000, start_date: '2026-10-15', end_date: '2026-12-14' }),
]
const iA = invoice('iA', 'lA', '2026-10-21', '2026-11-20', 1_700_000)
const iB = invoice('iB', 'lB', '2026-11-11', '2026-11-24', 1_700_000)
const iC = invoice('iC', 'lC', '2026-11-13', '2026-11-19', 500_000)
const iD = invoice('iD', 'lD', '2026-11-17', '2026-11-22', 900_000)
const iE = invoice('iE', 'lE', '2026-11-13', '2026-12-12', 1_700_000)
const iF1 = invoice('iF1', 'lF', '2026-10-15', '2026-11-14', 1_600_000)
const iF2 = invoice('iF2', 'lF', '2026-11-15', '2026-12-14', 1_600_000, 'unpaid')
const invoices = [iA, iB, iC, iD, iE, iF1, iF2]
const payments = [
  pay('pA', iA, 'lA', 1_700_000, '2026-10-21'),
  pay('pB', iB, 'lB', 1_700_000, '2026-11-11'),
  pay('pC', iC, 'lC', 500_000, '2026-11-13'),
  pay('pD', iD, 'lD', 900_000, '2026-11-17'),
  pay('pE', iE, 'lE', 1_700_000, '2026-11-13'),
  pay('pF', iF1, 'lF', 1_600_000, '2026-10-15'),
  pay('pDep', null, 'lB', 200_000, '2026-11-11', 'deposit'),
]
const expenses = [{ id: 'e1', property_id: 'p1', lease_id: null, category: 'utilities', amount: 400_000, expense_date: '2026-11-05', description: 'Listrik', vendor: null, receipt_path: null, ...ts } as Expense]
const input = {
  today: TODAY, orgName: 'EG', properties: [prop], rooms: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(room),
  tenants: ['A', 'B', 'C', 'D', 'E', 'F'].map((r) => tenant(`t-${r}`, `Penyewa ${r}`)), leases, invoices, payments, expenses,
}

describe('monthRange', () => {
  it('first and last day, also in a leap February', () => {
    expect(monthRange('2026-11-19')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(monthRange('2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
})

describe('expectedRenewals', () => {
  const name = (id: string) => id
  it('one period for a monthly lease, every week that starts in the month for a weekly one; daily apart; owing and paid-ahead left out', () => {
    const { perpanjangan, harian } = expectedRenewals(leases, invoices, payments, name, name, TODAY)
    expect(perpanjangan).toEqual([
      // C: due 20 Nov and again 27 Nov -> 2 weeks x 500.000
      { kamar: 'C', penyewa: 't-C', jenis: 'mingguan', jatuh_tempo: '2026-11-20', periode: 2, jumlah: 1_000_000 },
      { kamar: 'A', penyewa: 't-A', jenis: 'bulanan', jatuh_tempo: '2026-11-21', periode: 1, jumlah: 1_700_000 },
      // B: due 25 Nov; the next week would start 2 Des
      { kamar: 'B', penyewa: 't-B', jenis: 'mingguan', jatuh_tempo: '2026-11-25', periode: 1, jumlah: 850_000 },
    ])
    // D: paid to the night of 22 Nov -> nights 23..30 Nov = 8
    expect(harian).toEqual([{ kamar: 'D', penyewa: 't-D', harga_per_malam: 150_000, dibayar_sampai: '2026-11-22', malam_tersisa_bulan_ini: 8 }])
  })

  it('a weekly tenant who leaves mid-month is counted only for the weeks that start before he goes', () => {
    // C: due 20 Nov and 27 Nov; he leaves 25 Nov -> only the week of 20 Nov
    const leaving = leases.map((l) => (l.id === 'lC' ? { ...l, planned_checkout_date: '2026-11-25' } : l))
    expect(expectedRenewals(leaving, invoices, payments, name, name, TODAY).perpanjangan.find((r) => r.kamar === 'C')).toMatchObject({ periode: 1, jumlah: 500_000 })
  })

  it('a monthly tenant not billed since last month counts for both months', () => {
    // E's lease, but billed and paid only to 14 Okt: 15 Okt and 15 Nov both start on or before 30 Nov
    const behind = [lease('lE', 'E', { start_date: '2026-09-15', end_date: '2026-10-14' })]
    const paid = invoice('iE0', 'lE', '2026-09-15', '2026-10-14', 1_700_000)
    const got = expectedRenewals(behind, [paid], [pay('pE0', paid, 'lE', 1_700_000, '2026-09-15')], name, name, TODAY).perpanjangan
    expect(got).toEqual([{ kamar: 'E', penyewa: 't-E', jenis: 'bulanan', jatuh_tempo: '2026-10-15', periode: 2, jumlah: 3_400_000 }])
  })

  it('a tenant who said he leaves on the due day is not expected to renew', () => {
    const leaving = leases.map((l) => (l.id === 'lA' ? { ...l, planned_checkout_date: '2026-11-21' } : l))
    expect(expectedRenewals(leaving, invoices, payments, name, name, TODAY).perpanjangan.map((r) => r.kamar)).toEqual(['C', 'B'])
  })
})

describe('buildAiSnapshot', () => {
  const s = buildAiSnapshot(input)

  it('this month: received, owed and expected add up to the base projection', () => {
    const p = s.proyeksi_bulan_ini
    // rent paid in November: B 1.700.000 + C 500.000 + D 900.000 + E 1.700.000 (the deposit is not income)
    expect(p.pendapatan_sudah_diterima).toBe(4_800_000)
    expect(p.tagihan_belum_lunas_jatuh_tempo_sampai_akhir_bulan).toBe(1_600_000)
    expect(p.total_perpanjangan_diharapkan).toBe(3_550_000)
    expect(p.proyeksi_dasar).toBe(4_800_000 + 1_600_000 + 3_550_000)
    expect(p.pengeluaran_operasional_tercatat).toBe(400_000)
    expect(s.tunggakan).toEqual({
      total: 1_600_000,
      per_tagihan: [{ kamar: 'F', penyewa: 'Penyewa F', status_sewa: 'aktif', jenis: 'sewa', periode: '2026-11-15 s/d 2026-12-14', jatuh_tempo: '2026-11-15', hari_telat: 4, sisa_tagihan: 1_600_000 }],
    })
  })

  it('a bill due next month is owed but not part of this month; a tenant who left still owes', () => {
    // F also has December's bill issued ahead (due 15 Des); an old tenant of room G left owing 800.000 from October
    const iF3 = invoice('iF3', 'lF', '2026-12-15', '2027-01-14', 1_600_000, 'unpaid')
    const gone = lease('lG', 'G', { start_date: '2026-09-20', end_date: '2026-10-19', status: 'ended', checkout_date: '2026-10-20' })
    const iG = invoice('iG', 'lG', '2026-09-20', '2026-10-19', 800_000, 'unpaid')
    const more = buildAiSnapshot({ ...input, tenants: [...input.tenants, tenant('t-G', 'Penyewa G')], leases: [...leases, gone], invoices: [...invoices, iF3, iG] })
    expect(more.tunggakan.total).toBe(800_000 + 1_600_000 + 1_600_000)
    expect(more.tunggakan.per_tagihan.map((t) => [t.kamar, t.status_sewa, t.jatuh_tempo, t.sisa_tagihan])).toEqual([
      ['G', 'sudah keluar', '2026-09-20', 800_000],
      ['F', 'aktif', '2026-11-15', 1_600_000],
      ['F', 'aktif', '2026-12-15', 1_600_000],
    ])
    // due up to 30 Nov: G's old bill and F's November bill; December's is next month's
    expect(more.proyeksi_bulan_ini.tagihan_belum_lunas_jatuh_tempo_sampai_akhir_bulan).toBe(2_400_000)
    expect(more.proyeksi_bulan_ini.proyeksi_dasar).toBe(4_800_000 + 2_400_000 + 3_550_000)
  })

  it('monthly totals are the report\'s, the running month last', () => {
    expect(s.ringkasan_bulanan).toHaveLength(6)
    const [oct, nov] = s.ringkasan_bulanan.slice(-2)
    expect([oct.bulan, oct.pendapatan, oct.deposit_diterima]).toEqual(['2026-10', 3_300_000, 0])
    expect([nov.bulan, nov.pendapatan, nov.pengeluaran_operasional, nov.laba, nov.deposit_diterima]).toEqual(['2026-11', 4_800_000, 400_000, 4_400_000, 200_000])
  })

  it('rooms as they are today', () => {
    expect(s.hunian_hari_ini).toEqual({ total_kamar: 7, terisi: 6, dipesan: 0, kosong: 1, perbaikan: 0 })
    const a = s.kamar.find((k) => k.kamar === 'A')!
    expect(a).toMatchObject({ status: 'terisi', penyewa: 'Penyewa A', jenis_sewa: 'bulanan', dibayar_sampai: '2026-11-20', jatuh_tempo_berikut: '2026-11-21', hari_ke_jatuh_tempo: 2, sisa_tagihan: 0 })
    expect(s.kamar.find((k) => k.kamar === 'B')).toMatchObject({ deposit_dipegang: 200_000 })
    expect(s.kamar.find((k) => k.kamar === 'G')).toMatchObject({ status: 'kosong' })
  })

  it('carries names but no NIK, phone or address', () => {
    const text = buildAiSnapshotText(input)
    expect(text).toContain('Penyewa A')
    expect(text).not.toContain('3273011203900007')
    expect(text).not.toContain('0812')
    expect(text).not.toContain('Rahasia')
    // the same input gives the same text (the prompt cache depends on it)
    expect(buildAiSnapshotText(input)).toBe(text)
  })

  it('a kos filter leaves the other kos out', () => {
    const other: Property = { ...prop, id: 'p2', name: 'Kos Lain' }
    const more = { ...input, properties: [prop, other], rooms: [...input.rooms, { ...room('Z'), property_id: 'p2' }], propertyIds: ['p1'] }
    const filtered = buildAiSnapshot(more)
    expect(filtered.kos.map((k) => k.nama)).toEqual(['EG Kost'])
    expect(filtered.kamar.some((k) => k.kamar === 'Z')).toBe(false)
    expect(filtered.cakupan).toContain('hanya kos yang dipilih')
  })
})

describe('buildAiSnapshot with biaya tambahan (SPEC 7.31)', () => {
  // A: a late checkout charged yesterday, not paid; B: a cleaning charge paid in cash today
  const charge = (id: string, leaseId: string, date: string, amount: number, status: Invoice['status'], notes: string): Invoice => ({
    ...invoice(id, leaseId, date, date, amount, status),
    invoice_type: 'charge',
    base_amount: 0,
    extra_amount: amount,
    notes,
  })
  const cA = charge('cA', 'lA', '2026-11-18', 150_000, 'unpaid', 'Late checkout')
  const cB = charge('cB', 'lB', '2026-11-19', 75_000, 'paid', 'Kebersihan')
  const withCharges = { ...input, invoices: [...invoices, cA, cB], payments: [...payments, pay('pcB', cB, 'lB', 75_000, '2026-11-19')] }
  const s = buildAiSnapshot(withCharges)
  const base = buildAiSnapshot(input)

  it('an open charge is a tunggakan row of its own kind, with what it is for and its day', () => {
    expect(s.tunggakan.total).toBe(base.tunggakan.total + 150_000)
    expect(s.tunggakan.per_tagihan).toEqual([
      { kamar: 'F', penyewa: 'Penyewa F', status_sewa: 'aktif', jenis: 'sewa', periode: '2026-11-15 s/d 2026-12-14', jatuh_tempo: '2026-11-15', hari_telat: 4, sisa_tagihan: 1_600_000 },
      { kamar: 'A', penyewa: 'Penyewa A', status_sewa: 'aktif', jenis: 'biaya tambahan', keterangan: 'Late checkout', tanggal: '2026-11-18', jatuh_tempo: '2026-11-18', hari_telat: 1, sisa_tagihan: 150_000 },
    ])
  })

  it('a room shows its open charges apart; its rent position is unchanged', () => {
    const a = s.kamar.find((k) => k.kamar === 'A')!
    const { biaya_tambahan_belum_lunas, ...rentOnly } = a as typeof a & { biaya_tambahan_belum_lunas: number }
    const { biaya_tambahan_belum_lunas: none, ...before } = base.kamar.find((k) => k.kamar === 'A') as typeof a & { biaya_tambahan_belum_lunas: number }
    expect(rentOnly).toEqual(before)
    expect(biaya_tambahan_belum_lunas).toBe(150_000)
    expect(none).toBe(0)
    expect(s.kamar.find((k) => k.kamar === 'B')).toMatchObject({ biaya_tambahan_belum_lunas: 0, sisa_tagihan: 0 })
  })

  it('a payment on a charge is "biaya tambahan" and Pendapatan lain, never sewa', () => {
    expect(s.pembayaran.baris[0]).toEqual(['2026-11-19', 'B', 'Penyewa B', 'biaya tambahan', 'tunai', 75_000])
    expect(s.pembayaran.baris.filter((r) => r[3] === 'sewa')).toEqual(base.pembayaran.baris.filter((r) => r[3] === 'sewa'))
    const nov = s.ringkasan_bulanan.at(-1)!
    const novBase = base.ringkasan_bulanan.at(-1)!
    expect(nov.pendapatan_sewa).toBe(novBase.pendapatan_sewa)
    expect(nov.pendapatan_lain).toBe(novBase.pendapatan_lain + 75_000)
    expect(nov.pendapatan).toBe(novBase.pendapatan + 75_000)
  })

  it('the projection never counts a charge as a renewal: the same tenants renew on the same dates', () => {
    expect(s.proyeksi_bulan_ini.perpanjangan_diharapkan).toEqual(base.proyeksi_bulan_ini.perpanjangan_diharapkan)
    expect(s.proyeksi_bulan_ini.kamar_harian).toEqual(base.proyeksi_bulan_ini.kamar_harian)
    // the open charge is owed this month like any unpaid bill; the paid one is already received
    expect(s.proyeksi_bulan_ini.tagihan_belum_lunas_jatuh_tempo_sampai_akhir_bulan).toBe(1_600_000 + 150_000)
    expect(s.proyeksi_bulan_ini.pendapatan_sudah_diterima).toBe(4_800_000 + 75_000)
  })
})

describe('demoAnswer', () => {
  it('reads the projection from the summary and says it is a sample', () => {
    const text = demoAnswer(buildAiSnapshot(input))
    expect(text).toContain('Contoh jawaban (Mode Demo')
    expect(text).toContain('sekitar Rp 9.950.000')
    expect(text).toContain('Kamar C (Penyewa C) 20 Nov: Rp 1.000.000')
  })
})
