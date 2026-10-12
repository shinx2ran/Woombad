/**
 * UI-side helpers for the expenses module. Pure functions only (unit-tested in expenseUtils.test.ts).
 * Money maths that belongs to the business domain lives in src/domain/finance.ts and is NOT duplicated here:
 * these helpers only shape rows for display (visibility, grouping, labels) and build insert payloads.
 */
import { format, getDaysInMonth } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import type { Expense, ExpenseCategory, Lease, MemberRole, OrgInsert, Room, Tenant } from '../../types/db'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, REFUND_CATEGORIES } from '../../types/db'
import { inRange, parseISODate, toISODate, type DateRange } from '../../domain/period'
import { formatDate, formatRupiah } from '../../lib/format'

// ---------- categories ----------

/** Categories for selects: operating costs first, refunds (not operating costs) last. */
export const ORDERED_CATEGORIES: readonly ExpenseCategory[] = [
  ...EXPENSE_CATEGORIES.filter((c) => !REFUND_CATEGORIES.includes(c)),
  ...EXPENSE_CATEGORIES.filter((c) => REFUND_CATEGORIES.includes(c)),
]

export function isRefundCategory(category: ExpenseCategory): boolean {
  return REFUND_CATEGORIES.includes(category)
}

/**
 * Rows that count as operating expenses per SPEC §2a: every category except the refunds
 * (deposit_refund AND rent_refund). Feed the result into src/domain/finance (operatingExpensesInRange,
 * expensesByCategory): the domain currently excludes only deposit_refund, so rent_refund would otherwise be
 * counted as a cost. Local workaround until src/domain/finance.ts isOperatingExpense() excludes REFUND_CATEGORIES.
 */
export function operatingExpenseRows(expenses: Expense[]): Expense[] {
  return expenses.filter((e) => !isRefundCategory(e.category))
}

/** Option label: refunds carry the "bukan biaya operasional" hint. */
export function categoryOptionLabel(category: ExpenseCategory): string {
  const base = EXPENSE_CATEGORY_LABEL[category]
  return isRefundCategory(category) ? `${base} — bukan biaya operasional` : base
}

/** Categorical palette from the project chart guidelines, one colour per category (stable). */
export const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  wages: '#0f766e',
  utilities: '#0ea5e9',
  maintenance: '#f59e0b',
  supplies: '#8b5cf6',
  tax: '#e11d48',
  marketing: '#10b981',
  other: '#64748b',
  deposit_refund: '#f97316',
  rent_refund: '#f97316',
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'

export const CATEGORY_TONE: Record<ExpenseCategory, BadgeTone> = {
  wages: 'brand',
  utilities: 'info',
  maintenance: 'warning',
  supplies: 'neutral',
  tax: 'danger',
  marketing: 'success',
  other: 'neutral',
  deposit_refund: 'neutral',
  rent_refund: 'neutral',
}

// ---------- quick templates ----------

export interface ExpenseTemplate {
  id: string
  label: string
  category: ExpenseCategory
  description: string
}

export const EXPENSE_TEMPLATES: readonly ExpenseTemplate[] = [
  { id: 'wages', label: 'Gaji penjaga', category: 'wages', description: 'Gaji penjaga kos' },
  { id: 'electricity', label: 'Listrik', category: 'utilities', description: 'Listrik' },
  { id: 'water', label: 'Air', category: 'utilities', description: 'Air' },
  { id: 'internet', label: 'Internet', category: 'utilities', description: 'Internet' },
  { id: 'repair', label: 'Perbaikan', category: 'maintenance', description: 'Perbaikan' },
]

// ---------- list filtering & grouping ----------

export interface ExpenseListFilter {
  range: DateRange
  /** ids from useOrg().propertyFilterIds */
  propertyFilterIds: string[]
  /** true when the global filter is "Semua kos": shared rows (property_id null) are shown */
  showShared: boolean
  /** empty = every category */
  categories: ExpenseCategory[]
}

/** Global kos filter semantics for list pages: rows of the selected kos, plus "Bersama" rows only for "Semua kos". */
export function isExpenseVisible(e: Expense, propertyFilterIds: string[], showShared: boolean): boolean {
  if (e.property_id === null) return showShared
  return propertyFilterIds.includes(e.property_id)
}

/** Rows to show in the list, newest first (date desc, then created_at desc). */
export function filterExpenses(expenses: Expense[], filter: ExpenseListFilter): Expense[] {
  const cats = new Set(filter.categories)
  return expenses
    .filter(
      (e) =>
        inRange(e.expense_date, filter.range) &&
        isExpenseVisible(e, filter.propertyFilterIds, filter.showShared) &&
        (cats.size === 0 || cats.has(e.category)),
    )
    .sort((a, b) => {
      if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
    })
}

export interface DateGroup {
  date: string
  rows: Expense[]
  /** sum of every row in the group (refunds included: this is cash out for the day) */
  total: number
}

/** Group an already-sorted list by expense_date, keeping the input order. */
export function groupByDate(rows: Expense[]): DateGroup[] {
  const groups: DateGroup[] = []
  let current: DateGroup | null = null
  for (const row of rows) {
    if (!current || current.date !== row.expense_date) {
      current = { date: row.expense_date, rows: [], total: 0 }
      groups.push(current)
    }
    current.rows.push(row)
    current.total += row.amount
  }
  return groups
}

/** Sum of amounts of the given rows (display-only helper for a filtered list). */
export function sumAmounts(rows: ReadonlyArray<{ amount: number }>): number {
  let total = 0
  for (const r of rows) total += r.amount
  return total
}

// ---------- labels ----------

/** 'Oktober 2026' for a month range; '1 Okt 2026 – 15 Okt 2026' for a custom range. */
export function rangeLabel(range: DateRange, isMonth: boolean): string {
  if (isMonth) return format(parseISODate(range.start), 'MMMM yyyy', { locale: localeId })
  return `${formatDate(range.start)} – ${formatDate(range.end)}`
}

/** 'Sabtu, 11 Okt 2026' */
export function dateHeading(iso: string): string {
  return format(parseISODate(iso), 'EEEE, d MMM yyyy', { locale: localeId })
}

/**
 * Abbreviated Rupiah for tight spaces: 1_250_000 -> '1,3 jt'; 850_000 -> '850 rb'; 2_000_000_000 -> '2 M'.
 * One decimal, Indonesian comma, trailing ',0' trimmed.
 */
export function shortRupiah(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, '').replace('.', ',')
  if (abs >= 1_000_000_000) return `${sign}${one(abs / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `${sign}${one(abs / 1_000_000)} jt`
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} rb`
  return `${sign}${abs}`
}

export interface DeltaText {
  text: string
  /** more spending = negative tone, less = positive */
  tone: 'positive' | 'negative' | 'neutral'
}

/**
 * Period-over-period sentence for operating expenses. `vsLabel` e.g. 'bulan lalu' or 'periode sebelumnya';
 * when the current period is still running, append '(s/d tanggal yang sama)'.
 */
export function expenseDeltaText(current: number, previous: number, vsLabel: string, isPartial: boolean): DeltaText {
  const suffix = `vs ${vsLabel}${isPartial ? ' (s/d tanggal yang sama)' : ''}`
  const delta = current - previous
  if (previous === 0 && current === 0) return { text: `Tidak ada pengeluaran, sama seperti ${vsLabel}`, tone: 'neutral' }
  if (previous === 0) return { text: `Baru ada pengeluaran (${vsLabel} Rp 0)`, tone: 'neutral' }
  if (delta === 0) return { text: `Sama ${suffix}`, tone: 'neutral' }
  const pct = Math.round((delta / previous) * 100)
  const arrow = delta > 0 ? '▲' : '▼'
  return {
    text: `${arrow} ${formatRupiah(Math.abs(delta))} (${delta > 0 ? '+' : '-'}${Math.abs(pct)}%) ${suffix}`,
    tone: delta > 0 ? 'negative' : 'positive',
  }
}

/** 'Budi Santoso · Kamar A1 (Kos Melati)' style label for lease selects. */
export function leaseLabel(lease: Lease, tenants: Tenant[], rooms: Room[], propertyName?: string): string {
  const tenant = tenants.find((t) => t.id === lease.tenant_id)?.full_name ?? 'Penyewa ?'
  const room = rooms.find((r) => r.id === lease.room_id)?.name ?? '?'
  const status = lease.status === 'active' ? '' : lease.status === 'ended' ? ' · selesai' : ' · dibatalkan'
  return `${tenant} · Kamar ${room}${propertyName ? ` (${propertyName})` : ''}${status}`
}

// ---------- duplicate & split ----------

/**
 * Same day-of-month as `sourceISO` in the month of `todayISO`, clamped to that month's length:
 * ('2026-01-31', '2026-02-10') -> '2026-02-28'.
 */
export function sameDayInMonth(sourceISO: string, todayISO: string): string {
  const day = parseISODate(sourceISO).getDate()
  const today = parseISODate(todayISO)
  const last = getDaysInMonth(today)
  return toISODate(new Date(today.getFullYear(), today.getMonth(), Math.min(day, last)))
}

/** Split an integer amount into n integer parts; the remainder goes to the first part. 100/3 -> [34, 33, 33]. */
export function splitEvenly(total: number, n: number): number[] {
  if (n < 1) throw new Error('Jumlah bagian minimal 1')
  const base = Math.floor(total / n)
  const remainder = total - base * n
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base))
}

export interface ExpenseDraft {
  expense_date: string
  /** null = Bersama */
  property_id: string | null
  lease_id: string | null
  category: ExpenseCategory
  amount: number
  description: string
  vendor: string | null
  receipt_path: string | null
}

/** One row per kos with the amount split evenly and the description suffixed '(i/N)'. */
export function splitExpenseRows(draft: ExpenseDraft, propertyIds: string[]): OrgInsert<'expenses'>[] {
  const parts = splitEvenly(draft.amount, propertyIds.length)
  return propertyIds.map((property_id, i) => ({
    property_id,
    lease_id: null,
    category: draft.category,
    amount: parts[i],
    expense_date: draft.expense_date,
    description: `${draft.description} (${i + 1}/${propertyIds.length})`,
    vendor: draft.vendor,
    receipt_path: draft.receipt_path,
  }))
}

// ---------- permissions & write errors ----------

/** Shown next to a row a staff member may not edit (mirrors the `expenses_update` RLS policy). */
export const EDIT_DENIED_HINT = 'Hanya pencatat atau admin yang dapat mengubah pengeluaran ini.'
export const UPDATE_DENIED_MESSAGE = 'Data tidak ditemukan atau Anda tidak memiliki izin untuk mengubahnya.'
export const DELETE_DENIED_MESSAGE = 'Data tidak ditemukan atau Anda tidak memiliki izin untuk menghapusnya.'

/**
 * Client-side mirror of the database policy `expenses_update`: owners/admins may edit every row of the
 * organisation, staff only the rows they recorded themselves (`created_by = auth.uid()`). Used to hide the
 * "Ubah" action instead of letting the server filter the UPDATE down to 0 rows.
 */
export function canEditExpense(role: MemberRole, userId: string | undefined, expense: Pick<Expense, 'created_by'>): boolean {
  if (role !== 'staff') return true
  return Boolean(userId) && expense.created_by === userId
}

/**
 * Message for a failed save. PostgREST does not raise 42501 when RLS filters an UPDATE down to 0 rows: the
 * `.single()` on the response fails with PGRST116 ("JSON object requested, multiple (or no) rows returned"),
 * which must not reach the owner in English.
 */
export function saveErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : ''
  if (/PGRST116|multiple \(or no\) rows|\b0 rows\b/i.test(message)) return UPDATE_DENIED_MESSAGE
  return message || fallback
}

// ---------- validation ----------

export interface ExpenseFormValues {
  expense_date: string
  /** '' = not chosen, SHARED_VALUE = Bersama, otherwise a property id */
  property: string
  category: ExpenseCategory
  lease_id: string
  amount: number
  description: string
}

export const SHARED_VALUE = '__shared__'

export type ExpenseFormErrors = Partial<Record<keyof ExpenseFormValues, string>>

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateExpenseForm(values: ExpenseFormValues): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {}
  if (!ISO_DATE_RE.test(values.expense_date)) errors.expense_date = 'Tanggal wajib diisi.'
  else {
    try {
      parseISODate(values.expense_date)
    } catch {
      errors.expense_date = 'Tanggal tidak valid.'
    }
  }
  const refund = isRefundCategory(values.category)
  // A refund takes its kos from the chosen lease, so the kos select is not required once a lease is picked.
  if (!values.property && !(refund && values.lease_id)) errors.property = 'Pilih kos, atau "Bersama" untuk biaya semua kos.'
  if (!Number.isFinite(values.amount) || values.amount <= 0) errors.amount = 'Jumlah harus lebih dari 0.'
  if (!values.description.trim()) errors.description = 'Deskripsi wajib diisi.'
  if (refund && !values.lease_id) errors.lease_id = 'Pilih sewa yang menerima pengembalian.'
  return errors
}
