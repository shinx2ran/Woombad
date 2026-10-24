/**
 * Daftar tunggu (SPEC 7.7): people waiting for a room. Pure helpers for the list, its live room matches (the same
 * availability search as the planner), the WhatsApp "Kabari" text and the add/edit form.
 */
import type { Lease, OrgInsert, PeriodType, Room, Update, WaitlistEntry, WaitlistStatus } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { formatCheckout, formatDate, formatRupiah, formatStay, normalizePhone } from '../../lib/format'
import { isPlausiblePhone } from '../tenants/tenantUtils'
import { findAvailability, type FreeRoom, type PlannedStay, type StayRequest, type TenantNames } from './availability'
import { plannerSearch } from './rencanaParams'

// ---------- the stay an entry asks for ----------

/** First night wanted as of today: 'secepatnya' (null) and a wanted day already past both mean today. */
export function waitlistStart(entry: Pick<WaitlistEntry, 'wanted_from'>, today: string): string {
  return entry.wanted_from && entry.wanted_from > today ? entry.wanted_from : today
}

export function waitlistRequest(entry: WaitlistEntry, today: string): StayRequest {
  return { periodType: entry.period_type, start: waitlistStart(entry, today), quantity: entry.quantity, maxPrice: entry.max_price }
}

/** '/rencana?…' that books for this entry: the planner opens with its dates, duration and budget. */
export function plannerLinkFor(entry: WaitlistEntry, today: string): string {
  const r = waitlistRequest(entry, today)
  return `/rencana${plannerSearch({ periodType: r.periodType, start: r.start, quantity: r.quantity, maxPrice: r.maxPrice, waitlistId: entry.id })}`
}

// ---------- list ----------

/** Waiting entries first: 'secepatnya' on top, then the soonest wanted day, then the oldest entry; then the rest, newest change first. */
export function sortWaitlist(entries: readonly WaitlistEntry[]): WaitlistEntry[] {
  const rank = (e: WaitlistEntry) => (e.status === 'waiting' ? 0 : 1)
  return [...entries].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.status === 'waiting') {
      const aw = a.wanted_from ?? ''
      const bw = b.wanted_from ?? ''
      if (aw !== bw) return aw < bw ? -1 : 1
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    }
    return a.updated_at > b.updated_at ? -1 : a.updated_at < b.updated_at ? 1 : 0
  })
}

/** Entries the global kos filter shows: entries for any kos, and entries for one of the shown kos. */
export function inKosFilter(entry: Pick<WaitlistEntry, 'property_id'>, propertyIds: readonly string[]): boolean {
  return entry.property_id === null || propertyIds.includes(entry.property_id)
}

export interface WaitlistMatchInput {
  rooms: readonly Room[]
  leases: readonly Lease[]
  today: string
  /** kos shown (global filter): where an entry for any kos may go */
  propertyIds: readonly string[]
  tenants?: TenantNames
}

export interface WaitlistMatch {
  stay: PlannedStay | null
  /** rooms free for the whole stay within budget, best fit first */
  rooms: FreeRoom[]
}

/** Live matches of a waiting entry: its own kos, or every shown kos for an entry for any kos. */
export function waitlistMatches(entry: WaitlistEntry, input: WaitlistMatchInput): WaitlistMatch {
  const result = findAvailability({
    rooms: input.rooms,
    leases: input.leases,
    request: waitlistRequest(entry, input.today),
    today: input.today,
    propertyIds: entry.property_id ? [entry.property_id] : input.propertyIds,
    tenants: input.tenants,
  })
  return { stay: result?.stay ?? null, rooms: result?.free ?? [] }
}

/** 'Kamar cocok: A3, B1 (Rp 360.000)', '… (mulai Rp 300.000)', '+2 lainnya'; 'Belum ada kamar' without a match. */
export function matchText(rooms: readonly FreeRoom[]): string {
  if (rooms.length === 0) return 'Belum ada kamar'
  const shown = rooms.slice(0, 3)
  const more = rooms.length - shown.length
  const totals = shown.map((r) => r.total).filter((t): t is number => t !== null)
  const min = totals.length ? Math.min(...totals) : null
  const price = min === null ? '' : totals.every((t) => t === min) && totals.length === shown.length ? ` (${formatRupiah(min)})` : ` (mulai ${formatRupiah(min)})`
  return `Kamar cocok: ${shown.map((r) => r.room.name).join(', ')}${more > 0 ? ` +${more} lainnya` : ''}${price}`
}

/** 'Secepatnya · 2 malam · maks. Rp 150.000 / malam' or 'Mulai 5 Nov 2026 · 1 minggu (check-out 12 Nov 2026)'. */
export function wantText(entry: WaitlistEntry, stay?: PlannedStay | null): string {
  const unit = PERIOD_UNIT_LABEL[entry.period_type]
  const when = entry.wanted_from ? `Mulai ${formatDate(entry.wanted_from)}` : 'Secepatnya'
  const duration = `${entry.quantity} ${unit}${entry.wanted_from && stay ? ` (check-out ${formatCheckout(stay.end)})` : ''}`
  const budget = entry.max_price !== null ? `maks. ${formatRupiah(entry.max_price)} / ${unit}` : null
  return [when, duration, budget].filter(Boolean).join(' · ')
}

/** Counts for the Dashboard card: waiting entries, and how many of them a free room fits now. */
export function waitlistCounts(entries: readonly WaitlistEntry[], input: WaitlistMatchInput): { waiting: number; withRoom: number } {
  let waiting = 0
  let withRoom = 0
  for (const e of entries) {
    if (e.status !== 'waiting' || !inKosFilter(e, input.propertyIds)) continue
    waiting++
    if (waitlistMatches(e, input).rooms.length > 0) withRoom++
  }
  return { waiting, withRoom }
}

// ---------- Kabari (WhatsApp) ----------

export interface KabariInput {
  name: string
  roomName: string
  propertyName: string
  stay: PlannedStay
  /** price of the whole stay; null when the room has no rate */
  total: number | null
}

const honorific = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first ? `Kak ${first}` : 'Kak'
}

/** WhatsApp text telling a waiting guest a room is free: greeting, room, dates with the check-out day, price, kos. */
export function kabariText({ name, roomName, propertyName, stay, total }: KabariInput): string {
  const unit = PERIOD_UNIT_LABEL[stay.periodType]
  const lines = [
    `Halo ${honorific(name)}, ini dari ${propertyName}.`,
    `Kabar baik: kamar ${roomName} kosong untuk ${formatStay(stay.start, stay.end, { full: true })} (${stay.quantity} ${unit}, check-out ${formatCheckout(stay.end)}).`,
  ]
  if (total !== null) lines.push(`Harganya ${formatRupiah(total)} untuk ${stay.quantity} ${unit}.`)
  lines.push('Kalau jadi, balas pesan ini ya, nanti kamarnya kami pesankan. Terima kasih 🙏')
  return lines.join('\n')
}

// ---------- form ----------

export interface WaitlistForm {
  name: string
  phone: string
  /** '' = any kos */
  propertyId: string
  /** true = 'secepatnya' (wanted_from null) */
  asap: boolean
  wantedFrom: string
  periodType: PeriodType
  quantity: number
  /** 0 = no budget */
  maxPrice: number
  roomNote: string
  notes: string
}

export function emptyWaitlistForm(today: string, propertyId = ''): WaitlistForm {
  return { name: '', phone: '', propertyId, asap: false, wantedFrom: today, periodType: 'daily', quantity: 1, maxPrice: 0, roomNote: '', notes: '' }
}

export function entryToForm(entry: WaitlistEntry, today: string): WaitlistForm {
  return {
    name: entry.name,
    phone: entry.phone ?? '',
    propertyId: entry.property_id ?? '',
    asap: entry.wanted_from === null,
    wantedFrom: entry.wanted_from ?? today,
    periodType: entry.period_type,
    quantity: entry.quantity,
    maxPrice: entry.max_price ?? 0,
    roomNote: entry.room_note ?? '',
    notes: entry.notes ?? '',
  }
}

export type WaitlistFormErrors = Partial<Record<'name' | 'phone' | 'wantedFrom' | 'quantity' | 'maxPrice', string>>

export function validateWaitlistForm(form: WaitlistForm): WaitlistFormErrors {
  const errors: WaitlistFormErrors = {}
  if (!form.name.trim()) errors.name = 'Nama wajib diisi.'
  const phone = normalizePhone(form.phone)
  if (form.phone.trim() && (!phone || !isPlausiblePhone(phone))) errors.phone = 'Nomor HP tidak valid. Contoh: 0812-3456-7890.'
  if (!form.asap && !/^\d{4}-\d{2}-\d{2}$/.test(form.wantedFrom)) errors.wantedFrom = 'Isi tanggal mulai, atau pilih Secepatnya.'
  if (!Number.isInteger(form.quantity) || form.quantity < 1) errors.quantity = 'Minimal 1.'
  if (form.maxPrice < 0) errors.maxPrice = 'Harga tidak boleh negatif.'
  return errors
}

/** The columns a form writes (insert: a waiting entry; update: everything but status and lease). */
function formColumns(form: WaitlistForm): Omit<OrgInsert<'waitlist'>, 'status' | 'lease_id'> {
  return {
    property_id: form.propertyId || null,
    name: form.name.trim().replace(/\s+/g, ' '),
    phone: form.phone.trim() ? normalizePhone(form.phone) : null,
    wanted_from: form.asap ? null : form.wantedFrom,
    period_type: form.periodType,
    quantity: form.quantity,
    max_price: form.maxPrice > 0 ? form.maxPrice : null,
    room_note: form.roomNote.trim() || null,
    notes: form.notes.trim() || null,
  }
}

export function formToWaitlistInsert(form: WaitlistForm): OrgInsert<'waitlist'> {
  return { ...formColumns(form), status: 'waiting', lease_id: null }
}

export function formToWaitlistPatch(form: WaitlistForm): Update<'waitlist'> {
  return formColumns(form)
}

/** Filter chips of the list. */
export const WAITLIST_FILTERS: { status: WaitlistStatus; label: string }[] = [
  { status: 'waiting', label: 'Menunggu' },
  { status: 'booked', label: 'Sudah dipesan' },
  { status: 'cancelled', label: 'Batal' },
]
