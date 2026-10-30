// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Lease, MemberRole, Payment, Room } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'

// SPEC 7.12: a daily guest who stays on as weekly or monthly is asked for the uang jaminan in "Buat tagihan berikutnya".
// Room D1 as on the live data: a night on 29 Okt for Rp 250.000, extended from 30 Okt as weekly Rp 1.000.000.
const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions } from './useLeaseActions'
import { NextInvoiceModal } from './InvoiceFormModal'

let repo: OrgRepo
const room = {
  id: 'R1',
  org_id: 'org-1',
  property_id: 'P1',
  name: 'D1',
  floor: null,
  price_daily: 250_000,
  price_weekly: 1_000_000,
  price_monthly: 2_500_000,
  status: 'active',
  notes: null,
} as Room

beforeEach(async () => {
  invalidate.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 29, 20, 0, 0))
  repo = bindOrg(new LocalRepo(emptyLocalDb(), { today: () => '2026-10-29' }), 'org-1')
  state.repo = repo
  state.role = 'owner'
  await repo.insert('properties', { id: 'P1', name: 'EG Kost', address: null, notes: null, payment_info: null } as never)
  await repo.insert('rooms', { ...room } as never)
  await repo.insert('leases', {
    id: 'L1',
    property_id: 'P1',
    room_id: 'R1',
    tenant_id: 'T1',
    period_type: 'daily',
    price_per_period: 250_000,
    deposit_amount: 0,
    start_date: '2026-10-29',
    end_date: '2026-10-29',
    status: 'active',
    checkout_date: null,
    notes: null,
  } as never)
  await repo.insert('invoices', {
    id: 'I1',
    property_id: 'P1',
    lease_id: 'L1',
    invoice_number: 'INV-202610-0038',
    period_type: 'daily',
    period_start: '2026-10-29',
    period_end: '2026-10-29',
    quantity: 1,
    base_amount: 250_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 250_000,
    due_date: '2026-10-29',
    status: 'paid',
    notes: null,
  } as never)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const stored = async () => (await repo.get('leases', 'L1')) as Lease
const actions = () => renderHook(() => useLeaseActions()).result.current

async function openSheet(onClose = vi.fn(), payments: Payment[] = []) {
  const leaseInvoices = await repo.list('invoices')
  render(
    <ToastProvider>
      <NextInvoiceModal
        open
        onClose={onClose}
        lease={await stored()}
        room={room}
        addons={[]}
        leaseInvoices={leaseInvoices}
        orgInvoices={leaseInvoices}
        payments={payments}
        expenses={[]}
        actions={actions()}
      />
    </ToastProvider>,
  )
  return onClose
}

describe('Buat tagihan berikutnya: deposit when a stay switches to weekly or monthly', () => {
  it('staying daily asks for nothing; switching to Mingguan asks for the deposit and warns while it is 0', async () => {
    await openSheet()
    expect(screen.queryByTestId('extension-deposit')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    expect(screen.getByLabelText('Uang jaminan (deposit)')).toHaveProperty('value', '')
    expect(screen.getByTestId('extension-deposit-missing').textContent).toContain('sewa mingguan sebaiknya memakai deposit')
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '200000' } })
    expect(screen.queryByTestId('extension-deposit-missing')).toBeNull()
    // back to Harian: the question goes away again
    fireEvent.click(screen.getByRole('radio', { name: 'Harian' }))
    expect(screen.queryByTestId('extension-deposit')).toBeNull()
  })

  it('D1: weekly from 30 Okt with Rp 200.000 deposit received by transfer: one save writes the lease, the invoice and the deposit', async () => {
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '200000' } })
    const received = screen.getByRole('checkbox', { name: 'Deposit Rp 200.000 sudah diterima' })
    expect(received).toHaveProperty('checked', true)
    fireEvent.change(screen.getByLabelText('Metode deposit'), { target: { value: 'transfer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    expect(await stored()).toMatchObject({ period_type: 'weekly', price_per_period: 1_000_000, deposit_amount: 200_000, end_date: '2026-11-05' })
    const invoices = await repo.list('invoices')
    expect(invoices.find((i) => i.id !== 'I1')).toMatchObject({ period_type: 'weekly', period_start: '2026-10-30', period_end: '2026-11-05', total_amount: 1_000_000 })
    expect((await repo.list('payments')).map((p) => [p.kind, p.amount, p.method, p.invoice_id, p.notes])).toEqual([['deposit', 200_000, 'transfer', null, 'Uang jaminan']])
    expect(screen.getByText(/Sewa kini Mingguan Rp 1\.000\.000 \/ minggu\. Deposit Rp 200\.000, diterima Rp 200\.000 \(Transfer\)\./)).toBeTruthy()
  })

  it('a deposit agreed but not paid yet: on the lease, no payment, and the toast says so', async () => {
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Bulanan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '500000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deposit Rp 500.000 sudah diterima' }))
    expect(screen.queryByLabelText('Metode deposit')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await stored()).toMatchObject({ period_type: 'monthly', deposit_amount: 500_000 })
    expect(await repo.list('payments')).toEqual([])
    expect(screen.getByText(/Deposit Rp 500\.000 belum diterima\./)).toBeTruthy()
  })

  it('left at 0 the extension still saves (the owner may waive it); the lease keeps no deposit', async () => {
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await stored()).toMatchObject({ period_type: 'weekly', deposit_amount: 0 })
    expect(await repo.list('payments')).toEqual([])
  })

  it('a weekly stay without deposit going monthly: the warning does not speak of a daily stay', async () => {
    await repo.update('leases', 'L1', { period_type: 'weekly', price_per_period: 1_000_000 })
    await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Bulanan' }))
    expect(screen.getByTestId('extension-deposit-missing').textContent).toBe('Belum ada deposit. Sewa bulanan sebaiknya memakai deposit.')
  })

  it('a deposit partly received before: only what is still owed is received now', async () => {
    await repo.update('leases', 'L1', { period_type: 'weekly', price_per_period: 1_000_000, deposit_amount: 100_000 })
    const paid = await repo.insert('payments', { property_id: 'P1', invoice_id: null, lease_id: 'L1', amount: 100_000, paid_at: '2026-10-29', method: 'cash', kind: 'deposit', notes: 'Uang jaminan' } as never)
    const onClose = await openSheet(vi.fn(), [paid])
    fireEvent.click(screen.getByRole('radio', { name: 'Bulanan' }))
    const deposit = screen.getByLabelText('Uang jaminan (deposit)')
    expect(deposit).toHaveProperty('value', '100.000')
    expect(screen.getByText(/Sudah diterima Rp 100\.000\./)).toBeTruthy()
    fireEvent.change(deposit, { target: { value: '300000' } })
    // the rest, named as the rest
    expect(screen.getByRole('checkbox', { name: 'Sisa deposit Rp 200.000 sudah diterima' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await stored()).deposit_amount).toBe(300_000)
    expect((await repo.list('payments')).filter((p) => p.kind === 'deposit').map((p) => [p.amount, p.paid_at]).sort()).toEqual([[100_000, '2026-10-29'], [200_000, '2026-10-29']])
    expect(screen.getByText(/Deposit Rp 300\.000, sisa diterima Rp 200\.000 \(Tunai\)\./)).toBeTruthy()
  })

  it('the rest not paid yet: the toast names the rest, not the whole deposit', async () => {
    await repo.update('leases', 'L1', { period_type: 'weekly', price_per_period: 1_000_000, deposit_amount: 100_000 })
    const paid = await repo.insert('payments', { property_id: 'P1', invoice_id: null, lease_id: 'L1', amount: 100_000, paid_at: '2026-10-29', method: 'cash', kind: 'deposit', notes: 'Uang jaminan' } as never)
    const onClose = await openSheet(vi.fn(), [paid])
    fireEvent.click(screen.getByRole('radio', { name: 'Bulanan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '300000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sisa deposit Rp 200.000 sudah diterima' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/Deposit Rp 300\.000, sisa Rp 200\.000 belum diterima\./)).toBeTruthy()
    expect((await repo.list('payments')).filter((p) => p.kind === 'deposit')).toHaveLength(1)
  })

  it('an old deposit agreed but never paid is not ticked as received unless typed here', async () => {
    await repo.update('leases', 'L1', { deposit_amount: 300_000 })
    await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    expect(screen.getByRole('checkbox', { name: 'Deposit Rp 300.000 sudah diterima' })).toHaveProperty('checked', false)
    expect(screen.queryByLabelText('Metode deposit')).toBeNull()
    // a deposit is agreed: no warning
    expect(screen.queryByTestId('extension-deposit-missing')).toBeNull()
  })

  it('the deposit payment failing after the invoice: both saved stay, the message says where to finish', async () => {
    const onClose = vi.fn()
    const leaseInvoices = await repo.list('invoices')
    const real = actions()
    const failing = { ...real, recordDeposit: vi.fn(async () => { throw new Error('Tidak dapat terhubung ke server.') }) }
    render(
      <ToastProvider>
        <NextInvoiceModal open onClose={onClose} lease={await stored()} room={room} addons={[]} leaseInvoices={leaseInvoices} orgInvoices={leaseInvoices} payments={[]} expenses={[]} actions={failing} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '200000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/deposit yang diterima gagal dicatat: Tidak dapat terhubung ke server\. Catat lewat Lainnya → Catat deposit diterima\./)).toBeTruthy()
    expect(await stored()).toMatchObject({ period_type: 'weekly', deposit_amount: 200_000 })
    expect(await repo.list('invoices')).toHaveLength(2)
    expect(await repo.list('payments')).toEqual([])
  })

  it('staff: the sheet says only an owner/admin sets the deposit, and the action refuses a new deposit before writing', async () => {
    state.role = 'staff'
    await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    expect(screen.getByTestId('extension-deposit').textContent).toContain('hanya pemilik/admin yang dapat mengisinya')
    expect(screen.queryByLabelText('Uang jaminan (deposit)')).toBeNull()
    cleanup()
    const leaseInvoices = await repo.list('invoices')
    await expect(
      actions().issueInvoice({ lease: await stored(), addons: [], quantity: 1, periodType: 'weekly', pricePerPeriod: 1_000_000, depositAmount: 200_000, notes: null, existingInvoices: leaseInvoices, orgInvoices: leaseInvoices }),
    ).rejects.toThrow('Hanya pemilik/admin yang dapat mengubah deposit yang disepakati.')
    expect(await repo.list('invoices')).toHaveLength(1)
    expect((await stored()).deposit_amount).toBe(0)
  })

  it('the same deposit passed again changes nothing on the lease but the extension', async () => {
    const leaseInvoices = await repo.list('invoices')
    await actions().issueInvoice({ lease: await stored(), addons: [], quantity: 2, depositAmount: 0, notes: null, existingInvoices: leaseInvoices, orgInvoices: leaseInvoices })
    expect(await stored()).toMatchObject({ period_type: 'daily', deposit_amount: 0, end_date: '2026-10-31' })
  })
})
