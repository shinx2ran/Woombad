/**
 * Ringkasan WhatsApp (SPEC 7.18): the room board as a short message the owner sends to his wife or to the staff group:
 * rooms whose rent is late, what happens today (due, leaving, check-in) and what is due soon. Pure: built from the same
 * BoardGroup tiles the board draws, so the message and the colours never disagree.
 */
import { daysBetween } from '../../domain/period'
import { formatDate } from '../../lib/format'
import { PERIOD_TYPE_LABEL, type PeriodType } from '../../types/db'
import { BOARD_SOON_DAYS, boardTone, type BoardGroup, type BoardTile } from './boardModel'

export const SUMMARY_ALL_CLEAR = 'Semua kamar aman hari ini ✅'
/** closes a message that has something to act on (the owner's wording) */
export const SUMMARY_FOLLOW_UP = 'Mohon ditindaklanjuti.'

type Section = 'telat' | 'hariIni' | 'segera'
const SECTION_TITLE: Record<Section, string> = { telat: 'Telat bayar', hariIni: 'Hari ini', segera: 'Segera' }
const SECTIONS: Section[] = ['telat', 'hariIni', 'segera']

interface Line {
  section: Section
  /** for ordering inside a section: most urgent first */
  rank: number
  text: string
}

/** 'Kamar 5D'; a room already named 'Kamar 5D' is not doubled */
export function roomLabel(name: string): string {
  return /^kamar\b/i.test(name.trim()) ? name.trim() : `Kamar ${name.trim()}`
}

const period = (type: PeriodType | undefined) => (type ? PERIOD_TYPE_LABEL[type].toLowerCase() : '')
/** a daily stay ends ("habis sewa"); a weekly or monthly one falls due ("jatuh tempo") */
const dueWord = (type: PeriodType | undefined) => (type === 'daily' ? 'habis sewa' : 'jatuh tempo')
const inDays = (days: number) => (days === 0 ? 'hari ini' : days === 1 ? 'besok' : `${days} hari lagi`)

function who(tile: BoardTile): string {
  const room = roomLabel(tile.room.name)
  const name = tile.tenant?.full_name.trim()
  return name ? `${room} (${name})` : room
}

/**
 * The message lines of one tile (none for a quiet room). A stay that starts today is an occupied tile from its first
 * day (never 'reserved'), so an arrival is told apart by the lease's start date; a room under repair with a tenant
 * still in it is reported like any occupied room (the tenant's rent is late all the same), marked "· perbaikan".
 */
function tileLines(tile: BoardTile, today: string): Line[] {
  const lease = tile.lease
  if (!lease || !tile.summary || tile.days === null) return []
  const type = lease.period_type
  const tail = ` (${period(type)})`
  const repair = tile.tone === 'maintenance' ? ' · perbaikan' : ''
  const tone = tile.tone === 'maintenance' ? boardTone('occupied', tile.days) : tile.tone
  // a checkout recorded ahead of time (status ended, checkout_date still ahead) keeps the room until that day, and the
  // board then counts down to it as if rent fell due; nothing is due from a tenant who has checked out: say when he goes
  if (lease.status !== 'active') {
    const out = lease.checkout_date?.slice(0, 10)
    if (!out || out < today) return []
    if (out === today) return [{ section: 'hariIni', rank: 2, text: `${who(tile)} keluar hari ini${tail}${repair}` }]
    const inN = daysBetween(today, out)
    return inN <= BOARD_SOON_DAYS ? [{ section: 'segera', rank: inN, text: `${who(tile)} keluar ${formatDate(out, 'd MMM')}${tail}${repair}` }] : []
  }
  const leavingToday = tile.plannedCheckout === today
  // the tenant checks in today: say so, and whether the first payment is still open (then the tile is 'today').
  // "belum lunas", not "belum bayar": the summary only knows what is still owed, and the staff may have taken a DP
  if (lease.start_date.slice(0, 10) === today) {
    const unpaid = tone === 'today' && tile.summary.outstanding > 0 ? ' · belum lunas' : ''
    return [{ section: 'hariIni', rank: 3, text: `${who(tile)} check-in hari ini${tail}${unpaid}${repair}` }]
  }
  if (tone === 'overdue') {
    const extra = leavingToday ? ' · rencana keluar hari ini' : ''
    return [{ section: 'telat', rank: tile.days, text: `${who(tile)} telat ${-tile.days} hari${tail}${extra}${repair}` }]
  }
  // leaving today: that is today's news, whatever falls due
  if (leavingToday) return [{ section: 'hariIni', rank: 2, text: `${who(tile)} rencana keluar hari ini${tail}${repair}` }]
  if (tone === 'today') return [{ section: 'hariIni', rank: 1, text: `${who(tile)} ${dueWord(type)} hari ini${tail}${repair}` }]
  // a move-out within the week is news whatever the tile's colour or caption (the board shows 'Keluar 24 Nov' on blue
  // tiles too, but not in a repair room), ranked by the day he leaves; when rent falls due BEFORE he leaves, the money
  // is the headline and the plan rides along, like the overdue line (the tile stays orange for that reason)
  const leavesIn = tile.plannedCheckout && tile.plannedCheckout > today ? daysBetween(today, tile.plannedCheckout) : null
  const leavesOn = leavesIn !== null && leavesIn <= BOARD_SOON_DAYS ? `rencana keluar ${formatDate(tile.plannedCheckout, 'd MMM')}` : null
  if (tone === 'soon' && (leavesIn === null || tile.days < leavesIn)) {
    const plan = leavesOn ? ` · ${leavesOn}` : ''
    return [{ section: 'segera', rank: tile.days, text: `${who(tile)} ${dueWord(type)} ${inDays(tile.days)}${tail}${plan}${repair}` }]
  }
  if (leavesOn) return [{ section: 'segera', rank: leavesIn as number, text: `${who(tile)} ${leavesOn}${tail}${repair}` }]
  return []
}

function sectionBlocks(tiles: BoardTile[], today: string): string[] {
  const lines = tiles.flatMap((t) => tileLines(t, today))
  const blocks: string[] = []
  for (const s of SECTIONS) {
    const own = lines.filter((l) => l.section === s).sort((a, b) => a.rank - b.rank)
    if (own.length > 0) blocks.push([SECTION_TITLE[s], ...own.map((l) => `• ${l.text}`)].join('\n'))
  }
  return blocks
}

/**
 * The WhatsApp message for the board as shown (the kos filter applies): a title with the kos (or organisation) name
 * and today's date, then Telat bayar / Hari ini / Segera; one block per kos when several are shown. WhatsApp marks
 * *bold* and _italic_.
 */
export function boardSummaryText(groups: BoardGroup[], today: string, orgName: string): string {
  const title = `*${groups.length === 1 ? groups[0].property.name : orgName}* · ${formatDate(today, 'EEEE, d MMM yyyy')}`
  const parts: string[] = [title]
  if (groups.length === 1) {
    parts.push(...sectionBlocks(groups[0].tiles, today))
  } else {
    for (const g of groups) {
      const blocks = sectionBlocks(g.tiles, today)
      if (blocks.length > 0) parts.push([`_${g.property.name}_`, ...blocks].join('\n\n'))
    }
  }
  // something to act on ends with the owner's request; a quiet day needs none
  parts.push(parts.length > 1 ? SUMMARY_FOLLOW_UP : SUMMARY_ALL_CLEAR)
  return parts.join('\n\n')
}

/**
 * A WhatsApp link without a number: WhatsApp (or WhatsApp Business) opens with the text and asks which chat or group.
 * api.whatsapp.com rather than wa.me: wa.me's redirect re-encodes the text and turns every emoji (the ✅) into "�"
 * (measured 7 Nov 2026 with Android and iPhone user agents); api.whatsapp.com/send keeps it.
 */
export function whatsappShareLink(text: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`
}
