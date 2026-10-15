/**
 * Export shaping: turns rows into flat, human-readable sheets (Indonesian headers) that the reports
 * module writes as CSV or XLSX. Pure functions only; file writing lives in the feature module.
 *
 * Conventions:
 *  - 'date' cells hold 'YYYY-MM-DD' strings, 'money' cells hold integer Rupiah, 'string' cells strings.
 *  - The end of a stay is exported as the CHECK-OUT day (stored last night + 1, SPEC 7.3) under a header that says
 *    so ('Periode s/d (check-out)'); start dates, due dates and payment dates are exported as stored.
 *  - A missing join (unknown room, tenant, property, ...) renders as '-' in string cells; numeric cells
 *    always stay numbers so spreadsheet formulas keep working.
 *  - Property filter: `propertyIds` undefined = everything in the org; when given, only rows whose
 *    property is listed (shared expenses, property_id null, are then excluded) - same as finance.
 *  - Invoice status / Dibayar / Sisa are always DERIVED from rent payments (SPEC §2 / §2a), never read
 *    from the stored `invoices.status` column, except that a void invoice stays 'Dibatalkan'.
 *  - CSV output guards against spreadsheet formula injection (see `toCsv`).
 */
import type { Expense, Invoice, InvoiceStatus, Lease, Payment, Property, Room, Tenant } from '../types/db'
import {
  EXPENSE_CATEGORY_LABEL,
  GENDER_LABEL,
  INVOICE_STATUS_LABEL,
  LEASE_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  ID_TYPE_LABEL,
} from '../types/db'
import type { CashflowPoint, CategoryBreakdown, FinanceSummary, PropertyBreakdown } from './finance'
import { checkoutISO } from '../lib/format'
import { isLeaseActiveOn, isLeaseReservedOn } from './occupancy'
import type { DateRange } from './period'
import { inRange, toISODate } from './period'

export type CellType = 'string' | 'number' | 'money' | 'date'
export type ExportCell = string | number | null

export interface ExportColumn {
  key: string
  header: string
  type: CellType
}

export interface ExportSheet {
  /** sheet name, <= 31 chars, no []:*?/\ */
  name: string
  columns: ExportColumn[]
  rows: Record<string, ExportCell>[]
}

export interface ExportContext {
  properties: Property[]
  rooms: Room[]
  tenants: Tenant[]
  leases: Lease[]
}

/** Placeholder for a missing join in a string cell. */
export const MISSING = '-'
/** Label for expenses shared across all properties (property_id null). */
export const SHARED_LABEL = 'Bersama'
/** Lease status cell when a tenant has no lease occupying a room today and no reservation. */
export const NO_ACTIVE_LEASE_LABEL = 'Tidak ada sewa aktif'
/** Lease status cell when a tenant's only lease is an active one starting in the future (SPEC §2a "Dipesan"). */
export const RESERVED_LEASE_LABEL = 'Dipesan'

// ---------- lookups ----------

interface Lookup {
  propertyById: Map<string, Property>
  roomById: Map<string, Room>
  tenantById: Map<string, Tenant>
  leaseById: Map<string, Lease>
}

function indexContext(ctx: ExportContext): Lookup {
  const propertyById = new Map<string, Property>()
  for (const p of ctx.properties) propertyById.set(p.id, p)
  const roomById = new Map<string, Room>()
  for (const r of ctx.rooms) roomById.set(r.id, r)
  const tenantById = new Map<string, Tenant>()
  for (const t of ctx.tenants) tenantById.set(t.id, t)
  const leaseById = new Map<string, Lease>()
  for (const l of ctx.leases) leaseById.set(l.id, l)
  return { propertyById, roomById, tenantById, leaseById }
}

/** Resolved names for a row that points at a lease (payment, invoice). */
interface LeaseNames {
  property: string
  room: string
  tenant: string
}

/**
 * lease -> room -> property, lease -> tenant. When the lease or its room is unknown, the property name
 * falls back to the row's own property_id (a deposit/other-income payment has no lease but does have a kos).
 */
function resolveLeaseNames(lookup: Lookup, leaseId: string | null, fallbackPropertyId: string | null): LeaseNames {
  const lease = leaseId === null ? undefined : lookup.leaseById.get(leaseId)
  const room = lease ? lookup.roomById.get(lease.room_id) : undefined
  const tenant = lease ? lookup.tenantById.get(lease.tenant_id) : undefined
  const propertyId = room?.property_id ?? lease?.property_id ?? fallbackPropertyId
  const property = propertyId === null ? undefined : lookup.propertyById.get(propertyId)
  return {
    property: property?.name ?? MISSING,
    room: room?.name ?? MISSING,
    tenant: tenant?.full_name ?? MISSING,
  }
}

/** Same semantics as finance.matchesProperty (kept private so export does not depend on finance at runtime). */
function matchesPropertyFilter(propertyId: string | null, propertyIds?: string[]): boolean {
  if (propertyIds === undefined) return true
  if (propertyId === null) return false
  return propertyIds.includes(propertyId)
}

/** Sum of rent payments attached to the invoice (mirror of billing.paidAmountFor, kept private). */
function paidForInvoice(invoiceId: string, payments: Payment[]): number {
  let sum = 0
  for (const p of payments) if (p.kind === 'rent' && p.invoice_id === invoiceId) sum += p.amount
  return sum
}

/**
 * Mirror of billing.deriveInvoiceStatus (kept private): void stays void; paid >= total -> 'paid';
 * paid > 0 -> 'partial'; otherwise 'unpaid'. A zero-total invoice is therefore 'paid'.
 */
function derivedInvoiceStatus(inv: Invoice, paid: number): InvoiceStatus {
  if (inv.status === 'void') return 'void'
  if (paid >= inv.total_amount) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? MISSING : value
}

/** 'YYYY-MM-DD' part of a date string (tolerates a full ISO timestamp). */
function dateCell(iso: string): string {
  return iso.slice(0, 10)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------- sheets ----------

/**
 * Payments in range (by paid_at), sorted by paid_at then created_at.
 * Columns: Tanggal, Kos, Kamar, Penyewa, Jenis, Metode, No. Tagihan, Sewa, Jumlah, Catatan.
 *
 * 'Sewa' (key `lease`) identifies the lease for payments that have a `lease_id` but no `invoice_id`
 * (deposits, other income): 'Budi Santoso - A1' (tenant - room, unknown parts rendered '-'). Payments that
 * point at an invoice, or that have no lease at all, carry '-' in 'Sewa' (the invoice number already
 * identifies them). An unknown lease id renders '-' as well.
 * Kos/Kamar/Penyewa are resolved through the lease; without a lease the kos falls back to the payment's own
 * property_id.
 */
export function buildPaymentsSheet(payments: Payment[], invoices: Invoice[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  const lookup = indexContext(ctx)
  const invoiceById = new Map<string, Invoice>()
  for (const inv of invoices) invoiceById.set(inv.id, inv)

  const selected = payments
    .filter((p) => inRange(p.paid_at, range) && matchesPropertyFilter(p.property_id, propertyIds))
    .sort((a, b) => compareStrings(dateCell(a.paid_at), dateCell(b.paid_at)) || compareStrings(a.created_at, b.created_at))

  const rows = selected.map((p) => {
    const names = resolveLeaseNames(lookup, p.lease_id, p.property_id)
    const invoice = p.invoice_id === null ? undefined : invoiceById.get(p.invoice_id)
    const hasKnownLease = p.lease_id !== null && lookup.leaseById.has(p.lease_id)
    const lease = p.invoice_id === null && hasKnownLease ? `${names.tenant} - ${names.room}` : MISSING
    return {
      paid_at: dateCell(p.paid_at),
      property: names.property,
      room: names.room,
      tenant: names.tenant,
      kind: PAYMENT_KIND_LABEL[p.kind],
      method: PAYMENT_METHOD_LABEL[p.method],
      invoice_number: invoice?.invoice_number ?? MISSING,
      lease,
      amount: p.amount,
      notes: text(p.notes),
    }
  })

  return {
    name: 'Pembayaran',
    columns: [
      { key: 'paid_at', header: 'Tanggal', type: 'date' },
      { key: 'property', header: 'Kos', type: 'string' },
      { key: 'room', header: 'Kamar', type: 'string' },
      { key: 'tenant', header: 'Penyewa', type: 'string' },
      { key: 'kind', header: 'Jenis', type: 'string' },
      { key: 'method', header: 'Metode', type: 'string' },
      { key: 'invoice_number', header: 'No. Tagihan', type: 'string' },
      { key: 'lease', header: 'Sewa', type: 'string' },
      { key: 'amount', header: 'Jumlah', type: 'money' },
      { key: 'notes', header: 'Catatan', type: 'string' },
    ],
    rows,
  }
}

/** Expenses in range (by expense_date): Tanggal, Kos (or 'Bersama'), Kategori, Deskripsi, Vendor, Jumlah. */
export function buildExpensesSheet(expenses: Expense[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  const lookup = indexContext(ctx)
  const selected = expenses
    .filter((e) => inRange(e.expense_date, range) && matchesPropertyFilter(e.property_id, propertyIds))
    .sort((a, b) => compareStrings(dateCell(a.expense_date), dateCell(b.expense_date)) || compareStrings(a.created_at, b.created_at))

  const rows = selected.map((e) => ({
    expense_date: dateCell(e.expense_date),
    property: e.property_id === null ? SHARED_LABEL : (lookup.propertyById.get(e.property_id)?.name ?? MISSING),
    category: EXPENSE_CATEGORY_LABEL[e.category],
    description: text(e.description),
    vendor: text(e.vendor),
    amount: e.amount,
  }))

  return {
    name: 'Pengeluaran',
    columns: [
      { key: 'expense_date', header: 'Tanggal', type: 'date' },
      { key: 'property', header: 'Kos', type: 'string' },
      { key: 'category', header: 'Kategori', type: 'string' },
      { key: 'description', header: 'Deskripsi', type: 'string' },
      { key: 'vendor', header: 'Vendor', type: 'string' },
      { key: 'amount', header: 'Jumlah', type: 'money' },
    ],
    rows,
  }
}

export interface InvoicesSheetOptions {
  /** true = also list void invoices (status 'Dibatalkan', Sisa 0). Default false. */
  includeVoid?: boolean
}

/**
 * Invoices with due_date in range, sorted by due_date then invoice number (numeric aware).
 * Columns: No. Tagihan, Kos, Kamar, Penyewa, Periode Awal, Periode s/d (check-out), Jatuh Tempo, Total, Dibayar, Sisa, Status.
 *
 * - 'Periode s/d (check-out)' (key `period_checkout`) = period_end + 1: period_end is stored as the last night, people
 *   read the end of a period as the check-out day (SPEC 7.3), e.g. 2 nights from 15 Okt -> 17 Okt.
 * - Dibayar = sum of payments with kind 'rent' and this invoice_id, of ANY date (not only in range).
 * - Sisa = max(0, Total - Dibayar); 0 for a void invoice (it owes nothing).
 * - Status is DERIVED from Dibayar (deriveInvoiceStatus semantics), never read from the stored column:
 *   Dibayar >= Total -> 'Lunas', Dibayar > 0 -> 'DP / Sebagian', otherwise 'Belum Bayar'. A void invoice
 *   stays 'Dibatalkan' regardless of payments.
 * - Void invoices are excluded by default so the sheet reconciles with 'Ditagihkan' in the summary; pass
 *   `{ includeVoid: true }` to list them with status 'Dibatalkan'.
 */
export function buildInvoicesSheet(
  invoices: Invoice[],
  payments: Payment[],
  ctx: ExportContext,
  range: DateRange,
  propertyIds?: string[],
  options: InvoicesSheetOptions = {},
): ExportSheet {
  const includeVoid = options.includeVoid === true
  const lookup = indexContext(ctx)
  const selected = invoices
    .filter(
      (inv) =>
        (includeVoid || inv.status !== 'void') &&
        inRange(inv.due_date, range) &&
        matchesPropertyFilter(inv.property_id, propertyIds),
    )
    .sort(
      (a, b) =>
        compareStrings(dateCell(a.due_date), dateCell(b.due_date)) ||
        a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true }),
    )

  const rows = selected.map((inv) => {
    const names = resolveLeaseNames(lookup, inv.lease_id, inv.property_id)
    const paid = paidForInvoice(inv.id, payments)
    const status = derivedInvoiceStatus(inv, paid)
    return {
      invoice_number: inv.invoice_number,
      property: names.property,
      room: names.room,
      tenant: names.tenant,
      period_start: dateCell(inv.period_start),
      period_checkout: checkoutISO(dateCell(inv.period_end)) ?? dateCell(inv.period_end),
      due_date: dateCell(inv.due_date),
      total_amount: inv.total_amount,
      paid,
      outstanding: status === 'void' ? 0 : Math.max(0, inv.total_amount - paid),
      status: INVOICE_STATUS_LABEL[status],
    }
  })

  return {
    name: 'Tagihan',
    columns: [
      { key: 'invoice_number', header: 'No. Tagihan', type: 'string' },
      { key: 'property', header: 'Kos', type: 'string' },
      { key: 'room', header: 'Kamar', type: 'string' },
      { key: 'tenant', header: 'Penyewa', type: 'string' },
      { key: 'period_start', header: 'Periode Awal', type: 'date' },
      { key: 'period_checkout', header: 'Periode s/d (check-out)', type: 'date' },
      { key: 'due_date', header: 'Jatuh Tempo', type: 'date' },
      { key: 'total_amount', header: 'Total', type: 'money' },
      { key: 'paid', header: 'Dibayar', type: 'money' },
      { key: 'outstanding', header: 'Sisa', type: 'money' },
      { key: 'status', header: 'Status', type: 'string' },
    ],
    rows,
  }
}

/**
 * The tenant's earliest-started lease with status 'active', ignoring dates (kept for callers that have no
 * reference date). Ties on start_date fall back to id for determinism.
 *
 * NOTE: `buildTenantsSheet` no longer uses this; it uses `currentLeaseFor` (the lease occupying a room on a
 * given day, SPEC §2a "hunian historis"), which is what "current room" means.
 */
export function activeLeaseFor(tenantId: string, leases: Lease[]): Lease | undefined {
  let best: Lease | undefined
  for (const l of leases) {
    if (l.tenant_id !== tenantId || l.status !== 'active') continue
    if (!best || l.start_date < best.start_date || (l.start_date === best.start_date && l.id < best.id)) best = l
  }
  return best
}

/**
 * The lease that has the tenant in a room on `dateISO` (`isLeaseActiveOn`: status active with start_date <= date,
 * or ended with date <= checkout_date ?? end_date; cancelled never). A reserved lease (active, start_date in the
 * future) is NOT current, so a tenant who lives in A1 and has booked B1 for next month stays in A1.
 * When several leases occupy on the date, an ACTIVE lease always beats an ENDED one (an ended lease whose
 * checkout day has not passed yet - SPEC §2b.5 allows recording a planned checkout early - must not displace the
 * tenant's ongoing tenancy); among leases of the same status the LATEST started wins (e.g. the previous one was
 * not ended yet); ties on start_date fall back to id for determinism.
 */
export function currentLeaseFor(tenantId: string, leases: Lease[], dateISO: string): Lease | undefined {
  const rank = (l: Lease): number => (l.status === 'active' ? 1 : 0)
  let best: Lease | undefined
  for (const l of leases) {
    if (l.tenant_id !== tenantId || !isLeaseActiveOn(l, dateISO)) continue
    if (
      !best ||
      rank(l) > rank(best) ||
      (rank(l) === rank(best) && (l.start_date > best.start_date || (l.start_date === best.start_date && l.id < best.id)))
    )
      best = l
  }
  return best
}

/** The tenant's earliest-starting reserved lease (status active, start_date > dateISO), if any. */
function reservedLeaseFor(tenantId: string, leases: Lease[], dateISO: string): Lease | undefined {
  let best: Lease | undefined
  for (const l of leases) {
    if (l.tenant_id !== tenantId || !isLeaseReservedOn(l, dateISO)) continue
    if (!best || l.start_date < best.start_date || (l.start_date === best.start_date && l.id < best.id)) best = l
  }
  return best
}

/**
 * All tenants (sorted by name) with the room they occupy TODAY, if any.
 * Columns: Nama, Telepon, NIK, Jenis Kelamin, Kos, Kamar, Status Sewa, Alamat, Pekerjaan.
 *
 * - `todayISO` ('YYYY-MM-DD', default: today's local date) is the reference day. The current room comes from
 *   `currentLeaseFor(tenant, leases, todayISO)`, i.e. the lease occupying a room on that day; an active lease
 *   with a future start_date (a reservation) never displaces it. 'Status Sewa' shows that lease's status label
 *   ('Aktif', or 'Selesai' for an ended lease whose checkout day has not passed yet).
 * - A tenant with no lease occupying today but with a reserved lease shows the reserved kos/room and
 *   'Status Sewa' = 'Dipesan'.
 * - Otherwise Kamar is '-' and 'Status Sewa' = 'Tidak ada sewa aktif'.
 * - Kos: from the chosen lease's room, else the lease itself, else the tenant's home kos (tenant.property_id).
 * - Filter: by tenant.property_id (home kos); tenants without a home kos appear only when no filter is given.
 */
export function buildTenantsSheet(ctx: ExportContext, propertyIds?: string[], todayISO: string = toISODate(new Date())): ExportSheet {
  const lookup = indexContext(ctx)
  const today = todayISO.slice(0, 10)
  const selected = ctx.tenants
    .filter((t) => matchesPropertyFilter(t.property_id, propertyIds))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id') || compareStrings(a.id, b.id))

  const rows = selected.map((t) => {
    const current = currentLeaseFor(t.id, ctx.leases, today)
    const reserved = current ? undefined : reservedLeaseFor(t.id, ctx.leases, today)
    const lease = current ?? reserved
    const room = lease ? lookup.roomById.get(lease.room_id) : undefined
    const propertyId = room?.property_id ?? lease?.property_id ?? t.property_id
    const property = propertyId === null ? undefined : lookup.propertyById.get(propertyId)
    const leaseStatus = current ? LEASE_STATUS_LABEL[current.status] : reserved ? RESERVED_LEASE_LABEL : NO_ACTIVE_LEASE_LABEL
    return {
      full_name: t.full_name,
      phone: text(t.phone),
      nik: text(t.nik),
      id_type: ID_TYPE_LABEL[t.id_type ?? 'ktp'],
      id_number: text(t.id_type === 'ktp' ? t.nik : t.id_number),
      nationality: text(t.nationality),
      gender: t.gender === null ? MISSING : GENDER_LABEL[t.gender],
      property: property?.name ?? MISSING,
      room: room?.name ?? MISSING,
      lease_status: leaseStatus,
      address: text(t.address),
      occupation: text(t.occupation),
    }
  })

  return {
    name: 'Penyewa',
    columns: [
      { key: 'full_name', header: 'Nama', type: 'string' },
      { key: 'phone', header: 'Telepon', type: 'string' },
      { key: 'nik', header: 'NIK', type: 'string' },
      { key: 'id_type', header: 'Jenis Identitas', type: 'string' },
      { key: 'id_number', header: 'Nomor Identitas', type: 'string' },
      { key: 'nationality', header: 'Kewarganegaraan', type: 'string' },
      { key: 'gender', header: 'Jenis Kelamin', type: 'string' },
      { key: 'property', header: 'Kos', type: 'string' },
      { key: 'room', header: 'Kamar', type: 'string' },
      { key: 'lease_status', header: 'Status Sewa', type: 'string' },
      { key: 'address', header: 'Alamat', type: 'string' },
      { key: 'occupation', header: 'Pekerjaan', type: 'string' },
    ],
    rows,
  }
}

/** 0.3249 -> '32%'; null -> '-'. Rounded to whole percent (ratios can exceed 1, e.g. collection rate 105%). */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return MISSING
  return `${Math.round(ratio * 100)}%`
}

/** 'Masuk 1500000 / Keluar 500000' with plain integers (the sheet is for spreadsheets, not for reading). */
function inOutNote(revenue: number, expenses: number): string {
  return `Masuk ${revenue} / Keluar ${expenses}`
}

type SummaryRow = { label: string; value: number | null; note: string }

const BLANK_ROW: SummaryRow = { label: '', value: null, note: '' }

function sectionRow(label: string): SummaryRow {
  return { label, value: null, note: '' }
}

/**
 * Cash reconciliation rows (SPEC §2a "Arus kas vs laba"), in order:
 *   Pendapatan sewa bruto (rentRevenue), Pemasukan lain (otherRevenue), Pengembalian sewa (-rentRefunds),
 *   Pendapatan bersih (revenue), Uang jaminan diterima (depositsReceived), Potong jaminan (non-kas) (-depositsApplied),
 *   Total kas masuk (rentRevenue + otherRevenue - depositsApplied + depositsReceived),
 *   Pengeluaran operasional (expenses), Pengembalian sewa (kas keluar) (rentRefunds), Pengembalian uang jaminan (depositRefunds),
 *   Total kas keluar (expenses + rentRefunds + depositRefunds), Arus kas bersih (kas masuk - kas keluar),
 *   Laba bersih (netProfit), Uang jaminan dipegang (akhir periode) (depositsHeld),
 *   Piutang jatuh tempo (overdue), Piutang belum jatuh tempo (notYetDue).
 * Deductions are shown as negative numbers so the column sums naturally (a zero deduction is 0, never -0);
 * the totals are computed here from the summary's components (not read from a stored field).
 */
function negate(amount: number): number {
  return amount === 0 ? 0 : -amount
}

function reconciliationRows(summary: FinanceSummary): SummaryRow[] {
  const cashIn = summary.rentRevenue + summary.otherRevenue - summary.depositsApplied + summary.depositsReceived
  const cashOut = summary.expenses + summary.rentRefunds + summary.depositRefunds
  return [
    { label: 'Pendapatan sewa bruto', value: summary.rentRevenue, note: 'Pembayaran sewa, termasuk potong jaminan' },
    { label: 'Pemasukan lain', value: summary.otherRevenue, note: '' },
    { label: 'Pengembalian sewa', value: negate(summary.rentRefunds), note: 'Mengurangi pendapatan' },
    { label: 'Pendapatan bersih', value: summary.revenue, note: 'Sewa bruto + lain - pengembalian sewa' },
    { label: 'Uang jaminan diterima', value: summary.depositsReceived, note: 'Kewajiban, bukan pendapatan' },
    { label: 'Potong jaminan (non-kas)', value: negate(summary.depositsApplied), note: 'Sudah termasuk pendapatan, tidak ada kas masuk' },
    { label: 'Total kas masuk', value: cashIn, note: 'Sewa bruto + lain - potong jaminan + jaminan diterima' },
    { label: 'Pengeluaran operasional', value: summary.expenses, note: '' },
    { label: 'Pengembalian sewa (kas keluar)', value: summary.rentRefunds, note: '' },
    { label: 'Pengembalian uang jaminan', value: summary.depositRefunds, note: '' },
    { label: 'Total kas keluar', value: cashOut, note: 'Operasional + pengembalian sewa + pengembalian jaminan' },
    { label: 'Arus kas bersih', value: cashIn - cashOut, note: 'Kas masuk - kas keluar' },
    { label: 'Laba bersih', value: summary.netProfit, note: 'Pendapatan bersih - pengeluaran operasional' },
    { label: 'Uang jaminan dipegang (akhir periode)', value: summary.depositsHeld, note: 'Saldo per akhir rentang' },
    { label: 'Piutang jatuh tempo', value: summary.overdue, note: '' },
    { label: 'Piutang belum jatuh tempo', value: summary.notYetDue, note: '' },
  ]
}

/**
 * Key/value summary + cash reconciliation + cashflow table + category table + per-kos table flattened into one
 * sheet ("Ringkasan"). Columns: Keterangan (label) / Nilai (money) / Catatan (note).
 *
 * Layout (row 0 is the title with the range in Catatan):
 *   1. KPI rows: Pendapatan, Pengeluaran, Laba Bersih, Margin, Uang Jaminan Diterima, Pengembalian Uang Jaminan,
 *      Ditagihkan, Terkumpul, Tingkat Penagihan, Piutang. Percent-only rows (Margin, Tingkat Penagihan) carry null
 *      in Nilai and the percentage in Catatan.
 *   2. blank, 'Rekonsiliasi Kas' header, the 16 rows documented on `reconciliationRows`.
 *   3. blank, 'Arus Kas' header, one row per cashflow point (Nilai = net, Catatan = 'Masuk x / Keluar y').
 *   4. blank, 'Pengeluaran per Kategori' header, one row per category (Catatan = share %).
 *   5. blank, 'Laba per Kos' header, one row per property (Nilai = net, Catatan = 'Masuk x / Keluar y').
 * Sections are separated by a blank row and introduced by a header-like row; a section header is emitted even
 * when it has no rows so the sheet layout is predictable.
 */
export function buildSummarySheet(
  summary: FinanceSummary,
  cashflow: CashflowPoint[],
  byCategory: CategoryBreakdown[],
  byProperty: PropertyBreakdown[],
  range: DateRange,
  title: string,
): ExportSheet {
  const rows: SummaryRow[] = [
    { label: title, value: null, note: `${range.start} s/d ${range.end}` },
    { label: 'Pendapatan', value: summary.revenue, note: '' },
    { label: 'Pengeluaran', value: summary.expenses, note: '' },
    { label: 'Laba Bersih', value: summary.netProfit, note: '' },
    { label: 'Margin', value: null, note: formatPercent(summary.margin) },
    { label: 'Uang Jaminan Diterima', value: summary.depositsReceived, note: '' },
    { label: 'Pengembalian Uang Jaminan', value: summary.depositRefunds, note: '' },
    { label: 'Ditagihkan', value: summary.billed, note: '' },
    { label: 'Terkumpul', value: summary.collected, note: '' },
    { label: 'Tingkat Penagihan', value: null, note: formatPercent(summary.collectionRate) },
    { label: 'Piutang', value: summary.outstanding, note: '' },
    BLANK_ROW,
    sectionRow('Rekonsiliasi Kas'),
    ...reconciliationRows(summary),
    BLANK_ROW,
    sectionRow('Arus Kas'),
  ]
  for (const point of cashflow) {
    rows.push({ label: point.label, value: point.net, note: inOutNote(point.revenue, point.expenses) })
  }
  rows.push(BLANK_ROW, sectionRow('Pengeluaran per Kategori'))
  for (const cat of byCategory) {
    rows.push({ label: cat.label, value: cat.amount, note: formatPercent(cat.share) })
  }
  rows.push(BLANK_ROW, sectionRow('Laba per Kos'))
  for (const prop of byProperty) {
    rows.push({ label: prop.name, value: prop.net, note: inOutNote(prop.revenue, prop.expenses) })
  }

  return {
    name: 'Ringkasan',
    columns: [
      { key: 'label', header: 'Keterangan', type: 'string' },
      { key: 'value', header: 'Nilai', type: 'money' },
      { key: 'note', header: 'Catatan', type: 'string' },
    ],
    rows: rows.map((r) => ({ label: r.label, value: r.value, note: r.note })),
  }
}

// ---------- CSV ----------

/** Leading characters a spreadsheet may interpret as a formula / command (OWASP CSV injection list). */
const FORMULA_LEAD = ['=', '+', '-', '@', '\t', '\r']

/**
 * A signed plain number or percentage ('-68%', '+62812', '-1.500,5'): a sign followed only by digits,
 * '.' or ',' and an optional trailing '%'. Such a cell can never be a formula, so it is not guarded.
 */
const SIGNED_NUMBER = /^[-+]\d[\d.,]*%?$/

/**
 * Formula-injection guard: a string starting with '=', '+', '-', '@', '\t' or '\r' gets a single quote in
 * front, so a spreadsheet shows it as text instead of evaluating it. Applied to string cells only (numbers
 * are written as digits and are never affected; headers are our own constants).
 *
 * Exempt, because they cannot be formulas and the apostrophe would otherwise show literally after import:
 * the exact `MISSING` placeholder ('-') and plain signed numbers / percents matching `SIGNED_NUMBER`
 * (e.g. the '-68%' margin note of a loss month). A sign followed by anything else ('-5 ribu', '+62 812',
 * '-A1+B2') is still prefixed.
 */
function guardFormula(value: string): string {
  if (value === '' || value === MISSING || SIGNED_NUMBER.test(value)) return value
  return FORMULA_LEAD.includes(value[0] ?? '') ? `'${value}` : value
}

function csvEscape(value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * null/undefined -> ''; numbers -> plain digits (no thousand separators, negatives keep their sign); strings
 * are formula-guarded (see `toCsv`) and then quoted only when they contain the delimiter, '"', '\n' or '\r'.
 */
export function csvCell(cell: ExportCell | undefined, delimiter: ';' | ',' = ';'): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return String(cell)
  return csvEscape(guardFormula(cell), delimiter)
}

/**
 * RFC 4180 CSV. Default delimiter ';' (Indonesian Excel locale); pass ',' for Google Sheets/US Excel.
 * Prefixed with a UTF-8 BOM so Excel opens it correctly. money/number cells are plain digits (no separators).
 *
 * Formula injection guard: any STRING cell whose first character is '=', '+', '-', '@', '\t' or '\r' is
 * prefixed with a single quote (') before quoting, so '=HYPERLINK(...)' becomes "'=HYPERLINK(...)". Numbers
 * (including negatives such as -200000) are unaffected. Two string shapes that can never be formulas are
 * exempt and written verbatim: the '-' placeholder for a missing join, and plain signed numbers / percents
 * such as the '-68%' margin note of a loss month (see `guardFormula`).
 */
export function toCsv(sheet: ExportSheet, delimiter: ';' | ',' = ';'): string {
  const lines: string[] = [sheet.columns.map((c) => csvEscape(c.header, delimiter)).join(delimiter)]
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((c) => csvCell(row[c.key], delimiter)).join(delimiter))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

/** 'Laporan Bulanan!' -> 'laporan-bulanan' (lowercase; runs of anything but a-z0-9 become one '-'). */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 'woombad-pembayaran-2026-03-01_2026-03-31.csv' (lowercase, spaces -> '-'). */
export function exportFileName(base: string, range: DateRange, ext: 'csv' | 'xlsx'): string {
  const slug = slugify(base)
  const name = slug === '' ? 'woombad' : `woombad-${slug}`
  return `${name}-${range.start}_${range.end}.${ext}`
}
