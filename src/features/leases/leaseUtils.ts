/**
 * UI-side helpers for the leases module. Money/date rules live in src/domain; these functions only
 * arrange domain results for display (sorting, search, timeline segments, form conventions).
 */
import type { Expense, Invoice, Lease, LeaseAddon, OrgInsert, Payment, PeriodType, Property, Room, Tenant, Update } from '../../types/db'
import { PERIOD_TYPE_LABEL } from '../../types/db'
import type { BillingState, ExtraBreakdown, InvoiceDraft, LeaseBillingSummary } from '../../domain/billing'
import {
  activeInvoicesSorted,
  buildInvoiceDraft,
  chainAnchor,
  computeAddonsAmount,
  deriveInvoiceStatus,
  formatExtraBreakdown,
  isPaidUpAndEnding,
  nextDueSortKey,
  nextPeriodBounds,
  outstandingFor,
  paidAmountFor,
  parseExtraBreakdown,
} from '../../domain/billing'
import { reminderText } from '../../domain/messages'
import { addDaysISO, daysBetween, periodEnd } from '../../domain/period'
import { compareRoomNames, isLeaseActiveOn, isLeaseReservedOn, leaseOverlaps } from '../../domain/occupancy'
import { formatDate, formatRupiah } from '../../lib/format'

// ---------- billing state presentation ----------

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'

/** Billing state plus the UI-only 'ending' state (paid up, lease ends within 7 days: perpanjang atau checkout). */
export type DisplayBillingState = BillingState | 'ending'

export const BILLING_STATE_META: Record<DisplayBillingState, { label: string; tone: BadgeTone }> = {
  overdue: { label: 'Terlambat', tone: 'danger' },
  due_soon: { label: 'Jatuh tempo', tone: 'warning' },
  unbilled: { label: 'Belum ditagih', tone: 'neutral' },
  ok: { label: 'Aman', tone: 'success' },
  inactive: { label: 'Tidak aktif', tone: 'neutral' },
  ending: { label: 'Berakhir segera', tone: 'info' },
}

/** What the badge should say: a fully paid lease that ends within a week is "ending", not "jatuh tempo". */
export function displayBillingState(lease: Lease, summary: LeaseBillingSummary, todayISO: string): DisplayBillingState {
  return isPaidUpAndEnding(lease, summary, todayISO) ? 'ending' : summary.state
}

const STATE_ORDER: Record<BillingState, number> = { overdue: 0, due_soon: 1, unbilled: 2, ok: 3, inactive: 4 }

export interface LeaseListItem {
  lease: Lease
  summary: LeaseBillingSummary
  room: Room | undefined
  tenant: Tenant | undefined
  propertyName: string
}

/** Overdue first, then due soon, unbilled, ok; ties by next due date, then room name. */
export function compareLeaseItems(a: LeaseListItem, b: LeaseListItem): number {
  const so = STATE_ORDER[a.summary.state] - STATE_ORDER[b.summary.state]
  if (so !== 0) return so
  const ad = a.summary.nextDueDate ?? ''
  const bd = b.summary.nextDueDate ?? ''
  if (ad !== bd) return ad < bd ? -1 : 1
  return (a.room?.name ?? '').localeCompare(b.room?.name ?? '', undefined, { numeric: true })
}

// ---------- list sorting (SPEC 5.1) ----------

/** Values of the `?urut=` search param on /sewa. */
export const LEASE_SORT_KEYS = ['jatuh-tempo', 'jatuh-tempo-terjauh', 'kamar', 'nama'] as const
export type LeaseSortKey = (typeof LEASE_SORT_KEYS)[number]
export const DEFAULT_LEASE_SORT: LeaseSortKey = 'jatuh-tempo'

export const LEASE_SORT_LABEL: Record<LeaseSortKey, string> = {
  'jatuh-tempo': 'Sisa hari paling sedikit',
  'jatuh-tempo-terjauh': 'Sisa hari paling banyak',
  kamar: 'Nomor kamar',
  nama: 'Nama penyewa',
}

/** `?urut=` value -> sort key; unknown / missing values fall back to 'jatuh-tempo'. */
export function parseLeaseSort(value: string | null | undefined): LeaseSortKey {
  return (LEASE_SORT_KEYS as readonly string[]).includes(value ?? '') ? (value as LeaseSortKey) : DEFAULT_LEASE_SORT
}

function roomNameOf(item: LeaseListItem): string {
  return item.room?.name ?? ''
}

function compareKosNames(a: LeaseListItem, b: LeaseListItem): number {
  return a.propertyName.localeCompare(b.propertyName, 'id', { sensitivity: 'base' })
}

function compareDueKeys(a: LeaseListItem, b: LeaseListItem): number {
  const ak = nextDueSortKey(a.summary)
  const bk = nextDueSortKey(b.summary)
  return ak === bk ? 0 : ak < bk ? -1 : 1
}

/**
 * 'Jatuh tempo terdekat': earliest nextDueSortKey first (overdue = past dates come first automatically,
 * leases without a due date last), ties by room name (compareRoomNames), then kos name.
 */
export function compareByNextDue(a: LeaseListItem, b: LeaseListItem): number {
  return compareDueKeys(a, b) || compareRoomNames(roomNameOf(a), roomNameOf(b)) || compareKosNames(a, b)
}

/** Latest due date first; leases without a due date sort last here too (not first), unlike a plain reversal. */
function compareDueKeysDesc(a: LeaseListItem, b: LeaseListItem): number {
  const ad = a.summary.nextDueDate
  const bd = b.summary.nextDueDate
  if (!ad || !bd) return ad === bd ? 0 : ad ? -1 : 1
  return ad === bd ? 0 : ad > bd ? -1 : 1
}

/**
 * 'Sisa hari paling banyak': latest nextDueDate first (the leases that can wait longest on top), leases
 * without a due date still last; ties like compareByNextDue (room name, then kos name).
 */
export function compareByNextDueDesc(a: LeaseListItem, b: LeaseListItem): number {
  return compareDueKeysDesc(a, b) || compareRoomNames(roomNameOf(a), roomNameOf(b)) || compareKosNames(a, b)
}

/**
 * 'Nomor kamar': kos NAME first (not property id, so the order matches what the user reads across kos),
 * then the natural room order (A1 < A2 < A10); same room (old and new lease) by next due date.
 */
export function compareByRoom(a: LeaseListItem, b: LeaseListItem): number {
  return compareKosNames(a, b) || compareRoomNames(roomNameOf(a), roomNameOf(b)) || compareDueKeys(a, b)
}

/** 'Nama penyewa': tenant name A-Z (case-insensitive), then kos and room. Missing tenants last. */
export function compareByTenantName(a: LeaseListItem, b: LeaseListItem): number {
  const an = a.tenant?.full_name
  const bn = b.tenant?.full_name
  if (an && !bn) return -1
  if (!an && bn) return 1
  const byName = an && bn ? an.localeCompare(bn, 'id', { sensitivity: 'base' }) : 0
  return byName || compareKosNames(a, b) || compareRoomNames(roomNameOf(a), roomNameOf(b))
}

/**
 * Sorted copy of a lease list. On a finished (ended / cancelled) list nothing is due, so 'jatuh-tempo' keeps
 * "most recently finished first" and 'jatuh-tempo-terjauh' the reverse (oldest finished first); 'kamar' and
 * 'nama' apply to both lists.
 */
export function sortLeaseItems(items: LeaseListItem[], key: LeaseSortKey, finished = false): LeaseListItem[] {
  let cmp: (a: LeaseListItem, b: LeaseListItem) => number
  if (key === 'kamar') cmp = compareByRoom
  else if (key === 'nama') cmp = compareByTenantName
  else if (key === 'jatuh-tempo-terjauh') cmp = finished ? (a, b) => compareFinishedLeases(b, a) : compareByNextDueDesc
  else cmp = finished ? compareFinishedLeases : compareByNextDue
  return [...items].sort(cmp)
}

export type DueTone = 'danger' | 'warning' | 'info' | 'neutral'

export interface DueLabel {
  /** e.g. 'Jatuh tempo 14 Okt · 2 hari lagi', 'Terlambat 3 hari · sejak 9 Okt', 'Berakhir 15 Okt · 3 hari lagi' */
  text: string
  tone: DueTone
}

/** 'hari ini' / 'besok' / '2 hari lagi' / 'kemarin' / '3 hari lalu' for a raw day difference. */
export function relativeDays(days: number): string {
  if (days === 0) return 'hari ini'
  if (days === 1) return 'besok'
  if (days === -1) return 'kemarin'
  return days > 0 ? `${days} hari lagi` : `${-days} hari lalu`
}

/**
 * The prominent next-due line of a lease card (SPEC 5.1):
 *  - past due, still within the grace days (state due_soon) -> 'Lewat N hari · tenggang · sejak 9 Okt' (warning);
 *  - past due beyond the grace days (state overdue) -> 'Terlambat N hari · sejak 9 Okt' (danger);
 *  - due today -> 'Jatuh tempo hari ini · 12 Okt' (warning);
 *  - a paid-up lease ending within a week (isPaidUpAndEnding) -> 'Berakhir 15 Okt · 3 hari lagi' (info);
 *  - otherwise 'Jatuh tempo 14 Okt · 2 hari lagi' (warning when due_soon, else neutral).
 * Null for inactive leases or when no due date is known.
 */
export function dueLabel(lease: Lease, summary: LeaseBillingSummary, todayISO: string): DueLabel | null {
  if (lease.status !== 'active' || !summary.nextDueDate) return null
  if (isPaidUpAndEnding(lease, summary, todayISO)) {
    return { text: `Berakhir ${formatDate(lease.end_date, 'd MMM')} · ${relativeDays(daysBetween(todayISO, lease.end_date))}`, tone: 'info' }
  }
  const days = summary.daysUntilDue ?? daysBetween(todayISO, summary.nextDueDate)
  const date = formatDate(summary.nextDueDate, 'd MMM')
  if (days < 0) {
    return summary.state === 'overdue'
      ? { text: `Terlambat ${-days} hari · sejak ${date}`, tone: 'danger' }
      : { text: `Lewat ${-days} hari · tenggang · sejak ${date}`, tone: 'warning' }
  }
  if (days === 0) return { text: `Jatuh tempo hari ini · ${date}`, tone: 'warning' }
  return { text: `Jatuh tempo ${date} · ${relativeDays(days)}`, tone: summary.state === 'due_soon' ? 'warning' : 'neutral' }
}

export type RemainingKind = 'overdue' | 'grace' | 'today' | 'soon' | 'ok' | 'ending'

/** Right-hand block of a lease row (SPEC 7.1): a big day count with a short caption under it. */
export interface RemainingDays {
  /** raw day difference: negative = past due (or days until the lease ends for 'ending') */
  days: number
  kind: RemainingKind
  /** big text, e.g. '20 hari', 'Hari ini', '3 hari' */
  value: string
  /** small text under it, e.g. 'terlambat', 'lewat · tenggang', 'jatuh tempo', 'lagi · 15 Okt', 'berakhir 15 Okt' */
  caption: string
  tone: DueTone
}

/** '20 hari' / 'Hari ini' for the big text of a RemainingDays block. */
function dayCount(days: number): string {
  return days === 0 ? 'Hari ini' : `${Math.abs(days)} hari`
}

/**
 * Same decision tree as dueLabel, split into a number and a caption so a dense list can line the day counts up:
 *  - paid-up lease ending within a week -> 'ending': '3 hari' / 'berakhir 15 Okt' (info);
 *  - past due beyond the grace days (state overdue) -> 'overdue': '20 hari' / 'terlambat' (danger);
 *  - past due within the grace days -> 'grace': '2 hari' / 'lewat · tenggang' (warning);
 *  - due today -> 'today': 'Hari ini' / 'jatuh tempo' (warning);
 *  - otherwise 'soon' (state due_soon, warning) or 'ok' (neutral): '12 hari' / 'lagi · 15 Okt'.
 * Null for inactive leases or when no due date is known.
 */
export function remainingDays(lease: Lease, summary: LeaseBillingSummary, todayISO: string): RemainingDays | null {
  if (lease.status !== 'active' || !summary.nextDueDate) return null
  if (isPaidUpAndEnding(lease, summary, todayISO)) {
    const days = daysBetween(todayISO, lease.end_date)
    return { days, kind: 'ending', value: dayCount(days), caption: `berakhir ${formatDate(lease.end_date, 'd MMM')}`, tone: 'info' }
  }
  const days = summary.daysUntilDue ?? daysBetween(todayISO, summary.nextDueDate)
  const date = formatDate(summary.nextDueDate, 'd MMM')
  if (days < 0) {
    return summary.state === 'overdue'
      ? { days, kind: 'overdue', value: dayCount(days), caption: 'terlambat', tone: 'danger' }
      : { days, kind: 'grace', value: dayCount(days), caption: 'lewat · tenggang', tone: 'warning' }
  }
  if (days === 0) return { days, kind: 'today', value: dayCount(days), caption: 'jatuh tempo', tone: 'warning' }
  const soon = summary.state === 'due_soon'
  return { days, kind: soon ? 'soon' : 'ok', value: dayCount(days), caption: `lagi · ${date}`, tone: soon ? 'warning' : 'neutral' }
}

/** Ended/cancelled leases: most recently finished first. */
export function compareFinishedLeases(a: LeaseListItem, b: LeaseListItem): number {
  const ae = a.lease.checkout_date ?? a.lease.end_date
  const be = b.lease.checkout_date ?? b.lease.end_date
  if (ae !== be) return ae < be ? 1 : -1
  return (a.room?.name ?? '').localeCompare(b.room?.name ?? '', undefined, { numeric: true })
}

/** Case-insensitive match on tenant name, room name or kos name. Empty query matches everything. */
export function matchesLeaseSearch(item: LeaseListItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [item.tenant?.full_name, item.room?.name, item.propertyName].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q)
}

// ---------- invoice timeline ----------

export type TimelineKind = 'paid' | 'partial' | 'unpaid' | 'gap' | 'unbilled'

export interface TimelineSegment {
  kind: TimelineKind
  start: string
  end: string
  days: number
  invoice?: Invoice
  /** true when the invoice starts before the previous one ended (double billing) */
  overlap?: boolean
}

/**
 * Contiguous segments from the lease start to max(end_date / checkout, latest period_end, today for an
 * active lease): one per non-void invoice (kind from the derived payment position), 'gap' for days between
 * invoices that were never billed, and a trailing 'unbilled' stretch when the lease runs past its last
 * invoice. Lets the owner spot holes at a glance.
 */
export function invoiceTimeline(lease: Lease, invoices: Invoice[], payments: Payment[], todayISO: string): TimelineSegment[] {
  const active = activeInvoicesSorted(invoices.filter((inv) => inv.lease_id === lease.id))
  const leaseEnd = lease.status === 'ended' ? (lease.checkout_date ?? lease.end_date) : lease.end_date
  let rangeEnd = leaseEnd
  if (lease.status === 'active' && todayISO > rangeEnd) rangeEnd = todayISO
  for (const inv of active) if (inv.period_end > rangeEnd) rangeEnd = inv.period_end

  const segments: TimelineSegment[] = []
  let cursor = lease.start_date
  for (const inv of active) {
    if (inv.period_start > cursor) {
      const gapEnd = addDaysISO(inv.period_start, -1)
      segments.push({ kind: 'gap', start: cursor, end: gapEnd, days: daysBetween(cursor, gapEnd) + 1 })
    }
    const open = outstandingFor(inv, payments)
    const kind: TimelineKind = open <= 0 ? 'paid' : open < inv.total_amount ? 'partial' : 'unpaid'
    segments.push({
      kind,
      start: inv.period_start,
      end: inv.period_end,
      days: daysBetween(inv.period_start, inv.period_end) + 1,
      invoice: inv,
      overlap: inv.period_start < cursor,
    })
    const next = addDaysISO(inv.period_end, 1)
    if (next > cursor) cursor = next
  }
  if (cursor <= rangeEnd) {
    segments.push({ kind: 'unbilled', start: cursor, end: rangeEnd, days: daysBetween(cursor, rangeEnd) + 1 })
  }
  return segments
}

// ---------- invoice notes convention ----------

/**
 * Split stored invoice notes into the extra breakdown ('Listrik: X; Denda: Y') and the free text the user
 * typed. The breakdown line is the first line when it matches formatExtraBreakdown(parseExtraBreakdown(notes)).
 */
export function splitInvoiceNotes(notes: string | null): { breakdown: ExtraBreakdown; text: string } {
  const breakdown = parseExtraBreakdown(notes)
  if (!notes) return { breakdown, text: '' }
  const canonical = formatExtraBreakdown(breakdown)
  const lines = notes.split('\n')
  const rest = canonical && lines[0]?.trim() === canonical ? lines.slice(1) : lines
  return { breakdown, text: rest.join('\n').trim() }
}

/** Inverse of splitInvoiceNotes: breakdown line first, then the free text; null when both are empty. */
export function composeInvoiceNotes(parts: ExtraBreakdown, text: string): string | null {
  const line = formatExtraBreakdown(parts)
  const body = text.trim()
  if (!line && !body) return null
  if (!line) return body
  if (!body) return line
  return `${line}\n${body}`
}

/** Sum of the breakdown parts (undefined / negative parts count as 0). */
export function sumExtraBreakdown(parts: ExtraBreakdown): number {
  return Math.max(0, parts.listrik ?? 0) + Math.max(0, parts.denda ?? 0) + Math.max(0, parts.lainnya ?? 0)
}

// ---------- pro-rata suggestion (SPEC 2b.10 'Periode khusus') ----------

export interface ProRataSuggestion {
  /** suggested base amount, rounded to whole rupiah */
  amount: number
  /** inclusive days of the custom period */
  days: number
  /** inclusive days of the full anchored period the price covers */
  fullDays: number
}

/**
 * Pro-rata base price for a custom period [periodStart, customEnd] against the full period
 * [periodStart, fullPeriodEnd] that `pricePerPeriod` normally covers: price * days / fullDays, rounded.
 * Returns null when a date is missing/invalid or the custom end lies before the start. Only a suggestion:
 * the user may still override it (the agreed price wins).
 */
export function proRataSuggestion(pricePerPeriod: number, periodStart: string, fullPeriodEnd: string, customEnd: string): ProRataSuggestion | null {
  if (!periodStart || !fullPeriodEnd || !customEnd) return null
  try {
    const days = daysBetween(periodStart, customEnd) + 1
    const fullDays = daysBetween(periodStart, fullPeriodEnd) + 1
    if (days < 1 || fullDays < 1) return null
    return { amount: Math.round((pricePerPeriod * days) / fullDays), days, fullDays }
  } catch {
    return null
  }
}

// ---------- lifecycle helpers (checkout / cancel) ----------

/**
 * end_date to store when a lease is cancelled on `dateISO`: min(end_date, dateISO) but never before start_date,
 * so cancelling a lease that has not started yet keeps `end_date >= start_date` (DB check constraint).
 */
export function cancelledLeaseEndDate(lease: Lease, dateISO: string): string {
  const cut = lease.end_date <= dateISO ? lease.end_date : dateISO
  return cut < lease.start_date ? lease.start_date : cut
}

export interface FutureInvoicesAtCheckout {
  /** no payment at all -> voided (SPEC 2b.5) */
  toVoid: Invoice[]
  /** partially paid -> the user must choose refund / forfeit (same decision as SPEC 2b.4) */
  partial: Invoice[]
  /** fully paid for a period after checkout -> left as is, shown as a note */
  paid: Invoice[]
}

/**
 * Non-void invoices of the lease whose period starts after the checkout date, split by payment position.
 * Everything before/overlapping the checkout date is untouched (stays receivable, SPEC 2b.5).
 */
export function futureInvoicesAtCheckout(leaseId: string, invoices: Invoice[], payments: Payment[], checkoutDate: string): FutureInvoicesAtCheckout {
  const out: FutureInvoicesAtCheckout = { toVoid: [], partial: [], paid: [] }
  if (!checkoutDate) return out
  for (const inv of invoices) {
    if (inv.lease_id !== leaseId || inv.status === 'void' || inv.period_start <= checkoutDate) continue
    const paid = paidAmountFor(inv.id, payments)
    if (paid <= 0) out.toVoid.push(inv)
    else if (paid < inv.total_amount) out.partial.push(inv)
    else out.paid.push(inv)
  }
  return out
}

// ---------- closing partially-paid invoices (SPEC 2b.4) ----------

/** 'refund' = the paid part goes back to the tenant (expense rent_refund); 'forfeit' = the DP stays revenue. */
export type PartialDecision = 'refund' | 'forfeit'

/** Line added to the notes of an invoice closed by a refund; it also marks a refund still to record. */
const REFUND_NOTE_RE = /(^|\n)DP dikembalikan \(/

/**
 * Patch that closes a partially-paid invoice for good. Never a void: the database refuses to void an invoice
 * with rent payments (invoices_void_guard). The unpaid rest becomes discount, total = paid, so the invoice is
 * paid and owes nothing; the note says which decision closed it.
 */
export function closePartialInvoicePatch(inv: Invoice, paid: number, decision: PartialDecision, reason: string): Update<'invoices'> {
  const note = decision === 'refund' ? `DP dikembalikan (${reason})` : `Sisa dianggap hangus (${reason})`
  return {
    discount_amount: inv.discount_amount + (inv.total_amount - paid),
    total_amount: paid,
    status: 'paid',
    notes: [inv.notes, note].filter(Boolean).join('\n'),
  }
}

/** Another device changed the lease's bills after this screen loaded them (see leaseDataChanged). */
export const LEASE_DATA_CHANGED_MESSAGE = 'Tagihan atau pembayaran sewa ini baru saja diubah dari perangkat lain. Periksa angka terbaru di layar, lalu coba lagi.'

/**
 * True when a fresh read no longer matches what a checkout/cancel was computed from: a touched invoice (voided,
 * closed, refunded or paid from the deposit) is gone or its rent paid changed, or the lease has a live invoice the
 * screen does not show. Writing anyway would get refused half-way (void guard, total below paid) or refund the
 * wrong amount. `freshPayments` must hold every payment of the touched invoices.
 */
export function leaseDataChanged(leaseId: string, screenInvoices: Invoice[], screenPayments: Payment[], touched: Invoice[], freshInvoices: Invoice[], freshPayments: Payment[]): boolean {
  const fresh = new Map(freshInvoices.filter((i) => i.lease_id === leaseId).map((i) => [i.id, i]))
  for (const inv of touched) {
    if (!fresh.has(inv.id) || paidAmountFor(inv.id, screenPayments) !== paidAmountFor(inv.id, freshPayments)) return true
  }
  const shown = new Set(screenInvoices.map((i) => i.id))
  return [...fresh.values()].some((i) => i.status !== 'void' && !shown.has(i.id))
}

export interface InvoiceWrite {
  id: string
  patch: Update<'invoices'>
}

/**
 * Invoice writes of a checkout/cancel, built from fresh rows so the patch keeps what another device changed (notes,
 * extra) and still meets total = base + add-ons + extra - discount. Closes come before voids: a refused close then
 * leaves nothing behind. Rows an earlier attempt already closed or voided are skipped.
 */
export function closingInvoiceWrites(toVoid: Invoice[], partial: Invoice[], fresh: Invoice[], payments: Payment[], decisions: Record<string, PartialDecision>, reason: string): InvoiceWrite[] {
  const byId = new Map(fresh.map((i) => [i.id, i]))
  const out: InvoiceWrite[] = []
  for (const inv of partial) {
    const row = byId.get(inv.id) ?? inv
    const paid = paidAmountFor(inv.id, payments)
    if (row.total_amount > paid) out.push({ id: inv.id, patch: closePartialInvoicePatch(row, paid, decisions[inv.id], reason) })
  }
  for (const inv of toVoid) if ((byId.get(inv.id) ?? inv).status !== 'void') out.push({ id: inv.id, patch: { status: 'void' } })
  return out
}

/** The rent_refund expense for a refunded invoice; its description names the invoice number (hasRentRefundFor). */
export function rentRefundExpense(lease: Lease, inv: Invoice, amount: number, dateISO: string, reason: string): OrgInsert<'expenses'> {
  return {
    property_id: lease.property_id,
    lease_id: lease.id,
    category: 'rent_refund',
    amount,
    expense_date: dateISO,
    description: `Pengembalian DP tagihan ${inv.invoice_number} (${reason})`,
    vendor: null,
    receipt_path: null,
  }
}

/** True when the lease already has a rent_refund expense naming this invoice number. */
export function hasRentRefundFor(expenses: Expense[], leaseId: string, invoiceNumber: string): boolean {
  return expenses.some((e) => e.category === 'rent_refund' && e.lease_id === leaseId && e.description.split(/[\s()]+/).includes(invoiceNumber))
}

export interface RentRefund {
  invoice: Invoice
  amount: number
}

/**
 * Invoices of the lease already closed by a refund ('DP dikembalikan (...)' note) whose rent_refund expense is
 * missing: a checkout/cancel that stopped after closing them records it on the next attempt.
 */
export function unrecordedRentRefunds(leaseId: string, invoices: Invoice[], payments: Payment[], expenses: Expense[]): RentRefund[] {
  return invoices
    .filter((inv) => inv.lease_id === leaseId && inv.status !== 'void' && REFUND_NOTE_RE.test(inv.notes ?? ''))
    .map((inv) => ({ invoice: inv, amount: paidAmountFor(inv.id, payments) }))
    .filter((r) => r.amount > 0 && !hasRentRefundFor(expenses, leaseId, r.invoice.invoice_number))
}

/**
 * rent_refund expenses to insert for a checkout/cancel: one per invoice refunded now (its paid part) plus the
 * unrecorded ones, never one that already exists, so retrying after a failure does not refund twice.
 */
export function rentRefundsToRecord(leaseId: string, refundedNow: Invoice[], invoices: Invoice[], payments: Payment[], expenses: Expense[]): RentRefund[] {
  const out = new Map<string, RentRefund>()
  for (const inv of refundedNow) out.set(inv.id, { invoice: inv, amount: paidAmountFor(inv.id, payments) })
  for (const r of unrecordedRentRefunds(leaseId, invoices, payments, expenses)) if (!out.has(r.invoice.id)) out.set(r.invoice.id, r)
  return [...out.values()].filter((r) => r.amount > 0 && !hasRentRefundFor(expenses, leaseId, r.invoice.invoice_number))
}

// ---------- open invoices & deposit settlement ----------

/** Non-void invoices of the lease with money still owed, oldest due date first. */
export function openInvoicesSorted(leaseId: string, invoices: Invoice[], payments: Payment[]): Invoice[] {
  return invoices
    .filter((inv) => inv.lease_id === leaseId && inv.status !== 'void' && outstandingFor(inv, payments) > 0)
    .sort((a, b) => (a.due_date === b.due_date ? a.period_start.localeCompare(b.period_start) : a.due_date.localeCompare(b.due_date)))
}

// ---------- WhatsApp reminder ----------

export interface LeaseReminderInput {
  lease: Lease
  tenant: Tenant | undefined
  room: Room | undefined
  property: Property | undefined
  /** the lease's invoices (any order) */
  invoices: Invoice[]
  /** every invoice of the org: numbers the next draft (buildInvoiceDraft) */
  orgInvoices: Invoice[]
  payments: Payment[]
  addons: LeaseAddon[]
}

/**
 * Text of the WhatsApp reminder for a lease, shared by the list row and the detail page: the oldest open
 * invoice, or, when nothing is open on an active lease, a preview of the next period (buildInvoiceDraft with
 * quantity 1; a draft that cannot be built gives null). Null when the tenant has no phone number.
 */
export function leaseReminderText({ lease, tenant, room, property, invoices, orgInvoices, payments, addons }: LeaseReminderInput): string | null {
  if (!tenant?.phone) return null
  const base = { tenantName: tenant.full_name, roomName: room?.name ?? '-', propertyName: property?.name ?? 'Kos', paymentInfo: property?.payment_info }
  const oldest = openInvoicesSorted(lease.id, invoices, payments)[0]
  if (oldest) {
    return reminderText({ ...base, outstanding: outstandingFor(oldest, payments), dueDate: oldest.due_date, periodStart: oldest.period_start, periodEnd: oldest.period_end })
  }
  if (lease.status !== 'active') return null
  try {
    const draft = buildInvoiceDraft({ lease, addons, quantity: 1, existingInvoices: invoices, orgInvoices })
    return reminderText({ ...base, outstanding: draft.total_amount, dueDate: draft.due_date, periodStart: draft.period_start, periodEnd: draft.period_end })
  } catch {
    return null
  }
}

export interface Allocation {
  invoice: Invoice
  amount: number
}

/**
 * Spread `amount` over the given open invoices in order (oldest first), each taking at most its outstanding
 * balance. Throws 'Jumlah melebihi total sisa tagihan.' when the invoices cannot absorb the whole amount.
 */
export function allocateAcrossInvoices(amount: number, invoices: Invoice[], payments: Payment[]): Allocation[] {
  const out: Allocation[] = []
  let left = amount
  for (const inv of invoices) {
    if (left <= 0) break
    const open = outstandingFor(inv, payments)
    if (open <= 0) continue
    const take = Math.min(open, left)
    out.push({ invoice: inv, amount: take })
    left -= take
  }
  if (left > 0) throw new Error('Jumlah melebihi total sisa tagihan.')
  return out
}

export interface DepositSettlement {
  /** cash returned to the tenant (expense deposit_refund) */
  refund: number
  /** applied to open rent invoices (payment rent, method deposit) */
  rent: number
  /** kept for damage etc. (payment other, method deposit) */
  damage: number
  damageNotes: string
}

/** Indonesian error when the three parts do not add up to `held`, exceed the rent capacity, or are negative. */
export function validateSettlement(s: DepositSettlement, held: number, rentCapacity: number): string | null {
  if (s.refund < 0 || s.rent < 0 || s.damage < 0) return 'Jumlah tidak boleh negatif.'
  if (s.rent > rentCapacity) return `Potongan untuk sewa melebihi sisa tagihan (maks. ${formatRupiah(rentCapacity)}).`
  if (s.refund + s.rent + s.damage !== held) return 'Jumlah pengembalian + potongan harus sama dengan jaminan yang dipegang.'
  if (s.damage > 0 && !s.damageNotes.trim()) return 'Isi keterangan potongan (mis. kerusakan).'
  return null
}

// ---------- room availability (wizard) ----------

export type RoomAvailability = 'kosong' | 'terisi' | 'dipesan' | 'perbaikan' | 'bentrok'

export const ROOM_AVAILABILITY_LABEL: Record<RoomAvailability, string> = {
  kosong: 'Kosong',
  terisi: 'Terisi',
  dipesan: 'Dipesan',
  perbaikan: 'Perbaikan',
  bentrok: 'Bentrok jadwal',
}

/**
 * State of a room for a planned stay [startISO, endISO]: maintenance rooms are 'perbaikan'; a room occupied
 * on the start date is 'terisi'; one booked by a future lease is 'dipesan'; a free room whose planned stay
 * still collides with another lease (leaseOverlaps) is 'bentrok'; otherwise 'kosong'.
 */
export function roomAvailability(room: Room, leases: Lease[], startISO: string, endISO: string, excludeLeaseId?: string): RoomAvailability {
  if (room.status === 'maintenance') return 'perbaikan'
  const own = leases.filter((l) => l.room_id === room.id && l.id !== excludeLeaseId)
  if (own.some((l) => isLeaseActiveOn(l, startISO))) return 'terisi'
  if (own.some((l) => isLeaseReservedOn(l, startISO))) return 'dipesan'
  if (leaseOverlaps(leases, room.id, startISO, endISO, excludeLeaseId)) return 'bentrok'
  return 'kosong'
}

/** Default price of a room for a period type (null when the room has none). */
export function roomPriceFor(room: Room | undefined, periodType: Lease['period_type']): number | null {
  if (!room) return null
  switch (periodType) {
    case 'daily':
      return room.price_daily
    case 'weekly':
      return room.price_weekly
    case 'monthly':
      return room.price_monthly
  }
}

/** 'Pindah dari A1 ke B2 pada 2026-03-05' appended to existing notes. */
export function appendMoveNote(notes: string | null, fromRoom: string, toRoom: string, dateISO: string): string {
  const line = `Pindah dari ${fromRoom} ke ${toRoom} pada ${dateISO}`
  return notes?.trim() ? `${notes.trim()}\n${line}` : line
}

/** Simple tenant search for the wizard: name, phone or NIK. */
export function matchesTenantQuery(t: Tenant, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [t.full_name, t.phone, t.nik, t.id_number].some((v) => v?.toLowerCase().includes(q))
}

// ---------- negotiated price (SPEC 5.4) ----------

export interface PriceDelta {
  /** 'none' = the room has no standard rate for this type; 'same' = equal to the standard */
  kind: 'none' | 'same' | 'discount' | 'more'
  /** absolute difference in rupiah (0 for none / same) */
  amount: number
}

/** Agreed price vs the room's standard rate for the type (null standard -> 'none'). */
export function priceDelta(price: number, standard: number | null | undefined): PriceDelta {
  if (standard == null) return { kind: 'none', amount: 0 }
  if (price === standard) return { kind: 'same', amount: 0 }
  return price < standard ? { kind: 'discount', amount: standard - price } : { kind: 'more', amount: price - standard }
}

/** 'Diskon Rp 100.000' / 'Lebih Rp 50.000' / '' (same or no standard). */
export function priceDeltaText(delta: PriceDelta): string {
  if (delta.kind === 'discount') return `Diskon ${formatRupiah(delta.amount)}`
  if (delta.kind === 'more') return `Lebih ${formatRupiah(delta.amount)}`
  return ''
}

/** 'Harga disepakati Rp 1.700.000 · standar Rp 1.800.000' (standard omitted when the room has no rate). */
export function agreedPriceText(price: number, standard: number | null | undefined): string {
  return standard == null ? `Harga disepakati ${formatRupiah(price)}` : `Harga disepakati ${formatRupiah(price)} · standar ${formatRupiah(standard)}`
}

// ---------- extension with another period type (SPEC 5.2) ----------

/**
 * Price to prefill in the extension modal for `type`: the lease's agreed price for its own type (the
 * negotiated price stays), otherwise the room's standard rate for the new type (0 when the room has none).
 */
export function extensionPriceFor(lease: Lease, room: Room | undefined, type: PeriodType): number {
  if (type === lease.period_type) return lease.price_per_period
  return roomPriceFor(room, type) ?? 0
}

/** Default of 'Jadikan jenis/harga tetap sewa ini': on when the type changed, off when only the price did. */
export function defaultMakePermanent(lease: Lease, type: PeriodType): boolean {
  return type !== lease.period_type
}

/** True when an extension differs from the lease in type or price (the checkbox is only offered then). */
export function extensionChangesTerms(lease: Lease, type: PeriodType, price: number): boolean {
  return type !== lease.period_type || price !== lease.price_per_period
}

/** 'Ganti ke Bulanan Rp 1.800.000 mulai 16 Okt 2026' */
export function periodChangeNote(type: PeriodType, price: number, startISO: string): string {
  return `Ganti ke ${PERIOD_TYPE_LABEL[type]} ${formatRupiah(price)} mulai ${formatDate(startISO)}`
}

/** Append one line to lease notes (existing notes trimmed; null/empty notes -> just the line). */
export function appendLeaseNote(notes: string | null, line: string): string {
  return notes?.trim() ? `${notes.trim()}\n${line}` : line
}

/**
 * Insert payload for an invoice draft. `period_type` is always the draft's effective type, so an extension
 * billed monthly on a daily lease remembers its own unit (invoiceUnitLabel); status is derived for 0 paid
 * (a zero total is 'paid').
 */
export function invoiceInsertFromDraft(lease: Lease, draft: InvoiceDraft, notes: string | null): OrgInsert<'invoices'> {
  return {
    property_id: lease.property_id,
    lease_id: lease.id,
    invoice_number: draft.invoice_number,
    period_type: draft.period_type,
    period_start: draft.period_start,
    period_end: draft.period_end,
    quantity: draft.quantity,
    base_amount: draft.base_amount,
    addons_amount: draft.addons_amount,
    extra_amount: draft.extra_amount,
    discount_amount: draft.discount_amount,
    total_amount: draft.total_amount,
    due_date: draft.due_date,
    status: deriveInvoiceStatus(draft.total_amount, 0, 'unpaid'),
    notes,
  }
}

/**
 * Lease update after issuing `draft` (SPEC 2b.10 + 5.2), or null when nothing changes:
 *  - end_date = draft.new_lease_end_date when it moved;
 *  - when `makePermanent` and the draft's type or per-period price differs from the lease: period_type and
 *    price_per_period follow the draft and notes get 'Ganti ke <Jenis> Rp X mulai <period_start>'.
 */
export function extensionLeasePatch(lease: Lease, draft: InvoiceDraft, makePermanent: boolean): Update<'leases'> | null {
  const patch: Update<'leases'> = {}
  if (draft.new_lease_end_date !== lease.end_date) patch.end_date = draft.new_lease_end_date
  const changed = draft.period_type !== lease.period_type || draft.price_per_period !== lease.price_per_period
  if (makePermanent && changed) {
    patch.period_type = draft.period_type
    patch.price_per_period = draft.price_per_period
    patch.notes = appendLeaseNote(lease.notes, periodChangeNote(draft.period_type, draft.price_per_period, draft.period_start))
  }
  return Object.keys(patch).length > 0 ? patch : null
}

export interface FollowingPeriodPreview {
  /** one period of the lease's (post-save) type right after the new invoice */
  period_start: string
  period_end: string
  /** type the lease will have after saving */
  period_type: PeriodType
  /** true when the billing chain sits on a period grid (chainAnchor != null); false = counted from this invoice's end */
  anchored: boolean
  /** the grid's anchor date when anchored */
  anchor: string | null
}

/**
 * Preview of the period AFTER this extension: the lease as it will be after saving (type/price switched when
 * `makePermanent`), the lease's invoices plus a pseudo invoice for the draft, then chainAnchor (does the chain
 * sit on a grid?) and nextPeriodBounds(…, 1). Null when the bounds cannot be computed.
 */
export function previewFollowingPeriod(lease: Lease, invoices: Invoice[], draft: InvoiceDraft, makePermanent: boolean): FollowingPeriodPreview | null {
  const after: Lease = { ...lease, ...(extensionLeasePatch(lease, draft, makePermanent) ?? {}) }
  const pseudo: Invoice = { ...invoiceInsertFromDraft(lease, draft, null), id: '__draft__', org_id: lease.org_id, created_at: '', updated_at: '' }
  // Old rows with period_type null get pinned to the current type on save (invoicesToPinType); mirror that here.
  const all = [...invoices.filter((i) => i.lease_id === lease.id).map((i) => (i.period_type == null ? { ...i, period_type: lease.period_type } : i)), pseudo]
  try {
    const chain = chainAnchor(after, all)
    const next = nextPeriodBounds(after, all, 1)
    return { ...next, period_type: after.period_type, anchored: chain !== null, anchor: chain?.anchor ?? null }
  } catch {
    return null
  }
}

// ---------- add-ons and old invoices when a type switch is made permanent (SPEC 5.2) ----------

/**
 * Converts a per_period add-on amount from one lease unit to another when the lease switches its period type for
 * good: amount x (days of one `newType` period starting at `fromISO`) / (days of one `oldType` period starting at
 * `fromISO`), rounded to whole rupiah. Daily Rp 10.000 -> monthly from 16 Okt (31 nights) -> Rp 310.000; weekly
 * Rp 70.000 -> daily Rp 10.000; monthly Rp 310.000 from 1 Okt -> daily Rp 10.000. Same type -> unchanged.
 */
export function rescaleAddonAmount(amount: number, oldType: PeriodType, newType: PeriodType, fromISO: string): number {
  if (oldType === newType) return amount
  const days = (t: PeriodType) => daysBetween(fromISO, periodEnd(fromISO, t, 1)) + 1
  return Math.round((amount * days(newType)) / days(oldType))
}

/** Default new amount per per_period add-on (by id) for a permanent switch to `newType` (see rescaleAddonAmount). */
export function rescaledAddonDefaults(addons: LeaseAddon[], oldType: PeriodType, newType: PeriodType, fromISO: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of addons) if (a.billing === 'per_period') out[a.id] = rescaleAddonAmount(a.amount, oldType, newType, fromISO)
  return out
}

/** `addons` with the per_period amounts replaced by `amounts[id]` (missing ids keep their amount). */
export function applyAddonAmounts(addons: LeaseAddon[], amounts: Record<string, number>): LeaseAddon[] {
  return addons.map((a) => (a.billing === 'per_period' && amounts[a.id] !== undefined ? { ...a, amount: amounts[a.id] } : a))
}

/**
 * Add-ons amount of an extension whose new type is made permanent: the per_period add-ons are already expressed
 * per NEW unit (`amounts`), so they are multiplied by the invoice's quantity like a same-type invoice
 * (computeAddonsAmount); one_time add-ons only when the lease has no non-void invoice yet (as buildInvoiceDraft).
 */
export function permanentSwitchAddonsAmount(addons: LeaseAddon[], amounts: Record<string, number>, quantity: number, leaseInvoices: Invoice[]): number {
  const isFirst = !leaseInvoices.some((i) => i.status !== 'void')
  return computeAddonsAmount(applyAddonAmounts(addons, amounts), quantity, isFirst)
}

/** lease_addons rows whose amount changes (per_period only). */
export function addonAmountUpdates(addons: LeaseAddon[], amounts: Record<string, number>): { id: string; amount: number }[] {
  return addons
    .filter((a) => a.billing === 'per_period' && amounts[a.id] !== undefined && amounts[a.id] !== a.amount)
    .map((a) => ({ id: a.id, amount: amounts[a.id] }))
}

/**
 * Invoices of `lease` that store period_type null ('jenis sewa saat itu', SPEC 5.2) and must be pinned to the
 * lease's CURRENT type before the lease switches type, so '8 malam' does not turn into '8 bulan' and chainAnchor
 * keeps reading them correctly. Empty when the type does not change.
 */
export function invoicesToPinType(lease: Lease, invoices: Invoice[], newType: PeriodType | undefined): Invoice[] {
  if (newType === undefined || newType === lease.period_type) return []
  return invoices.filter((i) => i.lease_id === lease.id && i.period_type == null)
}
