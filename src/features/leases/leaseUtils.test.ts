import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import {
  allocateAcrossInvoices,
  appendMoveNote,
  cancelledLeaseEndDate,
  compareByShownDays,
  compareLeaseItems,
  checkoutInputError,
  composeInvoiceNotes,
  coverUntilCheckout,
  coverUntilCheckoutHint,
  futureInvoicesAtCheckout,
  invoiceDueText,
  invoiceTimeline,
  LEASE_SORT_KEYS,
  LEASE_SORT_LABEL,
  leaseEndDisplay,
  leaseReminderText,
  matchesLeaseSearch,
  nextPeriodCheckout,
  openInvoicesSorted,
  parseLeaseSort,
  proRataSuggestion,
  remainingDays,
  roomAvailability,
  roomPriceFor,
  sortLeaseItems,
  splitInvoiceNotes,
  sumExtraBreakdown,
  validateSettlement,
  type LeaseListItem,
} from './leaseUtils'
import type { LeaseBillingSummary } from '../../domain/billing'
import { reminderText } from '../../domain/messages'
import { formatCheckout, lastNightISO } from '../../lib/format'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const lease: Lease = {
  id: 'L1',
  ...ts,
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_000_000,
  deposit_amount: 500_000,
  start_date: '2026-01-10',
  end_date: '2026-04-09',
  status: 'active',
  checkout_date: null,
  notes: null,
}

function inv(id: string, start: string, end: string, total = 1_000_000, status: Invoice['status'] = 'unpaid'): Invoice {
  return {
    id,
    ...ts,
    property_id: 'P1',
    lease_id: 'L1',
    invoice_number: `INV-${start.slice(0, 7).replace('-', '')}-${id}`,
    period_type: null,
    period_start: start,
    period_end: end,
    quantity: 1,
    base_amount: total,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: total,
    due_date: start,
    status,
    notes: null,
  }
}

function pay(invoice_id: string, amount: number): Payment {
  return { id: `pay-${invoice_id}-${amount}`, org_id: 'o', created_at: ts.created_at, property_id: 'P1', invoice_id, lease_id: 'L1', amount, paid_at: '2026-01-10', method: 'cash', kind: 'rent', notes: null, created_by: null }
}

describe('invoiceTimeline', () => {
  it('marks paid/partial/unpaid invoices, gaps and the unbilled tail', () => {
    const invoices = [inv('a', '2026-01-10', '2026-02-09'), inv('b', '2026-03-10', '2026-04-09')]
    const payments = [pay('a', 1_000_000), pay('b', 400_000)]
    const segs = invoiceTimeline(lease, invoices, payments, '2026-04-20')
    expect(segs.map((s) => s.kind)).toEqual(['paid', 'gap', 'partial', 'unbilled'])
    expect(segs[1]).toMatchObject({ start: '2026-02-10', end: '2026-03-09', days: 28 })
    expect(segs[3]).toMatchObject({ start: '2026-04-10', end: '2026-04-20', days: 11 })
  })

  it('ignores void invoices and stops at the last night before checkout for ended leases', () => {
    const ended: Lease = { ...lease, status: 'ended', checkout_date: '2026-02-20' }
    const invoices = [inv('a', '2026-01-10', '2026-02-09', 1_000_000, 'paid'), inv('v', '2026-02-10', '2026-03-09', 1_000_000, 'void')]
    const segs = invoiceTimeline(ended, invoices, [pay('a', 1_000_000)], '2026-06-01')
    expect(segs.map((s) => s.kind)).toEqual(['paid', 'unbilled'])
    // checkout 20 Feb = the tenant was gone that night: the last unbilled night is 19 Feb (shown as check-out 20 Feb)
    expect(segs[1]).toMatchObject({ start: '2026-02-10', end: '2026-02-19', days: 10 })
  })

  it('a checkout on the day after the last billed night leaves no unbilled tail', () => {
    const ended: Lease = { ...lease, status: 'ended', checkout_date: '2026-02-10', end_date: '2026-02-10' }
    const segs = invoiceTimeline(ended, [inv('a', '2026-01-10', '2026-02-09', 1_000_000, 'paid')], [pay('a', 1_000_000)], '2026-06-01')
    expect(segs.map((s) => s.kind)).toEqual(['paid'])
    // an old ended row without checkout_date still ends on its end_date (a last night)
    const legacy: Lease = { ...lease, status: 'ended', checkout_date: null, end_date: '2026-02-12' }
    const legacySegs = invoiceTimeline(legacy, [inv('a', '2026-01-10', '2026-02-09', 1_000_000, 'paid')], [pay('a', 1_000_000)], '2026-06-01')
    expect(legacySegs[legacySegs.length - 1]).toMatchObject({ kind: 'unbilled', end: '2026-02-12', days: 3 })
  })

  it('an active paid-up lease adds no unbilled night on its check-out day, only from the day after', () => {
    const paidUp: Lease = { ...lease, end_date: '2026-02-09' }
    const invoices = [inv('a', '2026-01-10', '2026-02-09', 1_000_000, 'paid')]
    // check-out day 10 Feb: the tenant is leaving, tonight is not drawn as unbilled
    expect(invoiceTimeline(paidUp, invoices, [pay('a', 1_000_000)], '2026-02-10').map((s) => s.kind)).toEqual(['paid'])
    // 11 Feb, still not checked out: the nights of 10 and 11 Feb are unbilled
    const late = invoiceTimeline(paidUp, invoices, [pay('a', 1_000_000)], '2026-02-11')
    expect(late.map((s) => s.kind)).toEqual(['paid', 'unbilled'])
    expect(late[1]).toMatchObject({ start: '2026-02-10', end: '2026-02-11', days: 2 })
  })

  it('flags overlapping invoices', () => {
    const invoices = [inv('a', '2026-01-10', '2026-02-09'), inv('b', '2026-02-01', '2026-02-28')]
    const segs = invoiceTimeline(lease, invoices, [], '2026-02-01')
    expect(segs[1].overlap).toBe(true)
  })
})

describe('invoice notes convention', () => {
  it('round-trips breakdown and free text', () => {
    const notes = composeInvoiceNotes({ listrik: 125_000, denda: 0, lainnya: 10_000 }, 'Token bulan Maret')
    expect(notes).toBe('Listrik: 125000; Lainnya: 10000\nToken bulan Maret')
    const split = splitInvoiceNotes(notes)
    expect(split.breakdown).toEqual({ listrik: 125_000, lainnya: 10_000 })
    expect(split.text).toBe('Token bulan Maret')
    expect(sumExtraBreakdown(split.breakdown)).toBe(135_000)
  })

  it('returns null when nothing to store and keeps plain text as text', () => {
    expect(composeInvoiceNotes({}, '  ')).toBeNull()
    expect(composeInvoiceNotes({}, 'catatan')).toBe('catatan')
    expect(splitInvoiceNotes('catatan saja')).toEqual({ breakdown: {}, text: 'catatan saja' })
    expect(splitInvoiceNotes(null)).toEqual({ breakdown: {}, text: '' })
  })
})

describe('open invoices & allocation', () => {
  const invoices = [inv('b', '2026-02-10', '2026-03-09'), inv('a', '2026-01-10', '2026-02-09'), inv('v', '2026-03-10', '2026-04-09', 1_000_000, 'void')]
  const payments = [pay('a', 600_000)]

  it('sorts open invoices by due date and skips void / settled', () => {
    expect(openInvoicesSorted('L1', invoices, payments).map((i) => i.id)).toEqual(['a', 'b'])
    expect(openInvoicesSorted('L1', invoices, [pay('a', 1_000_000)]).map((i) => i.id)).toEqual(['b'])
  })

  it('allocates oldest first and throws when the amount cannot be absorbed', () => {
    const open = openInvoicesSorted('L1', invoices, payments)
    expect(allocateAcrossInvoices(500_000, open, payments)).toEqual([
      { invoice: open[0], amount: 400_000 },
      { invoice: open[1], amount: 100_000 },
    ])
    expect(() => allocateAcrossInvoices(2_000_000, open, payments)).toThrow('Jumlah melebihi total sisa tagihan.')
  })
})

describe('proRataSuggestion', () => {
  it('scales the period price by inclusive days and rounds', () => {
    // monthly period 8 Nov – 7 Dec (30 days); 14 days -> 1.500.000 * 14 / 30 = 700.000
    expect(proRataSuggestion(1_500_000, '2026-11-08', '2026-12-07', '2026-11-21')).toEqual({ amount: 700_000, days: 14, fullDays: 30 })
    // full period -> full price; single day -> price / days rounded
    expect(proRataSuggestion(1_200_000, '2026-11-01', '2026-11-30', '2026-11-30')?.amount).toBe(1_200_000)
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '2026-11-01')).toEqual({ amount: 33_333, days: 1, fullDays: 30 })
  })

  it('returns null for missing or inverted dates', () => {
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '')).toBeNull()
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', '2026-10-31')).toBeNull()
    expect(proRataSuggestion(1_000_000, '2026-11-01', '2026-11-30', 'bukan-tanggal')).toBeNull()
  })

  it('takes the last night: a typed check-out day is converted first (SPEC 7.3)', () => {
    // 'Sampai tanggal (check-out)' 22 Nov -> last night 21 Nov -> 14 nights, as above
    expect(proRataSuggestion(1_500_000, '2026-11-08', '2026-12-07', lastNightISO('2026-11-22'))).toEqual({ amount: 700_000, days: 14, fullDays: 30 })
    // check-out 8 Des = the full period's own check-out day -> the full price
    expect(proRataSuggestion(1_500_000, '2026-11-08', '2026-12-07', lastNightISO('2026-12-08'))?.amount).toBe(1_500_000)
  })
})

describe('end dates typed as check-out days (SPEC 7.3)', () => {
  // daily guest: 2 nights 15-16 Okt (check-out 17 Okt), next night from 17 Okt
  const daily: Lease = { ...lease, period_type: 'daily', price_per_period: 100_000, start_date: '2026-10-15', end_date: '2026-10-16' }
  const dailyInvoices = [{ ...inv('d1', '2026-10-15', '2026-10-16', 200_000, 'paid'), quantity: 2 }]
  // monthly lease billed 10 Jan .. 9 Apr; next period 10 Apr .. 9 Mei (check-out 10 Mei)
  const monthlyInvoices = [inv('a', '2026-01-10', '2026-02-09'), inv('b', '2026-02-10', '2026-03-09'), inv('c', '2026-03-10', '2026-04-09')]

  it('prefills the custom end with the check-out day of one next period', () => {
    expect(nextPeriodCheckout(daily, dailyInvoices)).toBe('2026-10-18')
    expect(nextPeriodCheckout(daily, dailyInvoices, 'weekly')).toBe('2026-10-24')
    expect(nextPeriodCheckout(lease, monthlyInvoices)).toBe('2026-05-10')
    expect(lastNightISO(nextPeriodCheckout(lease, monthlyInvoices))).toBe('2026-05-09')
  })

  it('a check-out day must come after the period start', () => {
    expect(checkoutInputError('2026-10-17', '2026-10-17')).toBe('Tanggal check-out harus setelah 17 Okt 2026.')
    expect(checkoutInputError('2026-10-16', '2026-10-17')).toBe('Tanggal check-out harus setelah 17 Okt 2026.')
    expect(checkoutInputError('2026-10-18', '2026-10-17')).toBeNull()
    expect(checkoutInputError('', '2026-10-17')).toBeNull()
    expect(checkoutInputError('2026-10-18', undefined)).toBeNull()
  })

  it('counts the periods up to the night before the picked check-out day', () => {
    // check-out 19 Okt -> nights of 17 and 18 Okt -> 2 nights, computed check-out = the picked one
    const twoNights = coverUntilCheckout(daily, dailyInvoices, 'daily', '2026-10-19')
    expect(twoNights).toEqual({ n: 2, end: '2026-10-18', differs: false })
    expect(coverUntilCheckoutHint(twoNights!, 'malam', '2026-10-19')).toBe('Dihitung 2 malam, check-out 19 Okt 2026')
    expect(coverUntilCheckout(daily, dailyInvoices, 'daily', '2026-10-18')).toEqual({ n: 1, end: '2026-10-17', differs: false })
    // a week from 17 Okt ends on the night of 23 Okt: check-out 24 Okt is exactly 1 week
    expect(coverUntilCheckout(daily, dailyInvoices, 'weekly', '2026-10-24')).toEqual({ n: 1, end: '2026-10-23', differs: false })
    // monthly: check-out 10 Mei is exactly one month (the stored end would have asked for 2 months before)
    const month = coverUntilCheckout(lease, monthlyInvoices, 'monthly', '2026-05-10')
    expect(month).toEqual({ n: 1, end: '2026-05-09', differs: false })
    expect(coverUntilCheckoutHint(month!, 'bulan', '2026-05-10')).toBe('Dihitung 1 bulan, check-out 10 Mei 2026')
    expect(coverUntilCheckout(lease, monthlyInvoices, 'monthly', '2026-05-11')).toEqual({ n: 2, end: '2026-06-09', differs: true })
  })

  it('says so with check-out days when the periods round up', () => {
    const rounded = coverUntilCheckout(lease, monthlyInvoices, 'monthly', '2026-05-05')
    expect(rounded).toEqual({ n: 1, end: '2026-05-09', differs: true })
    expect(coverUntilCheckoutHint(rounded!, 'bulan', '2026-05-05')).toBe('Dihitung 1 bulan, check-out 10 Mei 2026 (bukan 5 Mei 2026: periode dibulatkan ke atas)')
  })

  it('counts on the billing grid of a lease anchored on the 31st (no extra month)', () => {
    // anchor 31 Okt, billed 31 Okt .. 29 Nov; next period 30 Nov .. 30 Des (check-out 31 Des)
    const anchored: Lease = { ...lease, start_date: '2026-10-31', end_date: '2026-11-29' }
    const invs = [inv('m1', '2026-10-31', '2026-11-29')]
    expect(nextPeriodCheckout(anchored, invs)).toBe('2026-12-31')
    expect(coverUntilCheckout(anchored, invs, 'monthly', nextPeriodCheckout(anchored, invs))).toEqual({ n: 1, end: '2026-12-30', differs: false })
    expect(coverUntilCheckout(anchored, invs, 'monthly', '2027-01-31')).toEqual({ n: 2, end: '2027-01-30', differs: false })
    expect(coverUntilCheckout(anchored, invs, 'monthly', '2027-01-01')).toEqual({ n: 2, end: '2027-01-30', differs: true })
    // anchor 30 Jan: next period 28 Feb .. 29 Mar (check-out 30 Mar) is one month
    const jan30: Lease = { ...lease, start_date: '2026-01-30', end_date: '2026-02-27' }
    expect(coverUntilCheckout(jan30, [inv('j1', '2026-01-30', '2026-02-27')], 'monthly', '2026-03-30')).toEqual({ n: 1, end: '2026-03-29', differs: false })
  })

  it('gives nothing for an empty day or one not after the next period start', () => {
    expect(coverUntilCheckout(daily, dailyInvoices, 'daily', '')).toBeNull()
    expect(coverUntilCheckout(daily, dailyInvoices, 'daily', '2026-10-17')).toBeNull()
    expect(coverUntilCheckout(daily, dailyInvoices, 'daily', '2026-10-10')).toBeNull()
  })
})

describe('leaseEndDisplay (SPEC 7.3)', () => {
  it('active: check-out day of the last night; ended: the checkout date as is; cancelled: Berakhir + check-out day', () => {
    expect(leaseEndDisplay({ ...lease, end_date: '2026-10-16' })).toEqual({ label: 'Check-out', date: '17 Okt 2026' })
    expect(leaseEndDisplay({ ...lease, end_date: '2026-12-31' })).toEqual({ label: 'Check-out', date: '1 Jan 2027' })
    expect(leaseEndDisplay({ ...lease, status: 'ended', checkout_date: '2026-02-20', end_date: '2026-02-20' })).toEqual({ label: 'Checkout', date: '20 Feb 2026' })
    expect(leaseEndDisplay({ ...lease, status: 'cancelled', end_date: '2026-02-15' })).toEqual({ label: 'Berakhir', date: '16 Feb 2026' })
    expect(leaseEndDisplay({ ...lease, status: 'ended', checkout_date: null, end_date: '2026-02-15' })).toEqual({ label: 'Berakhir', date: '16 Feb 2026' })
  })
})

describe('cancelledLeaseEndDate', () => {
  it('reads the date as a check-out day: end_date = the night before, never past end_date nor before start_date', () => {
    // cancelled / checked out on 15 Feb: the last night is 14 Feb, shown back as check-out 15 Feb (the typed day)
    expect(cancelledLeaseEndDate(lease, '2026-02-15')).toBe('2026-02-14')
    expect(formatCheckout(cancelledLeaseEndDate(lease, '2026-02-15'))).toBe('15 Feb 2026')
    expect(cancelledLeaseEndDate(lease, '2026-06-01')).toBe('2026-04-09')
    // the day after the last night keeps end_date
    expect(cancelledLeaseEndDate(lease, '2026-04-10')).toBe('2026-04-09')
    // lease that has not started yet, cancelled today
    expect(cancelledLeaseEndDate({ ...lease, start_date: '2026-11-01', end_date: '2026-11-30' }, '2026-10-11')).toBe('2026-11-01')
    // on the start day no night was stayed: clamped to start_date (DB check end_date >= start_date)
    expect(cancelledLeaseEndDate(lease, '2026-01-10')).toBe('2026-01-10')
    expect(cancelledLeaseEndDate(lease, '2026-01-11')).toBe('2026-01-10')
  })

  describe('a booking cancelled before any night shows no check-out day (SPEC 7.3)', () => {
    // booked 20 Okt – check-out 20 Nov (last night 19 Nov)
    const booking: Lease = { ...lease, start_date: '2026-10-20', end_date: '2026-11-19' }
    const cancelOn = (dateISO: string): Lease => ({ ...booking, status: 'cancelled', end_date: cancelledLeaseEndDate(booking, dateISO) })

    it('cancelled before the start day or on it: Berakhir + the start day, not start + 1', () => {
      for (const day of ['2026-10-10', '2026-10-20']) {
        expect(cancelOn(day).end_date).toBe('2026-10-20') // clamped to start_date for the DB check only
        expect(leaseEndDisplay(cancelOn(day))).toEqual({ label: 'Berakhir', date: '20 Okt 2026' })
      }
      // the day after the start stores the same row, so it reads the same (a tenant who stayed is checked out instead)
      expect(leaseEndDisplay(cancelOn('2026-10-21'))).toEqual({ label: 'Berakhir', date: '20 Okt 2026' })
      // from two days after the start a night is left on the row: shown as its check-out day, the typed date
      expect(leaseEndDisplay(cancelOn('2026-10-22'))).toEqual({ label: 'Berakhir', date: '22 Okt 2026' })
    })

    it('the finished list sorts it on the start day it shows', () => {
      const item = (l: Lease, name: string): LeaseListItem => ({ lease: l, summary: {} as LeaseBillingSummary, room: { name } as Room, tenant: undefined, propertyName: 'Kos' })
      const noStay = item(cancelOn('2026-10-10'), 'A1')
      const checkedOutSameDay = item({ ...booking, status: 'ended', checkout_date: '2026-10-20', end_date: '2026-10-20' }, 'B1')
      const checkedOutDayAfter = item({ ...booking, status: 'ended', checkout_date: '2026-10-21', end_date: '2026-10-20' }, 'C1')
      // newest first: 21 Okt, then 20 Okt (same day: room name)
      expect(sortLeaseItems([noStay, checkedOutSameDay, checkedOutDayAfter], 'jatuh-tempo', true).map((i) => i.room?.name)).toEqual(['C1', 'A1', 'B1'])
    })

    it('the timeline adds no unbilled night for it; a cancelled lease with nights left keeps them', () => {
      const voided = [inv('v', '2026-10-20', '2026-11-19', 1_000_000, 'void')]
      expect(invoiceTimeline({ ...cancelOn('2026-10-20'), id: 'L1' }, voided, [], '2026-10-25')).toEqual([])
      const kept = invoiceTimeline({ ...cancelOn('2026-10-23'), id: 'L1' }, voided, [], '2026-10-25')
      expect(kept).toEqual([{ kind: 'unbilled', start: '2026-10-20', end: '2026-10-22', days: 3 }])
    })
  })
})

describe('futureInvoicesAtCheckout', () => {
  const invoices = [
    inv('cur', '2026-01-10', '2026-02-09'),
    inv('u', '2026-02-10', '2026-03-09'),
    inv('p', '2026-03-10', '2026-04-09'),
    inv('f', '2026-04-10', '2026-05-09', 1_000_000, 'paid'),
    inv('v', '2026-05-10', '2026-06-09', 1_000_000, 'void'),
    { ...inv('other', '2026-02-10', '2026-03-09'), lease_id: 'L2' },
  ]
  const payments = [pay('p', 500_000), pay('f', 1_000_000)]

  it('splits invoices starting after checkout into void / partial / paid and ignores the rest', () => {
    const r = futureInvoicesAtCheckout('L1', invoices, payments, '2026-01-20')
    expect(r.toVoid.map((i) => i.id)).toEqual(['u'])
    expect(r.partial.map((i) => i.id)).toEqual(['p'])
    expect(r.paid.map((i) => i.id)).toEqual(['f'])
  })

  it('treats an invoice starting on the checkout date as future (that night the tenant is gone) and handles an empty date', () => {
    // checkout 10 Feb: 'u' (from 10 Feb) bills nights after the tenant left -> voided; 'cur' (to 9 Feb) stays
    const onStart = futureInvoicesAtCheckout('L1', invoices, payments, '2026-02-10')
    expect(onStart.toVoid.map((i) => i.id)).toEqual(['u'])
    expect(onStart.partial.map((i) => i.id)).toEqual(['p'])
    expect(onStart.paid.map((i) => i.id)).toEqual(['f'])
    // checkout one day later: the tenant slept there on 10 Feb, so 'u' is current and stays receivable
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '2026-02-11').toVoid.map((i) => i.id)).toEqual([])
    // checkout on the last night of 'cur' (9 Feb): 'cur' started earlier and stays
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '2026-02-09').toVoid.map((i) => i.id)).toEqual(['u'])
    expect(futureInvoicesAtCheckout('L1', invoices, payments, '')).toEqual({ toVoid: [], partial: [], paid: [] })
  })
})

describe('validateSettlement', () => {
  it('requires the parts to sum to the held deposit', () => {
    expect(validateSettlement({ refund: 500_000, rent: 0, damage: 0, damageNotes: '' }, 500_000, 0)).toBeNull()
    expect(validateSettlement({ refund: 300_000, rent: 0, damage: 0, damageNotes: '' }, 500_000, 0)).toMatch(/harus sama/)
    expect(validateSettlement({ refund: 0, rent: 600_000, damage: 0, damageNotes: '' }, 600_000, 400_000)).toMatch(/melebihi sisa tagihan/)
    expect(validateSettlement({ refund: 0, rent: 0, damage: 500_000, damageNotes: '' }, 500_000, 0)).toMatch(/keterangan/)
    expect(validateSettlement({ refund: 0, rent: 0, damage: 500_000, damageNotes: 'kunci hilang' }, 500_000, 0)).toBeNull()
    expect(validateSettlement({ refund: -1, rent: 0, damage: 1, damageNotes: '' }, 0, 0)).toMatch(/negatif/)
  })
})

describe('roomAvailability', () => {
  const room: Room = { id: 'R2', ...ts, property_id: 'P1', name: 'A2', floor: '1', price_daily: 90_000, price_weekly: 540_000, price_monthly: 1_200_000, status: 'active', notes: null }
  const occupying: Lease = { ...lease, id: 'L9', room_id: 'R2', start_date: '2026-01-01', end_date: '2026-01-31' }

  it('distinguishes terisi / dipesan / bentrok / kosong / perbaikan', () => {
    expect(roomAvailability(room, [occupying], '2026-01-15', '2026-02-14')).toBe('terisi')
    expect(roomAvailability(room, [{ ...occupying, start_date: '2026-03-01', end_date: '2026-03-31' }], '2026-02-01', '2026-02-28')).toBe('dipesan')
    // a future active lease is always "Dipesan" (SPEC 2a); "bentrok" is left for non-reserving overlaps
    expect(roomAvailability(room, [{ ...occupying, status: 'ended', start_date: '2026-02-20', end_date: '2026-03-19', checkout_date: '2026-03-19' }], '2026-02-01', '2026-02-28')).toBe('bentrok')
    expect(roomAvailability(room, [{ ...occupying, status: 'cancelled' }], '2026-01-15', '2026-02-14')).toBe('kosong')
    expect(roomAvailability({ ...room, status: 'maintenance' }, [], '2026-01-15', '2026-02-14')).toBe('perbaikan')
    // the lease being edited is excluded
    expect(roomAvailability(room, [occupying], '2026-01-15', '2026-02-14', 'L9')).toBe('kosong')
  })

  it('reads the room price for a period type', () => {
    expect(roomPriceFor(room, 'daily')).toBe(90_000)
    expect(roomPriceFor(room, 'monthly')).toBe(1_200_000)
    expect(roomPriceFor(undefined, 'weekly')).toBeNull()
  })
})

describe('list helpers', () => {
  const summary = (state: LeaseBillingSummary['state'], nextDueDate: string): LeaseBillingSummary => ({
    leaseId: 'x',
    coveredThrough: null,
    paidThrough: null,
    outstanding: 0,
    nextDueDate,
    daysUntilDue: 0,
    state,
  })
  const item = (state: LeaseBillingSummary['state'], due: string, roomName: string, tenantName = 'Budi'): LeaseListItem => ({
    lease,
    summary: summary(state, due),
    room: { id: 'r', ...ts, property_id: 'P1', name: roomName, floor: null, price_daily: null, price_weekly: null, price_monthly: null, status: 'active', notes: null },
    tenant: {
      id: 't',
      ...ts,
      property_id: 'P1',
      full_name: tenantName,
      nik: null,
      id_type: 'ktp',
      id_number: null,
      nationality: null,
      phone: null,
      gender: null,
      birth_place: null,
      birth_date: null,
      address: null,
      religion: null,
      marital_status: null,
      occupation: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      ktp_image_path: null,
      notes: null,
    },
    propertyName: 'Kos Melati',
  })

  it('sorts overdue first, then due soon, then by date and room', () => {
    const items = [item('ok', '2026-05-01', 'B1'), item('due_soon', '2026-04-02', 'A2'), item('overdue', '2026-03-01', 'A10'), item('overdue', '2026-03-01', 'A2')]
    expect(items.sort(compareLeaseItems).map((i) => i.room?.name)).toEqual(['A2', 'A10', 'A2', 'B1'])
  })

  it('searches tenant, room and kos names', () => {
    const it1 = item('ok', '2026-05-01', 'B1', 'Siti Rahayu')
    expect(matchesLeaseSearch(it1, 'siti')).toBe(true)
    expect(matchesLeaseSearch(it1, 'b1')).toBe(true)
    expect(matchesLeaseSearch(it1, 'melati')).toBe(true)
    expect(matchesLeaseSearch(it1, 'anggrek')).toBe(false)
    expect(matchesLeaseSearch(it1, '')).toBe(true)
  })

  it('appends the move note', () => {
    expect(appendMoveNote(null, 'A1', 'B2', '2026-03-05')).toBe('Pindah dari A1 ke B2 pada 2026-03-05')
    expect(appendMoveNote('Tamu proyek', 'A1', 'B2', '2026-03-05')).toBe('Tamu proyek\nPindah dari A1 ke B2 pada 2026-03-05')
  })
})

describe('sort by remaining days (SPEC 7.1)', () => {
  const summary = (nextDueDate: string | null): LeaseBillingSummary => ({ leaseId: 'x', coveredThrough: null, paidThrough: null, outstanding: 0, nextDueDate, daysUntilDue: null, state: 'ok' })
  const item = (id: string, kos: string, roomName: string, due: string | null): LeaseListItem => ({
    lease: { ...lease, id },
    summary: summary(due),
    room: { id: `r-${id}`, ...ts, property_id: 'P1', name: roomName, floor: null, price_daily: null, price_weekly: null, price_monthly: null, status: 'active', notes: null },
    tenant: undefined,
    propertyName: kos,
  })
  const items = [
    item('a', 'Kos Melati', 'A10', '2026-10-20'),
    item('b', 'Kos Melati', 'A2', '2026-10-09'),
    item('c', 'Kos Anggrek', '102', '2026-10-16'),
    item('d', 'Kos Anggrek', '101', '2026-10-20'),
    item('e', 'Kos Melati', 'B1', null),
  ]
  const keys = (list: LeaseListItem[]) => list.map((i) => i.lease.id)

  it('offers four ?urut= values with Indonesian labels', () => {
    expect(LEASE_SORT_KEYS).toEqual(['jatuh-tempo', 'jatuh-tempo-terjauh', 'kamar', 'nama'])
    expect(LEASE_SORT_LABEL).toEqual({
      'jatuh-tempo': 'Sisa hari paling sedikit',
      'jatuh-tempo-terjauh': 'Sisa hari paling banyak',
      kamar: 'Nomor kamar',
      nama: 'Nama penyewa',
    })
    expect(parseLeaseSort('jatuh-tempo-terjauh')).toBe('jatuh-tempo-terjauh')
    expect(parseLeaseSort(undefined)).toBe('jatuh-tempo')
  })

  it('paling banyak: most days first, same count by room then kos, no due date still last', () => {
    const today = '2026-10-12'
    expect(keys([...items].sort(compareByShownDays(today, true)))).toEqual(['d', 'a', 'c', 'b', 'e'])
    expect(keys(sortLeaseItems(items, 'jatuh-tempo-terjauh', false, today))).toEqual(['d', 'a', 'c', 'b', 'e'])
    // the ascending order is the mirror image, except that undated leases stay at the end in both
    expect(keys([...items].sort(compareByShownDays(today)))).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(keys(sortLeaseItems(items, 'jatuh-tempo', false, today))).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(compareByShownDays(today, true)(items[4], items[4])).toBe(0)
  })

  it('sorts by the day count the row shows: a paid-up lease that is ending counts to its check-out day', () => {
    const today = '2026-10-12'
    // rolling lease paid through the night of 14 Okt: check-out 15 Okt = its next due date, both 3 days
    const rolling: LeaseListItem = {
      ...item('roll', 'Kos Melati', 'C1', '2026-10-15'),
      lease: { ...lease, id: 'roll', end_date: '2026-10-14' },
      summary: { ...summary('2026-10-15'), coveredThrough: '2026-10-14', paidThrough: '2026-10-14', daysUntilDue: 3 },
    }
    expect(remainingDays(rolling.lease, rolling.summary, today)).toMatchObject({ kind: 'ending', days: 3 })
    // billed through 13 Okt but staying to the night of 15 Okt: the row counts to check-out 16 Okt (4 days), so the
    // next due date (14 Okt, 2 days) alone would put it before a lease due in 3 days
    const longer: LeaseListItem = {
      ...item('long', 'Kos Melati', 'C1', '2026-10-14'),
      lease: { ...lease, id: 'long', end_date: '2026-10-15' },
      summary: { ...summary('2026-10-14'), coveredThrough: '2026-10-13', paidThrough: '2026-10-13', daysUntilDue: 2 },
    }
    const due = { ...item('due', 'Kos Melati', 'C2', '2026-10-15'), summary: { ...summary('2026-10-15'), daysUntilDue: 3 } }
    expect(keys(sortLeaseItems([longer, due], 'jatuh-tempo', false, today))).toEqual(['due', 'long'])
    expect(keys(sortLeaseItems([longer, due], 'jatuh-tempo-terjauh', false, today))).toEqual(['long', 'due'])
    // same count as a lease due that day: ties fall back to the next due date, then the room
    expect(keys(sortLeaseItems([due, rolling], 'jatuh-tempo', false, today))).toEqual(['roll', 'due'])
  })

  it('finished list: paling banyak puts the oldest finished lease first', () => {
    const finished = [
      { ...item('x', 'Kos Melati', 'A1', null), lease: { ...lease, id: 'x', status: 'ended' as const, checkout_date: '2026-05-01' } },
      { ...item('y', 'Kos Melati', 'A2', null), lease: { ...lease, id: 'y', status: 'ended' as const, checkout_date: '2026-08-01' } },
      { ...item('z', 'Kos Melati', 'A3', null), lease: { ...lease, id: 'z', status: 'cancelled' as const, end_date: '2026-06-15' } },
    ]
    expect(keys(sortLeaseItems(finished, 'jatuh-tempo', true))).toEqual(['y', 'z', 'x'])
    expect(keys(sortLeaseItems(finished, 'jatuh-tempo-terjauh', true))).toEqual(['x', 'z', 'y'])
    // only the date flips; leases finished on the same day stay in room order both ways
    const sameDay = [
      { ...item('b2', 'Kos Melati', 'B2', null), lease: { ...lease, id: 'b2', status: 'ended' as const, checkout_date: '2026-09-30' } },
      { ...item('a1', 'Kos Melati', 'A1', null), lease: { ...lease, id: 'a1', status: 'ended' as const, checkout_date: '2026-09-30' } },
    ]
    expect(keys(sortLeaseItems(sameDay, 'jatuh-tempo', true))).toEqual(['a1', 'b2'])
    expect(keys(sortLeaseItems(sameDay, 'jatuh-tempo-terjauh', true))).toEqual(['a1', 'b2'])
  })
})

describe('remainingDays (SPEC 7.1)', () => {
  const s = (nextDueDate: string | null, state: LeaseBillingSummary['state'], daysUntilDue: number | null = null, outstanding = 0): LeaseBillingSummary => ({
    leaseId: 'x',
    coveredThrough: null,
    paidThrough: null,
    outstanding,
    nextDueDate,
    daysUntilDue,
    state,
  })
  const monthly: Lease = { ...lease, end_date: '2026-12-31' }

  it('counts the days to the next due date with a short caption', () => {
    expect(remainingDays(monthly, s('2026-10-30', 'ok', 18), '2026-10-12')).toEqual({ days: 18, kind: 'ok', value: '18 hari', caption: 'lagi · 30 Okt', tone: 'neutral' })
    expect(remainingDays(monthly, s('2026-10-14', 'due_soon', 2), '2026-10-12')).toEqual({ days: 2, kind: 'soon', value: '2 hari', caption: 'lagi · 14 Okt', tone: 'warning' })
    expect(remainingDays(monthly, s('2026-10-12', 'due_soon', 0), '2026-10-12')).toEqual({ days: 0, kind: 'today', value: 'Hari ini', caption: 'jatuh tempo', tone: 'warning' })
    // daysUntilDue missing -> computed from the dates
    expect(remainingDays(monthly, s('2026-10-30', 'ok'), '2026-10-12')?.days).toBe(18)
  })

  it('shows lateness as a positive count; danger only once the grace days are over', () => {
    expect(remainingDays(monthly, s('2026-10-09', 'due_soon', -3, 100), '2026-10-12')).toEqual({ days: -3, kind: 'grace', value: '3 hari', caption: 'tenggang', tone: 'warning' })
    expect(remainingDays(monthly, s('2026-09-22', 'overdue', -20, 100), '2026-10-12')).toEqual({ days: -20, kind: 'overdue', value: '20 hari', caption: 'terlambat', tone: 'danger' })
  })

  it('a paid-up lease ending within a week counts to its check-out day (end_date + 1); inactive or undated leases get nothing', () => {
    // last night 15 Okt -> check-out 16 Okt: 4 days, the same number as its next due date
    const ending: Lease = { ...lease, end_date: '2026-10-15' }
    expect(remainingDays(ending, s('2026-10-16', 'ok', 4), '2026-10-12')).toEqual({ days: 4, kind: 'ending', value: '4 hari', caption: 'check-out', tone: 'info' })
    // the night of 12 Okt is still theirs: check-out tomorrow
    expect(remainingDays({ ...ending, end_date: '2026-10-12' }, s('2026-10-13', 'ok', 1), '2026-10-12')).toMatchObject({ kind: 'ending', days: 1, value: '1 hari', caption: 'check-out' })
    // on the check-out day itself: 'Hari ini / check-out', not 'jatuh tempo'
    expect(remainingDays({ ...ending, end_date: '2026-10-11' }, s('2026-10-12', 'due_soon', 0), '2026-10-12')).toEqual({ days: 0, kind: 'ending', value: 'Hari ini', caption: 'check-out', tone: 'info' })
    // the day after check-out (tenant stayed on): due again
    expect(remainingDays({ ...ending, end_date: '2026-10-10' }, s('2026-10-11', 'due_soon', -1), '2026-10-12')).toMatchObject({ kind: 'grace', days: -1 })
    // month end: last night 31 Okt -> check-out 1 Nov
    expect(remainingDays({ ...ending, end_date: '2026-10-31' }, s('2026-11-01', 'ok', 4), '2026-10-28')).toMatchObject({ kind: 'ending', days: 4, caption: 'check-out' })
    // check-out 8 days away is outside the week: the plain due count
    expect(remainingDays({ ...ending, end_date: '2026-10-19' }, s('2026-10-20', 'ok', 8), '2026-10-12')).toMatchObject({ kind: 'ok', days: 8, caption: 'lagi · 20 Okt' })
    expect(remainingDays({ ...monthly, status: 'ended' }, s('2026-10-14', 'inactive', 2), '2026-10-12')).toBeNull()
    expect(remainingDays(monthly, s(null, 'unbilled'), '2026-10-12')).toBeNull()
  })
})

describe('leaseReminderText', () => {
  const tenant: Tenant = {
    id: 'T1',
    ...ts,
    property_id: 'P1',
    full_name: 'Siti Rahayu',
    nik: null,
    id_type: 'ktp',
    id_number: null,
    nationality: null,
    phone: '081234567802',
    gender: null,
    birth_place: null,
    birth_date: null,
    address: null,
    religion: null,
    marital_status: null,
    occupation: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    ktp_image_path: null,
    notes: null,
  }
  const room: Room = { id: 'R1', ...ts, property_id: 'P1', name: 'A2', floor: null, price_daily: null, price_weekly: null, price_monthly: 1_000_000, status: 'active', notes: null }
  const property: Property = { id: 'P1', ...ts, name: 'Kos Melati', address: null, notes: null, payment_info: 'BCA 123456 a.n. Ibu Kos', logo_path: null }
  const invoices = [inv('b', '2026-02-10', '2026-03-09'), inv('a', '2026-01-10', '2026-02-09')]
  const input = (payments: Payment[]) => ({ lease, tenant, room, property, invoices, orgInvoices: invoices, payments, addons: [] })

  // the wording of the message (and how it writes the period end) belongs to reminderText; these tests check which
  // invoice / period and which amount leaseReminderText hands it
  const base = { tenantName: 'Siti Rahayu', roomName: 'A2', propertyName: 'Kos Melati', paymentInfo: 'BCA 123456 a.n. Ibu Kos' }

  it('reminds about the oldest open invoice with its remaining amount and the payment info', () => {
    const text = leaseReminderText(input([pay('a', 400_000)]))
    expect(text).toBe(reminderText({ ...base, outstanding: 600_000, dueDate: '2026-01-10', periodStart: '2026-01-10', periodEnd: '2026-02-09' }))
    expect(text).toContain('Halo Kak Siti, ini pengingat dari Kos Melati.')
    expect(text).toContain('*Rp 600.000*')
    expect(text).toContain('BCA 123456 a.n. Ibu Kos')
  })

  it('previews the next period when nothing is open on an active lease', () => {
    const text = leaseReminderText(input([pay('a', 1_000_000), pay('b', 1_000_000)]))
    expect(text).toBe(reminderText({ ...base, outstanding: 1_000_000, dueDate: '2026-03-10', periodStart: '2026-03-10', periodEnd: '2026-04-09' }))
    // the add-ons are part of the preview, as in buildInvoiceDraft
    const withAddon = leaseReminderText({ ...input([pay('a', 1_000_000), pay('b', 1_000_000)]), addons: [{ id: 'ad', org_id: 'o', created_at: '', lease_id: 'L1', name: 'Parkir', amount: 50_000, billing: 'per_period' }] })
    expect(withAddon).toContain('*Rp 1.050.000*')
  })

  it('gives nothing without a phone number, and nothing to preview on a settled finished lease', () => {
    const settled = [pay('a', 1_000_000), pay('b', 1_000_000)]
    expect(leaseReminderText({ ...input(settled), tenant: { ...tenant, phone: null } })).toBeNull()
    expect(leaseReminderText({ ...input(settled), tenant: undefined })).toBeNull()
    expect(leaseReminderText({ ...input(settled), lease: { ...lease, status: 'ended', checkout_date: '2026-03-09' } })).toBeNull()
    // a finished lease with an open invoice is still reminded
    expect(leaseReminderText({ ...input([pay('a', 1_000_000)]), lease: { ...lease, status: 'ended', checkout_date: '2026-03-09' } })).toContain('*Rp 1.000.000*')
    // room / kos unknown -> placeholders, no crash
    expect(leaseReminderText({ ...input([]), room: undefined, property: undefined })).toContain('Tagihan kamar - periode')
  })
})

describe('invoiceDueText', () => {
  const paidOn = (p: Payment, paid_at: string): Payment => ({ ...p, id: `${p.id}-${paid_at}`, paid_at })

  it('a paid invoice says when it was paid (its latest rent payment), not a due date long past', () => {
    // a year paid up front: due on the first day of the stay, paid in two parts
    const year = inv('y', '2026-06-04', '2027-07-03', 19_200_000, 'paid')
    const payments = [paidOn(pay('y', 9_600_000), '2026-06-04'), paidOn(pay('y', 9_600_000), '2026-06-20'), paidOn(pay('other', 5), '2026-09-01')]
    expect(invoiceDueText(year, payments)).toBe('dibayar 20 Jun 2026')
  })

  it('open, partly paid and cancelled invoices keep the due date', () => {
    expect(invoiceDueText(inv('u', '2026-06-04', '2026-07-03'), [])).toBe('jatuh tempo 4 Jun 2026')
    expect(invoiceDueText(inv('p', '2026-06-04', '2026-07-03', 1_000_000, 'partial'), [pay('p', 400_000)])).toBe('jatuh tempo 4 Jun 2026')
    expect(invoiceDueText(inv('v', '2026-06-04', '2026-07-03', 1_000_000, 'void'), [pay('v', 1_000_000)])).toBe('jatuh tempo 4 Jun 2026')
  })

  it('a paid invoice without a rent payment (a zero total) says just lunas; deposits never count', () => {
    const free = inv('z', '2026-06-04', '2026-07-03', 0, 'paid')
    expect(invoiceDueText(free, [{ ...pay('z', 1_000_000), kind: 'deposit' }])).toBe('lunas')
  })
})
