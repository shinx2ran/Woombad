import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'
import { buildInvoiceDraft } from '../../domain/billing'
import {
  allocateAcrossInvoices,
  closingInvoiceWrites,
  coverUntilCheckout,
  futureInvoicesAtCheckout,
  invoiceTimeline,
  invoicesToPinType,
  leaseReminderText,
  nextPeriodCheckout,
  openInvoicesSorted,
  permanentSwitchAddonsAmount,
  previewFollowingPeriod,
} from './leaseUtils'
import { planLeaseRedate } from './redate'
import { unusedPaidRent } from './moveCredit'

// SPEC 7.31: a charge (biaya tambahan) never takes part in the lease's rent schedule: timeline, check-out, the start-date
// correction and the room-move credit give the same answer with or without one, wherever it sits and paid or not.

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

// monthly from 1 Sep: Sep and Oct paid, Nov open; last night 30 Nov, check-out day 1 Des
const lease: Lease = {
  id: 'L',
  ...ts,
  property_id: 'P',
  room_id: 'R',
  tenant_id: 'T',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 1_000_000,
  start_date: '2026-09-01',
  end_date: '2026-11-30',
  status: 'active',
  checkout_date: null,
  notes: null,
}

function rentInv(id: string, start: string, end: string, status: Invoice['status'] = 'unpaid'): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P',
    lease_id: 'L',
    invoice_number: `INV-${start.slice(0, 7).replace('-', '')}-${id}`,
    invoice_type: 'rent',
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
  }
}

function charge(id: string, date: string, amount: number, status: Invoice['status'] = 'unpaid'): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P',
    lease_id: 'L',
    invoice_number: `INV-${date.slice(0, 7).replace('-', '')}-9${id}`,
    invoice_type: 'charge',
    period_type: null,
    period_start: date,
    period_end: date,
    quantity: 1,
    base_amount: 0,
    addons_amount: 0,
    extra_amount: amount,
    discount_amount: 0,
    total_amount: amount,
    due_date: date,
    status,
    notes: 'Late checkout',
  }
}

function pay(invoiceId: string, amount: number, over: Partial<Payment> = {}): Payment {
  return { id: `p-${invoiceId}-${amount}`, org_id: 'o', created_at: ts.created_at, property_id: 'P', invoice_id: invoiceId, lease_id: 'L', amount, paid_at: '2026-10-01', method: 'cash', kind: 'rent', notes: null, created_by: null, ...over }
}

const sep = rentInv('sep', '2026-09-01', '2026-09-30', 'paid')
const oct = rentInv('oct', '2026-10-01', '2026-10-31', 'paid')
const nov = rentInv('nov', '2026-11-01', '2026-11-30')
const rent = [sep, oct, nov]
const rentPayments = [pay('sep', 1_500_000), pay('oct', 1_500_000)]

const CASES = [
  { where: 'inside the coverage', date: '2026-10-15' },
  { where: 'on the check-out day', date: '2026-12-01' },
  { where: 'after the check-out day', date: '2026-12-20' },
].flatMap(({ where, date }) => [
  { name: `unpaid, ${where}`, inv: charge('c', date, 100_000), payments: rentPayments },
  { name: `paid, ${where}`, inv: charge('c', date, 100_000, 'paid'), payments: [...rentPayments, pay('c', 100_000)] },
])

describe('invoiceTimeline (linimasa) is rent only', () => {
  it.each(CASES)('$name: the same segments, no overlap, no longer bar', ({ inv, payments }) => {
    for (const today of ['2026-11-15', '2026-12-25']) {
      const withCharge = invoiceTimeline(lease, [...rent, inv], payments, today)
      expect(withCharge).toEqual(invoiceTimeline(lease, rent, rentPayments, today))
      expect(withCharge.some((s) => s.overlap)).toBe(false)
      expect(withCharge.some((s) => s.invoice?.id === 'c')).toBe(false)
    }
    const ended: Lease = { ...lease, status: 'ended', checkout_date: '2026-11-20', end_date: '2026-11-19' }
    expect(invoiceTimeline(ended, [...rent, inv], payments, '2026-12-25')).toEqual(invoiceTimeline(ended, rent, rentPayments, '2026-12-25'))
  })
})

describe('check-out (SPEC 2b.5 + 7.31)', () => {
  it.each(CASES)('$name: a charge is never a future invoice to void or settle, so it never needs an admin', ({ inv, payments }) => {
    for (const day of ['2026-11-15', '2026-12-01']) {
      expect(futureInvoicesAtCheckout('L', [...rent, inv], payments, day)).toEqual(futureInvoicesAtCheckout('L', rent, rentPayments, day))
    }
    // only the charge lies ahead: nothing to void, decide or note
    expect(futureInvoicesAtCheckout('L', [sep, oct, { ...nov, status: 'paid' }, inv], [...payments, pay('nov', 1_500_000)], '2026-12-01')).toEqual({ toVoid: [], partial: [], paid: [] })
  })

  it('rent periods from the check-out day on are still voided, settled or noted as before', () => {
    const dec = rentInv('dec', '2026-12-01', '2026-12-31')
    const out = futureInvoicesAtCheckout('L', [...rent, dec, charge('c', '2026-12-01', 100_000)], rentPayments, '2026-12-01')
    expect(out.toVoid.map((i) => i.id)).toEqual(['dec'])
  })

  it('an open charge is an open invoice: listed by due date and payable from the deposit', () => {
    const late = charge('c', '2026-12-01', 100_000)
    const open = openInvoicesSorted('L', [late, ...rent], rentPayments)
    expect(open.map((i) => i.id)).toEqual(['nov', 'c'])
    // the deposit (Rp 1.000.000 held) settles November first, then nothing is left for the charge
    expect(allocateAcrossInvoices(1_000_000, open, rentPayments).map((a) => [a.invoice.id, a.amount])).toEqual([['nov', 1_000_000]])
    // with November paid the deposit pays the charge and the rest goes back
    const paidNov = [...rentPayments, pay('nov', 1_500_000)]
    const onlyCharge = openInvoicesSorted('L', [late, ...rent], paidNov)
    expect(onlyCharge.map((i) => i.id)).toEqual(['c'])
    expect(allocateAcrossInvoices(100_000, onlyCharge, paidNov).map((a) => [a.invoice.id, a.amount])).toEqual([['c', 100_000]])
    expect(() => allocateAcrossInvoices(100_001, onlyCharge, paidNov)).toThrow('Jumlah melebihi total sisa tagihan.')
  })

  it('cancelling still voids an unpaid charge with the rest (SPEC 2b.4)', () => {
    const late = charge('c', '2026-10-15', 100_000)
    expect(closingInvoiceWrites([nov, late], [], [nov, late], rentPayments, {}, 'sewa dibatalkan')).toEqual([
      { id: 'nov', patch: { status: 'void' } },
      { id: 'c', patch: { status: 'void' } },
    ])
  })
})

describe('extension helpers read rent only', () => {
  it.each(CASES)('$name: the next check-out, cover-until and following-period preview are unchanged', ({ inv }) => {
    const all = [...rent, inv]
    expect(nextPeriodCheckout(lease, all)).toBe(nextPeriodCheckout(lease, rent))
    expect(nextPeriodCheckout(lease, all)).toBe('2027-01-01')
    expect(nextPeriodCheckout(lease, all, 'daily')).toBe(nextPeriodCheckout(lease, rent, 'daily'))
    expect(coverUntilCheckout(lease, all, 'monthly', '2027-02-15')).toEqual(coverUntilCheckout(lease, rent, 'monthly', '2027-02-15'))
    const draft = buildInvoiceDraft({ lease, addons: [], quantity: 1, existingInvoices: rent })
    expect(previewFollowingPeriod(lease, all, draft, false)).toEqual(previewFollowingPeriod(lease, rent, draft, false))
    const weekly = buildInvoiceDraft({ lease, addons: [], quantity: 2, periodType: 'weekly', pricePerPeriod: 400_000, existingInvoices: rent })
    expect(previewFollowingPeriod(lease, all, weekly, true)).toEqual(previewFollowingPeriod(lease, rent, weekly, true))
  })

  it('a type switch never pins a charge (its period_type stays null)', () => {
    const late = charge('c', '2026-10-15', 100_000)
    expect(invoicesToPinType(lease, [...rent, late], 'daily').map((i) => i.id)).toEqual(['sep', 'oct', 'nov'])
  })

  it('a charge does not use up the one_time add-ons of a permanent switch', () => {
    const addons: LeaseAddon[] = [{ id: 'k', org_id: 'o', created_at: ts.created_at, lease_id: 'L', name: 'Kunci', amount: 25_000, billing: 'one_time' }]
    expect(permanentSwitchAddonsAmount(addons, {}, 1, [charge('c', '2026-09-01', 50_000)])).toBe(25_000)
    expect(permanentSwitchAddonsAmount(addons, {}, 1, [sep])).toBe(0)
  })
})

describe('WhatsApp reminder is about rent only', () => {
  const tenant = { id: 'T', full_name: 'Budi', phone: '0812' } as Tenant
  const room = { id: 'R', name: 'A1' } as Room
  const property = { id: 'P', name: 'Kos Mawar', payment_info: null } as Property
  const reminder = (invoices: Invoice[], payments: Payment[]) => leaseReminderText({ lease, tenant, room, property, invoices, orgInvoices: invoices, payments, addons: [] })

  it.each(CASES)('$name: the reminder is the one without the charge', ({ inv, payments }) => {
    expect(reminder([inv, ...rent], payments)).toBe(reminder(rent, rentPayments))
    // rent paid up: the preview of the next period, not the charge
    const paidNov = [...rentPayments, pay('nov', 1_500_000)]
    const extra = inv.status === 'paid' ? [pay('c', 100_000)] : []
    expect(reminder([inv, ...rent], [...paidNov, ...extra])).toBe(reminder(rent, paidNov))
  })
})

describe('planLeaseRedate (SPEC 7.6 + 7.31): charges keep their date', () => {
  it.each(CASES)('$name: grid mode stays grid, rent moves as without it, the charge is sent unchanged', ({ inv }) => {
    const withCharge = planLeaseRedate(lease, [...rent, inv], '2026-08-18')
    const without = planLeaseRedate(lease, rent, '2026-08-18')
    expect(withCharge.mode).toBe('grid')
    expect(withCharge).toMatchObject({ mode: without.mode, lease: without.lease, warnings: without.warnings, error: without.error, deltaDays: without.deltaDays })
    expect(withCharge.patches.filter((p) => p.id !== 'c')).toEqual(without.patches)
    expect(withCharge.patches.find((p) => p.id === 'c')).toEqual({ id: 'c', period_start: inv.period_start, period_end: inv.period_end, due_date: inv.due_date })
    // every invoice of the lease is listed once (redate_lease refuses a missing one)
    expect(withCharge.patches.map((p) => p.id).sort()).toEqual(['c', 'nov', 'oct', 'sep'])
    expect(withCharge.invoices.find((r) => r.invoice.id === 'c')).toMatchObject({ before: { period_start: inv.period_start }, after: { period_start: inv.period_start }, gridIndex: null })
  })

  it.each(CASES)('$name: shift mode moves the rent by the same days and leaves the charge', ({ inv }) => {
    // a pro-rata last invoice (1–15 Nov) puts the plan in shift mode
    const proRata = [sep, oct, { ...nov, period_end: '2026-11-15' }]
    const short: Lease = { ...lease, end_date: '2026-11-15' }
    const withCharge = planLeaseRedate(short, [...proRata, inv], '2026-09-03')
    const without = planLeaseRedate(short, proRata, '2026-09-03')
    expect(withCharge.mode).toBe('shift')
    expect(withCharge).toMatchObject({ lease: without.lease, warnings: without.warnings, deltaDays: 2 })
    expect(withCharge.patches.filter((p) => p.id !== 'c')).toEqual(without.patches)
    expect(withCharge.patches.find((p) => p.id === 'c')).toMatchObject({ period_start: inv.period_start, due_date: inv.due_date })
  })

  it('a void charge stays where it is too', () => {
    const voided = charge('c', '2026-10-15', 100_000, 'void')
    const plan = planLeaseRedate(lease, [...rent, voided], '2026-08-18')
    expect(plan.mode).toBe('grid')
    expect(plan.patches.find((p) => p.id === 'c')).toEqual({ id: 'c', period_start: '2026-10-15', period_end: '2026-10-15', due_date: '2026-10-15' })
  })
})

describe('unusedPaidRent (pindah kamar, SPEC 7.24) ignores charges', () => {
  it.each(CASES)('$name: the same unused nights and amount', ({ inv, payments }) => {
    const allPaid = [...payments, pay('nov', 1_500_000)]
    const paidRent = [...rentPayments, pay('nov', 1_500_000)]
    for (const moveDate of ['2026-10-15', '2026-11-20', '2026-12-01']) {
      expect(unusedPaidRent('L', [...rent, inv], allPaid, moveDate)).toEqual(unusedPaidRent('L', rent, paidRent, moveDate))
    }
    expect(unusedPaidRent('L', [...rent, inv], allPaid, '2026-11-20')).toMatchObject({ nights: 11, paidThrough: '2026-11-30', resumeOn: '2026-12-01' })
  })

  it('a paid charge on the move day alone gives nothing back', () => {
    const late = charge('c', '2026-12-01', 100_000, 'paid')
    expect(unusedPaidRent('L', [late], [pay('c', 100_000)], '2026-12-01')).toEqual({ nights: 0, amount: 0, paidThrough: null, resumeOn: null })
  })
})
