/**
 * Financial analysis (cash basis). Revenue = payments received (kind rent/other) by paid_at.
 * Operating expenses exclude category 'deposit_refund' (that is returning the tenant's own money).
 *
 * Property filter semantics: `propertyIds` undefined = everything in the org. When provided, only rows
 * whose property_id is in the list are included; expenses with property_id null (shared) are excluded,
 * so per-kos figures never double count shared costs. UIs should say so when a single kos is selected.
 */
import type { Expense, ExpenseCategory, Invoice, Payment, PaymentMethod, Property } from '../types/db'
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '../types/db'
import type { DateRange, Granularity } from './period'
import { bucketKey, bucketKeysInRange, bucketLabel, daysBetween, inRange } from './period'
import { paidAmountFor } from './billing'

// ---------- shared filters ----------

/**
 * True when a row with `propertyId` passes the filter. `undefined` filter = everything;
 * a shared row (`null`) only passes when there is no filter.
 */
export function matchesProperty(propertyId: string | null, propertyIds?: string[]): boolean {
  if (propertyIds === undefined) return true
  if (propertyId === null) return false
  return propertyIds.includes(propertyId)
}

/** rent/other payments = revenue; deposits are a liability, never revenue. */
function isRevenuePayment(p: Payment): boolean {
  return p.kind === 'rent' || p.kind === 'other'
}

function isOperatingExpense(e: Expense): boolean {
  return e.category !== 'deposit_refund'
}

/** Revenue payments (rent/other) within the range and property filter. */
export function revenuePaymentsInRange(payments: Payment[], range: DateRange, propertyIds?: string[]): Payment[] {
  return payments.filter(
    (p) => isRevenuePayment(p) && inRange(p.paid_at, range) && matchesProperty(p.property_id, propertyIds),
  )
}

/** Operating expenses (not deposit_refund) within the range and property filter. */
export function operatingExpensesListInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): Expense[] {
  return expenses.filter(
    (e) => isOperatingExpense(e) && inRange(e.expense_date, range) && matchesProperty(e.property_id, propertyIds),
  )
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
  revenue: number
  /** operating expenses (excludes deposit_refund) */
  expenses: number
  netProfit: number
  /** netProfit / revenue, null when revenue is 0 */
  margin: number | null
  depositsReceived: number
  depositRefunds: number
  /** sum of total_amount of non-void invoices whose due_date is in range */
  billed: number
  /**
   * Over the same billed set: sum(min(paid to date, total_amount)). Payments are counted regardless of
   * paid_at, so this answers "how much of what was billed in this period has been collected".
   */
  collected: number
  /** collected / billed, null when billed is 0; always within 0..1 */
  collectionRate: number | null
  /**
   * Sum of (total - paid) over all non-void invoices with due_date <= range.end (not only in range) that
   * still have money owed. Derived from payments, never from the status column (SPEC §2a "Piutang").
   */
  outstanding: number
  paymentCount: number
  expenseCount: number
}

export function revenueInRange(payments: Payment[], range: DateRange, propertyIds?: string[]): number {
  return sumAmount(revenuePaymentsInRange(payments, range, propertyIds))
}

export function operatingExpensesInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): number {
  return sumAmount(operatingExpensesListInRange(expenses, range, propertyIds))
}

export function summarizeFinance(
  payments: Payment[],
  expenses: Expense[],
  invoices: Invoice[],
  range: DateRange,
  propertyIds?: string[],
): FinanceSummary {
  const revenueRows = revenuePaymentsInRange(payments, range, propertyIds)
  const expenseRows = operatingExpensesListInRange(expenses, range, propertyIds)
  const revenue = sumAmount(revenueRows)
  const opex = sumAmount(expenseRows)
  const netProfit = revenue - opex

  const depositsReceived = sumAmount(
    payments.filter(
      (p) => p.kind === 'deposit' && inRange(p.paid_at, range) && matchesProperty(p.property_id, propertyIds),
    ),
  )
  const depositRefunds = sumAmount(
    expenses.filter(
      (e) =>
        e.category === 'deposit_refund' && inRange(e.expense_date, range) && matchesProperty(e.property_id, propertyIds),
    ),
  )

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
  for (const inv of scopedInvoices) {
    // derived from payments, not from inv.status: a stale 'paid' flag must not hide money owed
    if (inv.due_date <= range.end) outstanding += invoiceOutstanding(inv, payments)
  }

  return {
    revenue,
    expenses: opex,
    netProfit,
    margin: revenue > 0 ? netProfit / revenue : null,
    depositsReceived,
    depositRefunds,
    billed,
    collected,
    collectionRate: billed > 0 ? collected / billed : null,
    outstanding,
    paymentCount: revenueRows.length,
    expenseCount: expenseRows.length,
  }
}

// ---------- cashflow series ----------

export interface CashflowPoint {
  key: string
  label: string
  revenue: number
  expenses: number
  net: number
}

/** One point per bucket in the range (zeros for empty buckets), chronological. */
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

/** Operating expenses by category, descending, excluding zero categories. */
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
  revenue: number
  expenses: number
  net: number
}

/** Per-property P&L for the range (shared expenses are listed under propertyId 'shared', name 'Bersama'). */
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

  for (const p of revenuePaymentsInRange(payments, range)) {
    const row = byId.get(p.property_id)
    if (row) row.revenue += p.amount
  }
  let shared = 0
  for (const e of operatingExpensesListInRange(expenses, range)) {
    if (e.property_id === null) {
      shared += e.amount
      continue
    }
    const row = byId.get(e.property_id)
    if (row) row.expenses += e.amount
  }
  for (const row of rows) row.net = row.revenue - row.expenses
  if (shared > 0) {
    rows.push({ propertyId: 'shared', name: 'Bersama', revenue: 0, expenses: shared, net: -shared })
  }
  return rows
}

export interface MethodBreakdown {
  method: PaymentMethod
  label: string
  amount: number
  count: number
}

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
  paid: number
  outstanding: number
  /** today - due_date; negative means not yet due */
  daysOverdue: number
}

/**
 * Non-void invoices that still have money owed (total - rent paid > 0, derived from payments rather than
 * the status column, SPEC §2a), sorted by due_date ascending (most overdue first) then invoice_number.
 */
export function outstandingInvoices(invoices: Invoice[], payments: Payment[], todayISO: string, propertyIds?: string[]): OutstandingItem[] {
  const items: OutstandingItem[] = []
  for (const inv of invoices) {
    if (!matchesProperty(inv.property_id, propertyIds)) continue
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

export function comparePeriods(current: FinanceSummary, previous: FinanceSummary): PeriodComparison {
  return {
    revenueDelta: current.revenue - previous.revenue,
    revenuePct: pctChange(current.revenue, previous.revenue),
    expensesDelta: current.expenses - previous.expenses,
    expensesPct: pctChange(current.expenses, previous.expenses),
    netDelta: current.netProfit - previous.netProfit,
  }
}
