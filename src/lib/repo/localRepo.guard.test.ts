import { beforeEach, describe, expect, it } from 'vitest'
import type { Lease, OrgInsert } from '../../types/db'
import { LocalRepo, emptyLocalDb } from './localRepo'
import { LEASE_OVERLAP_MESSAGE, bindOrg, type OrgRepo } from './types'

// SPEC 7.7: Mode Demo mirrors public.leases_overlap_guard (with the device's today) and the waitlist rules.
const TODAY = '2026-11-01'
let repo: OrgRepo

function row(start: string, end: string, extra: Partial<OrgInsert<'leases'>> = {}): OrgInsert<'leases'> {
  return {
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'daily',
    price_per_period: 100_000,
    deposit_amount: 0,
    start_date: start,
    end_date: end,
    status: 'active',
    checkout_date: null,
    notes: null,
    ...extra,
  }
}

beforeEach(() => {
  repo = bindOrg(new LocalRepo(emptyLocalDb(), { today: () => TODAY }), 'org-1')
})

describe('LocalRepo double-booking guard: new bookings', () => {
  it('refuses an active lease that takes a future night of another lease of the room', async () => {
    await repo.insert('leases', row('2026-11-05', '2026-11-06'))
    await expect(repo.insert('leases', row('2026-11-06', '2026-11-08'))).rejects.toThrow(LEASE_OVERLAP_MESSAGE)
    await expect(repo.insert('leases', row('2026-11-01', '2026-11-30', { period_type: 'monthly' }))).rejects.toThrow(LEASE_OVERLAP_MESSAGE)
    expect(await repo.list('leases')).toHaveLength(1)
  })

  it('a room is free again on the check-out day; other rooms and cancelled leases do not count', async () => {
    await repo.insert('leases', row('2026-11-05', '2026-11-06'))
    await repo.insert('leases', row('2026-11-07', '2026-11-08'))
    await repo.insert('leases', row('2026-11-01', '2026-11-04'))
    await repo.insert('leases', row('2026-11-05', '2026-11-06', { room_id: 'R2' }))
    await repo.insert('leases', row('2026-11-09', '2026-11-20', { status: 'cancelled' }))
    await repo.insert('leases', row('2026-11-09', '2026-11-10'))
    expect(await repo.list('leases')).toHaveLength(6)
  })

  it('an ended lease holds until the night before its checkout date', async () => {
    await repo.insert('leases', row('2026-10-01', '2026-11-30', { period_type: 'monthly', status: 'ended', checkout_date: '2026-11-05' }))
    await expect(repo.insert('leases', row('2026-11-04', '2026-11-05'))).rejects.toThrow(LEASE_OVERLAP_MESSAGE)
    await repo.insert('leases', row('2026-11-05', '2026-11-06'))
  })

  it('history is never refused: ended/cancelled rows, and overlaps only in the past', async () => {
    await repo.insert('leases', row('2026-10-01', '2026-10-31', { period_type: 'monthly' }))
    // an old double booking (e.g. a room move) imported as history
    await repo.insert('leases', row('2026-10-10', '2026-10-20', { status: 'ended', checkout_date: '2026-10-21' }))
    await repo.insert('leases', row('2026-10-10', '2026-10-20', { status: 'cancelled' }))
    // an active lease whose overlap with the other lies before today
    await repo.insert('leases', row('2026-10-25', '2026-11-03'))
    expect(await repo.list('leases')).toHaveLength(4)
  })

  it('checks a batch row by row against the rows before it, and stores none when one is refused', async () => {
    await expect(repo.insertMany('leases', [row('2026-11-05', '2026-11-06'), row('2026-11-06', '2026-11-07')])).rejects.toThrow(LEASE_OVERLAP_MESSAGE)
    expect(await repo.list('leases')).toHaveLength(0)
    await repo.insertMany('leases', [row('2026-11-05', '2026-11-06'), row('2026-11-07', '2026-11-08')])
    expect(await repo.list('leases')).toHaveLength(2)
  })
})

describe('LocalRepo double-booking guard: changes to a lease', () => {
  let weekly: Lease
  beforeEach(async () => {
    weekly = await repo.insert('leases', row('2026-10-29', '2026-11-04', { period_type: 'weekly' }))
    await repo.insert('leases', row('2026-11-08', '2026-11-09', { tenant_id: 'T2' }))
  })

  it('refuses an extension into another booking, allows one up to its check-in day', async () => {
    await expect(repo.update('leases', weekly.id, { end_date: '2026-11-11' })).rejects.toThrow(LEASE_OVERLAP_MESSAGE)
    expect((await repo.get('leases', weekly.id))!.end_date).toBe('2026-11-04')
    await repo.update('leases', weekly.id, { end_date: '2026-11-07' })
  })

  it('does not check room moves, start corrections, shorter ends, checkouts, cancels and notes', async () => {
    const other = await repo.insert('leases', row('2026-11-01', '2026-11-30', { room_id: 'R2' }))
    await repo.update('leases', other.id, { room_id: 'R1' })
    await repo.update('leases', other.id, { room_id: 'R2' })
    await repo.update('leases', weekly.id, { start_date: '2026-10-30', end_date: '2026-11-12' })
    await repo.update('leases', weekly.id, { end_date: '2026-11-02' })
    await repo.update('leases', weekly.id, { notes: 'catatan' })
    await repo.update('leases', weekly.id, { status: 'ended', checkout_date: '2026-11-03', end_date: '2026-11-02' })
    await repo.update('leases', other.id, { status: 'cancelled' })
  })
})

describe('LocalRepo waitlist rules', () => {
  it('fills the defaults and refuses rows the database would refuse', async () => {
    const entry = await repo.insert('waitlist', { name: 'Rina' } as OrgInsert<'waitlist'>)
    expect(entry).toMatchObject({ status: 'waiting', period_type: 'daily', quantity: 1, property_id: null, lease_id: null, wanted_from: null, max_price: null })
    await expect(repo.insert('waitlist', { name: '  ' } as OrgInsert<'waitlist'>)).rejects.toThrow('Nama wajib diisi.')
    await expect(repo.update('waitlist', entry.id, { quantity: 0 })).rejects.toThrow('Jumlah minimal 1.')
    await expect(repo.update('waitlist', entry.id, { max_price: -1 })).rejects.toThrow('Harga maksimal tidak boleh negatif.')
    await expect(repo.update('waitlist', entry.id, { status: 'x' as never })).rejects.toThrow('Status daftar tunggu tidak valid.')
    expect((await repo.get('waitlist', entry.id))!.quantity).toBe(1)
  })

  it('deleting the booked lease or the kos only clears the reference (ON DELETE SET NULL)', async () => {
    await repo.insert('properties', { id: 'P9', name: 'Kos', address: null, notes: null, payment_info: null, logo_path: null })
    const lease = await repo.insert('leases', row('2026-11-05', '2026-11-06'))
    const entry = await repo.insert('waitlist', { name: 'Rina', property_id: 'P9', status: 'booked', lease_id: lease.id } as OrgInsert<'waitlist'>)
    await repo.remove('leases', lease.id)
    await repo.remove('properties', 'P9')
    expect(await repo.get('waitlist', entry.id)).toMatchObject({ status: 'booked', lease_id: null, property_id: null })
  })
})
