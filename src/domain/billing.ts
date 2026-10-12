/**
 * Billing rules: invoices (tagihan), payments (pembayaran), DP / lunas status, deposits (uang jaminan),
 * and the "when is the next payment due" summary that drives the dashboard.
 *
 * Model recap (see docs/SPEC.md sections 2, 2a, 2b):
 *  - A lease (sewa) has a period_type and price_per_period (the negotiated price, SPEC 5.4).
 *  - Each invoice covers `quantity` periods starting at `period_start`, inclusive `period_end`, and may use its
 *    own period_type / price (SPEC 5.2: a daily guest extends monthly); invoices.period_type null = the lease's.
 *  - Issuing an invoice extends the lease's end_date to at least the invoice's period_end.
 *  - Invoice status is derived from payments with kind='rent': paid >= total -> 'paid' (Lunas);
 *    0 < paid < total -> 'partial' (DP / Sebagian); 0 -> 'unpaid'. 'void' is manual and sticky.
 *  - Deposits: received = payments kind='deposit' (never revenue); applied ("potong jaminan") = payments
 *    with method='deposit' (kind rent/other, revenue); returned = expenses category 'deposit_refund'
 *    with the lease_id. The lease row itself stores only the agreed deposit_amount.
 */
import type { Expense, Invoice, InvoiceStatus, Lease, LeaseAddon, Payment, PaymentMethod, PeriodType } from '../types/db'
import { PERIOD_UNIT_LABEL } from '../types/db'
import { formatRupiah } from '../lib/format'
import { addDaysISO, daysBetween, periodBounds, periodEnd, periodsToCover } from './period'

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
   * Period type override for THIS invoice (SPEC 5.2: a daily guest extends as weekly/monthly). Default
   * lease.period_type. When it differs from lease.period_type the anchored grid no longer applies: the
   * default bounds become [start, periodEnd(start, periodType, quantity)] with start = periodStart ?? day
   * after the latest non-void period_end ?? lease.start_date, and WARN_PERIOD_TYPE_CHANGED is added to
   * `warnings`. The draft reports the effective type in `period_type`.
   */
  periodType?: PeriodType
  /**
   * Price per period override for THIS invoice (SPEC 5.4, negotiated price; >= 0, else Error
   * 'Nilai tidak boleh negatif.'). Default lease.price_per_period. base_amount = quantity * effective price
   * unless `baseAmount` is given. The draft reports the effective price in `price_per_period`.
   * When `periodType` differs from lease.period_type and neither this nor `baseAmount` is given, the lease's
   * per-period price of the OLD unit is applied to the NEW unit (e.g. a daily rate for a whole month) and
   * WARN_PRICE_NOT_SET is pushed, so always pass the price for the new unit on a type change.
   */
  pricePerPeriod?: number
  /**
   * Override of the base amount (>= 0, else Error 'Nilai tidak boleh negatif.').
   * Default: quantity * (pricePerPeriod ?? lease.price_per_period).
   */
  baseAmount?: number
  /**
   * Override of the add-ons total (>= 0, else Error 'Nilai tidak boleh negatif.'). Default: computed by
   * computeAddonsAmount with addonPeriodQuantity (per_period add-ons are priced per LEASE period, SPEC 2:
   * on a type-changed invoice they are multiplied by the number of lease periods the invoice covers, not by
   * `quantity`). Pass it when the owner agrees a different add-on amount for this invoice.
   */
  addonsAmount?: number
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
  /** effective period type: input.periodType ?? lease.period_type (store it in invoices.period_type) */
  period_type: PeriodType
  period_start: string
  period_end: string
  quantity: number
  /** effective price for one period: input.pricePerPeriod ?? lease.price_per_period */
  price_per_period: number
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
   *  - WARN_PERIOD_TYPE_CHANGED ('Jenis periode berbeda dari sewa; periode berikutnya dihitung dari akhir
   *    tagihan ini.') when periodType differs from lease.period_type (pushed first);
   *  - WARN_OFF_SCHEDULE ('Periode tidak mengikuti jadwal sewa; tagihan berikutnya dihitung dari akhir
   *    periode ini.') when periodStart / periodEnd overrides make the invoice leave the default bounds
   *    (its start or end differs from what nextPeriodBounds(lease, invoices, quantity, periodType) gives);
   *  - WARN_PRICE_NOT_SET ('Harga per periode belum disesuaikan dengan jenis periode baru; tarif sewa lama
   *    dipakai apa adanya. Periksa harganya.') when periodType differs from lease.period_type and neither
   *    pricePerPeriod nor baseAmount is given (the old unit's price is billed for the new unit);
   *  - addonUnitWarning(lease.period_type, n) ('Add-on per periode dihitung per malam sesuai satuan sewa
   *    (31 malam); periksa jumlahnya.') when periodType differs from lease.period_type, addonsAmount is not
   *    given and at least one add-on is billed per_period: n = addonPeriodQuantity(...) lease periods.
   * Order: type changed, off schedule, price not set, add-on unit.
   */
  warnings: string[]
}

/** Warning pushed when an override leaves the anchored period grid. */
export const WARN_OFF_SCHEDULE = 'Periode tidak mengikuti jadwal sewa; tagihan berikutnya dihitung dari akhir periode ini.'

/** Warning pushed when the invoice's period type differs from the lease's (SPEC 5.2). */
export const WARN_PERIOD_TYPE_CHANGED = 'Jenis periode berbeda dari sewa; periode berikutnya dihitung dari akhir tagihan ini.'

/**
 * Warning pushed when the period type changes but no `pricePerPeriod` (nor `baseAmount`) is given: the
 * lease's price for the OLD unit is applied to the NEW unit (a Rp 100.000 daily rate billed for a month).
 */
export const WARN_PRICE_NOT_SET =
  'Harga per periode belum disesuaikan dengan jenis periode baru; tarif sewa lama dipakai apa adanya. Periksa harganya.'

/**
 * Warning pushed when a type-changed invoice carries per_period add-ons: they stay priced per lease period
 * (`leaseType`), so they are multiplied by `addonQuantity` lease periods (see addonPeriodQuantity), e.g.
 * addonUnitWarning('daily', 31) -> 'Add-on per periode dihitung per malam sesuai satuan sewa (31 malam);
 * periksa jumlahnya.'
 */
export function addonUnitWarning(leaseType: PeriodType, addonQuantity: number): string {
  const unit = PERIOD_UNIT_LABEL[leaseType]
  return `Add-on per periode dihitung per ${unit} sesuai satuan sewa (${addonQuantity} ${unit}); periksa jumlahnya.`
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
 * A null makes nextPeriodBounds try to re-anchor on the latest run of same-type invoices (chainAnchor) and
 * otherwise fall back to "latest period_end + 1 day", so no day is ever left unbilled.
 */
export function billedPeriodCount(lease: Lease, invoices: Invoice[]): number | null {
  return gridPeriodCount(lease.start_date, lease.period_type, activeInvoicesSorted(invoices))
}

/**
 * Periods covered by `run` (sorted, non-void) when every invoice sits exactly on the `type` grid anchored
 * at `anchorISO`: idx starts at 0 and each invoice must have period_start === periodBounds(anchor, type,
 * idx, 1).start and period_end === periodBounds(anchor, type, idx, quantity).end; null otherwise. [] -> 0.
 */
function gridPeriodCount(anchorISO: string, type: PeriodType, run: Invoice[]): number | null {
  let idx = 0
  for (const inv of run) {
    if (!Number.isInteger(inv.quantity) || inv.quantity < 1) return null
    const expectedStart = periodBounds(anchorISO, type, idx, 1).start
    const expectedEnd = periodBounds(anchorISO, type, idx, inv.quantity).end
    // Decision: both start and end must match the anchored schedule. Checking only the start
    // (contiguity) would accept an off-schedule end and then skip days on the next anchored invoice.
    if (inv.period_start !== expectedStart || inv.period_end !== expectedEnd) return null
    idx += inv.quantity
  }
  return idx
}

export interface ChainAnchor {
  /** date the lease's period grid is anchored on (lease.start_date, or the start of the re-anchored run) */
  anchor: string
  /** whole lease periods already billed from `anchor`; the next period is periodBounds(anchor, type, count, ...) */
  count: number
}

/**
 * Where the lease's billing chain is anchored, for the lease's own period_type:
 *  1. `{ anchor: lease.start_date, count: billedPeriodCount }` when the non-void invoices sit on the grid
 *     from start_date (billedPeriodCount != null) — the normal case;
 *  2. otherwise the chain **re-anchors**: take the trailing run of non-void invoices (sorted by
 *     period_start) whose invoicePeriodType(inv, lease) === lease.period_type and find the longest suffix
 *     of it that sits exactly on the grid anchored at that suffix's own first period_start (same rule as
 *     billedPeriodCount, i.e. each invoice covers a whole number of lease periods from the anchor). Returns
 *     `{ anchor: suffix[0].period_start, count }`.
 *     This is what keeps month-end tenants on their billing day after a SPEC 5.2 switch is made the
 *     lease's type: daily lease from 2026-01-01 billed through 01-30, monthly extension 01-31..02-27, lease
 *     switched to monthly -> anchor 2026-01-31, count 1 -> next 02-28..03-30, then 03-31..04-29 (not the
 *     drifting 02-28..03-27, 03-28..04-27).
 *  3. null when no such suffix exists: the latest non-void invoice was billed with another type, or its
 *     end is not a whole number of lease periods from its start (a pro-rata `periodEnd` invoice, e.g.
 *     2026-02-28..2026-03-13 on a monthly lease). nextPeriodBounds then uses "latest period_end + 1 day".
 * No non-void invoices -> `{ anchor: lease.start_date, count: 0 }`.
 */
export function chainAnchor(lease: Lease, invoices: Invoice[]): ChainAnchor | null {
  const active = activeInvoicesSorted(invoices)
  const fromStart = gridPeriodCount(lease.start_date, lease.period_type, active)
  if (fromStart !== null) return { anchor: lease.start_date, count: fromStart }
  let runStart = active.length
  while (runStart > 0 && invoicePeriodType(active[runStart - 1], lease) === lease.period_type) runStart -= 1
  for (let k = runStart; k < active.length; k += 1) {
    const run = active.slice(k)
    const count = gridPeriodCount(run[0].period_start, lease.period_type, run)
    if (count !== null) return { anchor: run[0].period_start, count }
  }
  return null
}

/**
 * Bounds of the next `quantity` periods to bill. `periodType` (default lease.period_type) is the type the
 * new invoice will use (SPEC 5.2 extension with a different type); UIs pass it to preview the bounds.
 *  - periodType === lease.period_type and chainAnchor(lease, invoices) != null:
 *    periodBounds(anchor, lease.period_type, count, quantity). With invoices on the grid from start_date
 *    this is the anchored grid exactly as before; after an off-grid invoice the chain re-anchors on the
 *    latest run of same-type invoices (see chainAnchor), e.g. Jan-31 monthly lease with a manual invoice
 *    2026-02-28..2026-03-27 -> next 2026-03-28..2026-04-27 (anchored on 02-28, no 28-30 Mar hole).
 *  - otherwise (no anchor, OR periodType differs from the lease's so the anchored grid no longer applies):
 *    start = day after the latest non-void period_end (or lease.start_date when none),
 *    end = periodEnd(start, periodType, quantity)
 * E.g. daily lease billed through 2026-03-10, periodType 'monthly', quantity 1 -> 2026-03-11 .. 2026-04-10.
 */
export function nextPeriodBounds(
  lease: Lease,
  invoices: Invoice[],
  quantity: number,
  periodType?: PeriodType,
): { period_start: string; period_end: string } {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah periode minimal 1')
  const type = periodType ?? lease.period_type
  if (type === lease.period_type) {
    const chain = chainAnchor(lease, invoices)
    if (chain !== null) {
      const bounds = periodBounds(chain.anchor, lease.period_type, chain.count, quantity)
      return { period_start: bounds.start, period_end: bounds.end }
    }
  }
  const covered = latestCoveredThrough(invoices)
  const start = covered === null ? lease.start_date : addDaysISO(covered, 1)
  return { period_start: start, period_end: periodEnd(start, type, quantity) }
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

/**
 * How many LEASE periods a per_period add-on is charged for on an invoice (SPEC 2: add-on amounts are per
 * lease period, "dikali jumlah periode"):
 *  - periodType === lease.period_type -> `quantity` (unchanged behaviour; a pro-rata invoice has quantity 1);
 *  - otherwise -> periodsToCover(period_start, period_end, lease.period_type): the whole lease periods needed
 *    to cover the invoice's dates, rounded up. Daily lease extended monthly 2026-03-11..2026-04-10 -> 31
 *    (nights); daily -> weekly x2 -> 14; weekly lease extended monthly (31 days) -> 5 weeks; a monthly
 *    lease billed 3 nights daily -> 1 month (the owner can override with InvoiceDraftInput.addonsAmount).
 */
export function addonPeriodQuantity(
  lease: Lease,
  periodType: PeriodType,
  bounds: { period_start: string; period_end: string },
  quantity: number,
): number {
  if (periodType === lease.period_type) return quantity
  return periodsToCover(bounds.period_start, bounds.period_end, lease.period_type)
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
 * Effective type = periodType ?? lease.period_type; effective price = pricePerPeriod ?? lease.price_per_period
 * (>= 0, else 'Nilai tidak boleh negatif.'). Both are reported on the draft (`period_type`, `price_per_period`).
 *
 * Bounds (default = nextPeriodBounds(lease, existingInvoices, quantity, effectiveType)):
 *  - default, type unchanged: the anchored grid, exactly as before
 *  - default, type differs from lease.period_type: start = day after the latest non-void period_end (or
 *    lease.start_date when none), end = periodEnd(start, effectiveType, quantity); `warnings` gets
 *    WARN_PERIOD_TYPE_CHANGED. E.g. daily lease billed through 2026-03-10 extended monthly ->
 *    2026-03-11 .. 2026-04-10.
 *  - periodStart only: [periodStart, periodEnd(periodStart, effectiveType, quantity)]
 *  - periodEnd given: quantity forced to 1, start = periodStart ?? default.period_start,
 *    end = periodEnd (must be >= start, else 'Tanggal akhir harus setelah tanggal mulai.')
 *  When the resulting start/end differ from the default bounds, `warnings` also contains WARN_OFF_SCHEDULE.
 *
 * Amounts: base = baseAmount ?? quantity * effective price; addons = addonsAmount ?? computeAddonsAmount(
 * addons, addonPeriodQuantity(lease, effectiveType, bounds, quantity), isFirstInvoice) — per_period add-ons
 * are priced per LEASE period, so on a type-changed invoice they are multiplied by the lease periods the
 * invoice covers (daily lease, 'Parkir motor' Rp 10.000/malam, extended monthly 2026-03-11..2026-04-10 ->
 * 31 x 10.000 = Rp 310.000, plus addonUnitWarning('daily', 31)); one_time add-ons only on the lease's first
 * non-void invoice; extra/discount default 0. baseAmount, addonsAmount, extraAmount and discountAmount must
 * be >= 0 ('Nilai tidak boleh negatif.'). total = base + addons + extra - discount; a negative total throws
 * 'Diskon melebihi jumlah tagihan.' (no clamping); 0 is allowed (free period, 'paid').
 * A type change without pricePerPeriod (and without baseAmount) bills the old unit's price for the new unit
 * and pushes WARN_PRICE_NOT_SET; it does not throw (the fallback price rule still applies).
 *
 * due_date = period_start (kos convention: pay at the start of the period).
 * invoice_number from nextInvoiceSequence(period_start, orgInvoices ?? existingInvoices).
 * new_lease_end_date = max(lease.end_date, period_end) regardless of the type change.
 */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  const { lease, addons, existingInvoices } = input
  const hasCustomEnd = input.periodEnd !== undefined
  const quantity = hasCustomEnd ? 1 : input.quantity
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah periode minimal 1')

  const period_type = input.periodType ?? lease.period_type
  const price_per_period = input.pricePerPeriod === undefined ? lease.price_per_period : assertNonNegative(input.pricePerPeriod)
  const typeChanged = period_type !== lease.period_type

  const anchored = nextPeriodBounds(lease, existingInvoices, quantity, period_type)
  let bounds: { period_start: string; period_end: string }
  if (input.periodEnd !== undefined) {
    const start = input.periodStart ?? anchored.period_start
    if (daysBetween(start, input.periodEnd) < 0) throw new Error('Tanggal akhir harus setelah tanggal mulai.')
    bounds = { period_start: start, period_end: input.periodEnd }
  } else if (input.periodStart !== undefined) {
    bounds = { period_start: input.periodStart, period_end: periodEnd(input.periodStart, period_type, quantity) }
  } else {
    bounds = anchored
  }

  const warnings: string[] = []
  if (typeChanged) warnings.push(WARN_PERIOD_TYPE_CHANGED)
  if (bounds.period_start !== anchored.period_start || bounds.period_end !== anchored.period_end) {
    warnings.push(WARN_OFF_SCHEDULE)
  }
  if (typeChanged && input.pricePerPeriod === undefined && input.baseAmount === undefined) warnings.push(WARN_PRICE_NOT_SET)

  // A voided first invoice does not count: the re-issued one is the lease's first invoice again.
  const isFirstInvoice = !existingInvoices.some((inv) => inv.status !== 'void')

  const base_amount = input.baseAmount === undefined ? price_per_period * quantity : assertNonNegative(input.baseAmount)
  // per_period add-ons stay in the lease's unit: on a type change they are multiplied by the lease periods covered.
  const addonQuantity = addonPeriodQuantity(lease, period_type, bounds, quantity)
  let addons_amount: number
  if (input.addonsAmount === undefined) {
    addons_amount = computeAddonsAmount(addons, addonQuantity, isFirstInvoice)
    if (typeChanged && addons.some((a) => a.billing === 'per_period')) warnings.push(addonUnitWarning(lease.period_type, addonQuantity))
  } else {
    addons_amount = assertNonNegative(input.addonsAmount)
  }
  const extra_amount = assertNonNegative(input.extraAmount)
  const discount_amount = assertNonNegative(input.discountAmount)
  const total_amount = base_amount + addons_amount + extra_amount - discount_amount
  if (total_amount < 0) throw new Error('Diskon melebihi jumlah tagihan.')

  const numberingPool = input.orgInvoices ?? existingInvoices
  const sequence = nextInvoiceSequence(bounds.period_start, numberingPool)

  return {
    period_type,
    period_start: bounds.period_start,
    period_end: bounds.period_end,
    quantity,
    price_per_period,
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

/** Period type an invoice was billed with: invoice.period_type ?? lease.period_type (older rows store null). */
export function invoicePeriodType(invoice: Invoice, lease: Lease): PeriodType {
  return invoice.period_type ?? lease.period_type
}

/** Unit word for the invoice's quantity ('malam' | 'minggu' | 'bulan'), from invoicePeriodType. */
export function invoiceUnitLabel(invoice: Invoice, lease: Lease): string {
  return PERIOD_UNIT_LABEL[invoicePeriodType(invoice, lease)]
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

/**
 * Sort key for "jatuh tempo terdekat" lists (SPEC 5.1): summary.nextDueDate, or '9999-12-31' when null, so
 * plain string comparison (a < b) orders earliest due first; overdue leases (past dates) naturally come first
 * and leases with no due date last.
 */
export function nextDueSortKey(summary: LeaseBillingSummary): string {
  return summary.nextDueDate ?? '9999-12-31'
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


/**
 * A lease that is fully paid and whose end_date falls within the next `withinDays` days: the owner's
 * decision is "perpanjang atau checkout", not "bayar / tagih". summarizeLeaseBilling ignores end_date
 * (a rolling tenant's end_date always equals coveredThrough), so UIs use this predicate to show such a
 * lease as "akan berakhir" instead of "jatuh tempo". A paid-up lease whose end_date is already in the
 * past is NOT covered (the tenant stayed on; the next invoice must be issued).
 */
export function isPaidUpAndEnding(lease: Lease, summary: LeaseBillingSummary, todayISO: string, withinDays = 7): boolean {
  return (
    lease.status === 'active' &&
    summary.outstanding === 0 &&
    summary.state !== 'unbilled' &&
    lease.end_date >= todayISO &&
    lease.end_date <= addDaysISO(todayISO, withinDays)
  )
}
