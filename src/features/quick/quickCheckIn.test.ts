import { beforeEach, describe, expect, it } from 'vitest'
import { buildInvoiceDraft, type InvoiceDraftInput } from '../../domain/billing'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import type { Lease, Room, Tenant } from '../../types/db'
import { invoiceInsertFromDraft } from '../leases/leaseUtils'
import {
  perNightText,
  perPeriodText,
  planQuickCheckIn,
  planStayBooking,
  quantityText,
  QuickCheckInError,
  resolveTenantChoice,
  saveQuickCheckIn,
  saveStayBooking,
  tenantsNamed,
  validateQuickCheckIn,
  validateStayBooking,
  type QuickCheckInDeps,
  type QuickCheckInInput,
  type StayBookingInput,
} from './quickCheckIn'

const TODAY = '2026-10-15'
const ts = { org_id: 'org-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const ROOM: Room = {
  id: 'R4',
  property_id: 'P1',
  name: 'D4',
  floor: null,
  price_daily: 180_000,
  price_weekly: null,
  price_monthly: null,
  status: 'active',
  notes: null,
  ...ts,
}
const base: QuickCheckInInput = { room: ROOM, startDate: TODAY, nights: 2, total: 360_000, paid: true, method: 'cash', tenantId: null, name: 'Taufik Kusnadi', phone: '' }

describe('planQuickCheckIn', () => {
  it('2 nights for 360k from 15 Okt: last night 16 Okt, Rp 180.000 per night', () => {
    expect(planQuickCheckIn('2026-10-15', 2, 360_000)).toEqual({ end: '2026-10-16', pricePerNight: 180_000, baseAmount: undefined })
  })

  it('keeps the agreed total when it does not split evenly', () => {
    const plan = planQuickCheckIn('2026-10-15', 3, 350_000)!
    expect(plan).toEqual({ end: '2026-10-17', pricePerNight: 116_667, baseAmount: 350_000 })
    expect(perNightText(plan, 350_000)).toBe('≈ Rp 116.667 / malam (total tetap Rp 350.000)')
    expect(perNightText(planQuickCheckIn('2026-10-15', 2, 360_000)!, 360_000)).toBe('= Rp 180.000 / malam')
  })

  it('has no plan without a date, a night or a total', () => {
    expect(planQuickCheckIn('', 2, 360_000)).toBeNull()
    expect(planQuickCheckIn(TODAY, 0, 360_000)).toBeNull()
    expect(planQuickCheckIn(TODAY, 2, 0)).toBeNull()
  })
})

describe('validateQuickCheckIn', () => {
  it('needs a name, but the phone may wait', () => {
    expect(validateQuickCheckIn(base, [])).toEqual({})
    expect(validateQuickCheckIn({ ...base, name: '' }, []).name).toBe('Nama wajib diisi.')
    expect(validateQuickCheckIn({ ...base, phone: 'abc' }, []).phone).toMatch(/Nomor HP tidak valid/)
    expect(validateQuickCheckIn({ ...base, phone: '0812-3456-7890' }, [])).toEqual({})
  })

  it('a returning tenant needs no name', () => {
    expect(validateQuickCheckIn({ ...base, tenantId: 'T9', name: '' }, [])).toEqual({})
  })

  it('refuses a room that is taken or under repair, and an empty total', () => {
    const living: Lease = {
      id: 'L1',
      property_id: 'P1',
      room_id: 'R4',
      tenant_id: 'T1',
      period_type: 'monthly',
      price_per_period: 1_500_000,
      deposit_amount: 0,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
      status: 'active',
      checkout_date: null,
      notes: null,
      ...ts,
    }
    expect(validateQuickCheckIn(base, [living]).room).toBe('Kamar D4 terisi pada tanggal ini.')
    expect(validateQuickCheckIn({ ...base, room: { ...ROOM, status: 'maintenance' } }, []).room).toBe('Kamar D4 perbaikan pada tanggal ini.')
    expect(validateQuickCheckIn({ ...base, total: 0 }, []).total).toBe('Isi total yang dibayar.')
  })
})

describe('tenantsNamed', () => {
  it('finds the same name whatever the spacing or case', () => {
    const t = { id: 'T1', full_name: 'Taufik Kusnadi' } as Tenant
    expect(tenantsNamed([t], '  taufik   KUSNADI ')).toEqual([t])
    expect(tenantsNamed([t], 'Taufik')).toEqual([])
    expect(tenantsNamed([t], 'T')).toEqual([])
  })
})

describe('resolveTenantChoice', () => {
  const a = { id: 'T1', full_name: 'Budi' } as Tenant
  const b = { id: 'T2', full_name: 'Budi' } as Tenant
  it('uses the only same-name tenant unless "orang lain" is picked', () => {
    expect(resolveTenantChoice([a], '', 'baru')).toBe('T1')
    expect(resolveTenantChoice([a], 'baru', 'baru')).toBeNull()
    expect(resolveTenantChoice([], '', 'baru')).toBeNull()
  })
  it('with several same-name tenants only an explicit pick counts', () => {
    expect(resolveTenantChoice([a, b], '', 'baru')).toBeNull()
    expect(resolveTenantChoice([a, b], 'T2', 'baru')).toBe('T2')
  })
  it('a pick for an earlier spelling of the name no longer counts after the name changed', () => {
    // picked T2 for "Budi", then the name became "Budi Santoso": no same-name tenant, so a new tenant
    expect(resolveTenantChoice([], 'T2', 'baru')).toBeNull()
  })
})

describe('saveQuickCheckIn: the same rows as the Sewa baru wizard', () => {
  let repo: OrgRepo
  let deps: QuickCheckInDeps

  beforeEach(() => {
    repo = bindOrg(new LocalRepo(emptyLocalDb()), 'org-1')
    deps = {
      repo,
      insertFromDraft: async (input: InvoiceDraftInput, notes: string | null) => {
        const draft = buildInvoiceDraft(input)
        const invoice = await repo.insert('invoices', invoiceInsertFromDraft(input.lease, draft, notes))
        return { invoice, draft }
      },
      canWriteInvoiceStatus: true,
      orgInvoices: [],
      todayISO: TODAY,
    }
  })

  it('new guest without a phone, 2 nights paid by transfer', async () => {
    const { lease, invoice, tenantId } = await saveQuickCheckIn({ ...base, method: 'transfer' }, deps)
    const tenants = await repo.list('tenants')
    expect(tenants).toHaveLength(1)
    expect(tenants[0]).toMatchObject({ id: tenantId, full_name: 'Taufik Kusnadi', phone: null, property_id: 'P1' })
    expect(lease).toMatchObject({ room_id: 'R4', tenant_id: tenantId, period_type: 'daily', price_per_period: 180_000, start_date: '2026-10-15', end_date: '2026-10-16', deposit_amount: 0, status: 'active' })
    expect(invoice).toMatchObject({ lease_id: lease.id, period_start: '2026-10-15', period_end: '2026-10-16', quantity: 2, total_amount: 360_000 })
    const payments = await repo.list('payments')
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ invoice_id: invoice.id, lease_id: lease.id, amount: 360_000, method: 'transfer', kind: 'rent', paid_at: TODAY })
    expect((await repo.list('invoices'))[0].status).toBe('paid')
  })

  it('returning guest, unpaid, uneven total: no new tenant, no payment, the invoice keeps the agreed total', async () => {
    const t = await repo.insert('tenants', { property_id: 'P1', full_name: 'Taufik Kusnadi', phone: '+6281234567890' } as never)
    const { lease, invoice } = await saveQuickCheckIn({ ...base, tenantId: t.id, nights: 3, total: 350_000, paid: false }, deps)
    expect(await repo.list('tenants')).toHaveLength(1)
    expect(lease.tenant_id).toBe(t.id)
    expect(lease.end_date).toBe('2026-10-17')
    expect(invoice).toMatchObject({ quantity: 3, base_amount: 350_000, total_amount: 350_000, status: 'unpaid' })
    expect(await repo.list('payments')).toHaveLength(0)
  })

  it('reports what was already written when a later step fails', async () => {
    deps.insertFromDraft = async () => {
      throw new Error('Nomor tagihan sudah dipakai')
    }
    const err = await saveQuickCheckIn(base, deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QuickCheckInError)
    const qe = err as QuickCheckInError
    expect(qe.message).toBe('Nomor tagihan sudah dipakai')
    expect(qe.createdTenant?.full_name).toBe('Taufik Kusnadi')
    expect(qe.lease?.room_id).toBe('R4')
  })
})

const MONTHLY_ROOM: Room = { ...ROOM, id: 'R13', name: 'A13', price_weekly: 850_000, price_monthly: 1_600_000 }
const yearly: StayBookingInput = {
  room: MONTHLY_ROOM,
  periodType: 'monthly',
  startDate: '2026-06-04',
  quantity: 12,
  total: 19_200_000,
  paidAmount: 19_200_000,
  method: 'transfer',
  tenantId: null,
  name: 'Kelvin',
  phone: '',
  notes: null,
  bonusQuantity: 1,
  deposit: { amount: 1_000_000, paidNow: true },
}

describe('planStayBooking with bonus periods (Check-in cepat tahunan)', () => {
  it('12 months paid + 1 bonus from 4 Jun 2026: the stay covers 13 months, the invoice discounts one at the monthly price', () => {
    const plan = planStayBooking('2026-06-04', 'monthly', 12, 19_200_000, 1)!
    expect(plan).toMatchObject({ end: '2027-07-03', pricePerPeriod: 1_600_000, quantityTotal: 13, discountAmount: 1_600_000, baseAmount: undefined })
    expect(perPeriodText(plan, 19_200_000, 'monthly')).toBe('= Rp 1.600.000 / bulan')
    expect(quantityText(12, 1, 'monthly')).toBe('13 bulan (12 dibayar + 1 bonus)')
    expect(quantityText(2, 0, 'daily')).toBe('2 malam')
  })

  it('an uneven total keeps the agreed total: base = total + discount', () => {
    const plan = planStayBooking('2026-06-04', 'monthly', 12, 19_000_000, 1)!
    expect(plan.pricePerPeriod).toBe(1_583_333)
    expect(plan.discountAmount).toBe(1_583_333)
    expect(plan.baseAmount).toBe(19_000_000 + 1_583_333)
  })

  it('no bonus is the old plan; a negative bonus is no plan', () => {
    expect(planStayBooking('2026-10-15', 'weekly', 2, 1_700_000)).toMatchObject({ end: '2026-10-28', pricePerPeriod: 850_000, quantityTotal: 2, discountAmount: 0 })
    expect(planStayBooking('2026-10-15', 'monthly', 12, 1, -1)).toBeNull()
  })
})

describe('validateStayBooking', () => {
  it('checks the money fields: DP within the total, no negative deposit or bonus', () => {
    expect(validateStayBooking({ ...yearly, paidAmount: 20_000_000 }, []).paid).toBe('Tidak boleh lebih dari total (Rp 19.200.000).')
    expect(validateStayBooking({ ...yearly, paidAmount: -1 }, []).paid).toBe('Tidak boleh negatif.')
    expect(validateStayBooking({ ...yearly, deposit: { amount: -5, paidNow: true } }, []).deposit).toBe('Tidak boleh negatif.')
    expect(validateStayBooking({ ...yearly, bonusQuantity: -1 }, []).bonus).toBe('Tidak boleh negatif.')
    expect(validateStayBooking({ ...yearly, quantity: 0 }, []).quantity).toBe('Minimal 1 bulan.')
    expect(validateStayBooking(yearly, [])).toEqual({})
  })

  it('refuses a room taken on the check-in day, naming the room', () => {
    const taken: Lease = { id: 'L9', ...ts, property_id: 'P1', room_id: 'R13', tenant_id: 'T9', period_type: 'monthly', price_per_period: 1_600_000, deposit_amount: 0, start_date: '2026-05-10', end_date: '2026-06-09', status: 'active', checkout_date: null, notes: null, planned_checkout_date: null }
    expect(validateStayBooking(yearly, [taken]).room).toBe('Kamar A13 terisi pada tanggal ini.')
    // an active lease past its end keeps the room until its checkout is recorded (SPEC 7.4); once it is, the room is free
    expect(validateStayBooking({ ...yearly, startDate: '2026-06-11' }, [taken]).room).toBe('Kamar A13 terisi pada tanggal ini.')
    expect(validateStayBooking({ ...yearly, startDate: '2026-06-11' }, [{ ...taken, status: 'ended', checkout_date: '2026-06-10' }])).toEqual({})
  })
})

describe('saveStayBooking: a year with a bonus month and a deposit, as the owner books A13', () => {
  let repo: OrgRepo
  let deps: QuickCheckInDeps

  beforeEach(() => {
    repo = bindOrg(new LocalRepo(emptyLocalDb()), 'org-1')
    deps = {
      repo,
      insertFromDraft: async (input: InvoiceDraftInput, notes: string | null) => {
        const draft = buildInvoiceDraft(input)
        const invoice = await repo.insert('invoices', invoiceInsertFromDraft(input.lease, draft, notes))
        return { invoice, draft }
      },
      canWriteInvoiceStatus: true,
      orgInvoices: [],
      todayISO: '2026-06-04',
    }
  })

  it('lease 13 months at Rp 1.600.000 with a Rp 1.000.000 deposit; invoice 13 x 1.6M minus 1.6M = 19.2M, paid; deposit received', async () => {
    const { lease, invoice, payment, depositPayment } = await saveStayBooking(yearly, deps)
    expect(lease).toMatchObject({ room_id: 'R13', period_type: 'monthly', price_per_period: 1_600_000, deposit_amount: 1_000_000, start_date: '2026-06-04', end_date: '2027-07-03', status: 'active' })
    expect(invoice).toMatchObject({ quantity: 13, base_amount: 20_800_000, discount_amount: 1_600_000, total_amount: 19_200_000, period_start: '2026-06-04', period_end: '2027-07-03', notes: 'bonus 1 bulan' })
    expect(payment).toMatchObject({ invoice_id: invoice.id, amount: 19_200_000, kind: 'rent', method: 'transfer', notes: null })
    expect(depositPayment).toMatchObject({ invoice_id: null, lease_id: lease.id, amount: 1_000_000, kind: 'deposit', method: 'transfer', notes: 'Uang jaminan' })
    expect((await repo.list('invoices'))[0].status).toBe('paid')
    expect(await repo.list('payments')).toHaveLength(2)
  })

  it('a DP on a monthly stay without deposit: partial invoice, the DP payment is marked, no deposit row', async () => {
    const { invoice, payment, depositPayment } = await saveStayBooking({ ...yearly, quantity: 1, bonusQuantity: 0, total: 1_600_000, paidAmount: 500_000, deposit: null }, deps)
    expect(invoice).toMatchObject({ quantity: 1, discount_amount: 0, total_amount: 1_600_000 })
    expect(payment).toMatchObject({ amount: 500_000, notes: 'DP' })
    expect(depositPayment).toBeNull()
    expect((await repo.list('invoices'))[0].status).toBe('partial')
    expect((await repo.list('leases'))[0].deposit_amount).toBe(0)
  })

  it('an agreed deposit not yet received: on the lease, no payment', async () => {
    const { lease, depositPayment } = await saveStayBooking({ ...yearly, deposit: { amount: 1_000_000, paidNow: false } }, deps)
    expect(lease.deposit_amount).toBe(1_000_000)
    expect(depositPayment).toBeNull()
    expect((await repo.list('payments')).map((p) => p.kind)).toEqual(['rent'])
  })
})
