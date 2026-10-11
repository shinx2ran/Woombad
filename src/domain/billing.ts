/**
 * Billing rules: invoices (tagihan), payments (pembayaran), DP / lunas status, deposits (uang jaminan),
 * and the "when is the next payment due" summary that drives the dashboard.
 *
 * Model recap (see docs/SPEC.md):
 *  - A lease (sewa) has a period_type and price_per_period.
 *  - Each invoice covers `quantity` periods starting at `period_start`, inclusive `period_end`.
 *  - Issuing an invoice extends the lease's end_date to at least the invoice's period_end.
 *  - Invoice status is derived from payments with kind='rent': paid >= total -> 'paid' (Lunas);
 *    0 < paid < total -> 'partial' (DP / Sebagian); 0 -> 'unpaid'. 'void' is manual and sticky.
 *  - Deposits are payments with kind='deposit' (never revenue), refunds are recorded on the lease.
 */
import type { Invoice, InvoiceStatus, Lease, LeaseAddon, Payment } from '../types/db'

const notImplemented = (name: string): never => {
  throw new Error(`${name} belum diimplementasikan`)
}

export interface InvoiceDraftInput {
  lease: Lease
  addons: LeaseAddon[]
  /** periods to bill (>= 1) */
  quantity: number
  /**
   * Manual override of the period start. When omitted, bounds come from nextPeriodBounds (anchored).
   * When given, period_end = periodEnd(periodStart, type, quantity).
   */
  periodStart?: string
  extraAmount?: number
  discountAmount?: number
  /** all invoices of this lease (used for numbering, first-invoice detection, next period) */
  existingInvoices: Invoice[]
  /** all invoices in the org for the month (optional, for sequence numbering) */
  orgInvoices?: Invoice[]
}

export interface InvoiceDraft {
  period_start: string
  period_end: string
  quantity: number
  base_amount: number
  addons_amount: number
  extra_amount: number
  discount_amount: number
  total_amount: number
  due_date: string
  invoice_number: string
  /** the lease end_date after this invoice is issued: max(lease.end_date, period_end) */
  new_lease_end_date: string
}

/**
 * Number of periods already billed when the lease's non-void invoices are contiguous from
 * lease.start_date (first invoice starts on start_date, each next one starts the day after the previous
 * period_end). Returns null when there are gaps/overlaps or an invoice starts before start_date.
 * Used to anchor the next period on the lease start so monthly leases never drift at month end.
 */
export function billedPeriodCount(lease: Lease, invoices: Invoice[]): number | null {
  return notImplemented('billedPeriodCount') as never ?? [lease, invoices]
}

/**
 * Bounds of the next `quantity` periods to bill:
 *  - contiguous invoices (billedPeriodCount != null): periodBounds(lease.start_date, type, count, quantity)
 *  - otherwise: start = day after the latest non-void period_end (or lease.start_date when none),
 *    end = periodEnd(start, type, quantity)
 */
export function nextPeriodBounds(lease: Lease, invoices: Invoice[], quantity: number): { period_start: string; period_end: string } {
  return notImplemented('nextPeriodBounds') as never ?? [lease, invoices, quantity]
}

/** Convenience: nextPeriodBounds(lease, invoices, 1).period_start */
export function nextPeriodStart(lease: Lease, invoices: Invoice[]): string {
  return notImplemented('nextPeriodStart') as never ?? [lease, invoices]
}

/**
 * per_period addons: amount * quantity. one_time addons: amount, only when this is the lease's first
 * (non-void) invoice. Negative amounts are allowed (discount-like addons) but totals never go below 0.
 */
export function computeAddonsAmount(addons: LeaseAddon[], quantity: number, isFirstInvoice: boolean): number {
  return notImplemented('computeAddonsAmount') as never ?? [addons, quantity, isFirstInvoice]
}

/** 'INV-YYYYMM-0001' where sequence counts invoices (any lease) whose period_start is in the same month. */
export function invoiceNumber(periodStart: string, sequence: number): string {
  return notImplemented('invoiceNumber') as never ?? [periodStart, sequence]
}

export function nextInvoiceSequence(periodStart: string, orgInvoices: Invoice[]): number {
  return notImplemented('nextInvoiceSequence') as never ?? [periodStart, orgInvoices]
}

/**
 * Build a ready-to-insert invoice. total = max(0, base + addons + extra - discount).
 * due_date = period_start (kos convention: pay at the start of the period).
 */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  return notImplemented('buildInvoiceDraft') as never ?? input
}

/** Sum of payments with kind='rent' for an invoice. */
export function paidAmountFor(invoiceId: string, payments: Payment[]): number {
  return notImplemented('paidAmountFor') as never ?? [invoiceId, payments]
}

export function outstandingFor(invoice: Invoice, payments: Payment[]): number {
  return notImplemented('outstandingFor') as never ?? [invoice, payments]
}

/** 'void' stays 'void'. Otherwise paid >= total -> 'paid'; paid > 0 -> 'partial'; else 'unpaid'. A zero-total invoice is 'paid'. */
export function deriveInvoiceStatus(totalAmount: number, paidAmount: number, current: InvoiceStatus): InvoiceStatus {
  return notImplemented('deriveInvoiceStatus') as never ?? [totalAmount, paidAmount, current]
}

export type BillingState = 'ok' | 'due_soon' | 'overdue' | 'unbilled' | 'inactive'

export interface LeaseBillingSummary {
  leaseId: string
  /** latest period_end among non-void invoices (what has been billed) */
  coveredThrough: string | null
  /** latest period_end among fully paid invoices */
  paidThrough: string | null
  /** total outstanding over unpaid/partial invoices */
  outstanding: number
  /**
   * Next date money is expected:
   *  - earliest due_date among unpaid/partial invoices, else
   *  - coveredThrough + 1 day (next period not yet billed), else
   *  - lease.start_date when nothing was ever billed.
   */
  nextDueDate: string | null
  /** nextDueDate - today in days; negative = overdue */
  daysUntilDue: number | null
  /**
   * inactive: lease not active. overdue: daysUntilDue < 0 (or any unpaid invoice past due).
   * due_soon: 0 <= daysUntilDue <= dueSoonDays. unbilled: no invoices at all and not yet due.
   * ok: otherwise.
   */
  state: BillingState
}

export function summarizeLeaseBilling(
  lease: Lease,
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
  dueSoonDays = 3,
): LeaseBillingSummary {
  return notImplemented('summarizeLeaseBilling') as never ?? [lease, invoices, payments, todayISO, dueSoonDays]
}

export interface DepositBalance {
  agreed: number
  received: number
  returned: number
  /** received - returned (what the owner still holds) */
  held: number
  /** agreed - received (what the tenant still owes as deposit) */
  shortfall: number
}

export function depositBalance(lease: Lease, payments: Payment[]): DepositBalance {
  return notImplemented('depositBalance') as never ?? [lease, payments]
}

/**
 * Validate a payment amount against an invoice. Returns an Indonesian error message or null.
 * Overpayment is rejected (amount > outstanding), as are non-positive amounts and void invoices.
 */
export function validateRentPayment(invoice: Invoice, payments: Payment[], amount: number): string | null {
  return notImplemented('validateRentPayment') as never ?? [invoice, payments, amount]
}
