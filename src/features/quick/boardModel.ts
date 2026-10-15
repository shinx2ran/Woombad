/**
 * Papan kamar (SPEC 7.4): one tile per room, coloured by what the owner has to do there. Pure; built from the same
 * functions the Kos & Kamar page (roomDisplayState) and the lease list (summarizeLeaseBilling, displayBillingState)
 * already use, so the board never disagrees with those screens.
 */
import { summarizeLeaseBilling, type LeaseBillingSummary } from '../../domain/billing'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import { displayBillingState } from '../leases/leaseUtils'
import { roomDisplayState, sortRoomsNatural } from '../properties/roomUtils'

export type BoardTone = 'vacant' | 'occupied' | 'due' | 'overdue' | 'ending' | 'reserved' | 'maintenance'

/** Short word under the room name (fits a 52px tile) and the legend text. */
export const BOARD_TONE_META: Record<BoardTone, { caption: string; legend: string }> = {
  vacant: { caption: 'Kosong', legend: 'Kosong' },
  occupied: { caption: 'Terisi', legend: 'Terisi, aman' },
  due: { caption: 'Tempo', legend: 'Jatuh tempo' },
  overdue: { caption: 'Telat', legend: 'Telat bayar' },
  ending: { caption: 'Keluar', legend: 'Check-out ≤ 7 hari' },
  reserved: { caption: 'Dipesan', legend: 'Dipesan' },
  maintenance: { caption: 'Perbaikan', legend: 'Perbaikan' },
}

/** Legend order: what needs action first. */
export const BOARD_TONES: BoardTone[] = ['overdue', 'due', 'ending', 'occupied', 'vacant', 'reserved', 'maintenance']

export interface BoardTile {
  room: Room
  tone: BoardTone
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

export function boardTone(kind: 'occupied' | 'reserved' | 'vacant' | 'maintenance', lease: Lease | null, summary: LeaseBillingSummary | null, todayISO: string): BoardTone {
  if (kind === 'maintenance') return 'maintenance'
  if (kind === 'vacant') return 'vacant'
  if (kind === 'reserved') return 'reserved'
  if (!lease || !summary) return 'occupied'
  switch (displayBillingState(lease, summary, todayISO)) {
    case 'overdue':
      return 'overdue'
    // an active lease with nothing billed yet is due from its start (summarizeLeaseBilling), like on the lease list
    case 'due_soon':
    case 'unbilled':
      return 'due'
    case 'ending':
      return 'ending'
    default:
      return 'occupied'
  }
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
      return { room, tone: boardTone(state.kind, state.lease, summary, todayISO), lease: state.lease, tenant: state.tenant, summary }
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
