/**
 * Export shaping: turns rows into flat, human-readable sheets (Indonesian headers) that the reports
 * module writes as CSV or XLSX. Pure functions only; file writing lives in the feature module.
 *
 * Conventions:
 *  - 'date' cells hold 'YYYY-MM-DD' strings, 'money' cells hold integer Rupiah, 'string' cells strings.
 *  - A missing join (unknown room, tenant, property, ...) renders as '-' in string cells; numeric cells
 *    always stay numbers so spreadsheet formulas keep working.
 *  - Property filter: `propertyIds` undefined = everything in the org; when given, only rows whose
 *    property is listed (shared expenses, property_id null, are then excluded) - same as finance.
 */
import type { Expense, Invoice, Lease, Payment, Property, Room, Tenant } from '../types/db'
import {
  EXPENSE_CATEGORY_LABEL,
  GENDER_LABEL,
  INVOICE_STATUS_LABEL,
  LEASE_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
} from '../types/db'
import type { CashflowPoint, CategoryBreakdown, FinanceSummary, PropertyBreakdown } from './finance'
import type { DateRange } from './period'
import { inRange } from './period'

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
/** Lease status cell when a tenant has no active lease. */
export const NO_ACTIVE_LEASE_LABEL = 'Tidak ada sewa aktif'

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

/** Payments in range (by paid_at): Tanggal, Kos, Kamar, Penyewa, Jenis, Metode, No. Tagihan, Jumlah, Catatan. */
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
    return {
      paid_at: dateCell(p.paid_at),
      property: names.property,
      room: names.room,
      tenant: names.tenant,
      kind: PAYMENT_KIND_LABEL[p.kind],
      method: PAYMENT_METHOD_LABEL[p.method],
      invoice_number: invoice?.invoice_number ?? MISSING,
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

/**
 * Invoices with due_date in range: No, Kos, Kamar, Penyewa, Periode awal/akhir, Jatuh tempo, Total, Dibayar, Sisa, Status.
 * Decision: void (Dibatalkan) invoices are left out so the sheet reconciles with 'Ditagihkan' in the summary.
 */
export function buildInvoicesSheet(invoices: Invoice[], payments: Payment[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  const lookup = indexContext(ctx)
  const selected = invoices
    .filter((inv) => inv.status !== 'void' && inRange(inv.due_date, range) && matchesPropertyFilter(inv.property_id, propertyIds))
    .sort(
      (a, b) =>
        compareStrings(dateCell(a.due_date), dateCell(b.due_date)) ||
        a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true }),
    )

  const rows = selected.map((inv) => {
    const names = resolveLeaseNames(lookup, inv.lease_id, inv.property_id)
    const paid = paidForInvoice(inv.id, payments)
    return {
      invoice_number: inv.invoice_number,
      property: names.property,
      room: names.room,
      tenant: names.tenant,
      period_start: dateCell(inv.period_start),
      period_end: dateCell(inv.period_end),
      due_date: dateCell(inv.due_date),
      total_amount: inv.total_amount,
      paid,
      outstanding: Math.max(0, inv.total_amount - paid),
      status: INVOICE_STATUS_LABEL[inv.status],
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
      { key: 'period_end', header: 'Periode Akhir', type: 'date' },
      { key: 'due_date', header: 'Jatuh Tempo', type: 'date' },
      { key: 'total_amount', header: 'Total', type: 'money' },
      { key: 'paid', header: 'Dibayar', type: 'money' },
      { key: 'outstanding', header: 'Sisa', type: 'money' },
      { key: 'status', header: 'Status', type: 'string' },
    ],
    rows,
  }
}

/** The tenant's active lease; when several are active (data error), the most recently started wins. */
function activeLeaseFor(tenantId: string, leases: Lease[]): Lease | undefined {
  let best: Lease | undefined
  for (const l of leases) {
    if (l.tenant_id !== tenantId || l.status !== 'active') continue
    if (!best || l.start_date > best.start_date) best = l
  }
  return best
}

/**
 * All tenants with their current room (active lease) if any.
 * Filter: by tenant.property_id (home kos); tenants without a home kos appear only when no filter is given.
 */
export function buildTenantsSheet(ctx: ExportContext, propertyIds?: string[]): ExportSheet {
  const lookup = indexContext(ctx)
  const selected = ctx.tenants
    .filter((t) => matchesPropertyFilter(t.property_id, propertyIds))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id') || compareStrings(a.id, b.id))

  const rows = selected.map((t) => {
    const lease = activeLeaseFor(t.id, ctx.leases)
    const room = lease ? lookup.roomById.get(lease.room_id) : undefined
    // kos: from the active lease's room, else the lease itself, else the tenant's home kos
    const propertyId = room?.property_id ?? lease?.property_id ?? t.property_id
    const property = propertyId === null ? undefined : lookup.propertyById.get(propertyId)
    return {
      full_name: t.full_name,
      phone: text(t.phone),
      nik: text(t.nik),
      gender: t.gender === null ? MISSING : GENDER_LABEL[t.gender],
      property: property?.name ?? MISSING,
      room: room?.name ?? MISSING,
      lease_status: lease ? LEASE_STATUS_LABEL[lease.status] : NO_ACTIVE_LEASE_LABEL,
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
 * Key/value summary + cashflow table + category table flattened into one sheet ("Ringkasan").
 * Columns: Keterangan (label) / Nilai (money) / Catatan (note). Percent-only rows (Margin, Tingkat Penagihan)
 * carry null in Nilai and the percentage in Catatan. Sections are separated by a blank row and introduced by a
 * header-like row; a section header is emitted even when it has no rows so the sheet layout is predictable.
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

function csvEscape(value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

/** null -> ''; numbers -> plain digits (no thousand separators); strings quoted only when needed. */
export function csvCell(cell: ExportCell | undefined, delimiter: ';' | ',' = ';'): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return String(cell)
  return csvEscape(cell, delimiter)
}

/**
 * RFC 4180 CSV. Default delimiter ';' (Indonesian Excel locale); pass ',' for Google Sheets/US Excel.
 * Prefixed with a UTF-8 BOM so Excel opens it correctly. money/number cells are plain digits (no separators).
 */
export function toCsv(sheet: ExportSheet, delimiter: ';' | ',' = ';'): string {
  const lines: string[] = [sheet.columns.map((c) => csvEscape(c.header, delimiter)).join(delimiter)]
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((c) => csvCell(row[c.key], delimiter)).join(delimiter))
  }
  return `﻿${lines.join('\r\n')}`
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
