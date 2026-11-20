/**
 * Tanya AI (SPEC 7.29): the summary of the kos data that goes to Claude with a question. Pure, built from the rows the
 * signed-in member already has (so Row Level Security has decided what is in it) with the same functions the Laporan
 * page and the room board use: the figures Claude reads are the app's own, not sums it has to redo.
 *
 * What is left out on purpose: NIK / passport numbers, addresses, phone numbers, e-mail, document photos, notes on
 * tenants. Names stay ("siapa yang telat?" needs them). Keys are Indonesian, like the answers.
 */
import { depositBalance, summarizeLeaseBilling } from '../../domain/billing'
import { matchesProperty, outstandingInvoices, summarizeFinance } from '../../domain/finance'
import { isLeaseActiveOn, plannedCheckoutOf, roomOccupancy } from '../../domain/occupancy'
import { addDaysISO, addPeriods, daysBetween, type DateRange } from '../../domain/period'
import { compareRoomNames } from '../../domain/occupancy'
import type { Expense, Invoice, Lease, Payment, PeriodType, Property, Room, Tenant } from '../../types/db'

export interface AiSnapshotInput {
  today: string
  orgName: string
  properties: Property[]
  rooms: Room[]
  tenants: Tenant[]
  leases: Lease[]
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  /** the kos filter of finance functions (undefined = every kos, shared expenses included) */
  propertyIds?: string[]
}

/** months of monthly totals, the running month last */
export const SNAPSHOT_MONTHS = 6
/** payment and expense rows listed one by one: this many days back, at most this many rows (the newest) */
export const SNAPSHOT_ROW_DAYS = 120
export const SNAPSHOT_MAX_ROWS = 400
/** leases that ended are listed this many days back */
export const SNAPSHOT_ENDED_DAYS = 60

const JENIS: Record<PeriodType, string> = { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan' }
const day = (iso: string) => iso.slice(0, 10)

/** first and last day of the month of `iso` */
export function monthRange(iso: string): DateRange {
  const start = `${day(iso).slice(0, 7)}-01`
  return { start, end: addDaysISO(addPeriods(start, 'monthly', 1), -1) }
}

export interface ExpectedRenewal {
  kamar: string
  penyewa: string
  jenis: string
  jatuh_tempo: string
  /** periods that start on or before the last day of the month */
  periode: number
  jumlah: number
}

/**
 * Rent not yet billed that falls due up to the end of the month from tenants who are in a room now and owe nothing:
 * every period (month or week) that starts on or before the last day of the month, and before the day a tenant said he
 * leaves. A due date already past counts from that date, so a tenant two months behind on billing counts twice. Daily
 * stays are left out (nobody knows whether a daily guest stays another night); they are listed apart with the nights
 * left in the month. An assumption, not a fact: every one of them renews and pays on the due date.
 */
export function expectedRenewals(
  leases: Lease[],
  invoices: Invoice[],
  payments: Payment[],
  roomName: (id: string) => string,
  tenantName: (id: string) => string,
  today: string,
): { perpanjangan: ExpectedRenewal[]; harian: { kamar: string; penyewa: string; harga_per_malam: number; dibayar_sampai: string | null; malam_tersisa_bulan_ini: number }[] } {
  const end = monthRange(today).end
  const perpanjangan: ExpectedRenewal[] = []
  const harian: { kamar: string; penyewa: string; harga_per_malam: number; dibayar_sampai: string | null; malam_tersisa_bulan_ini: number }[] = []
  for (const lease of leases) {
    if (lease.status !== 'active' || !isLeaseActiveOn(lease, today)) continue
    // a tenant who told when he leaves: nothing is expected from that day on
    const leaves = plannedCheckoutOf(lease)
    const summary = summarizeLeaseBilling(lease, invoices, payments, today)
    const due = summary.nextDueDate
    if (!due || summary.outstanding > 0) continue
    if (lease.period_type === 'daily') {
      // nights from the first unpaid night to the last night of the month (or the night before he leaves)
      const last = leaves && addDaysISO(leaves, -1) < end ? addDaysISO(leaves, -1) : end
      const nights = due > last ? 0 : daysBetween(due, last) + 1
      harian.push({ kamar: roomName(lease.room_id), penyewa: tenantName(lease.tenant_id), harga_per_malam: lease.price_per_period, dibayar_sampai: summary.paidThrough, malam_tersisa_bulan_ini: nights })
      continue
    }
    // periods that start on or before the last day of the month and before the day he leaves
    const lastStart = leaves && addDaysISO(leaves, -1) < end ? addDaysISO(leaves, -1) : end
    let periode = 0
    while (periode < 60 && addPeriods(due, lease.period_type, periode) <= lastStart) periode++
    if (periode === 0) continue
    perpanjangan.push({
      kamar: roomName(lease.room_id),
      penyewa: tenantName(lease.tenant_id),
      jenis: JENIS[lease.period_type],
      jatuh_tempo: due,
      periode,
      jumlah: periode * lease.price_per_period,
    })
  }
  perpanjangan.sort((a, b) => (a.jatuh_tempo < b.jatuh_tempo ? -1 : a.jatuh_tempo > b.jatuh_tempo ? 1 : compareRoomNames(a.kamar, b.kamar)))
  harian.sort((a, b) => compareRoomNames(a.kamar, b.kamar))
  return { perpanjangan, harian }
}

/** The whole summary as an object (buildAiSnapshotText serialises it). */
export function buildAiSnapshot(input: AiSnapshotInput) {
  const today = day(input.today)
  const ids = input.propertyIds
  const shown = (propertyId: string | null) => matchesProperty(propertyId, ids)
  const properties = input.properties.filter((p) => !ids || ids.includes(p.id))
  const propertyName = new Map(input.properties.map((p) => [p.id, p.name]))
  const rooms = input.rooms.filter((r) => !ids || ids.includes(r.property_id))
  const roomIds = new Set(rooms.map((r) => r.id))
  const roomById = new Map(input.rooms.map((r) => [r.id, r]))
  const tenantById = new Map(input.tenants.map((t) => [t.id, t]))
  const roomName = (id: string) => roomById.get(id)?.name ?? '?'
  const tenantName = (id: string) => tenantById.get(id)?.full_name.trim() || '?'
  const leases = input.leases.filter((l) => roomIds.has(l.room_id))
  const leaseById = new Map(leases.map((l) => [l.id, l]))
  const leaseIds = new Set(leases.map((l) => l.id))
  const invoices = input.invoices.filter((i) => leaseIds.has(i.lease_id))
  const payments = input.payments.filter((p) => shown(p.property_id))
  const expenses = input.expenses.filter((e) => shown(e.property_id))

  // ---- monthly totals, the same figures as Laporan ----
  const thisMonth = monthRange(today)
  const ringkasan_bulanan = []
  for (let back = SNAPSHOT_MONTHS - 1; back >= 0; back--) {
    const start = addPeriods(thisMonth.start, 'monthly', -back)
    const range = monthRange(start)
    const s = summarizeFinance(input.payments, input.expenses, input.invoices, range, ids, today)
    ringkasan_bulanan.push({
      bulan: start.slice(0, 7),
      ...(back === 0 ? { catatan: `bulan berjalan, sampai ${today}` } : {}),
      pendapatan: s.revenue,
      pendapatan_sewa: s.rentRevenue,
      pendapatan_lain: s.otherRevenue,
      pengembalian_sewa: s.rentRefunds,
      pengeluaran_operasional: s.expenses,
      laba: s.netProfit,
      deposit_diterima: s.depositsReceived,
      deposit_dikembalikan: s.depositRefunds,
      jumlah_pembayaran: s.paymentCount,
    })
  }
  const monthNow = summarizeFinance(input.payments, input.expenses, input.invoices, thisMonth, ids, today)

  // ---- rooms as they are today ----
  const occupancy = roomOccupancy(rooms, leases, today)
  const kamar = [...rooms]
    .sort((a, b) => (a.property_id === b.property_id ? compareRoomNames(a.name, b.name) : (propertyName.get(a.property_id) ?? '').localeCompare(propertyName.get(b.property_id) ?? '')))
    .map((room) => {
      const base = {
        kos: propertyName.get(room.property_id) ?? '?',
        kamar: room.name,
        tarif: { harian: room.price_daily, mingguan: room.price_weekly, bulanan: room.price_monthly },
      }
      const current =
        leases
          .filter((l) => l.room_id === room.id && isLeaseActiveOn(l, today))
          .sort((x, y) => (x.start_date < y.start_date ? -1 : x.start_date > y.start_date ? 1 : 0))[0] ?? null
      if (room.status === 'maintenance' && !current) return { ...base, status: 'perbaikan' }
      if (!current) {
        const booked = leases.some((l) => l.room_id === room.id && l.status === 'active' && day(l.start_date) > today)
        return { ...base, status: booked ? 'dipesan' : 'kosong' }
      }
      const s = summarizeLeaseBilling(current, invoices, payments, today)
      // every expense row: a deposit refund is found by its lease, whatever kos it was filed under
      const deposit = depositBalance(current, payments, input.expenses)
      return {
        ...base,
        status: room.status === 'maintenance' ? 'terisi (perbaikan)' : 'terisi',
        penyewa: tenantName(current.tenant_id),
        jenis_sewa: JENIS[current.period_type],
        harga_per_periode: current.price_per_period,
        mulai: day(current.start_date),
        dibayar_sampai: s.paidThrough,
        jatuh_tempo_berikut: s.nextDueDate,
        hari_ke_jatuh_tempo: s.daysUntilDue,
        sisa_tagihan: s.outstanding,
        deposit_dipegang: deposit.held,
        rencana_keluar: plannedCheckoutOf(current),
        ...(current.status !== 'active' ? { sudah_check_out_per: current.checkout_date ? day(current.checkout_date) : null } : {}),
      }
    })

  const pesanan_mendatang = leases
    .filter((l) => l.status === 'active' && day(l.start_date) > today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
    .map((l) => {
      const s = summarizeLeaseBilling(l, invoices, payments, today)
      return {
        kamar: roomName(l.room_id),
        penyewa: tenantName(l.tenant_id),
        jenis_sewa: JENIS[l.period_type],
        harga_per_periode: l.price_per_period,
        mulai: day(l.start_date),
        sampai_malam: day(l.end_date),
        sisa_tagihan: s.outstanding,
      }
    })

  const endedFrom = addDaysISO(today, -SNAPSHOT_ENDED_DAYS)
  const sewa_berakhir = leases
    .filter((l) => l.status === 'ended' && day(l.checkout_date ?? l.end_date) >= endedFrom && !isLeaseActiveOn(l, today))
    .sort((a, b) => (day(a.checkout_date ?? a.end_date) < day(b.checkout_date ?? b.end_date) ? 1 : -1))
    .map((l) => ({
      kamar: roomName(l.room_id),
      penyewa: tenantName(l.tenant_id),
      jenis_sewa: JENIS[l.period_type],
      mulai: day(l.start_date),
      check_out: day(l.checkout_date ?? l.end_date),
    }))

  // ---- this month: what is in, what is owed, what is expected ----
  const { perpanjangan, harian } = expectedRenewals(leases, invoices, payments, roomName, tenantName, today)
  // open invoices one by one (Laporan's receivables: also of tenants who have left, not of cancelled leases)
  const tunggakan = outstandingInvoices(invoices, input.payments, today, undefined, leases).map((o) => {
    const lease = leaseById.get(o.invoice.lease_id)
    return {
      kamar: lease ? roomName(lease.room_id) : '?',
      penyewa: lease ? tenantName(lease.tenant_id) : '?',
      status_sewa: lease?.status === 'active' ? 'aktif' : 'sudah keluar',
      periode: `${day(o.invoice.period_start)} s/d ${day(o.invoice.period_end)}`,
      jatuh_tempo: day(o.invoice.due_date),
      hari_telat: o.daysOverdue,
      sisa_tagihan: o.outstanding,
    }
  })
  const totalPerpanjangan = perpanjangan.reduce((sum, r) => sum + r.jumlah, 0)
  // what is owed with a due date up to the last day of this month (older arrears included; next month's bills not)
  const tunggakanBulanIni = tunggakan.filter((t) => t.jatuh_tempo <= thisMonth.end).reduce((sum, t) => sum + t.sisa_tagihan, 0)
  const proyeksi_bulan_ini = {
    bulan: today.slice(0, 7),
    hari_terakhir: thisMonth.end,
    pendapatan_sudah_diterima: monthNow.revenue,
    tagihan_belum_lunas_jatuh_tempo_sampai_akhir_bulan: tunggakanBulanIni,
    perpanjangan_diharapkan: perpanjangan,
    total_perpanjangan_diharapkan: totalPerpanjangan,
    proyeksi_dasar: monthNow.revenue + tunggakanBulanIni + totalPerpanjangan,
    asumsi:
      'proyeksi_dasar = sudah diterima + tagihan belum lunas yang jatuh tempo sampai akhir bulan ini (termasuk tunggakan bulan-bulan lalu) + perpanjangan; menganggap semua tagihan itu dibayar bulan ini dan semua penyewa bulanan/mingguan memperpanjang dan membayar tepat waktu. Kamar harian tidak dihitung.',
    kamar_harian: harian,
    pengeluaran_operasional_tercatat: monthNow.expenses,
  }

  // ---- rows, newest first ----
  const rowsFrom = addDaysISO(today, -SNAPSHOT_ROW_DAYS)
  const paymentRows = payments.filter((p) => day(p.paid_at) >= rowsFrom).sort((a, b) => (a.paid_at < b.paid_at ? 1 : a.paid_at > b.paid_at ? -1 : 0))
  const KIND = { rent: 'sewa', deposit: 'deposit', other: 'lain' } as const
  const METHOD = { cash: 'tunai', transfer: 'transfer', qris: 'qris', deposit: 'potong jaminan', other: 'lain' } as const
  const pembayaran = paymentRows.slice(0, SNAPSHOT_MAX_ROWS).map((p) => {
    const lease = p.lease_id ? leaseById.get(p.lease_id) : undefined
    return [day(p.paid_at), lease ? roomName(lease.room_id) : '-', lease ? tenantName(lease.tenant_id) : '-', KIND[p.kind], METHOD[p.method], p.amount]
  })
  const expenseRows = expenses.filter((e) => day(e.expense_date) >= rowsFrom).sort((a, b) => (a.expense_date < b.expense_date ? 1 : a.expense_date > b.expense_date ? -1 : 0))
  const pengeluaran = expenseRows.slice(0, SNAPSHOT_MAX_ROWS).map((e) => [day(e.expense_date), e.category, e.amount, (e.description ?? '').slice(0, 80)])

  return {
    hari_ini: today,
    organisasi: input.orgName,
    kos: properties.map((p) => ({ nama: p.name, jumlah_kamar: rooms.filter((r) => r.property_id === p.id).length })),
    cakupan: ids ? 'hanya kos yang dipilih; pengeluaran bersama tidak termasuk' : 'semua kos, termasuk pengeluaran bersama',
    hunian_hari_ini: { total_kamar: occupancy.total, terisi: occupancy.occupied, dipesan: occupancy.reserved, kosong: occupancy.available, perbaikan: occupancy.maintenance },
    ringkasan_bulanan,
    proyeksi_bulan_ini,
    tunggakan: { total: tunggakan.reduce((sum, t) => sum + t.sisa_tagihan, 0), per_tagihan: tunggakan },
    kamar,
    pesanan_mendatang,
    sewa_berakhir: { sejak: endedFrom, daftar: sewa_berakhir },
    pembayaran: {
      sejak: rowsFrom,
      kolom: ['tanggal', 'kamar', 'penyewa', 'jenis', 'metode', 'jumlah'],
      jumlah_baris_sebenarnya: paymentRows.length,
      baris: pembayaran,
    },
    pengeluaran: {
      sejak: rowsFrom,
      kolom: ['tanggal', 'kategori', 'jumlah', 'keterangan'],
      jumlah_baris_sebenarnya: expenseRows.length,
      baris: pengeluaran,
    },
  }
}

export type AiSnapshot = ReturnType<typeof buildAiSnapshot>

/** The summary as the text that is sent (compact JSON: the same input always gives the same text, which keeps the cache). */
export function buildAiSnapshotText(input: AiSnapshotInput): string {
  return JSON.stringify(buildAiSnapshot(input))
}
