/**
 * Pure helpers for the dashboard (no React, no I/O) so they can be unit-tested. All calculations
 * that exist in src/domain are delegated there; this file only assembles view models.
 */
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'
import { computeAddonsAmount, paidAmountFor, summarizeLeaseBilling, type BillingState, type LeaseBillingSummary } from '../../domain/billing'
import { expiringLeases, isLeaseActiveOn, isLeaseReservedOn, reservedRoomIds, vacantRooms } from '../../domain/occupancy'
import { addDaysISO, daysBetween, parseISODate, rangeForPreset, toISODate, type DateRange } from '../../domain/period'
import { formatDate } from '../../lib/format'
import { subMonths } from 'date-fns'

/** Window of the "Akan berakhir" card (SPEC section 3: sewa yang akan berakhir ≤ 7 hari). */
export const EXPIRING_WITHIN_DAYS = 7

export type AttentionGroup = Extract<BillingState, 'overdue' | 'due_soon' | 'unbilled'>

export const ATTENTION_ORDER: AttentionGroup[] = ['overdue', 'due_soon', 'unbilled']

export const ATTENTION_LABEL: Record<AttentionGroup, string> = {
  overdue: 'Terlambat',
  due_soon: 'Jatuh tempo ≤ 3 hari',
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
  /** how many non-settled invoices the lease has (the reminder quotes a period only when it is exactly one) */
  openInvoiceCount: number
  /**
   * What the next period will be billed at: price_per_period + add-ons for one period (per_period add-ons,
   * plus one_time add-ons when the lease has no non-void invoice yet), i.e. what buildInvoiceDraft produces.
   */
  nextPeriodAmount: number
  /** amount to mention: outstanding when > 0, otherwise nextPeriodAmount */
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

function isAttentionGroup(state: BillingState): state is AttentionGroup {
  return state === 'overdue' || state === 'due_soon' || state === 'unbilled'
}

/**
 * A lease that owes nothing and whose stay ends within the "Akan berakhir" window (today <= end_date <=
 * today + withinDays). `summarizeLeaseBilling` deliberately ignores end_date, so such a lease reads
 * due_soon (next period starts right after end_date) although there is no bill to pay or chase yet: the
 * owner's decision is "perpanjang atau checkout", not "bayar / tagih". SPEC 2b.12 lets the dashboard show a
 * lease either under due/overdue or under akan berakhir; this predicate picks the latter.
 *
 * A paid-up lease whose end_date is already in the past (tenant staying on past the paid period) is NOT
 * covered: it keeps its due_soon / overdue place so the next invoice gets issued.
 */
export function isPaidUpAndEnding(lease: Lease, summary: LeaseBillingSummary, todayISO: string, withinDays = EXPIRING_WITHIN_DAYS): boolean {
  return (
    lease.status === 'active' &&
    summary.outstanding === 0 &&
    summary.state !== 'unbilled' &&
    lease.end_date >= todayISO &&
    lease.end_date <= addDaysISO(todayISO, withinDays)
  )
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
    const summary = summarizeLeaseBilling(lease, invoices, payments, todayISO)
    if (!isAttentionGroup(summary.state)) continue
    if (isPaidUpAndEnding(lease, summary, todayISO, expiringWithinDays)) continue
    const activeInvoices = invoices.filter((inv) => inv.lease_id === lease.id && inv.status !== 'void')
    const openInvoices = activeInvoices
      .filter((inv) => inv.status !== 'paid' && inv.total_amount - paidAmountFor(inv.id, payments) > 0)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
    const openInvoice = openInvoices[0] ?? null
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
      nextPeriodAmount,
      amount: summary.outstanding > 0 ? summary.outstanding : nextPeriodAmount,
    })
  }
  const sections: AttentionSection[] = []
  for (const group of ATTENTION_ORDER) {
    const items = byGroup.get(group)!
    items.sort((a, b) => {
      const da = a.summary.daysUntilDue ?? 0
      const db = b.summary.daysUntilDue ?? 0
      if (da !== db) return da - db
      return (a.tenant?.full_name ?? '').localeCompare(b.tenant?.full_name ?? '')
    })
    if (items.length > 0) sections.push({ group, items })
  }
  return sections
}

export interface ExpiringItem {
  lease: Lease
  tenant: Tenant | null
  room: Room | null
  property: Property | null
  daysLeft: number
}

/** Leases ending within `withinDays`, excluding those already listed under "Perlu perhatian" (SPEC 2b.12). */
export function buildExpiringItems(
  leases: Lease[],
  excludeLeaseIds: Set<string>,
  lookups: Lookups,
  todayISO: string,
  withinDays = EXPIRING_WITHIN_DAYS,
): ExpiringItem[] {
  return expiringLeases(leases, todayISO, withinDays)
    .filter((l) => !excludeLeaseIds.has(l.id))
    .map((lease) => ({
      lease,
      tenant: lookups.tenantsById.get(lease.tenant_id) ?? null,
      room: lookups.roomsById.get(lease.room_id) ?? null,
      property: lookups.propertiesById.get(lease.property_id) ?? null,
      daysLeft: Math.max(0, daysBetween(todayISO, lease.end_date)),
    }))
}

export interface ExtensionQuestionInput {
  tenantName: string
  roomName: string
  propertyName: string
  /** 'YYYY-MM-DD' last night of the current stay */
  endDate: string
}

/**
 * WhatsApp text for a lease under "Akan berakhir": asks whether the tenant will extend. It never mentions a
 * bill or a due date; nothing is owed yet (that is why the lease is in this list and not under "Perlu
 * perhatian", where reminderText from src/domain/messages is used).
 */
export function extensionQuestionText(input: ExtensionQuestionInput): string {
  const first = input.tenantName.trim().split(/\s+/)[0] ?? ''
  const kak = first ? `Kak ${first}` : 'Kak'
  return [
    `Halo ${kak}, ini pesan dari ${input.propertyName}.`,
    `Masa sewa kamar ${input.roomName} berakhir pada ${formatDate(input.endDate)}.`,
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
