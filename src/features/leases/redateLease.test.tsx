// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Invoice, Lease, MemberRole } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import {
  REDATE_BAD_PERIOD_MESSAGE,
  REDATE_END_BEFORE_START_MESSAGE,
  REDATE_INACTIVE_MESSAGE,
  REDATE_OVERLAP_MESSAGE,
  REDATE_SAME_DATE_MESSAGE,
  REDATE_STAFF_MESSAGE,
  StaleWriteError,
  bindOrg,
  type OrgRepo,
  type RedateLeaseInput,
} from '../../lib/repo/types'
import { billedPeriodCount, nextPeriodBounds } from '../../domain/billing'
import { LEASE_DATA_CHANGED_MESSAGE } from './leaseUtils'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions } from './useLeaseActions'

const ORG = 'org-1'
let local: LocalRepo
let repo: OrgRepo
let lease: Lease

/** The owner's case: a monthly lease typed as starting 1 Sep (it really started 18 Agt), billed Sep, Oct, Nov. */
async function seed() {
  local = new LocalRepo(emptyLocalDb())
  repo = bindOrg(local, ORG)
  state.repo = repo
  state.role = 'owner'
  await repo.insert('properties', { id: 'P1', name: 'Kos A', address: null, notes: null, payment_info: null } as never)
  lease = await repo.insert('leases', {
    id: 'L1',
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 1_000_000,
    start_date: '2026-09-01',
    end_date: '2026-11-30',
    status: 'active',
    checkout_date: null,
    notes: 'Kamar pojok',
  } as never)
  const months: [string, string, string, string, Invoice['status']][] = [
    ['SEP', 'INV-202609-0001', '2026-09-01', '2026-09-30', 'paid'],
    ['OCT', 'INV-202610-0001', '2026-10-01', '2026-10-31', 'partial'],
    ['NOV', 'INV-202611-0001', '2026-11-01', '2026-11-30', 'unpaid'],
  ]
  for (const [id, number, start, end, status] of months) {
    await repo.insert('invoices', {
      id,
      property_id: 'P1',
      lease_id: lease.id,
      invoice_number: number,
      period_type: null,
      period_start: start,
      period_end: end,
      quantity: 1,
      base_amount: 1_500_000,
      addons_amount: 0,
      extra_amount: 0,
      discount_amount: 0,
      total_amount: 1_500_000,
      due_date: start,
      status,
      notes: null,
    } as never)
  }
  await repo.insert('payments', { property_id: 'P1', invoice_id: 'SEP', lease_id: lease.id, amount: 1_500_000, paid_at: '2026-09-01', method: 'transfer', kind: 'rent', notes: null })
  await repo.insert('payments', { property_id: 'P1', invoice_id: 'OCT', lease_id: lease.id, amount: 500_000, paid_at: '2026-10-02', method: 'cash', kind: 'rent', notes: 'DP' })
  await repo.insert('payments', { property_id: 'P1', invoice_id: null, lease_id: lease.id, amount: 1_000_000, paid_at: '2026-09-01', method: 'cash', kind: 'deposit', notes: null })
}

async function data() {
  return {
    invoices: (await repo.list('invoices')).sort((a, b) => a.invoice_number.localeCompare(b.invoice_number)),
    payments: await repo.list('payments'),
    leases: await repo.list('leases'),
    lease: (await repo.get('leases', lease.id)) as Lease,
  }
}
const dates = (rows: Invoice[]) => rows.map((i) => [i.id, i.period_start, i.period_end, i.due_date])

function actions() {
  return renderHook(() => useLeaseActions()).result.current
}

/** Records every repo call, to prove a refusal came before any read or write. */
function spyRepo(base: OrgRepo): { repo: OrgRepo; calls: string[] } {
  const calls: string[] = []
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) => {
      calls.push(name)
      return fn(...args)
    }
  return {
    calls,
    repo: {
      ...base,
      get: wrap('get', base.get) as OrgRepo['get'],
      list: wrap('list', base.list) as OrgRepo['list'],
      insert: wrap('insert', base.insert) as OrgRepo['insert'],
      update: wrap('update', base.update) as OrgRepo['update'],
      remove: wrap('remove', base.remove) as OrgRepo['remove'],
      redateLease: wrap('redateLease', base.redateLease),
    },
  }
}

beforeEach(() => invalidate.mockClear())
afterEach(cleanup)

describe('Ubah tanggal mulai sewa (SPEC 7.6) through useLeaseActions', () => {
  it('the owner moves the start 14 days earlier: every period, due date and the end follow; money is untouched; the next Tagih continues', async () => {
    await seed()
    const before = await data()
    const plan = await actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-08-18', reason: 'salah ketik', today: '2026-10-23' })
    expect(plan.mode).toBe('grid')

    const after = await data()
    expect(dates(after.invoices)).toEqual([
      ['SEP', '2026-08-18', '2026-09-17', '2026-08-18'],
      ['OCT', '2026-09-18', '2026-10-17', '2026-09-18'],
      ['NOV', '2026-10-18', '2026-11-17', '2026-10-18'],
    ])
    expect(after.lease).toMatchObject({
      start_date: '2026-08-18',
      end_date: '2026-11-17',
      status: 'active',
      price_per_period: 1_500_000,
      deposit_amount: 1_000_000,
      notes: 'Kamar pojok\nTanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026): salah ketik',
    })
    // amounts, numbers, statuses and every payment exactly as they were
    const money = (rows: Invoice[]) => rows.map((i) => [i.invoice_number, i.status, i.quantity, i.base_amount, i.total_amount, i.discount_amount])
    expect(money(after.invoices)).toEqual(money(before.invoices))
    expect(after.payments).toEqual(before.payments)
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices')

    expect(billedPeriodCount(after.lease, after.invoices)).toBe(3)
    expect(nextPeriodBounds(after.lease, after.invoices, 1)).toEqual({ period_start: '2026-11-18', period_end: '2026-12-17' })
    // "Tagih" on the corrected lease: the next invoice sits on the new grid and the end follows it
    const issued = await actions().issueInvoice({
      lease: after.lease,
      addons: [],
      quantity: 1,
      notes: null,
      existingInvoices: after.invoices,
      orgInvoices: after.invoices,
    })
    expect([issued.period_start, issued.period_end, issued.due_date]).toEqual(['2026-11-18', '2026-12-17', '2026-11-18'])
    expect((await data()).lease.end_date).toBe('2026-12-17')
  })

  it('without a reason the note is just the correction line; a later start works the same', async () => {
    await seed()
    const before = await data()
    await actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-09-15', today: '2026-10-23' })
    const after = await data()
    expect(after.lease.notes).toBe('Kamar pojok\nTanggal mulai dikoreksi dari 1 Sep 2026 ke 15 Sep 2026 (23 Okt 2026)')
    expect(dates(after.invoices).map((r) => r.slice(1, 3))).toEqual([
      ['2026-09-15', '2026-10-14'],
      ['2026-10-15', '2026-11-14'],
      ['2026-11-15', '2026-12-14'],
    ])
  })

  it('staff is refused before any read or write', async () => {
    await seed()
    const before = await data()
    const spy = spyRepo(repo)
    state.repo = spy.repo
    state.role = 'staff'
    await expect(actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-08-18' })).rejects.toThrow(REDATE_STAFF_MESSAGE)
    expect(spy.calls).toEqual([])
    state.repo = repo
    expect(await data()).toEqual(before)
  })

  it('an ended or cancelled lease is refused before any read or write', async () => {
    await seed()
    for (const status of ['ended', 'cancelled'] as const) {
      const spy = spyRepo(repo)
      state.repo = spy.repo
      const before = await data()
      await expect(actions().redateLease({ lease: { ...before.lease, status }, invoices: before.invoices, newStart: '2026-08-18' })).rejects.toThrow(REDATE_INACTIVE_MESSAGE)
      expect(spy.calls).toEqual([])
    }
  })

  it('an invoice issued on another device after the screen loaded: refused with the usual message, nothing written', async () => {
    await seed()
    const before = await data()
    await repo.insert('invoices', { ...before.invoices[2], id: 'DEC', invoice_number: 'INV-202612-0001', period_start: '2026-12-01', period_end: '2026-12-31', due_date: '2026-12-01', status: 'unpaid' } as never)
    const mid = await data()
    await expect(actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-08-18' })).rejects.toThrow(LEASE_DATA_CHANGED_MESSAGE)
    expect(await data()).toEqual(mid)
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices')
  })

  it('the start changed on another device between the read and the write: the write itself refuses, nothing partial', async () => {
    await seed()
    const before = await data()
    // the other phone saves its own correction right after this one read the lease
    state.repo = {
      ...repo,
      redateLease: async (input: RedateLeaseInput) => {
        await repo.update('leases', lease.id, { start_date: '2026-08-20' })
        return repo.redateLease(input)
      },
    }
    await expect(actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-08-18' })).rejects.toThrow(LEASE_DATA_CHANGED_MESSAGE)
    const after = await data()
    expect(dates(after.invoices)).toEqual(dates(before.invoices))
    expect(after.lease).toMatchObject({ start_date: '2026-08-20', end_date: '2026-11-30', notes: 'Kamar pojok' })
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices')
  })

  it('a start that collides with the previous tenant of the room is refused with their name; nothing written', async () => {
    await seed()
    await repo.insert('leases', { id: 'PREV', property_id: 'P1', room_id: 'R1', tenant_id: 'T2', period_type: 'monthly', price_per_period: 1_200_000, deposit_amount: 0, start_date: '2026-07-01', end_date: '2026-08-24', status: 'active', checkout_date: null, notes: null } as never)
    const before = await data()
    await expect(
      actions().redateLease({ lease: before.lease, invoices: before.invoices.filter((i) => i.lease_id === lease.id), newStart: '2026-08-18', tenants: [{ id: 'T2', full_name: 'Siti Rahayu' }] }),
    ).rejects.toThrow('Bentrok dengan sewa Siti Rahayu di kamar ini (1 Jul – 25 Agt 2026). Pilih tanggal lain.')
    expect(await data()).toEqual(before)
  })

  it('the same date is refused', async () => {
    await seed()
    const before = await data()
    await expect(actions().redateLease({ lease: before.lease, invoices: before.invoices, newStart: '2026-09-01' })).rejects.toThrow(REDATE_SAME_DATE_MESSAGE)
    expect(await data()).toEqual(before)
  })
})

describe('LocalRepo.redateLease (Mode Demo) checks like the database and writes all or nothing', () => {
  const good = (): RedateLeaseInput => ({
    leaseId: 'L1',
    expectedStart: '2026-09-01',
    newStart: '2026-08-18',
    newEnd: '2026-11-17',
    invoices: [
      { id: 'SEP', period_start: '2026-08-18', period_end: '2026-09-17', due_date: '2026-08-18' },
      { id: 'OCT', period_start: '2026-09-18', period_end: '2026-10-17', due_date: '2026-09-18' },
      { id: 'NOV', period_start: '2026-10-18', period_end: '2026-11-17', due_date: '2026-10-18' },
    ],
    note: null,
  })

  it.each([
    ['a stale expected start', (i: RedateLeaseInput) => ({ ...i, expectedStart: '2026-08-31' }), StaleWriteError],
    ['a missing invoice', (i: RedateLeaseInput) => ({ ...i, invoices: i.invoices.slice(0, 2) }), StaleWriteError],
    ['an extra invoice id', (i: RedateLeaseInput) => ({ ...i, invoices: [...i.invoices, { ...i.invoices[0], id: 'OTHER' }] }), StaleWriteError],
    ['an invoice listed twice', (i: RedateLeaseInput) => ({ ...i, invoices: [i.invoices[0], i.invoices[1], i.invoices[1]] }), StaleWriteError],
    ['the same start', (i: RedateLeaseInput) => ({ ...i, newStart: '2026-09-01' }), REDATE_SAME_DATE_MESSAGE],
    ['an end before the start', (i: RedateLeaseInput) => ({ ...i, newEnd: '2026-08-17' }), REDATE_END_BEFORE_START_MESSAGE],
    [
      'the last invoice ending before it starts',
      (i: RedateLeaseInput) => ({ ...i, invoices: [i.invoices[0], i.invoices[1], { ...i.invoices[2], period_end: '2026-10-01' }] }),
      REDATE_BAD_PERIOD_MESSAGE,
    ],
  ] as const)('%s is refused and nothing is written', async (_label, change, expected) => {
    await seed()
    const before = local.snapshot()
    const attempt = repo.redateLease(change(good()))
    if (typeof expected === 'string') await expect(attempt).rejects.toThrow(expected)
    else await expect(attempt).rejects.toBeInstanceOf(expected)
    expect(local.snapshot()).toEqual(before)
  })

  it('an ended lease, an overlap and another organisation are refused', async () => {
    await seed()
    await repo.insert('leases', { id: 'PREV', property_id: 'P1', room_id: 'R1', tenant_id: 'T2', period_type: 'monthly', price_per_period: 1, deposit_amount: 0, start_date: '2026-07-01', end_date: '2026-08-24', status: 'active', checkout_date: null, notes: null } as never)
    const before = local.snapshot()
    await expect(repo.redateLease(good())).rejects.toThrow(REDATE_OVERLAP_MESSAGE)
    await expect(bindOrg(local, 'org-2').redateLease(good())).rejects.toThrow('Sewa tidak ditemukan.')
    expect(local.snapshot()).toEqual(before)
    await repo.update('leases', 'L1', { status: 'ended', checkout_date: '2026-11-30' })
    const ended = local.snapshot()
    await expect(repo.redateLease(good())).rejects.toThrow(REDATE_INACTIVE_MESSAGE)
    expect(local.snapshot()).toEqual(ended)
  })

  it('a browser storage failure restores every row', async () => {
    await seed()
    const before = local.snapshot()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      await expect(repo.redateLease(good())).rejects.toThrow('Penyimpanan browser penuh atau tidak tersedia.')
    } finally {
      setItem.mockRestore()
    }
    expect(local.snapshot()).toEqual(before)
  })

  it('writes the lease, every invoice and the note in one go', async () => {
    await seed()
    await repo.redateLease({ ...good(), note: 'Tanggal mulai dikoreksi' })
    const after = await data()
    expect(dates(after.invoices).map((r) => r.slice(1))).toEqual(good().invoices.map((i) => [i.period_start, i.period_end, i.due_date]))
    expect(after.lease).toMatchObject({ start_date: '2026-08-18', end_date: '2026-11-17', notes: 'Kamar pojok\nTanggal mulai dikoreksi' })
  })
})
