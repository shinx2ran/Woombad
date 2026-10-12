import { describe, expect, it } from 'vitest'
import { LocalRepo, emptyLocalDb } from './localRepo'
import { DELETE_DENIED_MESSAGE, IN_USE_MESSAGE, UPDATE_DENIED_MESSAGE, VOID_PAID_INVOICE_MESSAGE } from './types'

async function setup() {
  const repo = new LocalRepo(emptyLocalDb())
  const invoice = (id: string) => ({
    id,
    org_id: 'o1',
    property_id: 'P1',
    lease_id: 'L1',
    invoice_number: id,
    period_type: null,
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    quantity: 1,
    base_amount: 1_000_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_000_000,
    due_date: '2026-10-01',
    status: 'unpaid' as const,
    notes: null,
  })
  await repo.insertMany('invoices', [invoice('paid-dp'), invoice('no-pay'), invoice('other-only')])
  const pay = (invoice_id: string | null, kind: 'rent' | 'other') => ({
    org_id: 'o1',
    property_id: 'P1',
    invoice_id,
    lease_id: 'L1',
    amount: 300_000,
    paid_at: '2026-09-20',
    method: 'cash' as const,
    kind,
    notes: null,
    created_by: null,
  })
  await repo.insertMany('payments', [pay('paid-dp', 'rent'), pay(null, 'other')])
  return repo
}

describe('LocalRepo mirrors the database', () => {
  it('refuses to void an invoice that has a rent payment (invoices_void_guard)', async () => {
    const repo = await setup()
    await expect(repo.update('invoices', 'paid-dp', { status: 'void' })).rejects.toThrow(VOID_PAID_INVOICE_MESSAGE)
    expect((await repo.get('invoices', 'paid-dp'))?.status).toBe('unpaid')
    // closing it at the paid amount is fine
    await expect(repo.update('invoices', 'paid-dp', { total_amount: 300_000, discount_amount: 700_000, status: 'paid' })).resolves.toMatchObject({ status: 'paid' })
  })

  it('voids an invoice without rent payments, and an already void one stays editable', async () => {
    const repo = await setup()
    await expect(repo.update('invoices', 'no-pay', { status: 'void' })).resolves.toMatchObject({ status: 'void' })
    await expect(repo.update('invoices', 'no-pay', { status: 'void', notes: 'x' })).resolves.toMatchObject({ notes: 'x' })
    await expect(repo.update('invoices', 'other-only', { status: 'void' })).resolves.toMatchObject({ status: 'void' })
  })

  it('update/remove of a missing row (or another organisation) is an error, never a silent no-op', async () => {
    const repo = await setup()
    await expect(repo.update('invoices', 'nope', { notes: 'x' })).rejects.toThrow(UPDATE_DENIED_MESSAGE)
    await expect(repo.remove('invoices', 'nope')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await expect(repo.remove('invoices', 'no-pay', 'other-org')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await repo.remove('invoices', 'no-pay', 'o1')
    expect(await repo.get('invoices', 'no-pay')).toBeNull()
    await expect(repo.remove('invoices', 'no-pay', 'o1')).rejects.toThrow(DELETE_DENIED_MESSAGE)
  })

  it('a row still referenced cannot be deleted (ON DELETE RESTRICT)', async () => {
    const repo = await setup()
    await expect(repo.remove('invoices', 'paid-dp')).rejects.toThrow(IN_USE_MESSAGE)
    expect(await repo.get('invoices', 'paid-dp')).not.toBeNull()
  })
})
