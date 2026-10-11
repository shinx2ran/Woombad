/**
 * UI-side helpers for the leases module. Money/date rules live in src/domain; these functions only
 * arrange domain results for display (sorting, search, timeline segments, form conventions).
 */
import type { Invoice, Lease, Payment, Room, Tenant } from '../../types/db'
import type { BillingState, ExtraBreakdown, LeaseBillingSummary } from '../../domain/billing'
import { activeInvoicesSorted, formatExtraBreakdown, outstandingFor, paidAmountFor, parseExtraBreakdown } from '../../domain/billing'
import { addDaysISO, daysBetween } from '../../domain/period'
import { isLeaseActiveOn, isLeaseReservedOn, leaseOverlaps } from '../../domain/occupancy'
import { formatRupiah } from '../../lib/format'

// ---------- billing state presentation ----------

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'

export const BILLING_STATE_META: Record<BillingState, { label: string; tone: BadgeTone }> = {
  overdue: { label: 'Terlambat', tone: 'danger' },
  due_soon: { label: 'Jatuh tempo', tone: 'warning' },
  unbilled: { label: 'Belum ditagih', tone: 'neutral' },
  ok: { label: 'Aman', tone: 'success' },
  inactive: { label: 'Tidak aktif', tone: 'neutral' },
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

// ---------- open invoices & deposit settlement ----------

/** Non-void invoices of the lease with money still owed, oldest due date first. */
export function openInvoicesSorted(leaseId: string, invoices: Invoice[], payments: Payment[]): Invoice[] {
  return invoices
    .filter((inv) => inv.lease_id === leaseId && inv.status !== 'void' && outstandingFor(inv, payments) > 0)
    .sort((a, b) => (a.due_date === b.due_date ? a.period_start.localeCompare(b.period_start) : a.due_date.localeCompare(b.due_date)))
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
  return [t.full_name, t.phone, t.nik].some((v) => v?.toLowerCase().includes(q))
}
