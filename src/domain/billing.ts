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
import { formatRupiah } from '../lib/format'
import { addDaysISO, daysBetween, periodBounds, periodEnd } from './period'

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

// ---------- helpers ----------

/** Non-void invoices sorted by period_start ascending (string compare is chronological for ISO dates). */
export function activeInvoicesSorted(invoices: Invoice[]): Invoice[] {
  return invoices.filter((inv) => inv.status !== 'void').sort((a, b) => a.period_start.localeCompare(b.period_start))
}

/** Latest period_end among non-void invoices, or null when none. */
export function latestCoveredThrough(invoices: Invoice[]): string | null {
  let latest: string | null = null
  for (const inv of invoices) {
    if (inv.status === 'void') continue
    if (latest === null || inv.period_end > latest) latest = inv.period_end
  }
  return latest
}

function maxISO(a: string, b: string): string {
  return a >= b ? a : b
}

// ---------- periods ----------

/**
 * Number of periods already billed when the lease's non-void invoices follow the anchored schedule from
 * lease.start_date: the first invoice starts on start_date, each next one starts the day after the previous
 * period_end, AND every invoice's period_end equals the anchored end for its quantity
 * (periodBounds(start_date, type, periodsSoFar, quantity).end). Returns null when there are gaps/overlaps,
 * an invoice does not start on start_date, or an invoice's end deviates from the anchored schedule
 * (e.g. a manual periodStart override whose unanchored end lands 3 days early on a Jan-31 lease).
 * Used to anchor the next period on the lease start so monthly leases never drift at month end; a null
 * makes nextPeriodBounds fall back to "latest period_end + 1", so no day is ever left unbilled.
 */
export function billedPeriodCount(lease: Lease, invoices: Invoice[]): number | null {
  const active = activeInvoicesSorted(invoices)
  // Zero non-void invoices: trivially contiguous, nothing billed yet.
  if (active.length === 0) return 0
  let count = 0
  for (const inv of active) {
    if (!Number.isInteger(inv.quantity) || inv.quantity < 1) return null
    const expected = periodBounds(lease.start_date, lease.period_type, count, inv.quantity)
    // Decision: both start and end must match the anchored schedule. Checking only the start
    // (contiguity) would accept an off-schedule end and then skip days on the next anchored invoice.
    if (inv.period_start !== expected.start || inv.period_end !== expected.end) return null
    count += inv.quantity
  }
  return count
}

/**
 * Bounds of the next `quantity` periods to bill:
 *  - contiguous invoices (billedPeriodCount != null): periodBounds(lease.start_date, type, count, quantity)
 *  - otherwise: start = day after the latest non-void period_end (or lease.start_date when none),
 *    end = periodEnd(start, type, quantity)
 */
export function nextPeriodBounds(lease: Lease, invoices: Invoice[], quantity: number): { period_start: string; period_end: string } {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah periode minimal 1')
  const count = billedPeriodCount(lease, invoices)
  if (count !== null) {
    const bounds = periodBounds(lease.start_date, lease.period_type, count, quantity)
    return { period_start: bounds.start, period_end: bounds.end }
  }
  const covered = latestCoveredThrough(invoices)
  const start = covered === null ? lease.start_date : addDaysISO(covered, 1)
  return { period_start: start, period_end: periodEnd(start, lease.period_type, quantity) }
}

/** Convenience: nextPeriodBounds(lease, invoices, 1).period_start */
export function nextPeriodStart(lease: Lease, invoices: Invoice[]): string {
  return nextPeriodBounds(lease, invoices, 1).period_start
}

// ---------- amounts ----------

/**
 * per_period addons: amount * quantity. one_time addons: amount, only when this is the lease's first
 * (non-void) invoice. Negative amounts are allowed (discount-like addons) but totals never go below 0.
 */
export function computeAddonsAmount(addons: LeaseAddon[], quantity: number, isFirstInvoice: boolean): number {
  let sum = 0
  for (const addon of addons) {
    if (addon.billing === 'per_period') sum += addon.amount * quantity
    else if (isFirstInvoice) sum += addon.amount
  }
  return Math.max(0, sum)
}

/** 'INV-YYYYMM-0001' where sequence counts invoices (any lease) whose period_start is in the same month. */
export function invoiceNumber(periodStart: string, sequence: number): string {
  const yyyymm = periodStart.slice(0, 7).replace('-', '')
  return `INV-${yyyymm}-${String(sequence).padStart(4, '0')}`
}

/**
 * 1 + number of org invoices whose period_start falls in the same YYYY-MM as periodStart.
 * Void invoices are counted too so a number is never reused after a cancellation.
 */
export function nextInvoiceSequence(periodStart: string, orgInvoices: Invoice[]): number {
  const month = periodStart.slice(0, 7)
  let count = 0
  for (const inv of orgInvoices) if (inv.period_start.slice(0, 7) === month) count++
  return count + 1
}

/**
 * Build a ready-to-insert invoice. total = max(0, base + addons + extra - discount).
 * due_date = period_start (kos convention: pay at the start of the period).
 */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  const { lease, addons, quantity, existingInvoices } = input
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah periode minimal 1')

  const bounds = input.periodStart
    ? { period_start: input.periodStart, period_end: periodEnd(input.periodStart, lease.period_type, quantity) }
    : nextPeriodBounds(lease, existingInvoices, quantity)

  // A voided first invoice does not count: the re-issued one is the lease's first invoice again.
  const isFirstInvoice = !existingInvoices.some((inv) => inv.status !== 'void')

  const base_amount = lease.price_per_period * quantity
  const addons_amount = computeAddonsAmount(addons, quantity, isFirstInvoice)
  const extra_amount = input.extraAmount ?? 0
  const discount_amount = input.discountAmount ?? 0
  const total_amount = Math.max(0, base_amount + addons_amount + extra_amount - discount_amount)

  const numberingPool = input.orgInvoices ?? existingInvoices
  const sequence = nextInvoiceSequence(bounds.period_start, numberingPool)

  return {
    period_start: bounds.period_start,
    period_end: bounds.period_end,
    quantity,
    base_amount,
    addons_amount,
    extra_amount,
    discount_amount,
    total_amount,
    due_date: bounds.period_start,
    invoice_number: invoiceNumber(bounds.period_start, sequence),
    new_lease_end_date: maxISO(lease.end_date, bounds.period_end),
  }
}

// ---------- payments & status ----------

/** Sum of payments with kind='rent' for an invoice. */
export function paidAmountFor(invoiceId: string, payments: Payment[]): number {
  let sum = 0
  for (const p of payments) if (p.kind === 'rent' && p.invoice_id === invoiceId) sum += p.amount
  return sum
}

/** total - paid, floored at 0. A void invoice has nothing outstanding (decision: cancelled = nothing owed). */
export function outstandingFor(invoice: Invoice, payments: Payment[]): number {
  if (invoice.status === 'void') return 0
  return Math.max(0, invoice.total_amount - paidAmountFor(invoice.id, payments))
}

/** 'void' stays 'void'. Otherwise paid >= total -> 'paid'; paid > 0 -> 'partial'; else 'unpaid'. A zero-total invoice is 'paid'. */
export function deriveInvoiceStatus(totalAmount: number, paidAmount: number, current: InvoiceStatus): InvoiceStatus {
  if (current === 'void') return 'void'
  if (totalAmount <= 0) return 'paid'
  if (paidAmount >= totalAmount) return 'paid'
  if (paidAmount > 0) return 'partial'
  return 'unpaid'
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
   *
   * Note: lease.end_date is NOT consulted. In this model end_date is extended to the latest invoice's
   * period_end, so once everything is paid nextDueDate (= coveredThrough + 1) is always > end_date; a
   * "nothing more to bill" rule based on end_date would silence every settled lease. A tenant who stays
   * past the paid period is therefore flagged due_soon/overdue until the next invoice is issued or the
   * lease is checked out (status 'ended' -> inactive).
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
  const active = invoices.filter((inv) => inv.lease_id === lease.id && inv.status !== 'void')

  let coveredThrough: string | null = null
  let paidThrough: string | null = null
  let outstanding = 0
  let earliestOpenDue: string | null = null

  for (const inv of active) {
    if (coveredThrough === null || inv.period_end > coveredThrough) coveredThrough = inv.period_end
    // Trust the stored status (the app keeps it in sync via deriveInvoiceStatus).
    if (inv.status === 'paid') {
      if (paidThrough === null || inv.period_end > paidThrough) paidThrough = inv.period_end
    } else {
      // unpaid / partial
      outstanding += Math.max(0, inv.total_amount - paidAmountFor(inv.id, payments))
      if (earliestOpenDue === null || inv.due_date < earliestOpenDue) earliestOpenDue = inv.due_date
    }
  }

  const nextDueDate = earliestOpenDue ?? (coveredThrough !== null ? addDaysISO(coveredThrough, 1) : lease.start_date)
  const daysUntilDue = daysBetween(todayISO, nextDueDate)

  // Decision: no end_date-based "nothing more to bill" short-circuit. end_date == coveredThrough for every
  // rolling lease (it is extended on each invoice), so such a rule would hide every settled lease from the
  // dashboard's "buat tagihan berikutnya" flow. A fixed-term stay is closed by checkout (status 'ended').
  let state: BillingState
  if (lease.status !== 'active') {
    state = 'inactive'
  } else if (daysUntilDue < 0) {
    state = 'overdue'
  } else if (active.length === 0 && daysUntilDue > dueSoonDays) {
    state = 'unbilled'
  } else if (daysUntilDue <= dueSoonDays) {
    state = 'due_soon'
  } else {
    state = 'ok'
  }

  return {
    leaseId: lease.id,
    coveredThrough,
    paidThrough,
    outstanding,
    nextDueDate,
    daysUntilDue,
    state,
  }
}

// ---------- deposit ----------

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
  let received = 0
  for (const p of payments) if (p.kind === 'deposit' && p.lease_id === lease.id) received += p.amount
  const returned = lease.deposit_returned_amount ?? 0
  const agreed = lease.deposit_amount
  return {
    agreed,
    received,
    returned,
    held: received - returned,
    shortfall: Math.max(0, agreed - received),
  }
}

// ---------- validation ----------

/**
 * Validate a payment amount against an invoice. Returns an Indonesian error message or null.
 * Overpayment is rejected (amount > outstanding), as are non-positive amounts and void invoices.
 */
export function validateRentPayment(invoice: Invoice, payments: Payment[], amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Jumlah pembayaran harus lebih dari 0.'
  if (invoice.status === 'void') return 'Tagihan sudah dibatalkan.'
  const outstanding = outstandingFor(invoice, payments)
  if (outstanding <= 0) return 'Tagihan ini sudah lunas.'
  if (amount > outstanding) return `Jumlah melebihi sisa tagihan (${formatRupiah(outstanding)}).`
  return null
}
