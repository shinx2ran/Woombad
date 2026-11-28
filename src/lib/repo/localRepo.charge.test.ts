import { beforeEach, describe, expect, it } from 'vitest'
import type { Invoice, OrgInsert } from '../../types/db'
import { LocalRepo, emptyLocalDb } from './localRepo'
import { CHARGE_SHAPE_MESSAGE, bindOrg, type OrgRepo } from './types'

// SPEC 7.31: Mode Demo mirrors invoices_invoice_type_check and invoices_charge_shape_check
let repo: OrgRepo

function charge(extra: Partial<OrgInsert<'invoices'>> = {}): OrgInsert<'invoices'> {
  return {
    property_id: 'P1',
    lease_id: 'L1',
    invoice_number: 'INV-202611-0009',
    invoice_type: 'charge',
    period_type: null,
    period_start: '2026-11-28',
    period_end: '2026-11-28',
    quantity: 1,
    base_amount: 0,
    addons_amount: 0,
    extra_amount: 150_000,
    discount_amount: 0,
    total_amount: 150_000,
    due_date: '2026-11-28',
    status: 'unpaid',
    notes: 'Late checkout',
    ...extra,
  }
}

beforeEach(() => {
  repo = bindOrg(new LocalRepo(emptyLocalDb(), { today: () => '2026-11-28' }), 'org-1')
})

describe('LocalRepo biaya tambahan shape', () => {
  it('saves a well-formed charge and a rent invoice without invoice_type', async () => {
    await expect(repo.insertMany('invoices', [charge()])).resolves.toHaveLength(1)
    const { invoice_type: _omit, ...rent } = charge({ invoice_number: 'INV-202611-0010', period_type: 'monthly', period_end: '2026-12-27', base_amount: 1_000_000, extra_amount: 0, total_amount: 1_000_000 })
    const [saved] = await repo.insertMany('invoices', [rent as OrgInsert<'invoices'>])
    expect((saved as Invoice).invoice_type).toBe('rent')
  })

  it.each([
    ['a rent amount', { base_amount: 100_000, total_amount: 250_000 }],
    ['an amount of 0', { extra_amount: 0, total_amount: 0 }],
    ['a discount down to 0', { discount_amount: 150_000, total_amount: 0 }],
    ['more than one day', { period_end: '2026-11-29' }],
    ['a period type', { period_type: 'daily' as const }],
    ['an unknown type', { invoice_type: 'fee' as unknown as 'charge' }],
  ])('refuses a charge with %s', async (_name, over) => {
    await expect(repo.insertMany('invoices', [charge(over)])).rejects.toThrow(CHARGE_SHAPE_MESSAGE)
  })

  it('refuses an edit that breaks a saved charge, and allows a fair one', async () => {
    const [saved] = await repo.insertMany('invoices', [charge()])
    await expect(repo.update('invoices', saved.id, { discount_amount: 150_000, total_amount: 0 })).rejects.toThrow(CHARGE_SHAPE_MESSAGE)
    await expect(repo.update('invoices', saved.id, { base_amount: 50_000, total_amount: 200_000 })).rejects.toThrow(CHARGE_SHAPE_MESSAGE)
    await expect(repo.update('invoices', saved.id, { extra_amount: 200_000, discount_amount: 25_000, total_amount: 175_000, notes: 'Late checkout 3 jam' })).resolves.toMatchObject({
      total_amount: 175_000,
    })
  })
})
