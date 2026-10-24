import { describe, expect, it } from 'vitest'
import type { Lease, Room, WaitlistEntry } from '../../types/db'
import { plannedStay } from './availability'
import { PERIOD_PARAM, parsePlannerParams, plannerSearch } from './rencanaParams'
import {
  emptyWaitlistForm,
  entryToForm,
  formToWaitlistInsert,
  formToWaitlistPatch,
  inKosFilter,
  kabariText,
  matchText,
  plannerLinkFor,
  sortWaitlist,
  validateWaitlistForm,
  waitlistCounts,
  waitlistMatches,
  waitlistRequest,
  waitlistStart,
  wantText,
} from './waitlist'

const TODAY = '2026-11-01'
const ts = { org_id: 'org-1', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

function entry(id: string, extra: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id,
    property_id: null,
    name: 'Rina Kartika',
    phone: '+6281234567811',
    wanted_from: null,
    period_type: 'daily',
    quantity: 2,
    max_price: null,
    room_note: null,
    notes: null,
    status: 'waiting',
    lease_id: null,
    created_by: null,
    ...ts,
    ...extra,
  }
}

function room(id: string, propertyId: string, daily: number | null, extra: Partial<Room> = {}): Room {
  return { id, property_id: propertyId, name: id, floor: null, price_daily: daily, price_weekly: 600_000, price_monthly: null, status: 'active', notes: null, ...ts, ...extra }
}

function lease(roomId: string, start: string, end: string): Lease {
  return {
    id: `L-${roomId}-${start}`,
    property_id: 'P1',
    room_id: roomId,
    tenant_id: 'T1',
    period_type: 'daily',
    price_per_period: 100_000,
    deposit_amount: 0,
    start_date: start,
    end_date: end,
    status: 'active',
    checkout_date: null,
    notes: null,
    ...ts,
  }
}

describe('the stay an entry asks for', () => {
  it('secepatnya and a wanted day already past both start today', () => {
    expect(waitlistStart({ wanted_from: null }, TODAY)).toBe(TODAY)
    expect(waitlistStart({ wanted_from: '2026-10-20' }, TODAY)).toBe(TODAY)
    expect(waitlistStart({ wanted_from: '2026-11-05' }, TODAY)).toBe('2026-11-05')
    expect(waitlistRequest(entry('W1', { wanted_from: '2026-11-05', period_type: 'weekly', quantity: 1, max_price: 700_000 }), TODAY)).toEqual({
      periodType: 'weekly',
      start: '2026-11-05',
      quantity: 1,
      maxPrice: 700_000,
    })
  })

  it('links to the planner filled in for this entry', () => {
    expect(plannerLinkFor(entry('W1', { wanted_from: '2026-11-05', max_price: 150_000 }), TODAY)).toBe('/rencana?jenis=harian&mulai=2026-11-05&jumlah=2&maks=150000&tunggu=W1')
  })

  it('an entry for one kos opens the planner on that kos only, as its matches are searched there', () => {
    const joko = entry('W2', { property_id: 'P2', period_type: 'weekly', wanted_from: '2026-11-05' })
    const link = plannerLinkFor(joko, TODAY)
    expect(link).toBe('/rencana?jenis=mingguan&mulai=2026-11-05&jumlah=2&kos=P2&tunggu=W2')
    expect(parsePlannerParams(new URLSearchParams(link.split('?')[1]), TODAY)).toMatchObject({ kosId: 'P2', waitlistId: 'W2', roomId: null })
  })
})

describe('sortWaitlist', () => {
  it('waiting first: secepatnya on top, then the soonest wanted day, then the oldest; then the rest, newest change first', () => {
    const list = [
      entry('booked-old', { status: 'booked', updated_at: '2026-10-02T00:00:00Z' }),
      entry('later', { wanted_from: '2026-11-20' }),
      entry('asap-new', { created_at: '2026-10-05T00:00:00Z' }),
      entry('cancelled-new', { status: 'cancelled', updated_at: '2026-10-09T00:00:00Z' }),
      entry('soon', { wanted_from: '2026-11-03' }),
      entry('asap-old', { created_at: '2026-09-05T00:00:00Z' }),
    ]
    expect(sortWaitlist(list).map((e) => e.id)).toEqual(['asap-old', 'asap-new', 'soon', 'later', 'cancelled-new', 'booked-old'])
  })

  it('the kos filter keeps entries for any kos', () => {
    expect(inKosFilter({ property_id: null }, ['P1'])).toBe(true)
    expect(inKosFilter({ property_id: 'P1' }, ['P1'])).toBe(true)
    expect(inKosFilter({ property_id: 'P2' }, ['P1'])).toBe(false)
  })
})

describe('live matches', () => {
  const rooms = [room('A1', 'P1', 120_000), room('A3', 'P1', 100_000), room('B1', 'P2', 90_000), room('B2', 'P2', 90_000)]
  const leases = [lease('B2', '2026-11-01', '2026-11-30')]
  const input = { rooms, leases, today: TODAY, propertyIds: ['P1', 'P2'] }

  it('an entry for any kos looks in every shown kos; one for a kos only there; the budget applies', () => {
    expect(waitlistMatches(entry('W1'), input).rooms.map((r) => r.room.name)).toEqual(['B1', 'A3', 'A1'])
    expect(waitlistMatches(entry('W1', { property_id: 'P1' }), input).rooms.map((r) => r.room.name)).toEqual(['A3', 'A1'])
    expect(waitlistMatches(entry('W1', { property_id: 'P1', max_price: 100_000 }), input).rooms.map((r) => r.room.name)).toEqual(['A3'])
    expect(waitlistMatches(entry('W1', { property_id: 'P2', period_type: 'monthly' }), input).rooms.map((r) => r.room.name)).toEqual(['B1'])
  })

  it('says which rooms fit and for how much', () => {
    const { rooms: fits } = waitlistMatches(entry('W1'), input)
    expect(matchText(fits)).toBe('Kamar cocok: B1, A3, A1 (mulai Rp 180.000)')
    expect(matchText(fits.slice(1, 2))).toBe('Kamar cocok: A3 (Rp 200.000)')
    expect(matchText([...fits, ...fits])).toBe('Kamar cocok: B1, A3, A1 +3 lainnya (mulai Rp 180.000)')
    expect(matchText([])).toBe('Belum ada kamar')
    const noRate = waitlistMatches(entry('W1', { property_id: 'P2', period_type: 'monthly' }), input).rooms
    expect(matchText(noRate)).toBe('Kamar cocok: B1')
  })

  it('counts waiting entries in the shown kos and those a room fits now', () => {
    const list = [
      entry('W1'),
      entry('W2', { property_id: 'P2', max_price: 50_000 }),
      entry('W3', { status: 'booked' }),
      entry('W4', { status: 'cancelled' }),
      entry('W5', { property_id: 'P9' }),
    ]
    expect(waitlistCounts(list, input)).toEqual({ waiting: 2, withRoom: 1 })
  })
})

describe('texts', () => {
  it('what the entry wants', () => {
    const e = entry('W1', { wanted_from: '2026-11-05', max_price: 150_000 })
    expect(wantText(e, plannedStay('2026-11-05', 'daily', 2))).toBe('Mulai 5 Nov 2026 · 2 malam (check-out 7 Nov 2026) · maks. Rp 150.000 / malam')
    expect(wantText(entry('W2', { period_type: 'weekly', quantity: 1 }))).toBe('Secepatnya · 1 minggu')
  })

  it('Kabari: greeting, room, dates with the check-out day, price and kos', () => {
    const stay = plannedStay('2026-11-05', 'daily', 2)!
    expect(kabariText({ name: 'Rina Kartika', roomName: 'A3', propertyName: 'Kos Melati', stay, total: 200_000 })).toBe(
      [
        'Halo Kak Rina, ini dari Kos Melati.',
        'Kabar baik: kamar A3 kosong untuk 5 Nov 2026 – 7 Nov 2026 (2 malam, check-out 7 Nov 2026).',
        'Harganya Rp 200.000 untuk 2 malam.',
        'Kalau jadi, balas pesan ini ya, nanti kamarnya kami pesankan. Terima kasih 🙏',
      ].join('\n'),
    )
    expect(kabariText({ name: '', roomName: 'A3', propertyName: 'Kos Melati', stay, total: null })).not.toMatch(/Harganya/)
  })
})

describe('form', () => {
  it('validates the name, an optional phone, the date unless secepatnya, the quantity and the budget', () => {
    const form = { ...emptyWaitlistForm(TODAY), name: 'Rina' }
    expect(validateWaitlistForm(form)).toEqual({})
    expect(validateWaitlistForm({ ...form, name: ' ' }).name).toBe('Nama wajib diisi.')
    expect(validateWaitlistForm({ ...form, phone: 'abc' }).phone).toMatch(/Nomor HP tidak valid/)
    expect(validateWaitlistForm({ ...form, wantedFrom: '' }).wantedFrom).toBe('Isi tanggal mulai, atau pilih Secepatnya.')
    expect(validateWaitlistForm({ ...form, wantedFrom: '', asap: true })).toEqual({})
    expect(validateWaitlistForm({ ...form, quantity: 0 }).quantity).toBe('Minimal 1.')
    expect(validateWaitlistForm({ ...form, maxPrice: -1 }).maxPrice).toBe('Harga tidak boleh negatif.')
  })

  it('writes a waiting entry; an edit keeps status and lease', () => {
    const form = {
      ...emptyWaitlistForm(TODAY, 'P1'),
      name: '  Rina   Kartika ',
      phone: '0812-3456-7811',
      wantedFrom: '2026-11-05',
      periodType: 'weekly' as const,
      quantity: 2,
      maxPrice: 700_000,
      roomNote: ' lantai bawah ',
      notes: '',
    }
    expect(formToWaitlistInsert(form)).toEqual({
      property_id: 'P1',
      name: 'Rina Kartika',
      phone: '+6281234567811',
      wanted_from: '2026-11-05',
      period_type: 'weekly',
      quantity: 2,
      max_price: 700_000,
      room_note: 'lantai bawah',
      notes: null,
      status: 'waiting',
      lease_id: null,
    })
    const patch = formToWaitlistPatch({ ...form, asap: true, propertyId: '', maxPrice: 0, phone: '' })
    expect(patch).toMatchObject({ property_id: null, wanted_from: null, max_price: null, phone: null })
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('lease_id')
  })

  it('an entry back into the form', () => {
    const e = entry('W1', { property_id: 'P1', wanted_from: null, max_price: 150_000, room_note: 'Lantai bawah' })
    expect(entryToForm(e, TODAY)).toEqual({
      name: 'Rina Kartika',
      phone: '+6281234567811',
      propertyId: 'P1',
      asap: true,
      wantedFrom: TODAY,
      periodType: 'daily',
      quantity: 2,
      maxPrice: 150_000,
      roomNote: 'Lantai bawah',
      notes: '',
    })
  })
})

describe('planner address', () => {
  it('reads the inputs and falls back to Harian, today, 1', () => {
    // kosId added with the review fix (a daftar tunggu entry's kos travels in the address)
    expect(parsePlannerParams(new URLSearchParams(''), TODAY)).toEqual({ periodType: 'daily', start: TODAY, quantity: 1, maxPrice: null, kosId: null, roomId: null, waitlistId: null })
    expect(parsePlannerParams(new URLSearchParams('jenis=mingguan&mulai=2026-11-05&jumlah=2&maks=700000&kos=P1&kamar=R1&tunggu=W1'), TODAY)).toEqual({
      periodType: 'weekly',
      start: '2026-11-05',
      quantity: 2,
      maxPrice: 700_000,
      kosId: 'P1',
      roomId: 'R1',
      waitlistId: 'W1',
    })
    expect(parsePlannerParams(new URLSearchParams('jenis=x&mulai=kemarin&jumlah=0&maks=-5'), TODAY)).toMatchObject({ periodType: 'daily', start: TODAY, quantity: 1, maxPrice: null })
  })

  it('writes them back', () => {
    expect(plannerSearch({ periodType: 'monthly', start: '2026-11-05', quantity: 1 })).toBe('?jenis=bulanan&mulai=2026-11-05')
    expect(PERIOD_PARAM.weekly).toBe('mingguan')
    const p = { periodType: 'weekly' as const, start: '2026-11-05', quantity: 3, maxPrice: 650_000, kosId: 'P2', roomId: 'R1', waitlistId: null }
    expect(parsePlannerParams(new URLSearchParams(plannerSearch(p)), TODAY)).toEqual(p)
  })
})
