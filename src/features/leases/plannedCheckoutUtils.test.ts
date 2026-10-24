import { describe, expect, it } from 'vitest'
import { plannedCheckoutOf } from '../../domain/occupancy'
import { defaultPlannedCheckout, plannedCheckoutBadge, plannedCheckoutError, plannedCheckoutNote } from './leaseUtils'

// SPEC 7.8 Rencana keluar: the helpers behind the sheet and the badges. Today: 24 Okt 2026.
const TODAY = '2026-10-24'

describe('plannedCheckoutOf', () => {
  it('is the planned check-out day of an active lease only', () => {
    expect(plannedCheckoutOf({ status: 'active', planned_checkout_date: '2026-11-20' })).toBe('2026-11-20')
    expect(plannedCheckoutOf({ status: 'active', planned_checkout_date: null })).toBeNull()
    // rows stored before the column existed carry no key at all
    expect(plannedCheckoutOf({ status: 'active' })).toBeNull()
    expect(plannedCheckoutOf({ status: 'ended', planned_checkout_date: '2026-11-20' })).toBeNull()
    expect(plannedCheckoutOf({ status: 'cancelled', planned_checkout_date: '2026-11-20' })).toBeNull()
  })
})

describe('defaultPlannedCheckout', () => {
  it('a recorded plan, else the check-out day of the billed period (end_date + 1), never a day in the past', () => {
    expect(defaultPlannedCheckout({ end_date: '2026-11-30', planned_checkout_date: '2026-11-15' }, TODAY)).toBe('2026-11-15')
    expect(defaultPlannedCheckout({ end_date: '2026-11-30', planned_checkout_date: null }, TODAY)).toBe('2026-12-01')
    expect(defaultPlannedCheckout({ end_date: '2026-11-30' }, TODAY)).toBe('2026-12-01')
    // month end: 31 Okt is the last night, 1 Nov the check-out day
    expect(defaultPlannedCheckout({ end_date: '2026-10-31' }, TODAY)).toBe('2026-11-01')
    // billed only through yesterday's night: today; through an older night: today too
    expect(defaultPlannedCheckout({ end_date: '2026-10-23' }, TODAY)).toBe(TODAY)
    expect(defaultPlannedCheckout({ end_date: '2026-10-10' }, TODAY)).toBe(TODAY)
  })
})

describe('plannedCheckoutError', () => {
  it('a check-out day after the first night', () => {
    expect(plannedCheckoutError({ start_date: '2026-09-01' }, '2026-09-02')).toBeNull()
    expect(plannedCheckoutError({ start_date: '2026-09-01' }, '2026-09-01')).toBe('Tanggal keluar harus sesudah tanggal mulai sewa (1 Sep 2026).')
    expect(plannedCheckoutError({ start_date: '2026-09-01' }, '2026-08-31')).toBe('Tanggal keluar harus sesudah tanggal mulai sewa (1 Sep 2026).')
    expect(plannedCheckoutError({ start_date: '2026-09-01' }, '')).toBe('Isi tanggal keluar.')
  })
})

describe('plannedCheckoutNote', () => {
  const lease = { end_date: '2026-11-30' }
  it('nothing on the billed check-out day', () => {
    expect(plannedCheckoutNote(lease, '2026-12-01')).toBeNull()
  })
  it('earlier: the room is offered from the billed check-out day (the database guard holds it until then)', () => {
    expect(plannedCheckoutNote(lease, '2026-11-20')).toBe(
      'Sewa sudah ditagih sampai check-out 1 Des 2026. Cek kamar menawarkan kamar ini mulai 1 Des 2026, atau sejak checkout dicatat.',
    )
  })
  it('later: the nights after the billed period are not billed', () => {
    expect(plannedCheckoutNote(lease, '2026-12-05')).toBe('Malam 1 Des – 5 Des 2026 belum ditagih. Buat tagihan berikutnya bila penyewa tetap tinggal sampai hari itu.')
    expect(plannedCheckoutNote(lease, '2027-01-03')).toBe('Malam 1 Des 2026 – 3 Jan 2027 belum ditagih. Buat tagihan berikutnya bila penyewa tetap tinggal sampai hari itu.')
  })
})

describe('plannedCheckoutBadge', () => {
  it("'Akan keluar 24 Nov' from today on; a day that passed without a checkout says so", () => {
    expect(plannedCheckoutBadge('2026-11-24', TODAY)).toEqual({ text: 'Akan keluar 24 Nov', overdue: false })
    expect(plannedCheckoutBadge(TODAY, TODAY)).toEqual({ text: 'Akan keluar 24 Okt', overdue: false })
    expect(plannedCheckoutBadge('2026-10-20', TODAY)).toEqual({ text: 'Rencana keluar 20 Okt lewat', overdue: true })
  })
})
