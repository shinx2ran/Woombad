/**
 * Financial analysis (cash basis). Revenue = payments received (kind rent/other) by paid_at.
 * Operating expenses exclude category 'deposit_refund' (that is returning the tenant's own money).
 *
 * Property filter semantics: `propertyIds` undefined = everything in the org. When provided, only rows
 * whose property_id is in the list are included; expenses with property_id null (shared) are excluded,
 * so per-kos figures never double count shared costs. UIs should say so when a single kos is selected.
 */
import type { Expense, ExpenseCategory, Invoice, Payment, PaymentMethod, Property } from '../types/db'
import type { DateRange, Granularity } from './period'

const notImplemented = (name: string): never => {
  throw new Error(`${name} belum diimplementasikan`)
}

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
  /** sum of rent payments in range that are attached to an invoice */
  collected: number
  /** collected / billed, null when billed is 0 (can exceed 1 when old invoices are paid in this range) */
  collectionRate: number | null
  /** outstanding across all unpaid/partial invoices with due_date <= range.end (not only in range) */
  outstanding: number
  paymentCount: number
  expenseCount: number
}

export function revenueInRange(payments: Payment[], range: DateRange, propertyIds?: string[]): number {
  return notImplemented('revenueInRange') as never ?? [payments, range, propertyIds]
}

export function operatingExpensesInRange(expenses: Expense[], range: DateRange, propertyIds?: string[]): number {
  return notImplemented('operatingExpensesInRange') as never ?? [expenses, range, propertyIds]
}

export function summarizeFinance(
  payments: Payment[],
  expenses: Expense[],
  invoices: Invoice[],
  range: DateRange,
  propertyIds?: string[],
): FinanceSummary {
  return notImplemented('summarizeFinance') as never ?? [payments, expenses, invoices, range, propertyIds]
}

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
  return notImplemented('cashflowSeries') as never ?? [payments, expenses, range, granularity, propertyIds]
}

export interface CategoryBreakdown {
  category: ExpenseCategory
  label: string
  amount: number
  /** 0..1 share of the total shown */
  share: number
}

/** Operating expenses by category, descending, excluding zero categories. */
export function expensesByCategory(expenses: Expense[], range: DateRange, propertyIds?: string[]): CategoryBreakdown[] {
  return notImplemented('expensesByCategory') as never ?? [expenses, range, propertyIds]
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
  return notImplemented('profitByProperty') as never ?? [payments, expenses, properties, range]
}

export interface MethodBreakdown {
  method: PaymentMethod
  label: string
  amount: number
  count: number
}

export function revenueByMethod(payments: Payment[], range: DateRange, propertyIds?: string[]): MethodBreakdown[] {
  return notImplemented('revenueByMethod') as never ?? [payments, range, propertyIds]
}

export interface OutstandingItem {
  invoice: Invoice
  paid: number
  outstanding: number
  /** today - due_date; negative means not yet due */
  daysOverdue: number
}

/** unpaid/partial invoices sorted by due_date ascending (most overdue first). */
export function outstandingInvoices(invoices: Invoice[], payments: Payment[], todayISO: string, propertyIds?: string[]): OutstandingItem[] {
  return notImplemented('outstandingInvoices') as never ?? [invoices, payments, todayISO, propertyIds]
}

export interface PeriodComparison {
  revenueDelta: number
  /** (current - previous) / previous, null when previous is 0 */
  revenuePct: number | null
  expensesDelta: number
  expensesPct: number | null
  netDelta: number
}

export function comparePeriods(current: FinanceSummary, previous: FinanceSummary): PeriodComparison {
  return notImplemented('comparePeriods') as never ?? [current, previous]
}
