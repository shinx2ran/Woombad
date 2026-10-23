/**
 * Ubah tanggal mulai sewa (SPEC 7.6): the owner typed a wrong lease start date and noticed months later, after every
 * invoice since was generated from it. planLeaseRedate moves the whole billing schedule to the right start date; it
 * is pure (no I/O) so the dialog can preview exactly what the save will write.
 *
 * Dates follow SPEC 7.3: period_end / end_date are LAST NIGHTS (inclusive); screens show them as check-out days.
 */
import type { Invoice, Lease, Payment, PeriodType, Tenant } from '../../types/db'
import { activeInvoicesSorted, billedPeriodCount, summarizeLeaseBilling, type LeaseBillingSummary } from '../../domain/billing'
import { addDaysISO, addPeriods, daysBetween, parseISODate, periodBounds } from '../../domain/period'
import { leaseOccupiedUntil, leaseOverlaps } from '../../domain/occupancy'
import { formatCheckout, formatDate, formatRupiah, formatStay } from '../../lib/format'
import { REDATE_INACTIVE_MESSAGE, REDATE_SAME_DATE_MESSAGE } from '../../lib/repo/types'
import { appendLeaseNote, remainingDays } from './leaseUtils'

// Shared with LocalRepo and public.redate_lease, so every mode says the same. Ended/cancelled leases keep their dates:
// their check-out and refunds were real events.
export { REDATE_INACTIVE_MESSAGE, REDATE_SAME_DATE_MESSAGE, REDATE_STAFF_MESSAGE } from '../../lib/repo/types'
export const REDATE_INVALID_DATE_MESSAGE = 'Isi tanggal mulai yang benar.'

/** Shift mode: some invoice is off the anchored grid, so every date moves by the same number of days. */
export function redateShiftWarning(days: number): string {
  return `Ada tagihan dengan periode khusus, jadi semua tanggal digeser ${Math.abs(days)} hari.`
}

/** 'Bentrok dengan sewa Siti Rahayu di kamar ini (1 Jul – 25 Agt 2026).' */
export function redateConflictMessage(tenantName: string | null | undefined, other: Lease): string {
  const lastNight = other.status === 'ended' ? (leaseOccupiedUntil(other) ?? other.end_date) : other.end_date
  return `Bentrok dengan sewa ${tenantName || 'penyewa lain'} di kamar ini (${formatStay(other.start_date, lastNight)}). Pilih tanggal lain.`
}

export type RedateMode = 'grid' | 'shift'

export interface InvoiceDates {
  period_start: string
  period_end: string
  due_date: string
}

/** What the save writes for one invoice (every invoice of the lease is listed, void ones too). */
export interface InvoiceRedatePatch extends InvoiceDates {
  id: string
}

export interface InvoiceRedate {
  invoice: Invoice
  before: InvoiceDates
  after: InvoiceDates
  /** grid position (lease periods from the start) when mapped on the anchored grid; null when moved by deltaDays */
  gridIndex: number | null
}

export interface LeaseRedatePlan {
  leaseId: string
  oldStart: string
  newStart: string
  /**
   * 'grid': every non-void invoice sat on the grid anchored at the old start (billedPeriodCount != null), so each one is
   * placed at the same grid position from the new start (month ends stay anchored, the next Tagih continues);
   * 'shift': otherwise every date moves by deltaDays.
   */
  mode: RedateMode
  /** newStart - oldStart in calendar days (negative = earlier) */
  deltaDays: number
  /** the lease patch */
  lease: { start_date: string; end_date: string }
  /** every invoice of the lease, oldest period first (void included) */
  invoices: InvoiceRedate[]
  /** the invoice writes, same order as `invoices` */
  patches: InvoiceRedatePatch[]
  /** non-blocking notices for the dialog (shift mode) */
  warnings: string[]
  /** Indonesian reason the plan cannot be saved; null when it can */
  error: string | null
  /** the other lease of the same room the new span collides with */
  conflict: Lease | null
}

export interface PlanLeaseRedateOptions {
  /** leases of the org (or at least of the room): the double-booking check (SPEC 2b.8) */
  leases?: Lease[]
  /** to name the tenant of a colliding lease */
  tenants?: Pick<Tenant, 'id' | 'full_name'>[]
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidISODate(iso: string | null | undefined): iso is string {
  if (!iso || !ISO_DATE_RE.test(iso)) return false
  try {
    parseISODate(iso)
    return true
  } catch {
    return false
  }
}

/**
 * k >= 0 with addPeriods(anchor, type, k) === date, or null when the date is not a grid point of that anchor.
 * addPeriods is strictly increasing in k, so the point is unique; the guess (days, weeks or calendar months between
 * the dates) is at most one off.
 */
export function gridIndexOf(anchorISO: string, type: PeriodType, dateISO: string): number | null {
  const days = daysBetween(anchorISO, dateISO)
  if (days < 0) return null
  let guess: number
  if (type === 'daily') guess = days
  else if (type === 'weekly') guess = Math.floor(days / 7)
  else {
    const a = parseISODate(anchorISO)
    const d = parseISODate(dateISO)
    guess = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth())
  }
  for (const k of [guess - 1, guess, guess + 1]) {
    if (k >= 0 && addPeriods(anchorISO, type, k) === dateISO) return k
  }
  return null
}

/** Grid position of an invoice that sits exactly on the grid of `anchor` (start AND end), else null. */
function invoiceGridIndex(anchorISO: string, type: PeriodType, inv: Invoice): number | null {
  if (!Number.isInteger(inv.quantity) || inv.quantity < 1) return null
  const k = gridIndexOf(anchorISO, type, inv.period_start)
  if (k === null) return null
  return periodBounds(anchorISO, type, k, inv.quantity).end === inv.period_end ? k : null
}

function datesOf(inv: Invoice): InvoiceDates {
  return { period_start: inv.period_start, period_end: inv.period_end, due_date: inv.due_date }
}

/** New dates for a new period: due_date keeps its offset (in days) from the period start. */
function withDue(before: InvoiceDates, start: string, end: string): InvoiceDates {
  return { period_start: start, period_end: end, due_date: addDaysISO(start, daysBetween(before.period_start, before.due_date)) }
}

function emptyPlan(lease: Lease, newStart: string, error: string): LeaseRedatePlan {
  return {
    leaseId: lease.id,
    oldStart: lease.start_date,
    newStart,
    mode: 'shift',
    deltaDays: 0,
    lease: { start_date: lease.start_date, end_date: lease.end_date },
    invoices: [],
    patches: [],
    warnings: [],
    error,
    conflict: null,
  }
}

/**
 * Plan for moving `lease` (status 'active', reservations included) to start on `newStart`.
 *
 * Refused (error, no patches): a lease that is not active (REDATE_INACTIVE_MESSAGE), an empty/invalid date
 * (REDATE_INVALID_DATE_MESSAGE), the same date (REDATE_SAME_DATE_MESSAGE). A plan whose new span [newStart, new
 * end_date] collides with another non-cancelled lease of the room (leaseOverlaps, SPEC 2b.8 / 7.3) is computed in full
 * for the preview but carries the error redateConflictMessage and `conflict`.
 *
 * Invoices (`invoices` may hold other leases' rows; only the lease's own are planned):
 *  - mode 'grid' when billedPeriodCount(lease, invoices) !== null: walking the non-void invoices in order with grid
 *    index k (k += quantity), each gets periodBounds(newStart, type, k, quantity). A void invoice that also sits exactly
 *    on a grid position k of the old start gets periodBounds(newStart, type, k, quantity) too; other void ones move by
 *    deltaDays. billedPeriodCount on the result equals the old count, so the next Tagih continues on the new grid.
 *  - mode 'shift' otherwise (pro-rata/custom periods, period-type switches, gaps): every invoice moves by deltaDays and
 *    redateShiftWarning is added. The relative layout is kept, so nextPeriodBounds still follows the shifted latest
 *    invoice without overlap or gap.
 *  - due_date keeps its offset in days from its own period_start.
 * Lease end_date: when it equals the latest non-void invoice's period_end it follows that invoice; otherwise its
 * check-out boundary (end_date + 1) is mapped like an invoice boundary (grid index in grid mode when it is a grid point
 * of the old start, else + deltaDays); never before the new start. Amounts, numbers, statuses, payments, add-ons and the
 * deposit are not touched.
 */
export function planLeaseRedate(lease: Lease, invoices: Invoice[], newStart: string, opts: PlanLeaseRedateOptions = {}): LeaseRedatePlan {
  if (lease.status !== 'active') return emptyPlan(lease, newStart, REDATE_INACTIVE_MESSAGE)
  if (!isValidISODate(newStart)) return emptyPlan(lease, newStart, REDATE_INVALID_DATE_MESSAGE)
  if (newStart === lease.start_date) return emptyPlan(lease, newStart, REDATE_SAME_DATE_MESSAGE)

  const oldStart = lease.start_date
  const type = lease.period_type
  const deltaDays = daysBetween(oldStart, newStart)
  const own = invoices.filter((inv) => inv.lease_id === lease.id)
  const active = activeInvoicesSorted(own)
  const mode: RedateMode = billedPeriodCount(lease, own) !== null ? 'grid' : 'shift'

  const after = new Map<string, { dates: InvoiceDates; gridIndex: number | null }>()
  const shifted = (inv: Invoice) => withDue(datesOf(inv), addDaysISO(inv.period_start, deltaDays), addDaysISO(inv.period_end, deltaDays))
  if (mode === 'grid') {
    let k = 0
    for (const inv of active) {
      const b = periodBounds(newStart, type, k, inv.quantity)
      after.set(inv.id, { dates: withDue(datesOf(inv), b.start, b.end), gridIndex: k })
      k += inv.quantity
    }
    for (const inv of own) {
      if (inv.status !== 'void') continue
      const gk = invoiceGridIndex(oldStart, type, inv)
      if (gk === null) {
        after.set(inv.id, { dates: shifted(inv), gridIndex: null })
      } else {
        const b = periodBounds(newStart, type, gk, inv.quantity)
        after.set(inv.id, { dates: withDue(datesOf(inv), b.start, b.end), gridIndex: gk })
      }
    }
  } else {
    for (const inv of own) after.set(inv.id, { dates: shifted(inv), gridIndex: null })
  }

  // lease end: follow the latest invoice, else map the check-out boundary like an invoice boundary
  let latest: Invoice | null = null
  for (const inv of active) if (latest === null || inv.period_end > latest.period_end) latest = inv
  let newEnd: string
  if (latest !== null && lease.end_date === latest.period_end) {
    newEnd = after.get(latest.id)!.dates.period_end
  } else {
    const boundary = addDaysISO(lease.end_date, 1)
    const k = mode === 'grid' ? gridIndexOf(oldStart, type, boundary) : null
    const newBoundary = k !== null ? addPeriods(newStart, type, k) : addDaysISO(boundary, deltaDays)
    newEnd = addDaysISO(newBoundary, -1)
  }
  if (newEnd < newStart) newEnd = newStart

  const rows: InvoiceRedate[] = [...own]
    .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.invoice_number.localeCompare(b.invoice_number))
    .map((inv) => {
      const a = after.get(inv.id)!
      return { invoice: inv, before: datesOf(inv), after: a.dates, gridIndex: a.gridIndex }
    })

  const warnings = mode === 'shift' && own.length > 0 ? [redateShiftWarning(deltaDays)] : []

  const others = (opts.leases ?? []).filter((l) => l.room_id === lease.room_id && l.id !== lease.id && l.status !== 'cancelled')
  const conflict = others.find((l) => leaseOverlaps([l], lease.room_id, newStart, newEnd)) ?? null
  const error = conflict ? redateConflictMessage(opts.tenants?.find((t) => t.id === conflict.tenant_id)?.full_name, conflict) : null

  return {
    leaseId: lease.id,
    oldStart,
    newStart,
    mode,
    deltaDays,
    lease: { start_date: newStart, end_date: newEnd },
    invoices: rows,
    patches: rows.map((r) => ({ id: r.invoice.id, ...r.after })),
    warnings,
    error,
    conflict,
  }
}

/**
 * True when a fresh read no longer matches what the dialog planned from: the lease's dates, status, room or period
 * type, or the lease's invoices (one added or removed, voided, or any date, quantity or type of one changed). Saving
 * then would write a plan the owner never saw, so the save is refused (LEASE_DATA_CHANGED_MESSAGE) and the screen
 * reloads. A payment recorded meanwhile (paid / partial) does not move any date and is not a change here.
 */
export function redateDataChanged(screenLease: Lease, screenInvoices: Invoice[], freshLease: Lease, freshInvoices: Invoice[]): boolean {
  const leaseKeys = ['start_date', 'end_date', 'status', 'room_id', 'period_type'] as const
  if (leaseKeys.some((k) => screenLease[k] !== freshLease[k])) return true
  const invoiceKeys = ['period_start', 'period_end', 'due_date', 'quantity', 'period_type'] as const
  const shown = new Map(screenInvoices.filter((i) => i.lease_id === screenLease.id).map((i) => [i.id, i]))
  const fresh = freshInvoices.filter((i) => i.lease_id === freshLease.id)
  if (fresh.length !== shown.size) return true
  return fresh.some((f) => {
    const s = shown.get(f.id)
    return !s || (s.status === 'void') !== (f.status === 'void') || invoiceKeys.some((k) => (s[k] ?? null) !== (f[k] ?? null))
  })
}

/** The lease and its invoices as they will be after saving the plan (for previews and tests). */
export function applyRedatePlan(lease: Lease, invoices: Invoice[], plan: LeaseRedatePlan): { lease: Lease; invoices: Invoice[] } {
  const byId = new Map(plan.patches.map((p) => [p.id, p]))
  return {
    lease: { ...lease, ...plan.lease },
    invoices: invoices.map((inv) => {
      const p = byId.get(inv.id)
      return p ? { ...inv, period_start: p.period_start, period_end: p.period_end, due_date: p.due_date } : inv
    }),
  }
}

/** Nights of an inclusive stay [start, lastNight]. */
export function nightsOf(start: string, lastNight: string): number {
  return daysBetween(start, lastNight) + 1
}

/**
 * Line appended to the lease notes: 'Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)', plus
 * ': <alasan>' when the owner typed a reason.
 */
export function redateNoteLine(oldStart: string, newStart: string, todayISO: string, reason?: string | null): string {
  const base = `Tanggal mulai dikoreksi dari ${formatDate(oldStart)} ke ${formatDate(newStart)} (${formatDate(todayISO)})`
  const why = reason?.trim().replace(/\s+/g, ' ')
  return why ? `${base}: ${why}` : base
}

/** The lease notes after the correction (existing notes kept, one line added). */
export function redateNotes(notes: string | null, oldStart: string, newStart: string, todayISO: string, reason?: string | null): string {
  return appendLeaseNote(notes, redateNoteLine(oldStart, newStart, todayISO, reason))
}

/**
 * The tenant's position today in the words of the lease list (summarizeLeaseBilling + remainingDays, SPEC 7.1):
 * 'telat 14 hari · sisa Rp 1.500.000', 'lunas s/d 1 Nov · jatuh tempo 9 hari lagi', 'belum ditagih · jatuh tempo hari
 * ini', 'lunas s/d 26 Okt · check-out 3 hari lagi'. Past-due and due-today lines lead with the days.
 */
export function leaseStateText(lease: Lease, summary: LeaseBillingSummary, todayISO: string): string {
  const amount =
    summary.outstanding > 0 ? `sisa ${formatRupiah(summary.outstanding)}` : summary.paidThrough ? `lunas s/d ${formatCheckout(summary.paidThrough, 'd MMM')}` : 'belum ditagih'
  const r = remainingDays(lease, summary, todayISO)
  if (!r) return amount
  let days: string
  switch (r.kind) {
    case 'overdue':
      days = `telat ${-r.days} hari`
      break
    case 'grace':
      days = `lewat ${-r.days} hari (tenggang)`
      break
    case 'today':
      days = 'jatuh tempo hari ini'
      break
    case 'ending':
      days = r.days === 0 ? 'check-out hari ini' : `check-out ${r.days} hari lagi`
      break
    default:
      days = `jatuh tempo ${r.days} hari lagi`
  }
  return r.kind === 'overdue' || r.kind === 'grace' || r.kind === 'today' ? `${days} · ${amount}` : `${amount} · ${days}`
}

export interface RedateStatePreview {
  /** summarizeLeaseBilling before / after the correction */
  before: LeaseBillingSummary
  after: LeaseBillingSummary
  beforeText: string
  afterText: string
}

/** Today's billing position before and after the correction, computed like the lease list does. */
export function redateStatePreview(lease: Lease, invoices: Invoice[], payments: Payment[], plan: LeaseRedatePlan, todayISO: string): RedateStatePreview {
  const own = invoices.filter((i) => i.lease_id === lease.id)
  const next = applyRedatePlan(lease, own, plan)
  const before = summarizeLeaseBilling(lease, own, payments, todayISO)
  const after = summarizeLeaseBilling(next.lease, next.invoices, payments, todayISO)
  return { before, after, beforeText: leaseStateText(lease, before, todayISO), afterText: leaseStateText(next.lease, after, todayISO) }
}
