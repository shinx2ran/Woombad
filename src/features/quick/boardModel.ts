/**
 * Papan kamar (SPEC 7.4): one tile per room, coloured by what the owner has to do there. Pure; built from the same
 * functions the Kos & Kamar page (roomDisplayState) and the lease list (summarizeLeaseBilling) use. The board counts
 * days to the next due date (for a paid-up lease that is its check-out day, SPEC 7.3) and, at the owner's request,
 * turns red from the first day past due (the lease list keeps its grace days as "tenggang").
 */
import { summarizeLeaseBilling, type LeaseBillingSummary } from '../../domain/billing'
import { daysBetween } from '../../domain/period'
import { formatDate } from '../../lib/format'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { roomDisplayState, sortRoomsNatural } from '../properties/roomUtils'

export type BoardTone = 'overdue' | 'soon' | 'occupied' | 'vacant' | 'reserved' | 'maintenance'

/** a due date this many days away or closer turns the tile orange */
export const BOARD_SOON_DAYS = 7

/** Legend text, and the word under the room name for tones without a day count. */
export const BOARD_TONE_META: Record<BoardTone, { caption: string; legend: string }> = {
  overdue: { caption: 'Telat', legend: 'Telat bayar' },
  soon: { caption: '', legend: `Jatuh tempo ≤ ${BOARD_SOON_DAYS} hari` },
  occupied: { caption: 'Terisi', legend: `Terisi, aman (> ${BOARD_SOON_DAYS} hari)` },
  vacant: { caption: 'Kosong', legend: 'Kosong' },
  reserved: { caption: 'Dipesan', legend: 'Dipesan' },
  maintenance: { caption: 'Perbaikan', legend: 'Perbaikan' },
}

/** Legend order: what needs action first. */
export const BOARD_TONES: BoardTone[] = ['overdue', 'soon', 'occupied', 'vacant', 'reserved', 'maintenance']

export interface BoardTile {
  room: Room
  tone: BoardTone
  /** word under the room name: 'Telat', '3 hari', 'Hari ini', 'Terisi', 'Kosong', ... */
  caption: string
  /** days until the next due date of the occupying lease (negative = past due), else null */
  days: number | null
  /** the lease living in (or booked into) the room, also kept for a room under maintenance */
  lease: Lease | null
  tenant: Tenant | null
  /** billing of `lease` when the room is occupied, else null */
  summary: LeaseBillingSummary | null
}

export interface BoardGroup {
  property: Property
  tiles: BoardTile[]
}

/** Days from today to the next due date (a paid-up lease: its check-out day, the day the next period starts). */
export function daysToDue(summary: LeaseBillingSummary | null, todayISO: string): number | null {
  if (!summary) return null
  if (summary.daysUntilDue !== null) return summary.daysUntilDue
  return summary.nextDueDate ? daysBetween(todayISO, summary.nextDueDate) : null
}

export function boardTone(kind: 'occupied' | 'reserved' | 'vacant' | 'maintenance', days: number | null): BoardTone {
  if (kind === 'maintenance') return 'maintenance'
  if (kind === 'vacant') return 'vacant'
  if (kind === 'reserved') return 'reserved'
  if (days === null) return 'occupied'
  if (days < 0) return 'overdue'
  return days <= BOARD_SOON_DAYS ? 'soon' : 'occupied'
}

export function boardCaption(tone: BoardTone, days: number | null): string {
  if (tone !== 'soon' || days === null) return BOARD_TONE_META[tone].caption
  return days === 0 ? 'Hari ini' : `${days} hari`
}

/** One line for the room sheet: 'Telat 3 hari · jatuh tempo 12 Okt', 'Jatuh tempo hari ini · 15 Okt', 'Jatuh tempo 17 Okt · 2 hari lagi'. */
export function boardStatusText(summary: LeaseBillingSummary | null, todayISO: string): string | null {
  const days = daysToDue(summary, todayISO)
  if (!summary?.nextDueDate || days === null) return null
  const date = formatDate(summary.nextDueDate, 'd MMM')
  if (days < 0) return `Telat ${-days} hari · jatuh tempo ${date}`
  if (days === 0) return `Jatuh tempo hari ini · ${date}`
  return `Jatuh tempo ${date} · ${days} hari lagi`
}

/** Rooms of the given kos (in that order), each sorted naturally (A2 before A10); kos without rooms are left out. */
export function buildBoard(
  properties: Property[],
  propertyIds: string[],
  rooms: Room[],
  leases: Lease[],
  tenantsById: Map<string, Tenant>,
  invoices: Invoice[],
  payments: Payment[],
  todayISO: string,
): BoardGroup[] {
  const groups: BoardGroup[] = []
  for (const property of properties) {
    if (!propertyIds.includes(property.id)) continue
    const own = sortRoomsNatural(rooms.filter((r) => r.property_id === property.id))
    if (own.length === 0) continue
    const tiles = own.map<BoardTile>((room) => {
      const state = roomDisplayState(room, leases, tenantsById, invoices, payments, todayISO)
      const summary = state.occupancy === 'occupied' && state.lease ? summarizeLeaseBilling(state.lease, invoices, payments, todayISO) : null
      const days = daysToDue(summary, todayISO)
      const tone = boardTone(state.kind, days)
      return { room, tone, caption: boardCaption(tone, days), days, lease: state.lease, tenant: state.tenant, summary }
    })
    groups.push({ property, tiles })
  }
  return groups
}

/** Tiles per tone over all groups, for the legend. */
export function countTones(groups: BoardGroup[]): Record<BoardTone, number> {
  const counts = Object.fromEntries(BOARD_TONES.map((t) => [t, 0])) as Record<BoardTone, number>
  for (const g of groups) for (const t of g.tiles) counts[t.tone]++
  return counts
}

/** Deep links into the lease page, which opens the existing dialog itself (LeaseDetailPage `?action=`). */
export function leaseActionLink(leaseId: string, action: 'bayar' | 'tagih' | 'checkout'): string {
  return `/sewa/${leaseId}?action=${action}`
}
