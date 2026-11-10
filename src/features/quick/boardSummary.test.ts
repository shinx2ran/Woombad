import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, PeriodType, Property, Room, Tenant } from '../../types/db'
import { buildBoard, type BoardGroup, type BoardTile, type BoardTone } from './boardModel'
import { SUMMARY_ALL_CLEAR, SUMMARY_FOLLOW_UP, boardSummaryText, roomLabel, whatsappShareLink } from './boardSummary'

// SPEC 7.18 Ringkasan WhatsApp: the board as a message for the wife or the staff group.
const TODAY = '2026-11-07' // a Saturday

const property = (name: string) => ({ id: name, name }) as Property
function tile(
  room: string,
  tone: BoardTone,
  opts: { name?: string; days?: number | null; period?: PeriodType; planned?: string | null; leavingOn?: string | null; start?: string } = {},
): BoardTile {
  const lease = opts.period ? ({ id: `l-${room}`, period_type: opts.period, start_date: opts.start ?? '2026-10-01', status: 'active', checkout_date: null } as Lease) : null
  // like buildBoard: a room under repair with a tenant still in it keeps his billing summary
  const living = tone !== 'vacant' && tone !== 'reserved'
  return {
    room: { id: room, name: room } as Room,
    tone,
    caption: '',
    days: opts.days ?? null,
    lease,
    tenant: opts.name ? ({ full_name: opts.name } as Tenant) : null,
    name: null,
    // like summarizeLeaseBilling: something is open on a 'today'/'overdue' tile, nothing on the others
    summary: living && lease ? ({ outstanding: tone === 'today' || tone === 'overdue' ? 130_000 : 0, paidThrough: null } as BoardTile['summary']) : null,
    plannedCheckout: opts.planned ?? null,
    leavingOn: opts.leavingOn ?? null,
    bookedFrom: null,
    freeUntil: null,
    freeNights: null,
  }
}
const group = (name: string, tiles: BoardTile[]): BoardGroup => ({ property: property(name), tiles })

describe('boardSummaryText', () => {
  it('the owner\'s example: late, a daily stay ending today, sorted under clear headings', () => {
    const text = boardSummaryText(
      [
        group('EG Kost', [
          tile('3A', 'today', { name: 'Mulan', days: 0, period: 'daily' }),
          tile('5D', 'overdue', { name: 'Pak Beni', days: -2, period: 'monthly' }),
          tile('1A', 'occupied', { name: 'Aman', days: 20, period: 'monthly' }),
          tile('2A', 'vacant'),
        ]),
      ],
      TODAY,
      'Org',
    )
    expect(text).toBe(
      ['*EG Kost* · Sabtu, 7 Nov 2026', 'Telat bayar\n• Kamar 5D (Pak Beni) telat 2 hari (bulanan)', 'Hari ini\n• Kamar 3A (Mulan) habis sewa hari ini (harian)', SUMMARY_FOLLOW_UP].join('\n\n'),
    )
  })

  it('today: due, leaving, check-in; soon: tomorrow and in N days, the nearest first', () => {
    const text = boardSummaryText(
      [
        group('EG Kost', [
          tile('6B', 'soon', { name: 'Joko', days: 3, period: 'monthly' }),
          tile('1B', 'today', { name: 'Sari', days: 0, period: 'monthly' }),
          // an arrival paid up front ('occupied' from its first day) and one whose first payment is still open ('today')
          tile('7A', 'occupied', { name: 'Andi', days: 3, period: 'daily', start: TODAY }),
          tile('7C', 'today', { name: 'Citra', days: 0, period: 'monthly', start: TODAY }),
          tile('7B', 'reserved', { name: 'Budi', period: 'daily', start: '2026-11-09' }),
          tile('2C', 'occupied', { name: 'Dodi', days: 12, period: 'weekly', planned: TODAY }),
          tile('4A', 'soon', { name: 'Rina', days: 1, period: 'weekly' }),
          tile('8A', 'soon', { name: 'Tono', days: 5, period: 'monthly', planned: '2026-11-11', leavingOn: '11 Nov' }),
        ]),
      ],
      TODAY,
      'Org',
    )
    expect(text).toContain(
      'Hari ini\n• Kamar 1B (Sari) jatuh tempo hari ini (bulanan)\n• Kamar 2C (Dodi) rencana keluar hari ini (mingguan)\n• Kamar 7A (Andi) check-in hari ini (harian)\n• Kamar 7C (Citra) check-in hari ini (bulanan) · belum lunas',
    )
    expect(text).toContain(
      'Segera\n• Kamar 4A (Rina) jatuh tempo besok (mingguan)\n• Kamar 6B (Joko) jatuh tempo 3 hari lagi (bulanan)\n• Kamar 8A (Tono) rencana keluar 11 Nov (bulanan)',
    )
    // a booking for another day is not news yet
    expect(text).not.toContain('Budi')
  })

  it('late and leaving today: one line in Telat bayar, the most days late first', () => {
    const text = boardSummaryText(
      [group('EG Kost', [tile('1A', 'overdue', { name: 'A', days: -1, period: 'daily', planned: TODAY }), tile('2A', 'overdue', { name: 'B', days: -9, period: 'monthly' })])],
      TODAY,
      'Org',
    )
    expect(text).toContain('Telat bayar\n• Kamar 2A (B) telat 9 hari (bulanan)\n• Kamar 1A (A) telat 1 hari (harian) · rencana keluar hari ini')
    expect(text).not.toContain('Hari ini')
  })

  it('a move-out within the week is reported whatever the tile colour, ranked by the day he leaves', () => {
    const text = boardSummaryText(
      [
        group('EG Kost', [
          // paid far ahead (blue tile 'Keluar 8 Nov') but leaving tomorrow: staff must prepare the room
          tile('1A', 'occupied', { name: 'Paid', days: 23, period: 'monthly', planned: '2026-11-08', leavingOn: '8 Nov' }),
          tile('2A', 'soon', { name: 'Due', days: 2, period: 'monthly' }),
          // leaving in 12 days: not yet
          tile('3A', 'occupied', { name: 'Later', days: 23, period: 'monthly', planned: '2026-11-19', leavingOn: '19 Nov' }),
        ]),
      ],
      TODAY,
      'Org',
    )
    expect(text).toContain('Segera\n• Kamar 1A (Paid) rencana keluar 8 Nov (bulanan)\n• Kamar 2A (Due) jatuh tempo 2 hari lagi (bulanan)')
    expect(text).not.toContain('Later')
  })

  it('a move-out within the week is reported even when the tenant leaves after his due date, or the room is under repair', () => {
    const text = boardSummaryText(
      [
        group('EG Kost', [
          // due in 2 days but leaving in 5: the board caption is '2 hari' (leavingOn null), the move-out is still news
          tile('1A', 'soon', { name: 'After', days: 2, period: 'monthly', planned: '2026-11-12', leavingOn: null }),
          // the room is under repair: the board never sets leavingOn for it
          tile('2A', 'maintenance', { name: 'Repair', days: 5, period: 'monthly', planned: '2026-11-09', leavingOn: null }),
        ]),
      ],
      TODAY,
      'Org',
    )
    // 1A: rent falls due (2 days) before he leaves (5 days): the money leads, the plan rides along, ranked by the due date
    expect(text).toContain('Segera\n• Kamar 1A (After) jatuh tempo 2 hari lagi (bulanan) · rencana keluar 12 Nov\n• Kamar 2A (Repair) rencana keluar 9 Nov (bulanan) · perbaikan')
  })

  it('a checkout recorded ahead of time is "keluar <day>", never rent due; past the day, nothing', () => {
    const ended = (room: string, out: string, days: number): BoardTile => {
      const t = tile(room, 'soon', { name: 'Pergi', days, period: 'monthly' })
      return { ...t, lease: { ...(t.lease as Lease), status: 'ended', checkout_date: out } }
    }
    const text = boardSummaryText([group('EG Kost', [ended('1A', '2026-11-10', 3), ended('2A', TODAY, 0), ended('3A', '2026-11-30', 23)])], TODAY, 'Org')
    expect(text).toContain('Hari ini\n• Kamar 2A (Pergi) keluar hari ini (bulanan)')
    expect(text).toContain('Segera\n• Kamar 1A (Pergi) keluar 10 Nov (bulanan)')
    expect(text).not.toContain('jatuh tempo')
    expect(text).not.toContain('3A')
  })

  it('a room under repair with a tenant still in it: his late rent is reported, marked perbaikan', () => {
    const text = boardSummaryText(
      [group('EG Kost', [tile('1A', 'maintenance', { name: 'AC rusak', days: -6, period: 'monthly' }), tile('2A', 'maintenance')])],
      TODAY,
      'Org',
    )
    expect(text).toContain('Telat bayar\n• Kamar 1A (AC rusak) telat 6 hari (bulanan) · perbaikan')
    expect(text).not.toContain('2A')
  })

  it('several kos: the organisation as title, a block per kos with news, a kos with none left out', () => {
    const text = boardSummaryText(
      [group('Kos Melati', [tile('A1', 'overdue', { name: 'X', days: -3, period: 'monthly' })]), group('Kos Mawar', [tile('B1', 'occupied', { days: 30, period: 'monthly' })])],
      TODAY,
      'EG Kost',
    )
    expect(text).toBe(`*EG Kost* · Sabtu, 7 Nov 2026\n\n_Kos Melati_\n\nTelat bayar\n• Kamar A1 (X) telat 3 hari (bulanan)\n\n${SUMMARY_FOLLOW_UP}`)
  })

  it('nothing to report says so, without asking for a follow-up', () => {
    const quiet = boardSummaryText([group('EG Kost', [tile('1A', 'occupied', { days: 20, period: 'monthly' })])], TODAY, 'Org')
    expect(quiet).toBe(`*EG Kost* · Sabtu, 7 Nov 2026\n\n${SUMMARY_ALL_CLEAR}`)
    expect(quiet).not.toContain(SUMMARY_FOLLOW_UP)
    expect(boardSummaryText([group('A', []), group('B', [])], TODAY, 'Org')).toBe(`*Org* · Sabtu, 7 Nov 2026\n\n${SUMMARY_ALL_CLEAR}`)
  })

  it('a message with something to act on ends with "Mohon ditindaklanjuti."', () => {
    const text = boardSummaryText([group('EG Kost', [tile('1A', 'soon', { name: 'A', days: 2, period: 'monthly' })])], TODAY, 'Org')
    expect(text.endsWith(`\n\n${SUMMARY_FOLLOW_UP}`)).toBe(true)
  })

  it('a room named "Kamar 12" is not written "Kamar Kamar 12"; a room without a tenant name has none', () => {
    expect(roomLabel('Kamar 12')).toBe('Kamar 12')
    expect(roomLabel('5D')).toBe('Kamar 5D')
    expect(boardSummaryText([group('K', [tile('Kamar 12', 'overdue', { days: -1, period: 'monthly' })])], TODAY, 'Org')).toContain('• Kamar 12 telat 1 hari (bulanan)')
  })
})

describe('whatsappShareLink', () => {
  it('opens WhatsApp with the text and lets the owner pick the chat or group', () => {
    expect(whatsappShareLink('*EG* · a&b\n• x ✅')).toBe('https://api.whatsapp.com/send?text=*EG*%20%C2%B7%20a%26b%0A%E2%80%A2%20x%20%E2%9C%85')
  })
})

// Through the real board (buildBoard), so the message follows what the tiles can actually be: a guest who checks in
// today is an occupied tile from his first day, never 'reserved' (the review of 7 Nov 2026 found the old branch dead).
describe('boardSummaryText from buildBoard', () => {
  const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
  const prop: Property = { id: 'p1', name: 'EG Kost', address: null, notes: null, payment_info: null, logo_path: null, ...ts }
  const mkRoom = (id: string): Room => ({ id, property_id: 'p1', name: id, floor: null, price_daily: 130_000, price_weekly: null, price_monthly: 1_500_000, status: 'active', notes: null, ...ts })
  const mkLease = (id: string, room: string, over: Partial<Lease>): Lease => ({
    id, property_id: 'p1', room_id: room, tenant_id: `t-${id}`, period_type: 'daily', price_per_period: 130_000, deposit_amount: 0,
    start_date: TODAY, end_date: TODAY, status: 'active', checkout_date: null, notes: null, ...ts, ...over,
  })
  const mkInvoice = (id: string, leaseId: string, start: string, end: string, status: Invoice['status']): Invoice => ({
    id, property_id: 'p1', lease_id: leaseId, invoice_number: id, period_type: null, period_start: start, period_end: end, quantity: 1,
    base_amount: 130_000, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: 130_000, due_date: start, status, notes: null, ...ts,
  })
  const tenant = (id: string, name: string): [string, Tenant] => [id, { id, full_name: name } as Tenant]

  it('an arrival today is "check-in hari ini", paid or not; never "habis sewa"', () => {
    const paid = mkInvoice('i-paid', 'l-paid', TODAY, '2026-11-09', 'paid')
    const open = mkInvoice('i-open', 'l-open', TODAY, '2026-11-09', 'unpaid')
    const payments: Payment[] = [{ id: 'pay', property_id: 'p1', invoice_id: 'i-paid', lease_id: 'l-paid', tenant_id: 't-l-paid', amount: 130_000, paid_at: TODAY, method: 'cash', kind: 'rent', notes: null, created_by: null, ...ts } as Payment]
    const board = buildBoard(
      [prop], ['p1'], [mkRoom('R1'), mkRoom('R2')],
      [mkLease('l-paid', 'R1', { end_date: '2026-11-09' }), mkLease('l-open', 'R2', { end_date: '2026-11-09' })],
      new Map([tenant('t-l-paid', 'Andi'), tenant('t-l-open', 'Citra')]), [paid, open], payments, TODAY,
    )
    const text = boardSummaryText(board, TODAY, 'Org')
    expect(text).toContain('• Kamar R1 (Andi) check-in hari ini (harian)')
    expect(text).toContain('• Kamar R2 (Citra) check-in hari ini (harian) · belum lunas')
    expect(text).not.toContain('habis sewa')
  })

  it('an arrival with a down payment also reads "belum lunas" (never "belum bayar": the staff took that DP themselves)', () => {
    const inv = mkInvoice('i-dp', 'l-dp', TODAY, '2026-11-09', 'partial')
    const dp: Payment = { id: 'dp', property_id: 'p1', invoice_id: 'i-dp', lease_id: 'l-dp', tenant_id: 't-l-dp', amount: 50_000, paid_at: TODAY, method: 'cash', kind: 'rent', notes: null, created_by: null, ...ts } as Payment
    const board = buildBoard([prop], ['p1'], [mkRoom('R3')], [mkLease('l-dp', 'R3', { end_date: '2026-11-09' })], new Map([tenant('t-l-dp', 'Dani')]), [inv], [dp], TODAY)
    expect(boardSummaryText(board, TODAY, 'Org')).toContain('• Kamar R3 (Dani) check-in hari ini (harian) · belum lunas')
  })
})
