// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Invoice, Lease, MemberRole, Payment } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { DELETE_DENIED_MESSAGE, VOID_PAID_INVOICE_MESSAGE, bindOrg, type OrgRepo } from '../../lib/repo/types'
import { outstandingInvoices, summarizeFinance } from '../../domain/finance'
import type { DepositSettlement } from './leaseUtils'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions } from './useLeaseActions'

const ORG = 'org-1'
const SEP = 'inv-sep'
const OCT = 'inv-oct'
const NOV = 'inv-nov'

let local: LocalRepo
let repo: OrgRepo
let lease: Lease

async function seed(opts: { start?: string; dp?: number; deposit?: number } = {}) {
  local = new LocalRepo(emptyLocalDb())
  repo = bindOrg(local, ORG)
  state.repo = repo
  state.role = 'owner'
  await repo.insert('properties', { id: 'P1', name: 'Kos A', address: null, notes: null, payment_info: null } as never)
  lease = await repo.insert('leases', {
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: opts.deposit ?? 0,
    start_date: opts.start ?? '2026-09-01',
    end_date: '2026-11-30',
    status: 'active',
    checkout_date: null,
    notes: null,
  })
  const months: [string, string, string, string][] = [
    [SEP, 'INV-202609-0001', '2026-09-01', '2026-09-30'],
    [OCT, 'INV-202610-0001', '2026-10-01', '2026-10-31'],
    [NOV, 'INV-202611-0001', '2026-11-01', '2026-11-30'],
  ]
  for (const [id, number, start, end] of months) {
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
      status: id === OCT ? 'partial' : 'unpaid',
      notes: null,
    } as never)
  }
  await repo.insert('payments', {
    property_id: 'P1',
    invoice_id: OCT,
    lease_id: lease.id,
    amount: opts.dp ?? 500_000,
    paid_at: '2026-09-10',
    method: 'transfer',
    kind: 'rent',
    notes: 'DP',
  })
  if (opts.deposit) {
    await repo.insert('payments', {
      property_id: 'P1',
      invoice_id: null,
      lease_id: lease.id,
      amount: opts.deposit,
      paid_at: '2026-09-01',
      method: 'cash',
      kind: 'deposit',
      notes: null,
    })
  }
}

async function data() {
  return {
    invoices: await repo.list('invoices'),
    payments: await repo.list('payments'),
    expenses: await repo.list('expenses'),
    lease: (await repo.get('leases', lease.id)) as Lease,
  }
}
const byId = (rows: Invoice[], id: string) => rows.find((i) => i.id === id) as Invoice
const noSettlement = (): DepositSettlement => ({ refund: 0, rent: 0, damage: 0, damageNotes: '' })

function actions() {
  return renderHook(() => useLeaseActions()).result.current
}

beforeEach(() => invalidate.mockClear())
afterEach(cleanup)

describe('checkout with a part-paid invoice after the checkout date', () => {
  it("'refund' closes the invoice (never voids it), then records one rent_refund; revenue nets to 0", async () => {
    await seed({ deposit: 1_000_000 })
    const before = await data()
    await actions().checkout({
      lease,
      checkoutDate: '2026-09-20',
      invoices: before.invoices,
      payments: before.payments,
      settlement: { ...noSettlement(), refund: 1_000_000 },
      partialDecisions: { [OCT]: 'refund' },
    })
    const after = await data()
    expect(byId(after.invoices, NOV).status).toBe('void')
    expect(byId(after.invoices, OCT)).toMatchObject({ status: 'paid', total_amount: 500_000, discount_amount: 1_000_000, notes: 'DP dikembalikan (checkout)' })
    expect(byId(after.invoices, SEP).status).toBe('unpaid')
    const refunds = after.expenses.filter((e) => e.category === 'rent_refund')
    expect(refunds).toHaveLength(1)
    expect(refunds[0]).toMatchObject({ amount: 500_000, lease_id: lease.id, property_id: 'P1', expense_date: '2026-09-20' })
    expect(refunds[0].description).toContain('INV-202610-0001')
    expect(after.expenses.filter((e) => e.category === 'deposit_refund').map((e) => e.amount)).toEqual([1_000_000])
    expect(after.lease).toMatchObject({ status: 'ended', checkout_date: '2026-09-20', end_date: '2026-09-20' })

    const range = { start: '2026-09-01', end: '2026-12-31' }
    const sum = summarizeFinance(after.payments, after.expenses, after.invoices, range)
    expect(sum.rentRevenue).toBe(500_000)
    expect(sum.rentRefunds).toBe(500_000)
    expect(sum.revenue).toBe(0)
    // only the September rent (before checkout) stays receivable
    expect(outstandingInvoices(after.invoices, after.payments, '2026-12-31').map((o) => o.invoice.id)).toEqual([SEP])
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices', 'payments', 'expenses')
  })

  it("'forfeit' still keeps the DP as revenue with no expense", async () => {
    await seed()
    const before = await data()
    await actions().checkout({
      lease,
      checkoutDate: '2026-09-20',
      invoices: before.invoices,
      payments: before.payments,
      settlement: noSettlement(),
      partialDecisions: { [OCT]: 'forfeit' },
    })
    const after = await data()
    expect(byId(after.invoices, OCT)).toMatchObject({ status: 'paid', total_amount: 500_000, notes: 'Sisa dianggap hangus (checkout)' })
    expect(after.expenses).toEqual([])
    expect(summarizeFinance(after.payments, after.expenses, after.invoices, { start: '2026-09-01', end: '2026-12-31' }).revenue).toBe(500_000)
  })

  it('a refused invoice write leaves no expense or payment behind', async () => {
    await seed({ deposit: 1_000_000 })
    const before = await data()
    const failing: OrgRepo = {
      ...repo,
      update: (async (table: string, id: string, patch: never) => {
        if (table === 'invoices' && id === OCT) throw new Error('Total tagihan tidak boleh lebih kecil dari jumlah yang sudah dibayar.')
        return repo.update(table as 'invoices', id, patch)
      }) as OrgRepo['update'],
    }
    state.repo = failing
    await expect(
      actions().checkout({
        lease,
        checkoutDate: '2026-09-20',
        invoices: before.invoices,
        payments: before.payments,
        settlement: { ...noSettlement(), rent: 500_000, refund: 500_000 },
        partialDecisions: { [OCT]: 'refund' },
      }),
    ).rejects.toThrow('Total tagihan')
    const after = await data()
    expect(after.expenses).toEqual([])
    expect(after.payments).toHaveLength(before.payments.length)
    expect(after.lease.status).toBe('active')
    // the screen is refreshed after a failure too
    expect(invalidate).toHaveBeenCalledWith('leases', 'invoices', 'payments', 'expenses')
  })

  it('staff is refused before any write', async () => {
    await seed()
    state.role = 'staff'
    const before = await data()
    await expect(
      actions().checkout({ lease, checkoutDate: '2026-09-20', invoices: before.invoices, payments: before.payments, settlement: noSettlement(), partialDecisions: { [OCT]: 'refund' } }),
    ).rejects.toThrow('Hanya pemilik/admin')
    expect((await data()).invoices.map((i) => i.status)).toEqual(before.invoices.map((i) => i.status))
  })
})

describe('retrying after the refund expense failed to save', () => {
  async function failFirstExpenseInsert() {
    const before = await data()
    let failed = false
    state.repo = {
      ...repo,
      insert: (async (table: string, row: never) => {
        if (table === 'expenses' && !failed) {
          failed = true
          throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
        }
        return repo.insert(table as 'expenses', row)
      }) as OrgRepo['insert'],
    }
    await expect(
      actions().cancelLease({ lease, invoices: before.invoices, payments: before.payments, partialDecisions: { [OCT]: 'refund' }, settlement: noSettlement(), dateISO: '2026-09-15' }),
    ).rejects.toThrow('koneksi')
    state.repo = repo
    const mid = await data()
    // the invoice is already closed, nothing was refunded yet, the lease is still active
    expect(byId(mid.invoices, OCT)).toMatchObject({ status: 'paid', total_amount: 500_000 })
    expect(mid.expenses).toEqual([])
    expect(mid.lease.status).toBe('active')
    return before
  }

  it('with the screen data from before the failure: one refund, invoice unchanged', async () => {
    await seed()
    const stale = await failFirstExpenseInsert()
    await actions().cancelLease({ lease, invoices: stale.invoices, payments: stale.payments, partialDecisions: { [OCT]: 'refund' }, settlement: noSettlement(), dateISO: '2026-09-15' })
    const after = await data()
    expect(after.expenses.filter((e) => e.category === 'rent_refund').map((e) => e.amount)).toEqual([500_000])
    expect(byId(after.invoices, OCT)).toMatchObject({ status: 'paid', total_amount: 500_000, discount_amount: 1_000_000, notes: 'DP dikembalikan (sewa dibatalkan)' })
    expect(after.lease.status).toBe('cancelled')
  })

  it('with refreshed data (the invoice already shows as paid): the missing refund is still recorded once', async () => {
    await seed()
    await failFirstExpenseInsert()
    const fresh = await data()
    await actions().cancelLease({ lease, invoices: fresh.invoices, payments: fresh.payments, partialDecisions: {}, settlement: noSettlement(), dateISO: '2026-09-15' })
    await actions().cancelLease({ lease, invoices: fresh.invoices, payments: fresh.payments, partialDecisions: {}, settlement: noSettlement(), dateISO: '2026-09-15' })
    const after = await data()
    expect(after.expenses.filter((e) => e.category === 'rent_refund').map((e) => e.amount)).toEqual([500_000])
    expect(summarizeFinance(after.payments, after.expenses, after.invoices, { start: '2026-09-01', end: '2026-12-31' }).revenue).toBe(0)
  })
})

describe('cancel', () => {
  it('a missing decision is refused before any invoice is voided', async () => {
    await seed()
    const before = await data()
    await expect(
      actions().cancelLease({ lease, invoices: before.invoices, payments: before.payments, partialDecisions: {}, settlement: noSettlement(), dateISO: '2026-09-15' }),
    ).rejects.toThrow('Pilih penyelesaian untuk tagihan INV-202610-0001.')
    expect((await data()).invoices.map((i) => i.status)).toEqual(before.invoices.map((i) => i.status))
  })

  it("a DP refunded on a lease that never started: nothing owed, revenue 0", async () => {
    await seed({ start: '2026-10-15', dp: 300_000 })
    const before = await data()
    await actions().cancelLease({ lease, invoices: before.invoices, payments: before.payments, partialDecisions: { [OCT]: 'refund' }, settlement: noSettlement(), dateISO: '2026-10-05' })
    const after = await data()
    expect(byId(after.invoices, SEP).status).toBe('void')
    expect(byId(after.invoices, NOV).status).toBe('void')
    expect(byId(after.invoices, OCT)).toMatchObject({ status: 'paid', total_amount: 300_000 })
    const sum = summarizeFinance(after.payments, after.expenses, after.invoices, { start: '2026-09-01', end: '2026-12-31' })
    expect(sum.revenue).toBe(0)
    expect(sum.outstanding).toBe(0)
    expect(after.lease).toMatchObject({ status: 'cancelled', end_date: '2026-10-15' })
  })
})

describe('Mode Demo behaves like the database', () => {
  it('voiding an invoice with a rent payment is refused (invoices_void_guard)', async () => {
    await seed()
    await expect(repo.update('invoices', OCT, { status: 'void' })).rejects.toThrow(VOID_PAID_INVOICE_MESSAGE)
  })

  it('deleting a payment that is already gone reports it instead of a false success', async () => {
    await seed()
    const [payment] = (await repo.list('payments')) as Payment[]
    await repo.remove('payments', payment.id)
    await expect(actions().deletePayment(payment)).rejects.toThrow(DELETE_DENIED_MESSAGE)
    expect(invalidate).toHaveBeenCalledWith('payments')
  })
})
