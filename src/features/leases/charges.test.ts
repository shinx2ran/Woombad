// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Invoice, Lease, MemberRole } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { depositBalance, summarizeLeaseBilling } from '../../domain/billing'
import {
  CHARGE_DESCRIPTION_MAX,
  CHARGE_PRESETS,
  chargeInvoiceRow,
  chargePayWithLabel,
  chargePresetText,
  chargeSavedText,
  chargeSummaryText,
  chargeTitle,
  hasChargeErrors,
  validateCharge,
  type ValidateChargeInput,
} from './charges'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { CHARGE_CANCELLED_MESSAGE, ChargeSavedError, useLeaseActions } from './useLeaseActions'

const LEASE = { id: 'L1', property_id: 'P1' } as Lease

function inv(number: string): Invoice {
  return { id: number, invoice_number: number } as Invoice
}

const valid = (over: Partial<ValidateChargeInput> = {}): ValidateChargeInput => ({
  description: 'Late checkout',
  amount: 100_000,
  date: '2026-11-20',
  leaseStart: '2026-11-01',
  depositHeld: 0,
  payWith: 'cash',
  ...over,
})

describe('charge presets', () => {
  it('are the five quick picks; Lainnya empties Keterangan for free text', () => {
    expect(CHARGE_PRESETS).toEqual(['Late checkout', 'Kerusakan', 'Kebersihan', 'Tamu menginap', 'Lainnya'])
    expect(chargePresetText('Kerusakan')).toBe('Kerusakan')
    expect(chargePresetText('Lainnya')).toBe('')
  })
})

describe('validateCharge', () => {
  it('accepts a described positive amount on or after the start, paid any way', () => {
    expect(validateCharge(valid())).toEqual({})
    expect(validateCharge(valid({ date: '2026-11-01', payWith: null }))).toEqual({})
    expect(hasChargeErrors(validateCharge(valid()))).toBe(false)
  })

  it('needs a keterangan of at most 200 letters', () => {
    expect(validateCharge(valid({ description: '   ' })).description).toBe('Keterangan wajib diisi.')
    expect(validateCharge(valid({ description: 'x'.repeat(CHARGE_DESCRIPTION_MAX) })).description).toBeUndefined()
    expect(validateCharge(valid({ description: 'x'.repeat(CHARGE_DESCRIPTION_MAX + 1) })).description).toBe('Keterangan maksimal 200 huruf.')
  })

  it('needs a whole amount above 0', () => {
    expect(validateCharge(valid({ amount: 0 })).amount).toBe('Jumlah harus lebih dari 0.')
    expect(validateCharge(valid({ amount: -5 })).amount).toBe('Jumlah harus lebih dari 0.')
    expect(validateCharge(valid({ amount: 10.5 })).amount).toBe('Jumlah harus lebih dari 0.')
  })

  it('needs a date, not before the lease starts', () => {
    expect(validateCharge(valid({ date: '' })).date).toBe('Tanggal wajib diisi.')
    expect(validateCharge(valid({ date: '2026-10-31' })).date).toBe('Tanggal tidak boleh sebelum mulai sewa (1 Nov 2026).')
  })

  it('Potong jaminan only when the deposit held covers the amount', () => {
    expect(validateCharge(valid({ payWith: 'deposit', depositHeld: 100_000 }))).toEqual({})
    expect(validateCharge(valid({ payWith: 'deposit', depositHeld: 99_999 })).payWith).toBe('Jaminan yang dipegang hanya Rp 99.999.')
    expect(validateCharge(valid({ payWith: 'deposit', depositHeld: -1 })).payWith).toBe('Jaminan yang dipegang hanya Rp 0.')
    // other ways of paying never look at the deposit; without an amount only the amount is wrong
    expect(validateCharge(valid({ payWith: 'cash', depositHeld: 0 }))).toEqual({})
    expect(validateCharge(valid({ payWith: 'deposit', depositHeld: 0, amount: 0 }))).toEqual({ amount: 'Jumlah harus lebih dari 0.' })
  })
})

describe('chargeInvoiceRow', () => {
  it('is one day, quantity 1, the amount as extra, no period type, numbered in the month of its date', () => {
    const org = [inv('INV-202611-0001'), inv('INV-202611-0002'), inv('INV-202612-0007')]
    expect(chargeInvoiceRow(LEASE, { description: '  Late checkout ', amount: 150_000, date: '2026-11-20' }, org)).toEqual({
      property_id: 'P1',
      lease_id: 'L1',
      invoice_number: 'INV-202611-0003',
      invoice_type: 'charge',
      period_type: null,
      period_start: '2026-11-20',
      period_end: '2026-11-20',
      due_date: '2026-11-20',
      quantity: 1,
      base_amount: 0,
      addons_amount: 0,
      extra_amount: 150_000,
      discount_amount: 0,
      total_amount: 150_000,
      status: 'unpaid',
      notes: 'Late checkout',
    })
    expect(chargeInvoiceRow(LEASE, { description: 'Kerusakan', amount: 1, date: '2027-01-02' }, org).invoice_number).toBe('INV-202701-0001')
  })
})

describe('charge texts', () => {
  it('names a charge by its keterangan', () => {
    expect(chargeTitle({ invoice_type: 'charge', notes: ' Late checkout ' })).toBe('Biaya tambahan · Late checkout')
    expect(chargeTitle({ invoice_type: 'charge', notes: null })).toBe('Biaya tambahan')
  })

  it('labels the ways of paying', () => {
    expect([null, 'cash', 'transfer', 'qris', 'deposit'].map((p) => chargePayWithLabel(p as never))).toEqual(['Bayar nanti', 'Tunai', 'Transfer', 'QRIS', 'Potong jaminan'])
  })

  it('summarises what saving does with the money', () => {
    expect(chargeSummaryText(0, 'cash', 0)).toBeNull()
    expect(chargeSummaryText(150_000, 'cash', 0)).toBe('Rp 150.000 dibayar Tunai hari ini; biaya langsung lunas.')
    expect(chargeSummaryText(150_000, 'deposit', 500_000)).toBe('Rp 150.000 dipotong dari jaminan; jaminan dipegang menjadi Rp 350.000.')
    expect(chargeSummaryText(150_000, null, 0)).toBe('Rp 150.000 belum dibayar: masuk Sisa tagihan, bayar nanti dari daftar tagihan.')
    expect(chargeSavedText(150_000, 'qris')).toBe('Biaya tambahan Rp 150.000 dicatat, lunas (QRIS).')
    expect(chargeSavedText(150_000, 'deposit')).toBe('Biaya tambahan Rp 150.000 dicatat, dipotong dari jaminan.')
    expect(chargeSavedText(150_000, null)).toBe('Biaya tambahan Rp 150.000 dicatat, belum dibayar.')
  })
})

// ---------- useLeaseActions.addCharge (SPEC 7.31) ----------

const ORG = 'org-1'
const TODAY = '2026-11-20'
let repo: OrgRepo
let lease: Lease

/** A monthly lease from 1 Nov, November billed and paid, a deposit of 500.000 received. */
async function seed(opts: { status?: Lease['status']; deposit?: number } = {}) {
  repo = bindOrg(new LocalRepo(emptyLocalDb()), ORG)
  state.repo = repo
  state.role = 'owner'
  lease = await repo.insert('leases', {
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 500_000,
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    status: opts.status ?? 'active',
    checkout_date: null,
    notes: null,
  })
  await repo.insert('invoices', {
    id: 'inv-nov',
    property_id: 'P1',
    lease_id: lease.id,
    invoice_number: 'INV-202611-0001',
    period_type: null,
    period_start: '2026-11-01',
    period_end: '2026-11-30',
    quantity: 1,
    base_amount: 1_500_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_500_000,
    due_date: '2026-11-01',
    status: 'paid',
    notes: null,
  } as never)
  await repo.insert('payments', { property_id: 'P1', invoice_id: 'inv-nov', lease_id: lease.id, amount: 1_500_000, paid_at: '2026-11-01', method: 'cash', kind: 'rent', notes: null })
  const deposit = opts.deposit ?? 500_000
  if (deposit > 0) {
    await repo.insert('payments', { property_id: 'P1', invoice_id: null, lease_id: lease.id, amount: deposit, paid_at: '2026-11-01', method: 'cash', kind: 'deposit', notes: null })
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

const charges = (rows: Invoice[]) => rows.filter((i) => i.invoice_type === 'charge')
const LATE = { description: 'Late checkout', amount: 150_000, date: TODAY }

function actions() {
  return renderHook(() => useLeaseActions()).result.current
}

beforeEach(() => {
  invalidate.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('addCharge', () => {
  it('paid in cash: the charge and its payment today, the charge paid; coverage and due date untouched', async () => {
    await seed()
    const before = await data()
    const summaryBefore = summarizeLeaseBilling(lease, before.invoices, before.payments, TODAY)
    const result = await actions().addCharge(lease, LATE, before.invoices, 'cash')

    const after = await data()
    const [charge] = charges(after.invoices)
    expect(charge).toMatchObject({ id: result.invoice.id, invoice_number: 'INV-202611-0002', invoice_type: 'charge', total_amount: 150_000, notes: 'Late checkout', status: 'paid' })
    expect(result.payment).toMatchObject({ invoice_id: charge.id, lease_id: lease.id, property_id: 'P1', amount: 150_000, method: 'cash', kind: 'rent', paid_at: TODAY, notes: 'Biaya tambahan' })
    expect(after.lease.end_date).toBe('2026-11-30')
    const summary = summarizeLeaseBilling(after.lease, after.invoices, after.payments, TODAY)
    expect(summary).toMatchObject({ paidThrough: summaryBefore.paidThrough, coveredThrough: summaryBefore.coveredThrough, nextDueDate: summaryBefore.nextDueDate, chargesOutstanding: 0 })
    expect(invalidate).toHaveBeenCalledWith('invoices', 'payments')
  })

  it('Bayar nanti: only the charge, unpaid, owed beside the rent', async () => {
    await seed()
    const before = await data()
    const result = await actions().addCharge(lease, { ...LATE, description: 'Kerusakan' }, before.invoices, null)
    expect(result.payment).toBeNull()
    const after = await data()
    expect(charges(after.invoices)).toHaveLength(1)
    expect(charges(after.invoices)[0].status).toBe('unpaid')
    expect(after.payments).toHaveLength(before.payments.length)
    const summary = summarizeLeaseBilling(after.lease, after.invoices, after.payments, TODAY)
    expect(summary.outstanding).toBe(0)
    expect(summary.chargesOutstanding).toBe(150_000)
  })

  it('Potong jaminan: paid from the deposit held, which goes down by the amount', async () => {
    await seed()
    const before = await data()
    await actions().addCharge(lease, LATE, before.invoices, 'deposit')
    const after = await data()
    expect(charges(after.invoices)[0].status).toBe('paid')
    expect(after.payments.find((p) => p.invoice_id === charges(after.invoices)[0].id)).toMatchObject({ method: 'deposit', kind: 'rent', amount: 150_000 })
    expect(depositBalance(after.lease, after.payments, after.expenses).held).toBe(350_000)
  })

  it('Potong jaminan beyond the deposit held is refused before anything is written', async () => {
    await seed({ deposit: 100_000 })
    const before = await data()
    await expect(actions().addCharge(lease, LATE, before.invoices, 'deposit')).rejects.toThrow('Jaminan yang dipegang hanya Rp 100.000.')
    expect(await data()).toEqual(before)
  })

  it('an ended lease may still be charged; a cancelled one never (read fresh)', async () => {
    await seed({ status: 'ended' })
    const before = await data()
    await actions().addCharge(lease, LATE, before.invoices, null)
    expect(charges((await data()).invoices)).toHaveLength(1)

    await seed()
    // cancelled on another device after this screen loaded
    await repo.update('leases', lease.id, { status: 'cancelled' })
    const cancelled = await data()
    await expect(actions().addCharge(lease, LATE, cancelled.invoices, 'cash')).rejects.toThrow(CHARGE_CANCELLED_MESSAGE)
    expect(await data()).toEqual(cancelled)
  })

  it('refuses what the dialog would: no keterangan, no amount, a day before the start', async () => {
    await seed()
    const before = await data()
    await expect(actions().addCharge(lease, { ...LATE, description: ' ' }, before.invoices, 'cash')).rejects.toThrow('Keterangan wajib diisi.')
    await expect(actions().addCharge(lease, { ...LATE, amount: 0 }, before.invoices, 'cash')).rejects.toThrow('Jumlah harus lebih dari 0.')
    await expect(actions().addCharge(lease, { ...LATE, date: '2026-10-31' }, before.invoices, 'cash')).rejects.toThrow('sebelum mulai sewa')
    expect(await data()).toEqual(before)
  })

  it('staff may add and pay a charge; online the status is left to the database trigger', async () => {
    await seed()
    state.role = 'staff'
    const local = await data()
    await actions().addCharge(lease, LATE, local.invoices, 'transfer')
    expect(charges((await data()).invoices)[0].status).toBe('paid')

    await seed()
    const updates: string[] = []
    state.repo = { ...repo, mode: 'supabase', update: (async (table: string) => updates.push(table)) as never } as OrgRepo
    state.role = 'staff'
    await actions().addCharge(lease, LATE, (await data()).invoices, 'cash')
    expect(updates).toEqual([])
  })

  it('a payment that fails after the charge was saved says so, and the charge stays', async () => {
    await seed()
    const before = await data()
    state.repo = {
      ...repo,
      insert: (async (table: string, row: never) => {
        if (table === 'payments') throw new Error('jaringan putus')
        return repo.insert(table as 'invoices', row)
      }) as OrgRepo['insert'],
    }
    const err = await actions()
      .addCharge(lease, LATE, before.invoices, 'qris')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChargeSavedError)
    expect((err as Error).message).toBe('Biaya tersimpan, tetapi pembayarannya gagal: jaringan putus. Bayar dari daftar tagihan.')
    const after = await data()
    expect(charges(after.invoices)).toHaveLength(1)
    expect((err as ChargeSavedError).invoice.id).toBe(charges(after.invoices)[0].id)
    expect(charges(after.invoices)[0].status).toBe('unpaid')
    // the screen is refreshed after a failure too
    expect(invalidate).toHaveBeenCalledWith('invoices', 'payments')
  })

  it('a number taken on another device meanwhile: renumbered from a fresh list', async () => {
    await seed()
    const stale = await data()
    // another phone issued INV-202611-0002 after this screen loaded; the database refuses a second one
    await repo.insert('invoices', { ...stale.invoices[0], id: 'inv-other', invoice_number: 'INV-202611-0002', lease_id: 'L-other' } as never)
    state.repo = {
      ...repo,
      insert: (async (table: string, row: { invoice_number?: string }) => {
        const taken = (await repo.list('invoices')).some((i) => i.invoice_number === row.invoice_number)
        if (table === 'invoices' && taken) throw new Error('Nomor tagihan sudah dipakai. Coba lagi.')
        return repo.insert(table as 'invoices', row as never)
      }) as OrgRepo['insert'],
    }
    const { invoice } = await actions().addCharge(lease, LATE, stale.invoices, null)
    expect(invoice.invoice_number).toBe('INV-202611-0003')
  })
})
