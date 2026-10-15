import { beforeEach, describe, expect, it } from 'vitest'
import { buildInvoiceDraft, type InvoiceDraftInput } from '../../domain/billing'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import type { Lease, Room, Tenant } from '../../types/db'
import { invoiceInsertFromDraft } from '../leases/leaseUtils'
import {
  perNightText,
  planQuickCheckIn,
  QuickCheckInError,
  resolveTenantChoice,
  saveQuickCheckIn,
  tenantsNamed,
  validateQuickCheckIn,
  type QuickCheckInDeps,
  type QuickCheckInInput,
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
