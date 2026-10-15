/**
 * Pure helpers for the dashboard (no React, no I/O) so they can be unit-tested. All calculations
 * that exist in src/domain are delegated there; this file only assembles view models.
 */
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'
import {
  computeAddonsAmount,
  isPaidUpAndEnding as domainIsPaidUpAndEnding,
  nextDueSortKey,
  outstandingFor,
  summarizeLeaseBilling,
  type BillingState,
  type LeaseBillingSummary,
} from '../../domain/billing'
import { compareRoomNames, isLeaseActiveOn, isLeaseReservedOn, reservedRoomIds, vacantRooms } from '../../domain/occupancy'
import { addDaysISO, daysBetween, parseISODate, rangeForPreset, toISODate, type DateRange } from '../../domain/period'
import { checkoutISO, formatCheckout } from '../../lib/format'
import { subMonths } from 'date-fns'

/** Window of the "Akan berakhir" card (SPEC section 3: sewa yang akan berakhir ≤ 7 hari), counted to the check-out day. */
export const EXPIRING_WITHIN_DAYS = 7

/**
 * How many days ahead a due date counts as "jatuh tempo" (summarizeLeaseBilling's dueSoonDays). Passed
 * explicitly so the billing state and the amount due (amountDueAsOf) use the same window.
 */
export const DUE_SOON_DAYS = 3

export type AttentionGroup = Extract<BillingState, 'overdue' | 'due_soon' | 'unbilled'>

export const ATTENTION_ORDER: AttentionGroup[] = ['overdue', 'due_soon', 'unbilled']

export const ATTENTION_LABEL: Record<AttentionGroup, string> = {
  overdue: 'Terlambat',
  due_soon: 'Jatuh tempo / masa tenggang',
  unbilled: 'Belum ditagih',
}

export interface AttentionItem {
  lease: Lease
  tenant: Tenant | null
  room: Room | null
  property: Property | null
  summary: LeaseBillingSummary
  group: AttentionGroup
  /** open invoice with the earliest due date (for reminder period), when any */
  openInvoice: Invoice | null
  /** how many non-settled invoices the lease has */
  openInvoiceCount: number
  /**
   * Non-settled invoices that are already due or fall due within DUE_SOON_DAYS (due_date <= today +
   * DUE_SOON_DAYS), earliest due first. An invoice issued early (e.g. next month's) is not in here.
   */
  dueInvoices: Invoice[]
  /** sum of the remaining amounts of dueInvoices: what the tenant has to pay now */
  dueAmount: number
  /** summary.outstanding - dueAmount: billed but not due yet (shown only as a secondary line) */
  notYetDueAmount: number
  /**
   * What the next period will be billed at: price_per_period + add-ons for one period (per_period add-ons,
   * plus one_time add-ons when the lease has no non-void invoice yet), i.e. what buildInvoiceDraft produces.
   */
  nextPeriodAmount: number
  /** amount to mention in the row and the WhatsApp reminder: dueAmount when > 0, otherwise nextPeriodAmount */
  amount: number
}

export interface AttentionSection {
  group: AttentionGroup
  items: AttentionItem[]
}

export interface Lookups {
  tenantsById: Map<string, Tenant>
  roomsById: Map<string, Room>
  propertiesById: Map<string, Property>
}

export function buildLookups(tenants: Tenant[], rooms: Room[], properties: Property[]): Lookups {
  return {
    tenantsById: new Map(tenants.map((t) => [t.id, t])),
    roomsById: new Map(rooms.map((r) => [r.id, r])),
    propertiesById: new Map(properties.map((p) => [p.id, p])),
  }
}

export interface AmountDue {
  /** open invoices with due_date <= asOf, earliest due first */
  invoices: Invoice[]
  /** sum of their remaining amounts (outstandingFor) */
  amount: number
}

/**
 * What a lease owes as of `asOfISO`: non-void invoices of the lease whose remaining amount (outstandingFor)
 * is > 0, whose stored status is not 'paid' (same "open" rule as summarizeLeaseBilling) and whose due_date
 * is on or before `asOfISO`. Invoices issued ahead of time are excluded so they are never quoted as due on
 * an earlier date.
 */
export function amountDueAsOf(leaseId: string, invoices: Invoice[], payments: Payment[], asOfISO: string): AmountDue {
  const due = invoices
    .filter((inv) => inv.lease_id === leaseId && inv.status !== 'void' && inv.status !== 'paid' && inv.due_date <= asOfISO)
    .map((inv) => ({ inv, open: outstandingFor(inv, payments) }))
    .filter((x) => x.open > 0)
    .sort((a, b) => (a.inv.due_date < b.inv.due_date ? -1 : a.inv.due_date > b.inv.due_date ? 1 : 0))
  return { invoices: due.map((x) => x.inv), amount: due.reduce((sum, x) => sum + x.open, 0) }
}

function isAttentionGroup(state: BillingState): state is AttentionGroup {
  return state === 'overdue' || state === 'due_soon' || state === 'unbilled'
}

/** Re-exported from the billing domain so every module agrees on what 'akan berakhir' means. */
export function isPaidUpAndEnding(lease: Lease, summary: LeaseBillingSummary, todayISO: string, withinDays = EXPIRING_WITHIN_DAYS): boolean {
  return domainIsPaidUpAndEnding(lease, summary, todayISO, withinDays)
}

/**
 * "Perlu perhatian": every active lease (already filtered by kos) whose billing state is overdue,
 * due_soon or unbilled, grouped in that order. Within a group, the most urgent (earliest due date) first.
 * Paid-up leases ending within `expiringWithinDays` are left out (see isPaidUpAndEnding) so that
 * buildExpiringItems lists them under "Akan berakhir" instead.
 */
export function buildAttentionSections(
  leases: Lease[],
  invoices: Invoice[],
  payments: Payment[],
  addons: LeaseAddon[],
  lookups: Lookups,
  todayISO: string,
  expiringWithinDays = EXPIRING_WITHIN_DAYS,
): AttentionSection[] {
  const byGroup = new Map<AttentionGroup, AttentionItem[]>(ATTENTION_ORDER.map((g) => [g, []]))
  const addonsByLease = new Map<string, LeaseAddon[]>()
  for (const addon of addons) {
    const list = addonsByLease.get(addon.lease_id)
    if (list) list.push(addon)
    else addonsByLease.set(addon.lease_id, [addon])
  }
  for (const lease of leases) {
    if (lease.status !== 'active') continue
    const summary = summarizeLeaseBilling(lease, invoices, payments, todayISO, DUE_SOON_DAYS)
    if (!isAttentionGroup(summary.state)) continue
    if (isPaidUpAndEnding(lease, summary, todayISO, expiringWithinDays)) continue
    const activeInvoices = invoices.filter((inv) => inv.lease_id === lease.id && inv.status !== 'void')
    const openInvoices = activeInvoices
      .filter((inv) => inv.status !== 'paid' && outstandingFor(inv, payments) > 0)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
    const openInvoice = openInvoices[0] ?? null
    const due = amountDueAsOf(lease.id, invoices, payments, addDaysISO(todayISO, DUE_SOON_DAYS))
    // Same arithmetic as buildInvoiceDraft for one period (SPEC 2b: one_time add-ons only on the first invoice).
    const nextPeriodAmount = lease.price_per_period + computeAddonsAmount(addonsByLease.get(lease.id) ?? [], 1, activeInvoices.length === 0)
    byGroup.get(summary.state)!.push({
      lease,
      tenant: lookups.tenantsById.get(lease.tenant_id) ?? null,
      room: lookups.roomsById.get(lease.room_id) ?? null,
      property: lookups.propertiesById.get(lease.property_id) ?? null,
      summary,
      group: summary.state,
      openInvoice,
      openInvoiceCount: openInvoices.length,
      dueInvoices: due.invoices,
      dueAmount: due.amount,
      notYetDueAmount: Math.max(0, summary.outstanding - due.amount),
      nextPeriodAmount,
      amount: due.amount > 0 ? due.amount : summary.outstanding > 0 ? summary.outstanding : nextPeriodAmount,
    })
  }
  const sections: AttentionSection[] = []
  for (const group of ATTENTION_ORDER) {
    const items = byGroup.get(group)!
    items.sort(compareAttentionByDate)
    if (items.length > 0) sections.push({ group, items })
  }
  return sections
}

/** Order of the rows inside each "Perlu perhatian" group (SPEC 5.1): 'date' = jatuh tempo terdekat, 'room' = kos lalu kamar. */
export type AttentionSort = 'date' | 'room'

export const ATTENTION_SORT_OPTIONS: { value: AttentionSort; label: string }[] = [
  { value: 'date', label: 'Tanggal' },
  { value: 'room', label: 'Kamar' },
]

/** localStorage key that remembers the chosen AttentionSort on this device. */
export const ATTENTION_SORT_STORAGE_KEY = 'woombad.dashboard.attentionSort'

/** Stored value -> AttentionSort; anything unknown (null, old values) falls back to 'date'. */
export function parseAttentionSort(value: string | null | undefined): AttentionSort {
  return value === 'room' ? 'room' : 'date'
}

function compareTenantNames(a: AttentionItem, b: AttentionItem): number {
  return (a.tenant?.full_name ?? '').localeCompare(b.tenant?.full_name ?? '')
}

/** Earliest next due date first (nextDueSortKey; the most overdue on top), then tenant name. */
export function compareAttentionByDate(a: AttentionItem, b: AttentionItem): number {
  const ka = nextDueSortKey(a.summary)
  const kb = nextDueSortKey(b.summary)
  if (ka !== kb) return ka < kb ? -1 : 1
  return compareTenantNames(a, b)
}

/** Kos name, then natural room name (compareRoomNames: A1 < A2 < A10), then next due date. */
export function compareAttentionByRoom(a: AttentionItem, b: AttentionItem): number {
  const pa = a.property?.name ?? ''
  const pb = b.property?.name ?? ''
  const byProperty = pa.localeCompare(pb, undefined, { sensitivity: 'base' })
  if (byProperty !== 0) return byProperty
  if (a.lease.property_id !== b.lease.property_id) return a.lease.property_id < b.lease.property_id ? -1 : 1
  const byRoom = compareRoomNames(a.room?.name ?? '', b.room?.name ?? '')
  if (byRoom !== 0) return byRoom
  return compareAttentionByDate(a, b)
}

/** Re-sorts the rows inside every group (group order stays overdue, due_soon, unbilled). Returns new arrays. */
export function sortAttentionSections(sections: AttentionSection[], sort: AttentionSort): AttentionSection[] {
  const compare = sort === 'room' ? compareAttentionByRoom : compareAttentionByDate
  return sections.map((section) => ({ ...section, items: [...section.items].sort(compare) }))
}

export interface ExpiringItem {
  lease: Lease
  tenant: Tenant | null
  room: Room | null
  property: Property | null
  /** 'YYYY-MM-DD' check-out day = lease.end_date (the last night) + 1 (SPEC 7.3) */
  checkoutDate: string
  /** days from today to checkoutDate: 0 = check-out today; equals the next due date's count of a paid-up lease */
  daysLeft: number
}

/**
 * Active leases whose CHECK-OUT day (end_date + 1, SPEC 7.3) falls within today .. today + `withinDays`, earliest
 * first, excluding those already listed under "Perlu perhatian" (SPEC 2b.12). Counting to the check-out day means a
 * stay whose last night was yesterday is still listed today ('Check-out hari ini') and one leaving in 8 days is not.
 */
export function buildExpiringItems(
  leases: Lease[],
  excludeLeaseIds: Set<string>,
  lookups: Lookups,
  todayISO: string,
  withinDays = EXPIRING_WITHIN_DAYS,
): ExpiringItem[] {
  const limit = addDaysISO(todayISO, withinDays)
  const byText = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  return leases
    .filter((l) => l.status === 'active' && !excludeLeaseIds.has(l.id))
    .map((lease) => ({ lease, checkoutDate: checkoutISO(lease.end_date) }))
    .filter(({ checkoutDate }) => checkoutDate >= todayISO && checkoutDate <= limit)
    .sort((a, b) => byText(a.checkoutDate, b.checkoutDate) || byText(a.lease.id, b.lease.id))
    .map(({ lease, checkoutDate }) => ({
      lease,
      tenant: lookups.tenantsById.get(lease.tenant_id) ?? null,
      room: lookups.roomsById.get(lease.room_id) ?? null,
      property: lookups.propertiesById.get(lease.property_id) ?? null,
      checkoutDate,
      daysLeft: Math.max(0, daysBetween(todayISO, checkoutDate)),
    }))
}

/** Badge of an "Akan berakhir" row: 0 -> 'Check-out hari ini', 1 -> 'Check-out besok', 3 -> 'Check-out 3 hari lagi'. */
export function checkoutDaysLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Check-out hari ini'
  if (daysLeft === 1) return 'Check-out besok'
  return `Check-out ${daysLeft} hari lagi`
}

export interface ExtensionQuestionInput {
  tenantName: string
  roomName: string
  propertyName: string
  /** 'YYYY-MM-DD' last night of the current stay (lease.end_date as stored) */
  endDate: string
}

/**
 * WhatsApp text for a lease under "Akan berakhir": asks whether the tenant will extend. It never mentions a
 * bill or a due date; nothing is owed yet (that is why the lease is in this list and not under "Perlu
 * perhatian", where reminderText from src/domain/messages is used). The date is the check-out day (SPEC 7.3).
 */
export function extensionQuestionText(input: ExtensionQuestionInput): string {
  const first = input.tenantName.trim().split(/\s+/)[0] ?? ''
  const kak = first ? `Kak ${first}` : 'Kak'
  return [
    `Halo ${kak}, ini pesan dari ${input.propertyName}.`,
    `Masa sewa kamar ${input.roomName} berakhir pada ${formatCheckout(input.endDate)} (hari check-out).`,
    'Apakah berencana memperpanjang sewa? Mohon kabari ya supaya kami bisa menyiapkan tagihan berikutnya atau jadwal checkout. Terima kasih 🙏',
  ].join('\n')
}

export interface VacantRoomItem {
  room: Room
  /** 'YYYY-MM-DD' start of the reserving lease when the room is "Dipesan", null when truly vacant */
  reservedFrom: string | null
  reservedTenant: Tenant | null
}

export interface VacantRoomGroup {
  property: Property | null
  propertyId: string
  rooms: VacantRoomItem[]
}

/**
 * Vacant rooms (`vacantRooms`) plus reserved rooms (`reservedRoomIds`, not occupied today), grouped by kos
 * in the order of `properties`. Rooms in maintenance are excluded.
 */
export function buildVacantGroups(rooms: Room[], leases: Lease[], lookups: Lookups, properties: Property[], todayISO: string): VacantRoomGroup[] {
  const vacant = vacantRooms(rooms, leases, todayISO)
  const reservedIds = reservedRoomIds(leases, todayISO)
  const items: VacantRoomItem[] = vacant.map((room) => ({ room, reservedFrom: null, reservedTenant: null }))
  for (const room of rooms) {
    if (room.status !== 'active' || !reservedIds.has(room.id)) continue
    if (leases.some((l) => l.room_id === room.id && isLeaseActiveOn(l, todayISO))) continue
    const reserving = leases
      .filter((l) => l.room_id === room.id && isLeaseReservedOn(l, todayISO))
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0]
    if (!reserving) continue
    items.push({ room, reservedFrom: reserving.start_date, reservedTenant: lookups.tenantsById.get(reserving.tenant_id) ?? null })
  }
  items.sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true }))
  const order = new Map(properties.map((p, i) => [p.id, i]))
  const grouped = new Map<string, VacantRoomItem[]>()
  for (const item of items) {
    const list = grouped.get(item.room.property_id)
    if (list) list.push(item)
    else grouped.set(item.room.property_id, [item])
  }
  return [...grouped.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
    .map(([propertyId, list]) => ({ propertyId, property: lookups.propertiesById.get(propertyId) ?? null, rooms: list }))
}

export interface RecentPaymentItem {
  payment: Payment
  tenant: Tenant | null
  room: Room | null
}

/** Last `limit` payments by paid_at (then created_at) descending, with tenant and room resolved via the lease. */
export function buildRecentPayments(payments: Payment[], leases: Lease[], lookups: Lookups, limit = 5): RecentPaymentItem[] {
  const leasesById = new Map(leases.map((l) => [l.id, l]))
  return [...payments]
    .sort((a, b) => {
      if (a.paid_at !== b.paid_at) return a.paid_at < b.paid_at ? 1 : -1
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
    })
    .slice(0, limit)
    .map((payment) => {
      const lease = payment.lease_id ? leasesById.get(payment.lease_id) : undefined
      return {
        payment,
        tenant: lease ? (lookups.tenantsById.get(lease.tenant_id) ?? null) : null,
        room: lease ? (lookups.roomsById.get(lease.room_id) ?? null) : null,
      }
    })
}

/** Six calendar months ending with the month of `todayISO` (first day of month-5 .. last day of this month). */
export function lastSixMonthsRange(todayISO: string): DateRange {
  const start = rangeForPreset('monthly', toISODate(subMonths(parseISODate(todayISO), 5))).start
  const end = rangeForPreset('monthly', todayISO).end
  return { start, end }
}

/** Axis tick: 1200000 -> '1,2 jt'; 850000 -> '850 rb'; 0 -> '0'; negatives keep the sign. */
export function formatCompactRupiah(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const trim = (n: number, digits: number) => n.toFixed(digits).replace('.', ',').replace(/,0+$/, '')
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000, 1)} M`
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000, 1)} jt`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000, 0)} rb`
  return `${sign}${Math.round(abs)}`
}

/**
 * Relative due label in Indonesian: -2 -> 'Terlambat 2 hari' (or 'Lewat 2 hari · tenggang' while still within the
 * grace period, i.e. state due_soon), 0 -> 'Jatuh tempo hari ini', 3 -> '3 hari lagi'.
 */
export function dueLabel(daysUntilDue: number | null, inGrace = false): string {
  if (daysUntilDue === null) return '-'
  if (daysUntilDue < 0) return inGrace ? `Lewat ${-daysUntilDue} hari · tenggang` : `Terlambat ${-daysUntilDue} hari`
  if (daysUntilDue === 0) return 'Jatuh tempo hari ini'
  if (daysUntilDue === 1) return 'Jatuh tempo besok'
  return `${daysUntilDue} hari lagi`
}

/** Greeting by local hour: 'Selamat pagi' (<11), 'siang' (<15), 'sore' (<18), 'malam'. */
export function greetingFor(hour: number): string {
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}

/** Signed delta text for stat subtitles: 1500000, 0.12 -> '+Rp 1.500.000 (+12%)'. */
export function deltaText(delta: number, pct: number | null, formatMoney: (n: number) => string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : ''
  const money = `${sign}${formatMoney(Math.abs(delta))}`
  if (pct === null) return money
  const p = Math.round(pct * 100)
  return `${money} (${p > 0 ? '+' : ''}${p}%)`
}
