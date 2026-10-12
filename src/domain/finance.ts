/**
 * Financial analysis (cash basis), SPEC §2a.
 *
 * - **Revenue** = payments with kind 'rent' or 'other' by `paid_at` MINUS expenses with category
 *   'rent_refund' by `expense_date`. Payments with method 'deposit' (potong jaminan) ARE revenue: the
 *   tenant's held deposit is converted into income. Payments with kind 'deposit' are never revenue.
 * - **Operating expenses** = every expense except the REFUND_CATEGORIES ('deposit_refund', 'rent_refund'),
 *   which are money returned to a tenant rather than cost.
 * - **Receivables** are derived from payments (`paidAmountFor`), never from `invoices.status`.
 *
 * Property filter semantics (`propertyIds`): `undefined` = everything in the org, including shared
 * expenses (`property_id = null`). An array = only rows whose property_id is in the list; shared expenses
 * are excluded and their total is reported in `FinanceSummary.sharedExpensesExcluded` so the UI can show a
 * note. An empty array matches nothing.
 */
import type { Expense, ExpenseCategory, Invoice, Lease, Payment, PaymentMethod, Property } from '../types/db'
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, REFUND_CATEGORIES } from '../types/db'
import type { DateRange, Granularity } from './period'
import { bucketKey, bucketKeysInRange, bucketLabel, daysBetween, inRange } from './period'
import { paidAmountFor } from './billing'

// ---------- shared filters ----------

/**
 * True when a row with `propertyId` passes the filter. `undefined` filter = everything (shared rows
 * included); an array = only those ids, so a shared row (`null`) never passes; `[]` matches nothing.
 */
export function matchesProperty(propertyId: string | null, propertyIds?: string[]): boolean {
  if (propertyIds === undefined) return true
  if (propertyId === null) return false
  return propertyIds.includes(propertyId)
}

/** rent/other payments = revenue (including method 'deposit'); kind 'deposit' is a liability, never revenue. */
function isRevenuePayment(p: Payment): boolean {
  return p.kind === 'rent' || p.kind === 'other'
}

/** Everything except deposit_refund / rent_refund. */
function isOperatingExpense(e: Expense): boolean {
  return !REFUND_CATEGORIES.includes(e.category)
}

/** rent/other payments with method 'deposit': rent or damage settled from the held deposit (potong jaminan). */
function isDepositApplied(p: Payment): boolean {
  return isRevenuePayment(p) && p.method === 'deposit'
}

/** Revenue payments (kind rent/other, any method) within the range and property filter. Gross of rent refunds. */
export function revenuePaymentsInRange(payments: Payment[], range: DateRange, propertyIds?: string[]): Payment[] {
  return payments.filter(
    (p) => isRevenuePayment(p) && inRange(p.paid_at, range) && matchesProperty(p.property_id, propertyIds),
  )
}

/** Operating expenses (excluding REFUND_CATEGORIES) within the range and property filter. */
export function operatingExpensesListInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): Expense[] {
  return expenses.filter(
    (e) => isOperatingExpense(e) && inRange(e.expense_date, range) && matchesProperty(e.property_id, propertyIds),
  )
}

/** Expenses with category 'rent_refund' (by expense_date) within the range and property filter. */
export function rentRefundsListInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): Expense[] {
  return expenses.filter(
    (e) => e.category === 'rent_refund' && inRange(e.expense_date, range) && matchesProperty(e.property_id, propertyIds),
  )
}

/** Sum of 'rent_refund' expenses by expense_date in range (reduces revenue, SPEC §2a). */
export function rentRefundsInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): number {
  return sumAmount(rentRefundsListInRange(expenses, range, propertyIds))
}

/** total - rent paid, floored at 0 (void invoices owe nothing). Same rule as billing.outstandingFor. */
function invoiceOutstanding(inv: Invoice, payments: Payment[]): number {
  if (inv.status === 'void') return 0
  return Math.max(0, inv.total_amount - paidAmountFor(inv.id, payments))
}

function sumAmount(rows: ReadonlyArray<{ amount: number }>): number {
  let total = 0
  for (const r of rows) total += r.amount
  return total
}

// ---------- summary ----------

export interface FinanceSummary {
  /** rentRevenue + otherRevenue - rentRefunds (cash basis, by paid_at / expense_date in range) */
  revenue: number
  /** payments kind 'rent' by paid_at in range (any method, including 'deposit') */
  rentRevenue: number
  /** payments kind 'other' by paid_at in range (any method, including 'deposit') */
  otherRevenue: number
  /** expenses category 'rent_refund' by expense_date in range */
  rentRefunds: number
  /** operating expenses: every category except deposit_refund / rent_refund */
  expenses: number
  /** revenue - expenses */
  netProfit: number
  /** netProfit / revenue, null when revenue is 0 */
  margin: number | null
  /** payments kind 'deposit' by paid_at in range (uang jaminan received; not revenue) */
  depositsReceived: number
  /** rent/other payments with method 'deposit' by paid_at in range (potong jaminan; counted in revenue) */
  depositsApplied: number
  /** expenses category 'deposit_refund' by expense_date in range (cash out; not an operating expense) */
  depositRefunds: number
  /**
   * Deposits still held as of range.end (range.start is ignored): deposits received (paid_at <= end)
   * - deposits applied (method 'deposit', paid_at <= end) - deposit refunds (expense_date <= end).
   * Same property filter as the rest of the summary.
   */
  depositsHeld: number
  /**
   * When `propertyIds` is given: operating expenses with property_id null (Bersama) in range that were
   * left out of `expenses`, so the UI can note them. 0 when there is no property filter.
   */
  sharedExpensesExcluded: number
  /** sum of total_amount of non-void invoices whose due_date is in range (due-date basis) */
  billed: number
  /**
   * Over the same billed set: sum(min(rent paid to date, total_amount)). Payments of ANY date count, so
   * this answers "how much of what was billed in this period has been collected".
   */
  collected: number
  /** collected / billed, null when billed is 0; always within 0..1 */
  collectionRate: number | null
  /** cash figure: payments kind 'rent' by paid_at in range (equals rentRevenue; kept for the collection card) */
  rentReceived: number
  /**
   * Sum of (total - rent paid) over non-void invoices with due_date <= range.end (not only in range) that
   * still have money owed. Derived from payments, never from the status column (SPEC §2a "Piutang").
   */
  outstanding: number
  /** part of `outstanding` whose due_date < todayISO (todayISO defaults to range.end) */
  overdue: number
  /** outstanding - overdue: owed but due on or after todayISO */
  notYetDue: number
  /** number of revenue payments (kind rent/other) in range */
  paymentCount: number
  /** number of operating expense rows in range */
  expenseCount: number
}

/** Revenue in range: rent/other payments by paid_at minus rent_refund expenses by expense_date. */
export function revenueInRange(payments: Payment[], expenses: Expense[], range: DateRange, propertyIds?: string[]): number {
  return sumAmount(revenuePaymentsInRange(payments, range, propertyIds)) - rentRefundsInRange(expenses, range, propertyIds)
}

/** Operating expenses in range (excludes deposit_refund and rent_refund). */
export function operatingExpensesInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): number {
  return sumAmount(operatingExpensesListInRange(expenses, range, propertyIds))
}

/**
 * Full cash-basis summary for the range. `todayISO` (default `range.end`) only splits `outstanding` into
 * `overdue` (due_date < today) and `notYetDue`. See FinanceSummary for each field's definition.
 */
export function summarizeFinance(
  payments: Payment[],
  expenses: Expense[],
  invoices: Invoice[],
  range: DateRange,
  propertyIds?: string[],
  todayISO: string = range.end,
): FinanceSummary {
  const today = todayISO.slice(0, 10)
  const revenueRows = revenuePaymentsInRange(payments, range, propertyIds)
  const expenseRows = operatingExpensesListInRange(expenses, range, propertyIds)

  let rentRevenue = 0
  let otherRevenue = 0
  let depositsApplied = 0
  for (const p of revenueRows) {
    if (p.kind === 'rent') rentRevenue += p.amount
    else otherRevenue += p.amount
    if (p.method === 'deposit') depositsApplied += p.amount
  }
  const rentRefunds = rentRefundsInRange(expenses, range, propertyIds)
  const revenue = rentRevenue + otherRevenue - rentRefunds
  const opex = sumAmount(expenseRows)
  const netProfit = revenue - opex

  const scopedPayments = payments.filter((p) => matchesProperty(p.property_id, propertyIds))
  const scopedExpenses = expenses.filter((e) => matchesProperty(e.property_id, propertyIds))

  const depositsReceived = sumAmount(scopedPayments.filter((p) => p.kind === 'deposit' && inRange(p.paid_at, range)))
  const depositRefunds = sumAmount(
    scopedExpenses.filter((e) => e.category === 'deposit_refund' && inRange(e.expense_date, range)),
  )

  // as-of balance: everything up to range.end, regardless of range.start
  let depositsHeld = 0
  for (const p of scopedPayments) {
    if (p.paid_at.slice(0, 10) > range.end) continue
    if (p.kind === 'deposit') depositsHeld += p.amount
    else if (isDepositApplied(p)) depositsHeld -= p.amount
  }
  for (const e of scopedExpenses) {
    if (e.category === 'deposit_refund' && e.expense_date.slice(0, 10) <= range.end) depositsHeld -= e.amount
  }

  let sharedExpensesExcluded = 0
  if (propertyIds !== undefined) {
    for (const e of expenses) {
      if (e.property_id === null && isOperatingExpense(e) && inRange(e.expense_date, range)) sharedExpensesExcluded += e.amount
    }
  }

  const scopedInvoices = invoices.filter((inv) => inv.status !== 'void' && matchesProperty(inv.property_id, propertyIds))
  let billed = 0
  let collected = 0
  for (const inv of scopedInvoices) {
    if (!inRange(inv.due_date, range)) continue
    billed += inv.total_amount
    // an over-paid invoice counts at most its total, so collectionRate stays within 0..1
    collected += Math.min(paidAmountFor(inv.id, payments), inv.total_amount)
  }

  let outstanding = 0
  let overdue = 0
  for (const inv of scopedInvoices) {
    // derived from payments, not from inv.status: a stale 'paid' flag must not hide money owed
    if (inv.due_date > range.end) continue
    const owed = invoiceOutstanding(inv, payments)
    outstanding += owed
    if (inv.due_date < today) overdue += owed
  }

  return {
    revenue,
    rentRevenue,
    otherRevenue,
    rentRefunds,
    expenses: opex,
    netProfit,
    margin: revenue > 0 ? netProfit / revenue : null,
    depositsReceived,
    depositsApplied,
    depositRefunds,
    depositsHeld,
    sharedExpensesExcluded,
    billed,
    collected,
    collectionRate: billed > 0 ? collected / billed : null,
    rentReceived: rentRevenue,
    outstanding,
    overdue,
    notYetDue: outstanding - overdue,
    paymentCount: revenueRows.length,
    expenseCount: expenseRows.length,
  }
}

// ---------- cashflow series ----------

export interface CashflowPoint {
  key: string
  label: string
  /** revenue payments in the bucket net of rent_refund expenses in the bucket (may be negative) */
  revenue: number
  /** operating expenses in the bucket */
  expenses: number
  /** revenue - expenses */
  net: number
}

/** One point per bucket in the range (zeros for empty buckets), chronological. Revenue is net of rent refunds. */
export function cashflowSeries(
  payments: Payment[],
  expenses: Expense[],
  range: DateRange,
  granularity: Granularity,
  propertyIds?: string[],
): CashflowPoint[] {
  const keys = bucketKeysInRange(range, granularity)
  const byKey = new Map<string, CashflowPoint>()
  for (const key of keys) {
    byKey.set(key, { key, label: bucketLabel(key, granularity), revenue: 0, expenses: 0, net: 0 })
  }
  for (const p of revenuePaymentsInRange(payments, range, propertyIds)) {
    const point = byKey.get(bucketKey(p.paid_at, granularity))
    if (point) point.revenue += p.amount
  }
  for (const e of rentRefundsListInRange(expenses, range, propertyIds)) {
    const point = byKey.get(bucketKey(e.expense_date, granularity))
    if (point) point.revenue -= e.amount
  }
  for (const e of operatingExpensesListInRange(expenses, range, propertyIds)) {
    const point = byKey.get(bucketKey(e.expense_date, granularity))
    if (point) point.expenses += e.amount
  }
  const series: CashflowPoint[] = []
  for (const key of keys) {
    const point = byKey.get(key)
    if (!point) continue
    point.net = point.revenue - point.expenses
    series.push(point)
  }
  return series
}

// ---------- breakdowns ----------

export interface CategoryBreakdown {
  category: ExpenseCategory
  label: string
  amount: number
  /** 0..1 share of the total shown */
  share: number
}

/** Operating expenses by category (refund categories never appear), descending, excluding zero categories. */
export function expensesByCategory(expenses: Expense[], range: DateRange, propertyIds?: string[]): CategoryBreakdown[] {
  const totals = new Map<ExpenseCategory, number>()
  for (const e of operatingExpensesListInRange(expenses, range, propertyIds)) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount)
  }
  let grand = 0
  for (const amount of totals.values()) if (amount !== 0) grand += amount
  const rows: CategoryBreakdown[] = []
  for (const [category, amount] of totals) {
    if (amount === 0) continue
    rows.push({ category, label: EXPENSE_CATEGORY_LABEL[category], amount, share: grand !== 0 ? amount / grand : 0 })
  }
  // descending by amount; ties keep catalogue order so the chart is stable
  rows.sort((a, b) => b.amount - a.amount)
  return rows
}

export interface PropertyBreakdown {
  propertyId: string
  name: string
  /** revenue payments minus rent_refund expenses attributed to the property */
  revenue: number
  /** operating expenses attributed to the property */
  expenses: number
  net: number
}

/**
 * Per-property P&L for the range, one row per property in the given order. Rows whose property_id is
 * null (shared operating expenses, or a rent_refund without a property) are gathered in a trailing row
 * with propertyId 'shared', name 'Bersama', which is only appended when it is non-zero.
 */
export function profitByProperty(payments: Payment[], expenses: Expense[], properties: Property[], range: DateRange): PropertyBreakdown[] {
  const rows: PropertyBreakdown[] = properties.map((prop) => ({
    propertyId: prop.id,
    name: prop.name,
    revenue: 0,
    expenses: 0,
    net: 0,
  }))
  const byId = new Map<string, PropertyBreakdown>()
  for (const row of rows) byId.set(row.propertyId, row)
  const shared: PropertyBreakdown = { propertyId: 'shared', name: 'Bersama', revenue: 0, expenses: 0, net: 0 }

  for (const p of revenuePaymentsInRange(payments, range)) {
    const row = byId.get(p.property_id)
    if (row) row.revenue += p.amount
  }
  for (const e of rentRefundsListInRange(expenses, range)) {
    const row = e.property_id === null ? shared : byId.get(e.property_id)
    if (row) row.revenue -= e.amount
  }
  for (const e of operatingExpensesListInRange(expenses, range)) {
    const row = e.property_id === null ? shared : byId.get(e.property_id)
    if (row) row.expenses += e.amount
  }
  for (const row of rows) row.net = row.revenue - row.expenses
  if (shared.expenses !== 0 || shared.revenue !== 0) {
    shared.net = shared.revenue - shared.expenses
    rows.push(shared)
  }
  return rows
}

export interface MethodBreakdown {
  method: PaymentMethod
  label: string
  amount: number
  count: number
}

/**
 * Revenue payments (kind rent/other) grouped by method, descending by amount, zero-amount methods dropped.
 * Method 'deposit' (label 'Potong Jaminan') is included. Gross of rent refunds (those are not payments).
 */
export function revenueByMethod(payments: Payment[], range: DateRange, propertyIds?: string[]): MethodBreakdown[] {
  const byMethod = new Map<PaymentMethod, MethodBreakdown>()
  for (const p of revenuePaymentsInRange(payments, range, propertyIds)) {
    const row = byMethod.get(p.method) ?? { method: p.method, label: PAYMENT_METHOD_LABEL[p.method], amount: 0, count: 0 }
    row.amount += p.amount
    row.count += 1
    byMethod.set(p.method, row)
  }
  return [...byMethod.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
}

// ---------- receivables ----------

export interface OutstandingItem {
  invoice: Invoice
  /** rent paid to date (any paid_at) */
  paid: number
  /** total_amount - paid */
  outstanding: number
  /** today - due_date; negative means not yet due */
  daysOverdue: number
}

/**
 * Non-void invoices that still have money owed (total_amount - rent paid > 0, derived from payments rather
 * than the status column, SPEC §2a), regardless of due_date, sorted by due_date ascending (most overdue
 * first) then invoice_number (numeric-aware). When `leases` is given, invoices whose lease has status
 * 'cancelled' are skipped (their unpaid invoices are void or refunded by the cancel flow, §2b.4); an
 * invoice whose lease is not in the list is kept.
 */
export function outstandingInvoices(
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
  propertyIds?: string[],
  leases?: Lease[],
): OutstandingItem[] {
  const cancelledLeaseIds = new Set<string>()
  if (leases) for (const l of leases) if (l.status === 'cancelled') cancelledLeaseIds.add(l.id)

  const items: OutstandingItem[] = []
  for (const inv of invoices) {
    if (!matchesProperty(inv.property_id, propertyIds)) continue
    if (cancelledLeaseIds.has(inv.lease_id)) continue
    const outstanding = invoiceOutstanding(inv, payments)
    if (outstanding <= 0) continue
    items.push({
      invoice: inv,
      paid: paidAmountFor(inv.id, payments),
      outstanding,
      daysOverdue: daysBetween(inv.due_date, todayISO),
    })
  }
  items.sort((a, b) => {
    if (a.invoice.due_date !== b.invoice.due_date) return a.invoice.due_date < b.invoice.due_date ? -1 : 1
    return a.invoice.invoice_number.localeCompare(b.invoice.invoice_number, undefined, { numeric: true })
  })
  return items
}

// ---------- comparison ----------

export interface PeriodComparison {
  revenueDelta: number
  /** (current - previous) / previous, null when previous is 0 */
  revenuePct: number | null
  expensesDelta: number
  expensesPct: number | null
  netDelta: number
}

function pctChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous
}

/** Deltas between two summaries (typically `comparableRanges` current vs previous). */
export function comparePeriods(current: FinanceSummary, previous: FinanceSummary): PeriodComparison {
  return {
    revenueDelta: current.revenue - previous.revenue,
    revenuePct: pctChange(current.revenue, previous.revenue),
    expensesDelta: current.expenses - previous.expenses,
    expensesPct: pctChange(current.expenses, previous.expenses),
    netDelta: current.netProfit - previous.netProfit,
  }
}
