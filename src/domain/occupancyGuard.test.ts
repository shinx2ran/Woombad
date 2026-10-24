import { describe, expect, it } from 'vitest'
import type { Lease } from '../types/db'
import { guardedNights, overlappingLease } from './occupancy'

// SPEC 7.7: the rule of public.leases_overlap_guard, as LocalRepo and the app's pre-checks use it.
const TODAY = '2026-11-01'
const ts = { org_id: 'o', created_at: '', updated_at: '' }
function lease(id: string, start: string, end: string, extra: Partial<Lease> = {}): Lease {
  return {
    id,
    property_id: 'P',
    room_id: 'R',
    tenant_id: 'T',
    period_type: 'daily',
    price_per_period: 1,
    deposit_amount: 0,
    start_date: start,
    end_date: end,
    status: 'active',
    checkout_date: null,
    notes: null,
    ...ts,
    ...extra,
  }
}

describe('guardedNights', () => {
  it('insert of an active lease: its future nights only', () => {
    expect(guardedNights(null, lease('a', '2026-11-05', '2026-11-06'), TODAY)).toEqual({ from: '2026-11-05', to: '2026-11-06' })
    expect(guardedNights(null, lease('a', '2026-10-20', '2026-11-03'), TODAY)).toEqual({ from: TODAY, to: '2026-11-03' })
    expect(guardedNights(null, lease('a', '2026-10-01', '2026-10-31'), TODAY)).toBeNull()
  })

  it('insert of history (ended / cancelled) is not checked', () => {
    expect(guardedNights(null, lease('a', '2026-11-05', '2026-11-06', { status: 'ended', checkout_date: '2026-11-07' }), TODAY)).toBeNull()
    expect(guardedNights(null, lease('a', '2026-11-05', '2026-11-06', { status: 'cancelled' }), TODAY)).toBeNull()
  })

  it('an extension (same room, start and active status, later end): the added future nights', () => {
    const before = lease('a', '2026-10-01', '2026-11-04')
    expect(guardedNights(before, { ...before, end_date: '2026-11-11' }, TODAY)).toEqual({ from: '2026-11-05', to: '2026-11-11' })
    const lapsed = lease('a', '2026-09-01', '2026-10-15')
    expect(guardedNights(lapsed, { ...lapsed, end_date: '2026-11-14' }, TODAY)).toEqual({ from: TODAY, to: '2026-11-14' })
    expect(guardedNights(lapsed, { ...lapsed, end_date: '2026-10-25' }, TODAY)).toBeNull()
  })

  it('room moves, start corrections, shorter ends, checkouts and cancels are not checked', () => {
    const before = lease('a', '2026-10-01', '2026-11-04')
    expect(guardedNights(before, { ...before, room_id: 'R2', end_date: '2026-11-30' }, TODAY)).toBeNull()
    expect(guardedNights(before, { ...before, start_date: '2026-10-02', end_date: '2026-11-30' }, TODAY)).toBeNull()
    expect(guardedNights(before, { ...before, end_date: '2026-11-02' }, TODAY)).toBeNull()
    expect(guardedNights(before, { ...before, status: 'ended', checkout_date: '2026-11-03' }, TODAY)).toBeNull()
    expect(guardedNights(before, { ...before, status: 'cancelled' }, TODAY)).toBeNull()
    expect(guardedNights({ ...before, status: 'ended' }, { ...before, end_date: '2026-11-30' }, TODAY)).toBeNull()
  })
})

describe('overlappingLease', () => {
  it('finds another non-cancelled lease of the room holding a night of the window', () => {
    const booked = lease('b', '2026-11-05', '2026-11-06')
    expect(overlappingLease([booked], 'R', '2026-11-06', '2026-11-08')).toBe(booked)
    expect(overlappingLease([booked], 'R', '2026-11-07', '2026-11-08')).toBeNull() // check-out day reuse
    expect(overlappingLease([booked], 'R', '2026-11-01', '2026-11-04')).toBeNull()
    expect(overlappingLease([booked], 'R2', '2026-11-05', '2026-11-06')).toBeNull()
    expect(overlappingLease([booked], 'R', '2026-11-05', '2026-11-06', 'b')).toBeNull()
    expect(overlappingLease([{ ...booked, status: 'cancelled' }], 'R', '2026-11-05', '2026-11-06')).toBeNull()
  })

  it('an ended lease holds until the night before its checkout date; one without a night holds none', () => {
    const ended = lease('e', '2026-10-01', '2026-11-30', { status: 'ended', checkout_date: '2026-11-05' })
    expect(overlappingLease([ended], 'R', '2026-11-04', '2026-11-04')).toBe(ended)
    expect(overlappingLease([ended], 'R', '2026-11-05', '2026-11-09')).toBeNull()
    const noNight = lease('n', '2026-11-05', '2026-11-05', { status: 'ended', checkout_date: '2026-11-05' })
    expect(overlappingLease([noNight], 'R', '2026-11-01', '2026-11-30')).toBeNull()
  })
})
