/**
 * Rencana check-in (SPEC 7.7, 7.8): which rooms are free for a planned stay, best fit first, which may become free, and
 * why the others are not. Pure: no React, no I/O. The planner page, the booking re-check and the daftar tunggu matches all
 * use it.
 *
 * What holds a room (the double-booking rule of SPEC 2b.8 / leaseOverlaps with the dates of SPEC 7.3):
 *  - a cancelled lease holds nothing;
 *  - an ended lease holds [start_date, checkout_date - 1] (end_date when no checkout date was recorded): the room is
 *    free again ON the check-out day (same-day turnover);
 *  - a daily or weekly booking that has not started yet (active, start_date after today: "Dipesan") holds
 *    [start_date, end_date];
 *  - a guest staying now (active, start_date on or before today) on a daily or weekly stay holds [start_date, end_date]:
 *    the guest is expected to leave on the check-out day end_date + 1 (shown as "masih menginap" so the owner knows);
 *  - a monthly tenant, booked ("Dipesan") or staying now, without a Rencana keluar (SPEC 7.8), and a guest whose
 *    check-out day has passed without a recorded checkout, hold the room from start_date until the checkout is recorded
 *    (an active lease occupies its room without an upper bound, SPEC 2a): a monthly tenant rolls on from month to month;
 *  - a monthly tenant WITH a Rencana keluar (planned_checkout_date, a check-out day) holds [start_date, planned - 1], but
 *    never less than his billed period [start_date, end_date] (the database guard holds the room through end_date until
 *    the checkout is recorded): the planned check-out day itself is free. Once that day has passed without a recorded
 *    checkout he rolls on again (still in the room).
 * A hold without a night (an ended lease checked out on its first day) holds nothing. Rooms under maintenance are never
 * offered. A stay from today is never put in a room whose guest is still checked in (Check-in cepat's rule, SPEC 7.4):
 * a guest whose check-out day is today holds the room until that checkout is recorded. This is never looser than the
 * database guard (leases_overlap_guard), which uses end_date for active leases.
 *
 * "Bisa kosong" (SPEC 7.8): a room held only by a rolling monthly tenant without a Rencana keluar whose billed period ends
 * before the stay (end_date < check-in) is not free, but would be if he leaves at the end of it: the owner asks him
 * (WhatsApp) and records his Rencana keluar, after which the room is offered.
 */
import type { Lease, PeriodType, Room, Tenant } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { compareRoomNames, leaseOccupiedUntil, plannedCheckoutOf } from '../../domain/occupancy'
import { addDaysISO, daysBetween, periodEnd } from '../../domain/period'
import { formatDate, formatRupiah } from '../../lib/format'
import { roomPriceFor } from '../leases/leaseUtils'

// ---------- the stay ----------

export interface StayRequest {
  periodType: PeriodType
  /** check-in day = first night ('YYYY-MM-DD') */
  start: string
  /** nights, weeks or months (>= 1) */
  quantity: number
  /** highest price per night / week / month the guest wants to pay; null or undefined = any */
  maxPrice?: number | null
}

export interface PlannedStay {
  start: string
  /** last night (stored as lease.end_date / period_end, SPEC 7.3) */
  end: string
  /** check-out day = end + 1 (what people read as the end of a stay) */
  checkout: string
  nights: number
  periodType: PeriodType
  quantity: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The nights of a planned stay: `quantity` periods of `periodType` from `start` (periodEnd); null when not computable. */
export function plannedStay(start: string, periodType: PeriodType, quantity: number): PlannedStay | null {
  if (!ISO_DAY.test(start) || !Number.isInteger(quantity) || quantity < 1) return null
  try {
    const end = periodEnd(start, periodType, quantity)
    return { start, end, checkout: addDaysISO(end, 1), nights: daysBetween(start, end) + 1, periodType, quantity }
  } catch {
    return null
  }
}

// ---------- what holds a room ----------

/** 'occupied' = somebody stays there now (or stayed); 'reserved' = booked, not started yet ("Dipesan"). */
export type HoldKind = 'occupied' | 'reserved'

export interface RoomHold {
  lease: Lease
  /** first night held */
  start: string
  /** last night held; null = until a checkout is recorded */
  end: string | null
  kind: HoldKind
  /**
   * somebody staying now whose check-out day (end + 1) is not recorded yet: a daily/weekly guest, or a monthly tenant
   * with a Rencana keluar
   */
  expectedLeave: boolean
  /** the hold ends at a monthly tenant's Rencana keluar (SPEC 7.8) */
  plannedLeave: boolean
}

const laterDay = (a: string, b: string) => (a > b ? a : b)

/** The nights a lease holds its room as seen on `today` (see the file comment); null when it holds none. */
export function leaseHold(lease: Lease, today: string): RoomHold | null {
  if (lease.status === 'cancelled') return null
  const start = lease.start_date.slice(0, 10)
  const kind: HoldKind = start <= today ? 'occupied' : 'reserved'
  const hold = (end: string | null, expectedLeave = false, plannedLeave = false): RoomHold => ({ lease, start, end, kind, expectedLeave, plannedLeave })
  if (lease.status === 'ended') {
    const end = leaseOccupiedUntil(lease)!
    return end < start ? null : hold(end)
  }
  const end = lease.end_date.slice(0, 10)
  if (lease.period_type === 'monthly') {
    const planned = plannedCheckoutOf(lease)
    // no Rencana keluar: he rolls on from month to month, from the first night of the booking on (booked or staying)
    if (!planned || planned <= start) return hold(null)
    // his planned day passed without a recorded checkout: he is still in the room (also when the plan fell inside his
    // billed period: the plan, not the billing, says when he leaves)
    if (kind === 'occupied' && planned < today) return hold(null)
    // free from his planned check-out day, never before the end of his billed period (the database guard's rule)
    const lastNight = laterDay(addDaysISO(planned, -1), end)
    return hold(lastNight, kind === 'occupied', true)
  }
  if (kind === 'reserved') return hold(end)
  // staying now: a guest past the check-out day without a checkout is still in the room
  if (addDaysISO(end, 1) < today) return hold(null)
  return hold(end, true)
}

/** Every hold on the room, earliest first. `leases` may contain other rooms' leases. */
export function roomHolds(roomId: string, leases: readonly Lease[], today: string): RoomHold[] {
  const holds: RoomHold[] = []
  for (const l of leases) {
    if (l.room_id !== roomId) continue
    const h = leaseHold(l, today)
    if (h) holds.push(h)
  }
  return holds.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
}

/** True when the hold covers the night of `day`. */
export function holdsNight(hold: RoomHold, day: string): boolean {
  return hold.start <= day && (hold.end === null || day <= hold.end)
}

/** Holds that take at least one night of [start, end] (inclusive), earliest first. */
export function holdsWithin(holds: readonly RoomHold[], start: string, end: string): RoomHold[] {
  return holds.filter((h) => h.start <= end && (h.end === null || h.end >= start))
}

/**
 * Check-in cepat's rule for a stay from today (SPEC 7.4): a daily/weekly guest whose check-out day is the check-in day is
 * still in the room until that checkout is recorded, so the room is not free for a check-in now (a later stay may count
 * on the planned check-out). The guest's hold, or undefined.
 */
export function stillCheckedIn(holds: readonly RoomHold[], stay: Pick<PlannedStay, 'start'>, today: string): RoomHold | undefined {
  if (stay.start > today) return undefined
  return holds.find((h) => h.expectedLeave && h.start <= stay.start && h.end !== null && h.end < stay.start)
}

// ---------- texts ----------

export type TenantNames = ReadonlyMap<string, Pick<Tenant, 'full_name'>>

const shortDay = (iso: string) => formatDate(iso, 'd MMM')

/** Nights [start, lastNight] read as a stay, check-in – check-out (SPEC 7.3): '5–9 Nov', '28 Okt – 2 Nov'. */
export function shortStay(start: string, lastNight: string): string {
  const out = addDaysISO(lastNight, 1)
  if (start.slice(0, 7) === out.slice(0, 7)) return `${formatDate(start, 'd')}–${shortDay(out)}`
  return `${shortDay(start)} – ${shortDay(out)}`
}

/** Calendar days [a, b] (both included): '13 Nov', '5–8 Nov', '30 Okt – 2 Nov'. */
export function dayRange(a: string, b: string): string {
  if (a === b) return shortDay(a)
  if (a.slice(0, 7) === b.slice(0, 7)) return `${formatDate(a, 'd')}–${shortDay(b)}`
  return `${shortDay(a)} – ${shortDay(b)}`
}

function nameOf(hold: RoomHold, names?: TenantNames): string {
  return names?.get(hold.lease.tenant_id)?.full_name ?? 'penyewa lain'
}

/**
 * 'dipesan Budi 5–9 Nov', 'ditempati Sari sampai 7 Nov', 'ditempati Sari sampai check-out dicatat', 'dipesan Zaki mulai
 * 1 Nov (bulanan)' (lower case).
 */
export function holdText(hold: RoomHold, names?: TenantNames): string {
  const who = nameOf(hold, names)
  if (hold.end === null) return hold.kind === 'reserved' ? `dipesan ${who} mulai ${shortDay(hold.start)} (bulanan)` : `ditempati ${who} sampai check-out dicatat`
  if (hold.kind === 'reserved') return `dipesan ${who} ${shortStay(hold.start, hold.end)}`
  return `ditempati ${who} sampai ${shortDay(addDaysISO(hold.end, 1))}`
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** 'Rp 100.000 / malam', or 'Harga belum diatur' for a room without a rate for the type. */
export function rateText(rate: number | null, periodType: PeriodType): string {
  return rate === null ? 'Harga belum diatur' : `${formatRupiah(rate)} / ${PERIOD_UNIT_LABEL[periodType]}`
}

// ---------- the search ----------

export interface FreeRoom {
  room: Room
  /** the room's price per night / week / month for the stay's type; null = not set */
  rate: number | null
  /** rate x quantity; null when the room has no rate (the total is typed in the booking sheet) */
  total: number | null
  /** idle nights between the stay's check-out day and the room's next booking; null = nothing booked after it */
  gapAfter: number | null
  /** idle nights from when the room is free (today at the earliest) to the check-in day */
  gapBefore: number
  /** the booking right after the stay, if any */
  next: RoomHold | null
  /** the stay right before the stay, if any */
  previous: RoomHold | null
  /**
   * 'Pas sebelum pesanan 12 Nov', 'Sisa 3 malam sebelum pesanan 15 Nov'; with nothing booked after the stay 'Kosong
   * mulai 5 Nov (setelah Sari check-out)' while somebody is (or will be) in the room before it, 'Kosong mulai 20 Nov
   * (Budi akan keluar)' after a Rencana keluar, and 'Kosong sampai seterusnya' only for a room empty from today on
   */
  reason: string
  /**
   * about the guest before: 'Sari masih menginap, jadwal check-out 5 Nov', 'Budi masih menginap, rencana keluar 20 Nov',
   * 'Langsung setelah Sari check-out'; or null
   */
  note: string | null
}

export interface PartialRoom {
  room: Room
  rate: number | null
  total: number | null
  /** free nights within the stay */
  freeNights: number
  /** 'Kosong 5–9 Nov, lalu dipesan Budi', 'Ditempati Sari sampai 7 Nov, lalu kosong 7–12 Nov' */
  reason: string
}

export interface TakenRoom {
  room: Room
  /** 'Dipesan Budi 5–9 Nov', 'Ditempati Sari sampai check-out dicatat', 'Sedang perbaikan' */
  reason: string
}

/** "Bisa kosong" (SPEC 7.8): held by a monthly tenant who has not said whether he extends; free if he leaves. */
export interface MaybeFreeRoom {
  room: Room
  rate: number | null
  total: number | null
  /** the monthly lease (active, no Rencana keluar) whose billed period ends before the stay */
  lease: Lease
  /** last billed night (lease.end_date, SPEC 7.3) */
  paidThrough: string
  /** its check-out day: the room is free from then if he leaves (the Rencana keluar sheet starts there) */
  checkout: string
  /** days since that check-out day once it is today or past (the next month is not billed: "belum diperpanjang"), else null */
  lapsedDays: number | null
}

export interface Availability {
  stay: PlannedStay
  /** "Kosong untuk seluruh tanggal", best fit first */
  free: FreeRoom[]
  /**
   * "Bisa kosong — penyewa bulanan belum konfirmasi": rooms held only by a monthly tenant without a Rencana keluar whose
   * billed period ends before the check-in day, free for the whole stay if he leaves then; earliest paid-through first,
   * then room name; within budget. They are not free, so each is also listed in `taken`.
   */
  maybeFree: MaybeFreeRoom[]
  /** "Hampir cocok": free for part of the stay, most free nights first (at most `maxPartial`) */
  partial: PartialRoom[]
  /** rooms without a free night of the stay (or under maintenance, or for a check-in today still checked in), by room name */
  taken: TakenRoom[]
  /** rooms left out because their rate is above maxPrice */
  overBudget: number
}

export interface AvailabilityInput {
  rooms: readonly Room[]
  leases: readonly Lease[]
  request: StayRequest
  /** the device's today: decides who is staying now and who has only booked */
  today: string
  /** only rooms of these kos (the global kos filter); undefined = every room given */
  propertyIds?: readonly string[]
  /** only this room ("Pesan tanggal lain" on the room board) */
  roomId?: string | null
  /** tenant names for the reasons */
  tenants?: TenantNames
  /** most "Hampir cocok" rooms returned (default 5) */
  maxPartial?: number
}

export const MAX_PARTIAL = 5

interface Run {
  start: string
  end: string
}

/** Free runs of nights inside [start, end] around the given holds (which all overlap it). */
function freeRuns(conflicts: readonly RoomHold[], start: string, end: string): Run[] {
  const runs: Run[] = []
  let cursor: string | null = start
  for (const h of conflicts) {
    const from = h.start > start ? h.start : start
    if (from > cursor) runs.push({ start: cursor, end: addDaysISO(from, -1) })
    if (h.end === null) {
      cursor = null
      break
    }
    const after = addDaysISO(h.end, 1)
    if (after > cursor) cursor = after
  }
  if (cursor !== null && cursor <= end) runs.push({ start: cursor, end })
  return runs
}

const nightsOf = (run: Run) => daysBetween(run.start, run.end) + 1

function cmpNullableAsc(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function cmpRoom(a: Room, b: Room): number {
  return compareRoomNames(a.name, b.name) || (a.property_id < b.property_id ? -1 : a.property_id > b.property_id ? 1 : 0)
}

function freeRoomFor(room: Room, holds: RoomHold[], stay: PlannedStay, rate: number | null, today: string, names?: TenantNames): FreeRoom {
  const next = holds.find((h) => h.start > stay.end) ?? null
  let previous: RoomHold | null = null
  for (const h of holds) if (h.end !== null && h.end < stay.start && (previous === null || h.end > previous.end!)) previous = h
  const gapAfter = next ? daysBetween(stay.checkout, next.start) : null
  const freeFrom = previous ? addDaysISO(previous.end!, 1) : today
  const from = freeFrom > today ? freeFrom : today
  const gapBefore = Math.max(0, daysBetween(from, stay.start))
  // the day the guest before leaves, and whether somebody is (or will be) in the room until then
  const out = previous ? addDaysISO(previous.end!, 1) : null
  const before = previous !== null && (previous.expectedLeave || out! > today) ? previous : null
  let reason: string
  if (next !== null) reason = gapAfter === 0 ? `Pas sebelum pesanan ${shortDay(next.start)}` : `Sisa ${gapAfter} malam sebelum pesanan ${shortDay(next.start)}`
  else if (before?.plannedLeave) reason = `Kosong mulai ${shortDay(out!)} (${nameOf(before, names)} akan keluar)`
  else if (before) reason = `Kosong mulai ${shortDay(out!)} (setelah ${nameOf(before, names)} check-out)`
  else reason = 'Kosong sampai seterusnya'
  let note: string | null = null
  if (previous?.expectedLeave && previous.plannedLeave) {
    // his own planned day (what the lease page says), and the billed check-out day when the plan falls before it
    const planned = plannedCheckoutOf(previous.lease) ?? out!
    note = `${nameOf(previous, names)} masih menginap, rencana keluar ${shortDay(planned)}${planned < out! ? ` (ditagih s/d ${shortDay(out!)})` : ''}`
  } else if (previous?.expectedLeave) note = `${nameOf(previous, names)} masih menginap, jadwal check-out ${shortDay(out!)}`
  else if (previous && out === stay.start) note = `Langsung setelah ${nameOf(previous, names)} check-out`
  return { room, rate, total: rate === null ? null : rate * stay.quantity, gapAfter, gapBefore, next, previous, reason, note }
}

function partialReason(run: Run, conflicts: RoomHold[], stay: PlannedStay, names?: TenantNames): string {
  const parts: string[] = []
  if (run.start > stay.start) {
    const before = conflicts.find((h) => holdsNight(h, addDaysISO(run.start, -1)))
    if (before) parts.push(holdText(before, names))
  }
  parts.push(`kosong ${shortStay(run.start, run.end)}`)
  if (run.end < stay.end) {
    const after = conflicts.find((h) => holdsNight(h, addDaysISO(run.end, 1)))
    if (after) parts.push(`${after.kind === 'reserved' ? 'dipesan' : 'ditempati'} ${nameOf(after, names)}`)
  }
  return capitalize(parts.join(', lalu '))
}

/** A monthly tenant without a Rencana keluar (rolling on) whose billed period ends before the stay starts. */
function unconfirmedMonthly(hold: RoomHold, stay: PlannedStay): boolean {
  const l = hold.lease
  return hold.end === null && l.status === 'active' && l.period_type === 'monthly' && !l.planned_checkout_date && l.end_date.slice(0, 10) < stay.start
}

/**
 * The monthly tenant who stands between the room and the stay when it is "Bisa kosong": the room's holds that take a
 * night of the stay are all such tenants, and as if each left on the check-out day of his billed period, nothing else
 * takes a night of the stay, nor, for a check-in today, is anybody still checked in — the tenant himself included, so a
 * check-in today never lists a tenant who is still in the room: only recording his checkout frees it (Check-in cepat),
 * exactly as after a Rencana keluar of today. Null otherwise.
 */
function maybeFreeHold(holds: readonly RoomHold[], conflicts: readonly RoomHold[], stay: PlannedStay, today: string): RoomHold | null {
  const soft = conflicts.filter((h) => unconfirmedMonthly(h, stay))
  if (soft.length === 0) return null
  const ifLeaving = holds.map((h) => (soft.includes(h) ? { ...h, end: h.lease.end_date.slice(0, 10), expectedLeave: h.kind === 'occupied' } : h))
  if (holdsWithin(ifLeaving, stay.start, stay.end).length > 0 || stillCheckedIn(ifLeaving, stay, today)) return null
  return soft.reduce((a, b) => (b.lease.end_date > a.lease.end_date ? b : a))
}

/**
 * Rooms for a planned stay: (1) free for every night, best fit first: the smallest idle gap left before the room's next
 * booking after the stay (null = nothing booked after it, last), then the smallest idle gap before the stay, then the
 * total price (no rate last), then the room name; (2) "Hampir cocok": free for some nights, most free nights first, at
 * most `maxPartial`; (3) the rest with the booking in the way, among them (4) "Bisa kosong" (maybeFreeHold): held only by
 * monthly tenants without a Rencana keluar whose billed period ends before the stay, earliest paid-through first.
 * Maintenance rooms are never free, nor for a check-in today a room whose guest's checkout of today is not recorded yet
 * (stillCheckedIn). A room whose rate is above `maxPrice` is left out of (1) and (2) and counted in overBudget, and left
 * out of (4); a room without a rate stays in (its price is unknown). Null when the stay itself cannot be computed.
 */
export function findAvailability(input: AvailabilityInput): Availability | null {
  const { request, today, tenants: names } = input
  const stay = plannedStay(request.start, request.periodType, request.quantity)
  if (!stay) return null
  const kos = input.propertyIds ? new Set(input.propertyIds) : null
  const maxPrice = request.maxPrice ?? null
  const free: FreeRoom[] = []
  const maybeFree: MaybeFreeRoom[] = []
  const partial: PartialRoom[] = []
  const taken: TakenRoom[] = []
  let overBudget = 0
  for (const room of input.rooms) {
    if (kos && !kos.has(room.property_id)) continue
    if (input.roomId && room.id !== input.roomId) continue
    if (room.status === 'maintenance') {
      taken.push({ room, reason: 'Sedang perbaikan' })
      continue
    }
    const holds = roomHolds(room.id, input.leases, today)
    const conflicts = holdsWithin(holds, stay.start, stay.end)
    const checkedIn = conflicts.length === 0 ? stillCheckedIn(holds, stay, today) : undefined
    if (checkedIn) {
      taken.push({ room, reason: capitalize(holdText({ ...checkedIn, end: null }, names)) })
      continue
    }
    const runs = freeRuns(conflicts, stay.start, stay.end)
    const rate = roomPriceFor(room, stay.periodType)
    const overMax = maxPrice !== null && rate !== null && rate > maxPrice
    if (runs.length === 0) {
      taken.push({ room, reason: capitalize(holdText(conflicts[0], names)) })
      const tenant = overMax ? null : maybeFreeHold(holds, conflicts, stay, today)
      if (tenant) {
        const paidThrough = tenant.lease.end_date.slice(0, 10)
        const checkout = addDaysISO(paidThrough, 1)
        maybeFree.push({
          room,
          rate,
          total: rate === null ? null : rate * stay.quantity,
          lease: tenant.lease,
          paidThrough,
          checkout,
          lapsedDays: checkout <= today ? daysBetween(checkout, today) : null,
        })
      }
      continue
    }
    if (overMax) {
      overBudget++
      continue
    }
    if (conflicts.length === 0) {
      free.push(freeRoomFor(room, holds, stay, rate, today, names))
      continue
    }
    const longest = runs.reduce((best, r) => (nightsOf(r) > nightsOf(best) ? r : best))
    partial.push({
      room,
      rate,
      total: rate === null ? null : rate * stay.quantity,
      freeNights: runs.reduce((n, r) => n + nightsOf(r), 0),
      reason: partialReason(longest, conflicts, stay, names),
    })
  }
  free.sort((a, b) => cmpNullableAsc(a.gapAfter, b.gapAfter) || a.gapBefore - b.gapBefore || cmpNullableAsc(a.total, b.total) || cmpRoom(a.room, b.room))
  maybeFree.sort((a, b) => (a.paidThrough < b.paidThrough ? -1 : a.paidThrough > b.paidThrough ? 1 : 0) || cmpRoom(a.room, b.room))
  partial.sort((a, b) => b.freeNights - a.freeNights || cmpNullableAsc(a.total, b.total) || cmpRoom(a.room, b.room))
  taken.sort((a, b) => cmpRoom(a.room, b.room))
  return { stay, free, maybeFree, partial: partial.slice(0, input.maxPartial ?? MAX_PARTIAL), taken, overBudget }
}

// ---------- the booking re-check ----------

export interface StayConflict {
  hold: RoomHold
  /** 'Kamar A3 sudah tidak kosong pada tanggal itu: dipesan Budi 5–9 Nov. Pilih kamar atau tanggal lain.' */
  message: string
}

/**
 * The first booking that takes a night of the stay in the room (checked on fresh rows right before a booking is
 * written), or for a check-in today the guest still checked in (stillCheckedIn); null when the room is free for every
 * night. Maintenance is the caller's check (room.status).
 */
export function stayConflict(room: Room, leases: readonly Lease[], stay: PlannedStay, today: string, names?: TenantNames): StayConflict | null {
  const holds = roomHolds(room.id, leases, today)
  const [hold] = holdsWithin(holds, stay.start, stay.end)
  if (hold) return { hold, message: `Kamar ${room.name} sudah tidak kosong pada tanggal itu: ${holdText(hold, names)}. Pilih kamar atau tanggal lain.` }
  const staying = stillCheckedIn(holds, stay, today)
  if (staying) {
    return {
      hold: staying,
      message: `Kamar ${room.name} masih ditempati ${nameOf(staying, names)}: check-out-nya belum dicatat. Catat check-out dulu, lalu coba lagi.`,
    }
  }
  return null
}

// ---------- the 14-day strip ----------

export type StripState = 'free' | 'occupied' | 'reserved' | 'checkout'

export interface StripDay {
  date: string
  /** the night of `date`: free, occupied (somebody staying), reserved (booked); 'checkout' = free, a guest leaves that day */
  state: StripState
  /** the night belongs to the planned stay */
  inStay: boolean
}

export const STRIP_DAYS = 14

export const STRIP_STATE_LABEL: Record<StripState, string> = {
  free: 'kosong',
  occupied: 'terisi',
  reserved: 'dipesan',
  checkout: 'hari check-out',
}

/** One cell per day from `from` (the check-in day), STRIP_DAYS long by default. */
export function availabilityStrip(holds: readonly RoomHold[], from: string, stay?: PlannedStay | null, days = STRIP_DAYS): StripDay[] {
  const cells: StripDay[] = []
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(from, i)
    const hold = holds.find((h) => holdsNight(h, date))
    const state: StripState = hold ? hold.kind : holds.some((h) => h.end !== null && addDaysISO(h.end, 1) === date) ? 'checkout' : 'free'
    cells.push({ date, state, inStay: stay ? date >= stay.start && date <= stay.end : false })
  }
  return cells
}

/** Text alternative of a strip: '5–8 Nov kosong; 9–12 Nov dipesan; 13 Nov hari check-out; 14–18 Nov kosong'. */
export function stripText(cells: readonly StripDay[]): string {
  const parts: string[] = []
  let i = 0
  while (i < cells.length) {
    let j = i
    while (j + 1 < cells.length && cells[j + 1].state === cells[i].state) j++
    parts.push(`${dayRange(cells[i].date, cells[j].date)} ${STRIP_STATE_LABEL[cells[i].state]}`)
    i = j + 1
  }
  return parts.join('; ')
}
