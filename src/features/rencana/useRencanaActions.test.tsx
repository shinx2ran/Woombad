// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Lease, MemberRole, OrgInsert, Room } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { roomDisplayState } from '../properties/roomUtils'
import { buildBoard } from '../quick/boardModel'
import { QuickCheckInError } from '../quick/quickCheckIn'
import { emptyWaitlistForm } from './waitlist'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useRencanaActions, WAITLIST_CHANGED_MESSAGE, WAITLIST_DELETE_STAFF_MESSAGE, type BookStayInput } from './useRencanaActions'
import { useLeaseActions } from '../leases/useLeaseActions'

const TODAY = '2026-11-01'
let repo: OrgRepo
let room: Room

beforeEach(async () => {
  // todayISO() everywhere (the extension pre-check) and the LocalRepo guard agree on 1 Nov 2026
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0))
  repo = bindOrg(new LocalRepo(emptyLocalDb(), { today: () => TODAY }), 'org-1')
  state.repo = repo
  state.role = 'owner'
  invalidate.mockClear()
  await repo.insert('properties', { id: 'P1', name: 'Kos Melati', address: null, notes: null, payment_info: null, logo_path: null })
  room = await repo.insert('rooms', {
    id: 'R1',
    property_id: 'P1',
    name: 'A3',
    floor: '1',
    price_daily: 100_000,
    price_weekly: 600_000,
    price_monthly: 1_500_000,
    status: 'active',
    notes: null,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const actionsHook = () => renderHook(() => useRencanaActions()).result.current

function booking(extra: Partial<BookStayInput> = {}): BookStayInput {
  return {
    room,
    periodType: 'daily',
    startDate: '2026-11-05',
    quantity: 2,
    total: 200_000,
    paidAmount: 0,
    method: 'cash',
    tenantId: null,
    name: 'Rina Kartika',
    phone: '',
    notes: null,
    orgInvoices: [],
    today: TODAY,
    ...extra,
  }
}

async function bookedBy(name: string, start: string, end: string, roomId = 'R1'): Promise<Lease> {
  const tenant = await repo.insert('tenants', { property_id: 'P1', full_name: name, phone: null } as never)
  return repo.insert('leases', {
    property_id: 'P1',
    room_id: roomId,
    tenant_id: tenant.id,
    period_type: 'daily',
    price_per_period: 100_000,
    deposit_amount: 0,
    start_date: start,
    end_date: end,
    status: 'active',
    checkout_date: null,
    notes: null,
  })
}

describe('bookStay: a planned stay through the Check-in cepat path', () => {
  it('a future weekly stay with a DP: lease, first invoice and the DP payment; the room shows Dipesan', async () => {
    const { lease, invoice, payment, waitlistError } = await actionsHook().bookStay(
      booking({ periodType: 'weekly', quantity: 2, total: 1_200_000, paidAmount: 300_000, method: 'transfer', notes: ' Lantai bawah ' }),
    )
    expect(waitlistError).toBeNull()
    expect(lease).toMatchObject({ room_id: 'R1', period_type: 'weekly', price_per_period: 600_000, start_date: '2026-11-05', end_date: '2026-11-18', status: 'active', deposit_amount: 0, notes: 'Lantai bawah' })
    expect(invoice).toMatchObject({ lease_id: lease.id, period_type: 'weekly', period_start: '2026-11-05', period_end: '2026-11-18', quantity: 2, total_amount: 1_200_000 })
    expect(payment).toMatchObject({ invoice_id: invoice.id, amount: 300_000, method: 'transfer', kind: 'rent', notes: 'DP', paid_at: TODAY })
    expect((await repo.get('invoices', invoice.id))!.status).toBe('partial')
    const tenants = await repo.list('tenants')
    expect(tenants).toEqual([expect.objectContaining({ id: lease.tenant_id, full_name: 'Rina Kartika', phone: null, property_id: 'P1' })])

    const leases = await repo.list('leases')
    const byId = new Map(tenants.map((t) => [t.id, t]))
    expect(roomDisplayState(room, leases, byId, await repo.list('invoices'), await repo.list('payments'), TODAY)).toMatchObject({ kind: 'reserved', startDate: '2026-11-05' })
    const [group] = buildBoard([{ id: 'P1', name: 'Kos Melati' } as never], ['P1'], [room], leases, byId, [], [], TODAY)
    expect(group.tiles[0]).toMatchObject({ tone: 'reserved', caption: 'Dipesan' })
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices', 'payments', 'tenants', 'waitlist')
  })

  it('Check-in cepat with a vehicle plate: bookStay passes it on to the lease, written as plates are (SPEC 7.11)', async () => {
    const { lease } = await actionsHook().bookStay(booking({ startDate: TODAY, vehiclePlate: 'kb1442gz' }))
    expect(lease.vehicle_plate).toBe('KB 1442 GZ')
    expect((await repo.get('leases', lease.id))!.vehicle_plate).toBe('KB 1442 GZ')
    // a later stay without one: no plate
    const later = await actionsHook().bookStay(booking({ startDate: '2026-11-20' }))
    expect(later.lease.vehicle_plate ?? null).toBeNull()
  })

  it('today, paid in full: the same rows as Check-in cepat, and the room is occupied', async () => {
    const { lease, invoice, payment } = await actionsHook().bookStay(booking({ startDate: TODAY, paidAmount: 200_000 }))
    expect(lease).toMatchObject({ start_date: TODAY, end_date: '2026-11-02', price_per_period: 100_000, period_type: 'daily' })
    expect(payment).toMatchObject({ amount: 200_000, notes: null })
    expect((await repo.get('invoices', invoice.id))!.status).toBe('paid')
    expect(roomDisplayState(room, await repo.list('leases'), new Map(), [], [], TODAY).kind).toBe('occupied')
  })

  it('a year from today with a bonus month and a deposit (Check-in cepat tahunan): 13 months held, invoice discounted, deposit received', async () => {
    const { lease, invoice, payment, depositPayment } = await actionsHook().bookStay(
      booking({ startDate: TODAY, periodType: 'monthly', quantity: 12, bonusQuantity: 1, total: 18_000_000, paidAmount: 18_000_000, method: 'transfer', deposit: { amount: 1_000_000, paidNow: true } }),
    )
    expect(lease).toMatchObject({ period_type: 'monthly', price_per_period: 1_500_000, deposit_amount: 1_000_000, start_date: TODAY, end_date: '2027-11-30' })
    expect(invoice).toMatchObject({ quantity: 13, base_amount: 19_500_000, discount_amount: 1_500_000, total_amount: 18_000_000, period_end: '2027-11-30', notes: 'bonus 1 bulan' })
    expect(payment).toMatchObject({ amount: 18_000_000, kind: 'rent', notes: null })
    expect(depositPayment).toMatchObject({ amount: 1_000_000, kind: 'deposit', invoice_id: null, lease_id: lease.id, method: 'transfer', notes: 'Uang jaminan' })
    expect((await repo.get('invoices', invoice.id))!.status).toBe('paid')
    // the bonus month is held too: a booking inside it is refused before anything is written
    await expect(actionsHook().bookStay(booking({ startDate: '2027-11-15', quantity: 1 }))).rejects.toThrow(/Kamar A3 sudah tidak kosong/)
    expect(await repo.list('leases')).toHaveLength(1)
  })

  it('a booking inside the bonus month of a year is refused as a conflict before writing', async () => {
    await bookedBy('Budi', '2027-11-20', '2027-11-21')
    await expect(
      actionsHook().bookStay(booking({ startDate: TODAY, periodType: 'monthly', quantity: 12, bonusQuantity: 1, total: 18_000_000 })),
    ).rejects.toThrow(/dipesan Budi/)
    // without the bonus the same year ends 31 Okt 2027 and does not reach that booking
    const { lease } = await actionsHook().bookStay(booking({ startDate: TODAY, periodType: 'monthly', quantity: 12, total: 18_000_000 }))
    expect(lease.end_date).toBe('2027-10-31')
  })

  it('an existing tenant is used instead of a new one', async () => {
    const t = await repo.insert('tenants', { property_id: 'P1', full_name: 'Rina Kartika', phone: '+6281234567811' } as never)
    const { lease } = await actionsHook().bookStay(booking({ tenantId: t.id }))
    expect(lease.tenant_id).toBe(t.id)
    expect(await repo.list('tenants')).toHaveLength(1)
  })

  it('refuses a room another phone booked meanwhile, naming that booking, before anything is written', async () => {
    await bookedBy('Budi', '2026-11-06', '2026-11-07')
    await expect(actionsHook().bookStay(booking())).rejects.toThrow('Kamar A3 sudah tidak kosong pada tanggal itu: dipesan Budi 6–8 Nov. Pilih kamar atau tanggal lain.')
    expect(await repo.list('leases')).toHaveLength(1)
    expect((await repo.list('tenants')).map((t) => t.full_name)).toEqual(['Budi'])
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices', 'payments', 'tenants', 'waitlist')
  })

  it('a check-in today waits for the checkout of the guest still in the room (Check-in cepat rule)', async () => {
    // Hendra's last night was 31 Okt: today is his check-out day, not recorded yet
    const hendra = await bookedBy('Hendra', '2026-10-29', '2026-10-31')
    await expect(actionsHook().bookStay(booking({ startDate: TODAY, quantity: 1, total: 100_000 }))).rejects.toThrow(
      'Kamar A3 masih ditempati Hendra: check-out-nya belum dicatat. Catat check-out dulu, lalu coba lagi.',
    )
    expect(await repo.list('leases')).toHaveLength(1)
    // a stay from tomorrow counts on his planned check-out
    await actionsHook().bookStay(booking({ startDate: '2026-11-02', quantity: 1, total: 100_000, name: 'Besok' }))
    // once his checkout is recorded, tonight is free
    await repo.update('leases', hendra.id, { status: 'ended', checkout_date: TODAY })
    const { lease } = await actionsHook().bookStay(booking({ startDate: TODAY, quantity: 1, total: 100_000 }))
    expect(lease).toMatchObject({ start_date: TODAY, end_date: TODAY, status: 'active' })
  })

  it('refuses a room put under repair meanwhile', async () => {
    await repo.update('rooms', 'R1', { status: 'maintenance' })
    await expect(actionsHook().bookStay(booking())).rejects.toThrow('Kamar A3 sedang perbaikan.')
  })

  it('names the booking the database guard refused in the last moment (two phones at once)', async () => {
    await bookedBy('Budi', '2026-11-06', '2026-11-07')
    // this phone's re-check still reads the room as free; the insert then meets the guard
    const list = repo.list.bind(repo)
    let stale = true
    state.repo = {
      ...repo,
      list: ((table, opts) => {
        if (table === 'leases' && stale) {
          stale = false
          return Promise.resolve([])
        }
        return list(table, opts)
      }) as OrgRepo['list'],
    }
    const err = await actionsHook().bookStay(booking()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QuickCheckInError)
    expect((err as QuickCheckInError).message).toBe('Kamar A3 sudah tidak kosong pada tanggal itu: dipesan Budi 6–8 Nov. Pilih kamar atau tanggal lain.')
    // the new tenant exists already: the sheet reuses it on retry
    expect((err as QuickCheckInError).createdTenant?.full_name).toBe('Rina Kartika')
    expect((err as QuickCheckInError).lease).toBeNull()
    expect(await repo.list('leases')).toHaveLength(1)
  })
})

describe('daftar tunggu', () => {
  const form = () => ({ ...emptyWaitlistForm(TODAY, 'P1'), name: 'Rina Kartika', phone: '0812-3456-7811', wantedFrom: '2026-11-05', quantity: 2, maxPrice: 120_000 })

  it('booking for an entry marks it booked with the new lease', async () => {
    const actions = actionsHook()
    const entry = await actions.addEntry(form())
    expect(entry).toMatchObject({ status: 'waiting', name: 'Rina Kartika', phone: '+6281234567811', property_id: 'P1', max_price: 120_000 })
    const { lease, waitlistError } = await actions.bookStay(booking({ waitlistId: entry.id }))
    expect(waitlistError).toBeNull()
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: lease.id })
  })

  // changed with the review fix: a booking for an entry that is gone was saved with a warning; the entry is now read
  // fresh first, so a booking from a stale screen is refused before anything is written (see the two-phone tests below)
  it('a booking for an entry deleted meanwhile is refused before anything is written', async () => {
    const actions = actionsHook()
    const entry = await actions.addEntry(form())
    await repo.remove('waitlist', entry.id)
    await expect(actions.bookStay(booking({ waitlistId: entry.id }))).rejects.toThrow(WAITLIST_CHANGED_MESSAGE)
    expect(await repo.list('leases')).toEqual([])
    expect(await repo.list('tenants')).toEqual([])
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices', 'payments', 'tenants', 'waitlist')
  })

  it('a booking still stands when the entry cannot be marked afterwards; the warning says so', async () => {
    const actions = actionsHook()
    const entry = await actions.addEntry(form())
    const update = repo.update.bind(repo)
    state.repo = {
      ...repo,
      update: ((table, id, patch) => (table === 'waitlist' ? Promise.reject(new Error('Data daftar tunggu tidak ditemukan.')) : update(table, id, patch))) as OrgRepo['update'],
    }
    const { lease, waitlistError } = await actionsHook().bookStay(booking({ waitlistId: entry.id }))
    expect(lease.status).toBe('active')
    expect(waitlistError).toMatch(/tidak ditemukan/)
  })

  it('two phones: the second Pesan for the same waiting person is refused, in another room too, and the link stays', async () => {
    await repo.insert('rooms', { id: 'R2', property_id: 'P1', name: 'B1', floor: '1', price_daily: 100_000, price_weekly: null, price_monthly: null, status: 'active', notes: null })
    const phoneA = actionsHook()
    const phoneB = actionsHook()
    const entry = await phoneA.addEntry(form())
    // both phones show Rina as Menunggu; A books A3, then B (stale screen) books B1 for her
    const first = await phoneA.bookStay(booking({ waitlistId: entry.id }))
    const room2 = (await repo.get('rooms', 'R2'))!
    await expect(phoneB.bookStay(booking({ room: room2, waitlistId: entry.id }))).rejects.toThrow(WAITLIST_CHANGED_MESSAGE)
    expect((await repo.list('leases')).map((l) => l.room_id)).toEqual(['R1'])
    expect(await repo.list('invoices')).toHaveLength(1)
    expect((await repo.list('tenants')).map((t) => t.full_name)).toEqual(['Rina Kartika'])
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: first.lease.id })
  })

  it('a stale Batal or Aktifkan lagi does not undo a booking made on another phone', async () => {
    const actions = actionsHook()
    const entry = await actions.addEntry(form())
    const { lease } = await actions.bookStay(booking({ waitlistId: entry.id }))
    // `entry` is the card as the other phone still shows it: Menunggu
    await expect(actions.setEntryStatus(entry, 'cancelled')).rejects.toThrow(WAITLIST_CHANGED_MESSAGE)
    await expect(actions.setEntryStatus(entry, 'waiting')).rejects.toThrow(WAITLIST_CHANGED_MESSAGE)
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: lease.id })
    expect(invalidate).toHaveBeenCalledWith('waitlist')
  })

  it('a cancelled entry is not booked from a stale screen; once active again it is', async () => {
    const actions = actionsHook()
    const entry = await actions.addEntry(form())
    await actions.setEntryStatus(entry, 'cancelled')
    await expect(actions.bookStay(booking({ waitlistId: entry.id }))).rejects.toThrow(WAITLIST_CHANGED_MESSAGE)
    expect(await repo.list('leases')).toEqual([])
    await actions.setEntryStatus(entry, 'waiting')
    const { lease } = await actions.bookStay(booking({ waitlistId: entry.id }))
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: lease.id })
  })

  it('staff can book and manage the list but not delete entries; owners can', async () => {
    state.role = 'staff'
    const staff = actionsHook()
    expect(staff.canDeleteEntries).toBe(false)
    const entry = await staff.addEntry(form())
    await staff.updateEntry(entry, { ...form(), roomNote: 'kamar mandi dalam', quantity: 3 })
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ room_note: 'kamar mandi dalam', quantity: 3, status: 'waiting' })
    await staff.setEntryStatus(entry, 'cancelled')
    expect((await repo.get('waitlist', entry.id))!.status).toBe('cancelled')
    await staff.setEntryStatus(entry, 'waiting')
    const { lease } = await staff.bookStay(booking({ waitlistId: entry.id }))
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: lease.id })
    await expect(staff.removeEntry(entry)).rejects.toThrow(WAITLIST_DELETE_STAFF_MESSAGE)
    expect(await repo.get('waitlist', entry.id)).not.toBeNull()

    state.role = 'owner'
    await actionsHook().removeEntry(entry)
    expect(await repo.get('waitlist', entry.id)).toBeNull()
  })
})

describe('Pindah kamar into a room booked meanwhile (SPEC 2b.9, 7.7)', () => {
  it('is refused on fresh rows with the reason, and works once the room is free again', async () => {
    const r2 = await repo.insert('rooms', { id: 'R2', property_id: 'P1', name: 'B1', floor: '1', price_daily: 100_000, price_weekly: 600_000, price_monthly: null, status: 'active', notes: null })
    const sari = await bookedBy('Sari', '2026-10-29', '2026-11-04')
    // the dialog (stale screen) still lists B1 as Kosong; another phone books it meanwhile
    const budi = await bookedBy('Budi', '2026-11-08', '2026-11-09', 'R2')
    const leaseActions = renderHook(() => useLeaseActions()).result.current
    await expect(leaseActions.moveRoom(sari, room, r2, null, TODAY)).rejects.toThrow(
      'Kamar B1 sudah tidak kosong (Dipesan). Datanya baru saja berubah di HP lain: muat ulang lalu pilih kamar lain.',
    )
    expect((await repo.get('leases', sari.id))!.room_id).toBe('R1')
    expect(invalidate).toHaveBeenCalledWith('leases', 'rooms')
    // a room put under repair meanwhile
    await repo.update('leases', budi.id, { status: 'cancelled', end_date: budi.start_date })
    await repo.update('rooms', 'R2', { status: 'maintenance' })
    await expect(leaseActions.moveRoom(sari, room, r2, null, TODAY)).rejects.toThrow('Kamar B1 sudah tidak kosong (Perbaikan).')
    // free again: the move goes through as before
    await repo.update('rooms', 'R2', { status: 'active' })
    await leaseActions.moveRoom(sari, room, r2, null, TODAY)
    expect((await repo.get('leases', sari.id))!).toMatchObject({ room_id: 'R2', notes: 'Pindah dari A3 ke B1 pada 2026-11-01' })
  })
})

describe('Perpanjang into a booked stay (SPEC 7.7)', () => {
  it('is refused before any invoice is written, naming the booking; up to its check-in day it works', async () => {
    const weekly = await repo.insert('leases', {
      property_id: 'P1',
      room_id: 'R1',
      tenant_id: (await repo.insert('tenants', { property_id: 'P1', full_name: 'Sari', phone: null } as OrgInsert<'tenants'>)).id,
      period_type: 'weekly',
      price_per_period: 600_000,
      deposit_amount: 0,
      start_date: '2026-10-29',
      end_date: '2026-11-04',
      status: 'active',
      checkout_date: null,
      notes: null,
    })
    const first = await repo.insert('invoices', {
      property_id: 'P1',
      lease_id: weekly.id,
      invoice_number: 'INV-202610-0001',
      period_type: 'weekly',
      period_start: '2026-10-29',
      period_end: '2026-11-04',
      quantity: 1,
      base_amount: 600_000,
      addons_amount: 0,
      extra_amount: 0,
      discount_amount: 0,
      total_amount: 600_000,
      due_date: '2026-10-29',
      status: 'unpaid',
      notes: null,
    })
    await bookedBy('Budi', '2026-11-05', '2026-11-06')
    const leaseActions = renderHook(() => useLeaseActions()).result.current
    const input = { lease: weekly, addons: [], quantity: 1, notes: null, existingInvoices: [first], orgInvoices: [first] }
    await expect(leaseActions.issueInvoice(input)).rejects.toThrow(
      'Kamar ini sudah dipesan Budi mulai 5 Nov 2026, jadi sewa ini tidak bisa diperpanjang sampai 12 Nov 2026. Perpendek perpanjangan atau pindahkan salah satu ke kamar lain.',
    )
    expect(await repo.list('invoices')).toHaveLength(1)
    expect((await repo.get('leases', weekly.id))!.end_date).toBe('2026-11-04')

    // the booked guest is moved to another room: the extension goes through
    const budi = (await repo.list('leases')).find((l) => l.id !== weekly.id)!
    await repo.update('leases', budi.id, { room_id: 'R9' })
    await leaseActions.issueInvoice(input)
    expect((await repo.get('leases', weekly.id))!.end_date).toBe('2026-11-11')
  })
})
