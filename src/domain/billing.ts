/**
 * Billing rules: invoices (tagihan), payments (pembayaran), DP / lunas status, deposits (uang jaminan),
 * and the "when is the next payment due" summary that drives the dashboard.
 *
 * Model recap (see docs/SPEC.md sections 2, 2a, 2b):
 *  - A lease (sewa) has a period_type and price_per_period.
 *  - Each invoice covers `quantity` periods starting at `period_start`, inclusive `period_end`.
 *  - Issuing an invoice extends the lease's end_date to at least the invoice's period_end.
 *  - Invoice status is derived from payments with kind='rent': paid >= total -> 'paid' (Lunas);
 *    0 < paid < total -> 'partial' (DP / Sebagian); 0 -> 'unpaid'. 'void' is manual and sticky.
 *  - Deposits: received = payments kind='deposit' (never revenue); applied ("potong jaminan") = payments
 *    with method='deposit' (kind rent/other, revenue); returned = expenses category 'deposit_refund'
 *    with the lease_id. The lease row itself stores only the agreed deposit_amount.
 */
import type { Expense, Invoice, InvoiceStatus, Lease, LeaseAddon, Payment, PaymentMethod } from '../types/db'
import { formatRupiah } from '../lib/format'
import { addDaysISO, daysBetween, periodBounds, periodEnd } from './period'

export interface InvoiceDraftInput {
  lease: Lease
  addons: LeaseAddon[]
  /**
   * Periods to bill (integer >= 1). Ignored (forced to 1) when `periodEnd` is given.
   */
  quantity: number
  /**
   * Manual override of the period start. When omitted, bounds come from nextPeriodBounds (anchored).
   * When given without `periodEnd`, period_end = periodEnd(periodStart, type, quantity).
   * Leaving the anchored grid adds a warning to the draft (see InvoiceDraft.warnings).
   */
  periodStart?: string
  /**
   * Inclusive custom end date for pro-rata / partial extensions ("tambah 2 minggu saja" on a monthly lease).
   * Must be >= the period start (else Error 'Tanggal akhir harus setelah tanggal mulai.'). When given,
   * quantity is forced to 1, period_end = periodEnd, and the start is `periodStart` when given, otherwise
   * nextPeriodBounds(lease, existingInvoices, 1).period_start. Usually paired with `baseAmount`.
   */
  periodEnd?: string
  /**
   * Override of the base amount (>= 0, else Error 'Nilai tidak boleh negatif.').
   * Default: quantity * lease.price_per_period.
   */
  baseAmount?: number
  /** Manual extras (listrik, denda, ...), >= 0. See parseExtraBreakdown / formatExtraBreakdown for the notes convention. */
  extraAmount?: number
  /** Discount, >= 0. A discount larger than base + addons + extra throws 'Diskon melebihi jumlah tagihan.' */
  discountAmount?: number
  /** all invoices of this lease (used for first-invoice detection and the next period) */
  existingInvoices: Invoice[]
  /**
   * All invoices in the org (optional; used for sequence numbering, see nextInvoiceSequence).
   * Falls back to existingInvoices when omitted, which is only correct for a single-lease org.
   */
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
  /** base + addons + extra - discount; never negative (buildInvoiceDraft throws instead). 0 is allowed (free period -> 'paid'). */
  total_amount: number
  due_date: string
  invoice_number: string
  /** the lease end_date after this invoice is issued: max(lease.end_date, period_end) */
  new_lease_end_date: string
  /**
   * Indonesian, non-blocking notices for the UI to show before saving. Currently:
   *  - 'Periode tidak mengikuti jadwal sewa; tagihan berikutnya dihitung dari akhir periode ini.'
   *    when periodStart / periodEnd overrides make the invoice leave the anchored grid
   *    (its start or end differs from what nextPeriodBounds would have produced).
   */
  warnings: string[]
}

/** Warning pushed when an override leaves the anchored period grid. */
export const WARN_OFF_SCHEDULE = 'Periode tidak mengikuti jadwal sewa; tagihan berikutnya dihitung dari akhir periode ini.'

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

function assertNonNegative(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value) || value < 0) throw new Error('Nilai tidak boleh negatif.')
  return value
}

// ---------- periods ----------

/**
 * Number of periods already billed when the lease's non-void invoices sit exactly on the anchored grid
 * from lease.start_date. Non-void invoices are sorted by period_start; starting at idx = 0 each invoice must
 * satisfy period_start === periodBounds(start_date, type, idx, 1).start AND
 * period_end === periodBounds(start_date, type, idx, quantity).end, then idx += quantity. Returns idx.
 *
 * Returns null on any mismatch: gaps, overlaps, a first invoice not on start_date, a non-integer quantity,
 * or an end that deviates from the grid (e.g. a manual periodStart 2026-02-28 on a Jan-31 lease yields
 * period_end 2026-03-27 while the anchored end is 2026-03-30). Zero non-void invoices -> 0.
 * A null makes nextPeriodBounds fall back to "latest period_end + 1 day", so no day is ever left unbilled.
 */
export function billedPeriodCount(lease: Lease, invoices: Invoice[]): number | null {
  const active = activeInvoicesSorted(invoices)
  if (active.length === 0) return 0
  let idx = 0
  for (const inv of active) {
    if (!Number.isInteger(inv.quantity) || inv.quantity < 1) return null
    const expectedStart = periodBounds(lease.start_date, lease.period_type, idx, 1).start
    const expectedEnd = periodBounds(lease.start_date, lease.period_type, idx, inv.quantity).end
    // Decision: both start and end must match the anchored schedule. Checking only the start
    // (contiguity) would accept an off-schedule end and then skip days on the next anchored invoice.
    if (inv.period_start !== expectedStart || inv.period_end !== expectedEnd) return null
    idx += inv.quantity
  }
  return idx
}

/**
 * Bounds of the next `quantity` periods to bill:
 *  - invoices on the anchored grid (billedPeriodCount != null): periodBounds(lease.start_date, type, count, quantity)
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
 * (non-void) invoice. Negative amounts are allowed (discount-like addons) but the addons total never goes below 0.
 */
export function computeAddonsAmount(addons: LeaseAddon[], quantity: number, isFirstInvoice: boolean): number {
  let sum = 0
  for (const addon of addons) {
    if (addon.billing === 'per_period') sum += addon.amount * quantity
    else if (isFirstInvoice) sum += addon.amount
  }
  return Math.max(0, sum)
}

/** 'INV-YYYYMM-0001': YYYYMM from periodStart, sequence from nextInvoiceSequence (padded to 4, longer when needed). */
export function invoiceNumber(periodStart: string, sequence: number): string {
  const yyyymm = periodStart.slice(0, 7).replace('-', '')
  return `INV-${yyyymm}-${String(sequence).padStart(4, '0')}`
}

const INVOICE_NUMBER_RE = /^INV-(\d{6})-(\d+)$/

/**
 * Next sequence for periodStart's month: parses every invoice_number matching /^INV-(\d{6})-(\d+)$/ whose
 * YYYYMM equals periodStart's YYYYMM (void invoices included) and returns max(sequence) + 1, or 1 when none.
 * Pass ALL invoices of the org (every lease), not just one lease's.
 *
 * Because only the maximum is consulted, the number of a hard-deleted invoice is reused only when it was the
 * highest in its month. The UI should void invoices rather than delete them (SPEC 2b.3) so numbers are never
 * reused; on a unique-constraint error (two devices at once) retry with the next number (SPEC 2b.11).
 */
export function nextInvoiceSequence(periodStart: string, orgInvoices: Invoice[]): number {
  const yyyymm = periodStart.slice(0, 7).replace('-', '')
  let max = 0
  for (const inv of orgInvoices) {
    const m = INVOICE_NUMBER_RE.exec(inv.invoice_number)
    if (!m || m[1] !== yyyymm) continue
    const seq = Number(m[2])
    if (seq > max) max = seq
  }
  return max + 1
}

/**
 * Build a ready-to-insert invoice.
 *
 * Bounds:
 *  - default: nextPeriodBounds(lease, existingInvoices, quantity) (anchored grid)
 *  - periodStart only: [periodStart, periodEnd(periodStart, type, quantity)]
 *  - periodEnd given: quantity forced to 1, start = periodStart ?? nextPeriodBounds(..., 1).period_start,
 *    end = periodEnd (must be >= start, else 'Tanggal akhir harus setelah tanggal mulai.')
 *  When the resulting start/end differ from the anchored bounds, `warnings` contains WARN_OFF_SCHEDULE.
 *
 * Amounts: base = baseAmount ?? quantity * price_per_period; addons via computeAddonsAmount (one_time addons
 * only on the lease's first non-void invoice); extra/discount default 0. baseAmount, extraAmount and
 * discountAmount must be >= 0 ('Nilai tidak boleh negatif.'). total = base + addons + extra - discount;
 * a negative total throws 'Diskon melebihi jumlah tagihan.' (no clamping); 0 is allowed (free period, 'paid').
 *
 * due_date = period_start (kos convention: pay at the start of the period).
 * invoice_number from nextInvoiceSequence(period_start, orgInvoices ?? existingInvoices).
 */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  const { lease, addons, existingInvoices } = input
  const hasCustomEnd = input.periodEnd !== undefined
  const quantity = hasCustomEnd ? 1 : input.quantity
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah periode minimal 1')

  const anchored = nextPeriodBounds(lease, existingInvoices, quantity)
  let bounds: { period_start: string; period_end: string }
  if (input.periodEnd !== undefined) {
    const start = input.periodStart ?? anchored.period_start
    if (daysBetween(start, input.periodEnd) < 0) throw new Error('Tanggal akhir harus setelah tanggal mulai.')
    bounds = { period_start: start, period_end: input.periodEnd }
  } else if (input.periodStart !== undefined) {
    bounds = { period_start: input.periodStart, period_end: periodEnd(input.periodStart, lease.period_type, quantity) }
  } else {
    bounds = anchored
  }

  const warnings: string[] = []
  if (bounds.period_start !== anchored.period_start || bounds.period_end !== anchored.period_end) {
    warnings.push(WARN_OFF_SCHEDULE)
  }

  // A voided first invoice does not count: the re-issued one is the lease's first invoice again.
  const isFirstInvoice = !existingInvoices.some((inv) => inv.status !== 'void')

  const base_amount = input.baseAmount === undefined ? lease.price_per_period * quantity : assertNonNegative(input.baseAmount)
  const addons_amount = computeAddonsAmount(addons, quantity, isFirstInvoice)
  const extra_amount = assertNonNegative(input.extraAmount)
  const discount_amount = assertNonNegative(input.discountAmount)
  const total_amount = base_amount + addons_amount + extra_amount - discount_amount
  if (total_amount < 0) throw new Error('Diskon melebihi jumlah tagihan.')

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
    warnings,
  }
}

// ---------- payments & status ----------

/** Sum of payments with kind='rent' for an invoice (any method, including 'deposit' = potong jaminan). */
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
  /**
   * latest period_end among settled invoices: stored status 'paid' OR total_amount - rent paid <= 0
   * (a zero-total free period and a 'partial' invoice whose payments reach the total count as settled
   * regardless of the status column)
   */
  paidThrough: string | null
  /** sum of max(0, total_amount - rent paid) over non-settled invoices; always 0 when state is driven by coveredThrough */
  outstanding: number
  /**
   * Next date money is expected:
   *  - earliest due_date among non-settled invoices (derived: total_amount - rent paid > 0 and status != 'paid'), else
   *  - coveredThrough + 1 day (next period not yet billed), else
   *  - lease.start_date when nothing was ever billed.
   */
  nextDueDate: string | null
  /** nextDueDate - today in days, raw (not shifted by graceDays); negative = past due */
  daysUntilDue: number | null
  /**
   * inactive: lease not active.
   * overdue:  daysUntilDue < -graceDays (the grace period has fully elapsed).
   * due_soon: -graceDays <= daysUntilDue <= dueSoonDays (about to fall due, due today, or within grace).
   * unbilled: no non-void invoices at all and daysUntilDue > dueSoonDays.
   * ok:       otherwise.
   *
   * Note: lease.end_date is NOT consulted. In this model end_date is extended to the latest invoice's
   * period_end, so once everything is paid nextDueDate (= coveredThrough + 1) is always > end_date; a
   * "nothing more to bill" rule based on end_date would silence every settled lease. A tenant who stays
   * past the paid period is therefore flagged due_soon/overdue until the next invoice is issued or the
   * lease is checked out (status 'ended' -> inactive).
   */
  state: BillingState
}

/**
 * Dashboard summary for one lease. `dueSoonDays` (default 3) is how many days ahead a due date counts as
 * due_soon; `graceDays` (default 3, SPEC 2b.12) is how many days past the due date are still due_soon
 * before the state becomes overdue (graceDays 0 -> overdue the day after the due date).
 */
export function summarizeLeaseBilling(
  lease: Lease,
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
  dueSoonDays = 3,
  graceDays = 3,
): LeaseBillingSummary {
  const active = invoices.filter((inv) => inv.lease_id === lease.id && inv.status !== 'void')

  let coveredThrough: string | null = null
  let paidThrough: string | null = null
  let outstanding = 0
  let earliestOpenDue: string | null = null

  for (const inv of active) {
    if (coveredThrough === null || inv.period_end > coveredThrough) coveredThrough = inv.period_end
    // "Open" is decided by the derived amount (SPEC 2a: receivables come from payments, not the status
    // column), so a zero-total free period or a 'partial' invoice whose rent payments already reach the
    // total is settled even when the stored status lags. A stored 'paid' is also honoured so a settled
    // invoice is never reopened when the caller passes a payments subset.
    const open = Math.max(0, inv.total_amount - paidAmountFor(inv.id, payments))
    if (inv.status === 'paid' || open <= 0) {
      if (paidThrough === null || inv.period_end > paidThrough) paidThrough = inv.period_end
    } else {
      outstanding += open
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
  } else if (daysUntilDue < -graceDays) {
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
  /** lease.deposit_amount (what was agreed) */
  agreed: number
  /** sum of payments kind='deposit' with lease_id === lease.id (cash actually received) */
  received: number
  /** sum of payments with lease_id === lease.id, method='deposit' and kind rent or other (potong jaminan); kind='deposit' rows never count here */
  applied: number
  /** sum of expenses with lease_id === lease.id and category='deposit_refund' (cash returned to the tenant) */
  returned: number
  /** received - applied - returned (what the owner still holds); may be negative when data is inconsistent, not clamped */
  held: number
  /** max(0, agreed - received) (what the tenant still owes as deposit) */
  shortfall: number
}

/**
 * Deposit (uang jaminan) position of one lease, see SPEC 2a "Uang jaminan". Pass the org's payments and
 * expenses (or any superset of the lease's); rows of other leases are ignored by lease_id.
 */
export function depositBalance(lease: Lease, payments: Payment[], expenses: Expense[]): DepositBalance {
  let received = 0
  let applied = 0
  for (const p of payments) {
    if (p.lease_id !== lease.id) continue
    if (p.kind === 'deposit') received += p.amount
    // Only rent/other payments are "potong jaminan". A kind='deposit' row with method='deposit' is a data
    // error; counting it as applied would silently net the deposit to 0 and diverge from finance.depositsHeld.
    else if (p.method === 'deposit') applied += p.amount
  }
  let returned = 0
  for (const e of expenses) {
    if (e.lease_id === lease.id && e.category === 'deposit_refund') returned += e.amount
  }
  const agreed = lease.deposit_amount
  return {
    agreed,
    received,
    applied,
    returned,
    held: received - applied - returned,
    shortfall: Math.max(0, agreed - received),
  }
}

// ---------- validation ----------

export interface ValidateRentPaymentOptions {
  method?: PaymentMethod
  /** depositBalance(...).held; only consulted when method === 'deposit' */
  depositHeld?: number
}

/**
 * Validate a rent payment amount against an invoice. Returns an Indonesian error message or null.
 * Checks, in order:
 *  1. amount not finite or <= 0        -> 'Jumlah pembayaran harus lebih dari 0.'
 *  2. invoice void                      -> 'Tagihan sudah dibatalkan.'
 *  3. nothing outstanding               -> 'Tagihan ini sudah lunas.'
 *  4. amount > outstanding              -> 'Jumlah melebihi sisa tagihan (Rp X).'
 *  5. options.method === 'deposit', options.depositHeld != null and amount > depositHeld
 *                                       -> 'Jaminan yang dipegang hanya Rp X.'
 */
export function validateRentPayment(
  invoice: Invoice,
  payments: Payment[],
  amount: number,
  options?: ValidateRentPaymentOptions,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Jumlah pembayaran harus lebih dari 0.'
  if (invoice.status === 'void') return 'Tagihan sudah dibatalkan.'
  const outstanding = outstandingFor(invoice, payments)
  if (outstanding <= 0) return 'Tagihan ini sudah lunas.'
  if (amount > outstanding) return `Jumlah melebihi sisa tagihan (${formatRupiah(outstanding)}).`
  if (options?.method === 'deposit' && options.depositHeld != null && amount > options.depositHeld) {
    return `Jaminan yang dipegang hanya ${formatRupiah(options.depositHeld)}.`
  }
  return null
}

// ---------- extra breakdown (notes convention) ----------

export interface ExtraBreakdown {
  listrik?: number
  denda?: number
  lainnya?: number
}

const EXTRA_KEYS = ['listrik', 'denda', 'lainnya'] as const
const EXTRA_LABEL: Record<(typeof EXTRA_KEYS)[number], string> = { listrik: 'Listrik', denda: 'Denda', lainnya: 'Lainnya' }
const EXTRA_RE = /\b(listrik|denda|lainnya)\s*:\s*(?:rp\.?\s*)?(\d[\d.]*)/gi

/**
 * Parse the extra_amount breakdown convention stored in invoice notes:
 * 'Listrik: 125000; Denda: 50000; Lainnya: 10000'. Labels are case-insensitive, amounts are digits with
 * optional thousand dots ('125.000'), an optional 'Rp' prefix is tolerated, and surrounding text is ignored.
 * Only the parts found are present in the result; a repeated label keeps the last value. null/'' -> {}.
 */
export function parseExtraBreakdown(notes: string | null): ExtraBreakdown {
  const out: ExtraBreakdown = {}
  if (!notes) return out
  for (const m of notes.matchAll(EXTRA_RE)) {
    const key = m[1].toLowerCase() as (typeof EXTRA_KEYS)[number]
    const value = Number(m[2].replace(/\./g, ''))
    if (Number.isFinite(value)) out[key] = value
  }
  return out
}

/**
 * Inverse of parseExtraBreakdown: 'Listrik: 125000; Denda: 50000; Lainnya: 10000' in that fixed order,
 * omitting parts that are undefined, 0, NaN or negative. Returns '' when nothing remains.
 */
export function formatExtraBreakdown(parts: ExtraBreakdown): string {
  const chunks: string[] = []
  for (const key of EXTRA_KEYS) {
    const value = parts[key]
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue
    chunks.push(`${EXTRA_LABEL[key]}: ${Math.round(value)}`)
  }
  return chunks.join('; ')
}
