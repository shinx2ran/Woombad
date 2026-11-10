/**
 * Pindah kamar sambil ganti jenis sewa (SPEC 7.24): what the tenant has already paid for but will not use in the old
 * stay when he moves on `moveDate` (the first night he no longer sleeps there under the old lease). Pure.
 *
 * Only settled invoices count (rent paid >= total, total > 0): a part-paid or unpaid invoice is closed by the checkout
 * sheet's own rules. An invoice's period is [period_start, period_end], period_end being its last night. Only an
 * unbroken run of paid nights from the move day counts: a gap (an unpaid invoice in between, or a paid period that
 * starts later) ends it, so "paid through" is a day the tenant has really paid up to. The unused share is by nights
 * and of the RENT only (base - discount; add-ons, late fees and other extras are not given back): rent x unused nights
 * / nights of the invoice, rounded DOWN to whole rupiah, never more than was paid.
 */
import { paidAmountFor } from '../../domain/billing'
import { addDaysISO, daysBetween } from '../../domain/period'
import type { Invoice, Payment } from '../../types/db'

export interface UnusedPaidRent {
  /** paid nights from moveDate on, over all settled invoices */
  nights: number
  /** what those nights cost the tenant, whole rupiah */
  amount: number
  /** the last paid night ('YYYY-MM-DD'), null when nothing is left */
  paidThrough: string | null
  /** the day after the last paid night: when a new stay starts if the paid nights are used first */
  resumeOn: string | null
}

const day = (iso: string) => iso.slice(0, 10)

export function unusedPaidRent(leaseId: string, invoices: readonly Invoice[], payments: Payment[], moveDate: string): UnusedPaidRent {
  const from = day(moveDate)
  let nights = 0
  let amount = 0
  let paidThrough: string | null = null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { nights, amount, paidThrough, resumeOn: null }
  const settled = invoices
    .filter((inv) => inv.lease_id === leaseId && inv.status !== 'void' && inv.total_amount > 0 && day(inv.period_end) >= from && day(inv.period_end) >= day(inv.period_start))
    .filter((inv) => paidAmountFor(inv.id, payments) >= inv.total_amount)
    .sort((x, y) => day(x.period_start).localeCompare(day(y.period_start)))
  // the next night that has to be paid for the run to go on
  let cursor = from
  for (const inv of settled) {
    const start = day(inv.period_start)
    const end = day(inv.period_end)
    if (start > cursor) break
    if (end < cursor) continue
    const total = daysBetween(start, end) + 1
    const unused = daysBetween(cursor, end) + 1
    const rent = Math.min(inv.total_amount, Math.max(0, inv.base_amount - inv.discount_amount))
    nights += unused
    amount += Math.floor((rent * unused) / total)
    paidThrough = end
    cursor = addDaysISO(end, 1)
  }
  return { nights, amount, paidThrough, resumeOn: paidThrough ? addDaysISO(paidThrough, 1) : null }
}
