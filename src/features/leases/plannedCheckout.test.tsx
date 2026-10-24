// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Invoice, Lease, MemberRole } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { PLANNED_CHECKOUT_BEFORE_START_MESSAGE, bindOrg, type OrgRepo } from '../../lib/repo/types'
import { PLANNED_CHECKOUT_INACTIVE_MESSAGE } from './leaseUtils'
import { redatePlannedCheckoutMessage } from './redate'

// SPEC 7.8 Rencana keluar through useLeaseActions (LocalRepo = Mode Demo), and the dialogs that use it. Today: 24 Okt 2026.
const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions, type LeaseActions } from './useLeaseActions'
import { CheckoutModal } from './LifecycleModals'
import { NextInvoiceModal } from './InvoiceFormModal'
import { PlannedCheckoutModal } from './PlannedCheckoutModal'

const ORG = 'org-1'
let local: LocalRepo
let repo: OrgRepo
let lease: Lease

const invoice = (id: string, number: string, start: string, end: string): Invoice =>
  ({
    id,
    org_id: ORG,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'P1',
    lease_id: 'L1',
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
    status: 'paid',
    notes: null,
  }) as Invoice

/** Budi, monthly since 1 Sep, billed and paid through the night of 30 Nov (check-out 1 Des). */
async function seed() {
  local = new LocalRepo(emptyLocalDb(), { today: () => '2026-10-24' })
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
    deposit_amount: 0,
    start_date: '2026-09-01',
    end_date: '2026-11-30',
    status: 'active',
    checkout_date: null,
    notes: null,
  } as never)
  for (const [id, number, start, end] of [
    ['SEP', 'INV-202609-0001', '2026-09-01', '2026-09-30'],
    ['OCT', 'INV-202610-0001', '2026-10-01', '2026-10-31'],
    ['NOV', 'INV-202611-0001', '2026-11-01', '2026-11-30'],
  ]) {
    const { id: _id, org_id: _org, created_at: _c, updated_at: _u, ...row } = invoice(id, number, start, end)
    await repo.insert('invoices', { id, ...row } as never)
  }
}

const stored = async () => (await repo.get('leases', 'L1')) as Lease
function actions() {
  return renderHook(() => useLeaseActions()).result.current
}

beforeEach(() => {
  invalidate.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 24, 10, 0, 0))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('setPlannedCheckout (useLeaseActions)', () => {
  it('the owner records the check-out day; nothing else on the lease changes; clearing removes it', async () => {
    await seed()
    const saved = await actions().setPlannedCheckout(lease, '2026-12-01')
    expect(saved.planned_checkout_date).toBe('2026-12-01')
    const after = await stored()
    expect(after).toMatchObject({ planned_checkout_date: '2026-12-01', end_date: '2026-11-30', status: 'active', checkout_date: null, price_per_period: 1_500_000 })
    expect(invalidate).toHaveBeenCalledWith('leases')
    // invoices untouched
    expect((await repo.list('invoices')).map((i) => [i.period_start, i.period_end, i.status])).toHaveLength(3)

    await actions().setPlannedCheckout(after, null)
    expect((await stored()).planned_checkout_date).toBeNull()
  })

  it('staff may record and clear it (front-desk work, not a lease term)', async () => {
    await seed()
    state.role = 'staff'
    await actions().setPlannedCheckout(lease, '2026-11-15')
    expect((await stored()).planned_checkout_date).toBe('2026-11-15')
    await actions().setPlannedCheckout(lease, null)
    expect((await stored()).planned_checkout_date).toBeNull()
  })

  it('refuses a day on or before the start, and a lease checked out meanwhile (read fresh); nothing is written', async () => {
    await seed()
    await expect(actions().setPlannedCheckout(lease, '2026-09-01')).rejects.toThrow('Tanggal keluar harus sesudah tanggal mulai sewa (1 Sep 2026).')
    await expect(actions().setPlannedCheckout(lease, '')).rejects.toThrow('Isi tanggal keluar.')
    expect((await stored()).planned_checkout_date ?? null).toBeNull()
    // checked out on another phone: the screen still shows it active
    await local.update('leases', 'L1', { status: 'ended', checkout_date: '2026-10-20', end_date: '2026-10-19' })
    await expect(actions().setPlannedCheckout(lease, '2026-12-01')).rejects.toThrow(PLANNED_CHECKOUT_INACTIVE_MESSAGE)
    expect((await stored()).planned_checkout_date ?? null).toBeNull()
    expect(invalidate).toHaveBeenCalledWith('leases')
  })

  it('Mode Demo mirrors the database check constraint', async () => {
    await seed()
    await expect(repo.update('leases', 'L1', { planned_checkout_date: '2026-08-31' })).rejects.toThrow(PLANNED_CHECKOUT_BEFORE_START_MESSAGE)
    await expect(repo.update('leases', 'L1', { start_date: '2026-12-01', planned_checkout_date: '2026-12-01' })).rejects.toThrow(PLANNED_CHECKOUT_BEFORE_START_MESSAGE)
    expect((await stored()).start_date).toBe('2026-09-01')
  })
})

/** Budi's plan of 1 Des freed A1; Sari was booked into it from that day (daily, 1–3 Des, nights 1 and 2 Des). */
async function seedBookedAfterPlan(sariStart = '2026-12-01', sariEnd = '2026-12-02') {
  await seed()
  await repo.insert('rooms', { id: 'R1', property_id: 'P1', name: 'A1', floor: null, price_daily: 100_000, price_weekly: null, price_monthly: 1_500_000, status: 'active', notes: null } as never)
  await repo.insert('tenants', { id: 'T1', property_id: 'P1', full_name: 'Budi', phone: null } as never)
  const sari = await repo.insert('tenants', { id: 'T2', property_id: 'P1', full_name: 'Sari', phone: null } as never)
  lease = await repo.update('leases', 'L1', { planned_checkout_date: '2026-12-01' })
  const booking = await repo.insert('leases', {
    id: 'L2',
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: sari.id,
    period_type: 'daily',
    price_per_period: 100_000,
    deposit_amount: 0,
    start_date: sariStart,
    end_date: sariEnd,
    status: 'active',
    checkout_date: null,
    notes: null,
  } as never)
  return booking
}

describe('a booking made because the Rencana keluar freed the room (SPEC 7.8)', () => {
  const CANCEL_REFUSED = 'Rencana keluar tidak bisa dibatalkan: kamar A1 sudah dipesan Sari mulai 1 Des 2026. Pindahkan atau batalkan pesanan itu dulu.'
  const LATER_REFUSED = 'Kamar A1 sudah dipesan Sari mulai 1 Des 2026, jadi tanggal keluar paling lambat 1 Des 2026. Pindahkan atau batalkan pesanan itu dulu bila penyewa tetap tinggal.'

  for (const role of ['owner', 'staff'] as const) {
    it(`${role}: cancelling the plan or moving it later over the booking is refused before writing, naming the booking`, async () => {
      await seedBookedAfterPlan()
      state.role = role
      await expect(actions().setPlannedCheckout(lease, null)).rejects.toThrow(CANCEL_REFUSED)
      await expect(actions().setPlannedCheckout(lease, '2026-12-10')).rejects.toThrow(LATER_REFUSED)
      // one night later is already Sari's first night
      await expect(actions().setPlannedCheckout(lease, '2026-12-02')).rejects.toThrow(LATER_REFUSED)
      expect((await stored()).planned_checkout_date).toBe('2026-12-01')
      expect(invalidate).toHaveBeenCalledWith('leases')
      // earlier, or back on the booking's check-in day (same-day turnover): accepted
      await actions().setPlannedCheckout(lease, '2026-11-20')
      expect((await stored()).planned_checkout_date).toBe('2026-11-20')
      await actions().setPlannedCheckout(await stored(), '2026-12-01')
      expect((await stored()).planned_checkout_date).toBe('2026-12-01')
    })
  }

  it('the latest day is the booking\'s check-in day; once the booking is cancelled the plan may be cancelled', async () => {
    await seedBookedAfterPlan('2026-12-10', '2026-12-11')
    await actions().setPlannedCheckout(lease, '2026-12-05')
    expect((await stored()).planned_checkout_date).toBe('2026-12-05')
    await expect(actions().setPlannedCheckout(await stored(), '2026-12-12')).rejects.toThrow(
      'Kamar A1 sudah dipesan Sari mulai 10 Des 2026, jadi tanggal keluar paling lambat 10 Des 2026.',
    )
    await local.update('leases', 'L2', { status: 'cancelled' })
    await actions().setPlannedCheckout(await stored(), null)
    expect((await stored()).planned_checkout_date).toBeNull()
  })

  it('the Rencana keluar sheet shows the refusal and stays open', async () => {
    await seedBookedAfterPlan()
    const onClose = vi.fn()
    render(
      <ToastProvider>
        <PlannedCheckoutModal lease={lease} tenantName="Budi" roomName="A1" actions={actions()} onClose={onClose} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Batalkan rencana keluar/ }))
    await waitFor(() => expect(screen.getByText(CANCEL_REFUSED)).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
    expect((await stored()).planned_checkout_date).toBe('2026-12-01')
  })
})

describe('Ubah tanggal mulai with a Rencana keluar (SPEC 7.6 + 7.8)', () => {
  it('the planned check-out does not move with the start', async () => {
    await seed()
    await repo.update('leases', 'L1', { planned_checkout_date: '2026-12-01' })
    const fresh = await stored()
    await actions().redateLease({ lease: fresh, invoices: await repo.list('invoices'), newStart: '2026-08-18', today: '2026-10-24' })
    expect(await stored()).toMatchObject({ start_date: '2026-08-18', end_date: '2026-11-17', planned_checkout_date: '2026-12-01' })
  })

  it('a new start on or after it is refused before anything is written (planner, and LocalRepo like the database)', async () => {
    await seed()
    await repo.update('leases', 'L1', { planned_checkout_date: '2026-09-15' })
    const fresh = await stored()
    const invoices = await repo.list('invoices')
    await expect(actions().redateLease({ lease: fresh, invoices, newStart: '2026-09-15', today: '2026-10-24' })).rejects.toThrow(redatePlannedCheckoutMessage('2026-09-15'))
    expect(redatePlannedCheckoutMessage('2026-09-15')).toBe('Rencana keluar penyewa 15 Sep 2026 tidak sesudah tanggal mulai yang baru. Ubah atau batalkan rencana keluar dulu.')
    expect(await stored()).toMatchObject({ start_date: '2026-09-01', end_date: '2026-11-30' })
    expect((await repo.list('invoices')).map((i) => i.period_start).sort()).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
    // the repo itself refuses the same write
    await expect(
      repo.redateLease({
        leaseId: 'L1',
        expectedStart: '2026-09-01',
        newStart: '2026-09-20',
        newEnd: '2026-12-19',
        invoices: invoices.map((i) => ({ id: i.id, period_start: i.period_start, period_end: i.period_end, due_date: i.due_date })),
        note: null,
      }),
    ).rejects.toThrow(PLANNED_CHECKOUT_BEFORE_START_MESSAGE)
    expect((await stored()).start_date).toBe('2026-09-01')
  })
})

describe('the dialogs', () => {
  const base: Lease = {
    id: 'L1',
    org_id: ORG,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'monthly',
    price_per_period: 1_500_000,
    deposit_amount: 0,
    start_date: '2026-09-01',
    end_date: '2026-11-30',
    status: 'active',
    checkout_date: null,
    notes: null,
  }
  const invoices = [invoice('SEP', 'INV-202609-0001', '2026-09-01', '2026-09-30'), invoice('OCT', 'INV-202610-0001', '2026-10-01', '2026-10-31'), invoice('NOV', 'INV-202611-0001', '2026-11-01', '2026-11-30')]
  const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>)

  it('Checkout starts at the Rencana keluar when one is recorded, else today', () => {
    wrap(<CheckoutModal open onClose={() => {}} lease={{ ...base, planned_checkout_date: '2026-12-01' }} invoices={invoices} payments={[]} expenses={[]} actions={{ canEditInvoices: true } as LeaseActions} />)
    expect(screen.getByLabelText(/Tanggal checkout/)).toHaveProperty('value', '2026-12-01')
    expect(screen.getByText(/Sesuai rencana keluar penyewa/)).toBeTruthy()
    cleanup()
    wrap(<CheckoutModal open onClose={() => {}} lease={base} invoices={invoices} payments={[]} expenses={[]} actions={{ canEditInvoices: true } as LeaseActions} />)
    expect(screen.getByLabelText(/Tanggal checkout/)).toHaveProperty('value', '2026-10-24')
  })

  it('Tagih/Perpanjang warns when the tenant leaves on or before the next period starts, and still lets it be billed', () => {
    const props = { open: true, onClose: () => {}, addons: [], leaseInvoices: invoices, orgInvoices: invoices, actions: { canEditLeaseTerms: true, canWriteInvoiceStatus: true } as LeaseActions }
    wrap(<NextInvoiceModal {...props} lease={{ ...base, planned_checkout_date: '2026-12-01' }} />)
    expect(screen.getByTestId('planned-checkout-warning').textContent).toContain('Penyewa berencana keluar 1 Des 2026.')
    expect(screen.getByTestId('planned-checkout-warning').textContent).toContain('periode mulai 1 Des 2026')
    expect(screen.getByRole('button', { name: 'Buat tagihan' })).toHaveProperty('disabled', false)
    cleanup()
    // leaving earlier than that: warned too; leaving within the next period: not
    wrap(<NextInvoiceModal {...props} lease={{ ...base, planned_checkout_date: '2026-11-20' }} />)
    expect(screen.queryByTestId('planned-checkout-warning')).not.toBeNull()
    cleanup()
    wrap(<NextInvoiceModal {...props} lease={{ ...base, planned_checkout_date: '2026-12-15' }} />)
    expect(screen.queryByTestId('planned-checkout-warning')).toBeNull()
    cleanup()
    wrap(<NextInvoiceModal {...props} lease={base} />)
    expect(screen.queryByTestId('planned-checkout-warning')).toBeNull()
  })

  it('the Rencana keluar sheet starts at the billed check-out day, saves the typed day, and cancels a plan', async () => {
    const setPlannedCheckout = vi.fn(async (l: Lease, day: string | null) => ({ ...l, planned_checkout_date: day }))
    const onClose = vi.fn()
    wrap(<PlannedCheckoutModal lease={base} tenantName="Budi" roomName="A1" actions={{ setPlannedCheckout }} onClose={onClose} />)
    const date = screen.getByLabelText(/Tanggal keluar/)
    expect(date).toHaveProperty('value', '2026-12-01')
    expect(screen.queryByRole('button', { name: /Batalkan rencana keluar/ })).toBeNull()
    fireEvent.change(date, { target: { value: '2026-09-01' } })
    expect(screen.getByText('Tanggal keluar harus sesudah tanggal mulai sewa (1 Sep 2026).')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Simpan' })).toHaveProperty('disabled', true)
    fireEvent.change(date, { target: { value: '2026-12-10' } })
    expect(screen.getByTestId('planned-checkout-note').textContent).toBe('Malam 1 Des – 10 Des 2026 belum ditagih. Buat tagihan berikutnya bila penyewa tetap tinggal sampai hari itu.')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setPlannedCheckout).toHaveBeenCalledWith(base, '2026-12-10')
    cleanup()

    // a recorded plan: starts there and can be cancelled
    const planned = { ...base, planned_checkout_date: '2026-11-15' }
    wrap(<PlannedCheckoutModal lease={planned} tenantName="Budi" roomName="A1" actions={{ setPlannedCheckout }} onClose={onClose} />)
    expect(screen.getByLabelText(/Tanggal keluar/)).toHaveProperty('value', '2026-11-15')
    expect(screen.getByTestId('planned-checkout-note').textContent).toContain('Cek kamar menawarkan kamar ini mulai 1 Des 2026')
    fireEvent.click(screen.getByRole('button', { name: /Batalkan rencana keluar/ }))
    await waitFor(() => expect(setPlannedCheckout).toHaveBeenLastCalledWith(planned, null))
  })

  it('a tenant whose billed period already ended starts at today, not in the past', () => {
    wrap(<PlannedCheckoutModal lease={{ ...base, end_date: '2026-10-19' }} tenantName="Budi" roomName="A1" actions={{ setPlannedCheckout: vi.fn() }} onClose={() => {}} />)
    expect(screen.getByLabelText(/Tanggal keluar/)).toHaveProperty('value', '2026-10-24')
    fireEvent.change(screen.getByLabelText(/Tanggal keluar/), { target: { value: '2026-10-20' } })
    expect(screen.getByText(/Tanggal ini sudah lewat/)).toBeTruthy()
  })
})
