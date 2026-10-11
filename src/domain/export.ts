/**
 * Export shaping: turns rows into flat, human-readable sheets (Indonesian headers) that the reports
 * module writes as CSV or XLSX. Pure functions only; file writing lives in the feature module.
 */
import type { Expense, Invoice, Lease, Payment, Property, Room, Tenant } from '../types/db'
import type { CashflowPoint, CategoryBreakdown, FinanceSummary, PropertyBreakdown } from './finance'
import type { DateRange } from './period'

const notImplemented = (name: string): never => {
  throw new Error(`${name} belum diimplementasikan`)
}

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

/** Payments in range (by paid_at): Tanggal, Kos, Kamar, Penyewa, Jenis, Metode, No. Tagihan, Jumlah, Catatan. */
export function buildPaymentsSheet(payments: Payment[], invoices: Invoice[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  return notImplemented('buildPaymentsSheet') as never ?? [payments, invoices, ctx, range, propertyIds]
}

/** Expenses in range (by expense_date): Tanggal, Kos (or 'Bersama'), Kategori, Deskripsi, Vendor, Jumlah. */
export function buildExpensesSheet(expenses: Expense[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  return notImplemented('buildExpensesSheet') as never ?? [expenses, ctx, range, propertyIds]
}

/** Invoices with due_date in range: No, Kos, Kamar, Penyewa, Periode awal/akhir, Jatuh tempo, Total, Dibayar, Sisa, Status. */
export function buildInvoicesSheet(invoices: Invoice[], payments: Payment[], ctx: ExportContext, range: DateRange, propertyIds?: string[]): ExportSheet {
  return notImplemented('buildInvoicesSheet') as never ?? [invoices, payments, ctx, range, propertyIds]
}

/** All tenants with their current room (active lease) if any. */
export function buildTenantsSheet(ctx: ExportContext, propertyIds?: string[]): ExportSheet {
  return notImplemented('buildTenantsSheet') as never ?? [ctx, propertyIds]
}

/** Key/value summary + cashflow table + category table flattened into one sheet ("Ringkasan"). */
export function buildSummarySheet(
  summary: FinanceSummary,
  cashflow: CashflowPoint[],
  byCategory: CategoryBreakdown[],
  byProperty: PropertyBreakdown[],
  range: DateRange,
  title: string,
): ExportSheet {
  return notImplemented('buildSummarySheet') as never ?? [summary, cashflow, byCategory, byProperty, range, title]
}

/**
 * RFC 4180 CSV. Default delimiter ';' (Indonesian Excel locale); pass ',' for Google Sheets/US Excel.
 * Prefixed with a UTF-8 BOM so Excel opens it correctly. money/number cells are plain digits (no separators).
 */
export function toCsv(sheet: ExportSheet, delimiter: ';' | ',' = ';'): string {
  return notImplemented('toCsv') as never ?? [sheet, delimiter]
}

/** 'woombad-pembayaran-2026-03-01_2026-03-31.csv' (lowercase, spaces -> '-'). */
export function exportFileName(base: string, range: DateRange, ext: 'csv' | 'xlsx'): string {
  return notImplemented('exportFileName') as never ?? [base, range, ext]
}
