// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Invoice, Lease, MemberRole, Payment, Room } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'

// SPEC 7.13 "Bayar & perpanjang": the next-invoice sheet with the rent recorded in the same save; SPEC 7.14 Cek harga in it.
// A daily guest in D1 (Rp 250.000 a night, paid for 29 Okt) hands over the money for the next night on 29 Okt 20:00.
const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions, type LeaseActions } from './useLeaseActions'
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
const newInvoice = async () => (await repo.list('invoices')).find((i) => i.id !== 'I1')

/** the cash already received for I1 (the sheet's view of the org's payments; not written to the repo) */
const paidI1 = { id: 'P-I1', lease_id: 'L1', invoice_id: 'I1', amount: 250_000, kind: 'rent', method: 'cash', paid_at: '2026-10-29' } as Payment

async function openSheet({ payNow = true, using, onCreated, sheetRoom = room }: { payNow?: boolean; using?: LeaseActions; onCreated?: (i: Invoice) => void; sheetRoom?: Room } = {}) {
  const onClose = vi.fn()
  const leaseInvoices = await repo.list('invoices')
  render(
    <ToastProvider>
      <NextInvoiceModal
        open
        onClose={onClose}
        lease={await stored()}
        room={sheetRoom}
        addons={[]}
        leaseInvoices={leaseInvoices}
        orgInvoices={leaseInvoices}
        payments={[paidI1]}
        expenses={[]}
        actions={using ?? actions()}
        onCreated={onCreated}
        payNow={payNow}
      />
    </ToastProvider>,
  )
  return onClose
}

describe('Bayar & perpanjang (SPEC 7.13)', () => {
  it('the plain "Buat tagihan berikutnya" is unchanged: no payment question, no payment written', async () => {
    const onClose = await openSheet({ payNow: false })
    expect(screen.getByRole('heading', { name: 'Buat tagihan berikutnya' })).toBeTruthy()
    expect(screen.queryByTestId('pay-now')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await newInvoice())?.status).toBe('unpaid')
    expect(await repo.list('payments')).toEqual([])
  })

  it('one save: the next night billed, paid in full in cash today, the lease extended; the share sheet gets the invoice', async () => {
    const onCreated = vi.fn()
    const onClose = await openSheet({ onCreated })
    expect(screen.getByRole('heading', { name: 'Bayar & perpanjang' })).toBeTruthy()
    const paid = screen.getByRole('checkbox', { name: 'Sudah dibayar lunas Rp 250.000' })
    expect(paid).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Metode bayar')).toHaveProperty('value', 'cash')
    expect(screen.getByLabelText(/Tanggal bayar/)).toHaveProperty('value', '2026-10-29')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const invoice = await newInvoice()
    expect(invoice).toMatchObject({ period_start: '2026-10-30', period_end: '2026-10-30', total_amount: 250_000, status: 'paid' })
    expect((await repo.list('payments')).map((p) => [p.kind, p.amount, p.method, p.paid_at, p.invoice_id])).toEqual([['rent', 250_000, 'cash', '2026-10-29', invoice!.id]])
    expect((await stored()).end_date).toBe('2026-10-30')
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: invoice!.id }))
    expect(screen.getByText(/Tagihan INV-202610-\d+ lunas, Rp 250\.000 diterima \(Tunai\)\. Sewa diperpanjang, check-out 31 Okt 2026\./)).toBeTruthy()
  })

  it('two nights by transfer, paid yesterday: the amount follows the total, the date is the one typed', async () => {
    const onClose = await openSheet()
    fireEvent.change(screen.getByLabelText(/Jumlah periode/), { target: { value: '2' } })
    expect(screen.getByRole('checkbox', { name: 'Sudah dibayar lunas Rp 500.000' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Metode bayar'), { target: { value: 'transfer' } })
    fireEvent.change(screen.getByLabelText(/Tanggal bayar/), { target: { value: '2026-10-28' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await repo.list('payments')).map((p) => [p.amount, p.method, p.paid_at])).toEqual([[500_000, 'transfer', '2026-10-28']])
    expect((await newInvoice())?.status).toBe('paid')
  })

  it('unticked it is the plain sheet: the invoice is made unpaid and nothing is recorded', async () => {
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('checkbox', { name: /Sudah dibayar lunas/ }))
    expect(screen.queryByLabelText('Metode bayar')).toBeNull()
    expect(screen.getByTestId('pay-now').textContent).toContain('Catat lewat Catat pembayaran')
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await newInvoice())?.status).toBe('unpaid')
    expect(await repo.list('payments')).toEqual([])
  })

  it('a payment day after today is refused before anything is written', async () => {
    const onClose = await openSheet()
    fireEvent.change(screen.getByLabelText(/Tanggal bayar/), { target: { value: '2026-10-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    expect(await screen.findByText('Tanggal bayar tidak boleh sesudah hari ini.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(await repo.list('invoices')).toHaveLength(1)
  })

  it('daily to weekly with a Rp 200.000 deposit handed over too: rent and deposit recorded on the typed day', async () => {
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText(/Tanggal bayar/), { target: { value: '2026-10-28' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await stored()).toMatchObject({ period_type: 'weekly', deposit_amount: 200_000, end_date: '2026-11-05' })
    const rows = (await repo.list('payments')).map((p) => [p.kind, p.amount, p.method, p.paid_at]).sort()
    expect(rows).toEqual([
      ['deposit', 200_000, 'cash', '2026-10-28'],
      ['rent', 1_000_000, 'cash', '2026-10-28'],
    ])
    expect(screen.getByText(/lunas, Rp 1\.000\.000 diterima \(Tunai\)\. .*Deposit Rp 200\.000, diterima Rp 200\.000 \(Tunai\)\./)).toBeTruthy()
  })

  it('the rent payment failing after the invoice: the invoice stays, the message says where to finish it', async () => {
    const real = actions()
    const failing = { ...real, recordRentPayment: vi.fn(async () => { throw new Error('Tidak dapat terhubung ke server.') }) }
    const onCreated = vi.fn()
    const onClose = await openSheet({ using: failing, onCreated })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/Tagihan INV-202610-\d+ dibuat, tetapi pembayaran sewanya gagal dicatat: Tidak dapat terhubung ke server\. Catat lewat Catat pembayaran\./)).toBeTruthy()
    expect((await newInvoice())?.status).toBe('unpaid')
    expect(onCreated).toHaveBeenCalled()
  })

  it('rent recorded but the deposit failing: the message says the invoice is paid and names only the deposit', async () => {
    const real = actions()
    const failing = { ...real, recordDeposit: vi.fn(async () => { throw new Error('Tidak dapat terhubung ke server.') }) }
    const onClose = await openSheet({ using: failing })
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    fireEvent.change(screen.getByLabelText('Uang jaminan (deposit)'), { target: { value: '200000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/dibuat dan lunas, tetapi deposit yang diterima gagal dicatat: Tidak dapat terhubung ke server\. Catat lewat Lainnya → Catat deposit diterima\./)).toBeTruthy()
    expect((await repo.list('payments')).map((p) => p.kind)).toEqual(['rent'])
  })

  it('staff may record the rent with the extension (front-desk work)', async () => {
    state.role = 'staff'
    const onClose = await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await repo.list('payments')).map((p) => [p.kind, p.amount])).toEqual([['rent', 250_000]])
  })
})

describe('Cek harga in the next-invoice sheet (SPEC 7.14)', () => {
  it('Rp 20.000 typed for Rp 250.000 a night: saving waits for "Harga ini memang benar"', async () => {
    const onClose = await openSheet()
    fireEvent.change(screen.getByLabelText(/Harga per malam/), { target: { value: '20000' } })
    expect(screen.getByTestId('price-confirm').textContent).toContain('Harga Rp 20.000 / malam jauh di bawah tarif kamar (Rp 250.000). Kurang angka nol?')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    expect(await screen.findByText('Centang bila harganya memang benar, atau perbaiki harganya.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(await repo.list('invoices')).toHaveLength(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Harga ini memang benar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await newInvoice())?.total_amount).toBe(20_000)
  })

  it('a tick belongs to the price it was given for: another odd price asks again; a normal one asks nothing', async () => {
    await openSheet({ payNow: false })
    const price = screen.getByLabelText(/Harga per malam/)
    fireEvent.change(price, { target: { value: '2000000' } })
    expect(screen.getByTestId('price-confirm').textContent).toContain('lebih dari 5× tarif kamar')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Harga ini memang benar' }))
    fireEvent.change(price, { target: { value: '3000000' } })
    expect(screen.getByRole('checkbox', { name: 'Harga ini memang benar' })).toHaveProperty('checked', false)
    fireEvent.change(price, { target: { value: '200000' } })
    expect(screen.queryByTestId('price-confirm')).toBeNull()
  })

  it('the switch to Mingguan prefills the room rate: nothing to ask', async () => {
    await openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Mingguan' }))
    expect(screen.queryByTestId('price-confirm')).toBeNull()
  })
})

describe('Bayar & perpanjang: review follow-ups', () => {
  it('an older invoice still open is named in the sheet: the money here pays the next period', async () => {
    await repo.insert('invoices', {
      id: 'I2',
      property_id: 'P1',
      lease_id: 'L1',
      invoice_number: 'INV-202610-0039',
      period_type: 'daily',
      period_start: '2026-10-30',
      period_end: '2026-10-30',
      quantity: 1,
      base_amount: 250_000,
      addons_amount: 0,
      extra_amount: 0,
      discount_amount: 0,
      total_amount: 250_000,
      due_date: '2026-10-30',
      status: 'unpaid',
      notes: null,
    } as never)
    await repo.update('leases', 'L1', { end_date: '2026-10-30' })
    await openSheet()
    expect(screen.getByTestId('pay-now-open-invoices').textContent).toContain('Masih ada tagihan belum lunas: INV-202610-0039 (sisa Rp 250.000).')
    cleanup()
    // the plain sheet says nothing new
    await openSheet({ payNow: false })
    expect(screen.queryByTestId('pay-now-open-invoices')).toBeNull()
  })

  it('the invoice written but the lease update failing: the rent is said to be unrecorded and the sheet closes (no second period on a retry)', async () => {
    const real = actions()
    const { InvoiceIssuedError } = await import('./useLeaseActions')
    const recordRentPayment = vi.fn(real.recordRentPayment)
    const failing = {
      ...real,
      recordRentPayment,
      issueInvoice: vi.fn(async () => {
        throw new InvoiceIssuedError('Tagihan INV-202610-0039 sudah dibuat, tetapi data sewa gagal diperbarui: Tidak dapat terhubung ke server.', { id: 'I9' } as Invoice)
      }),
    }
    const onClose = await openSheet({ using: failing })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & perpanjang' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/data sewa gagal diperbarui: Tidak dapat terhubung ke server\. Pembayaran sewanya belum dicatat: catat lewat Catat pembayaran\./)).toBeTruthy()
    expect(recordRentPayment).not.toHaveBeenCalled()
  })

  it('Periode khusus with the type switch made permanent: a price of Rp 0 is not written to the lease', async () => {
    const onClose = await openSheet({ payNow: false, sheetRoom: { ...room, price_monthly: null } })
    fireEvent.click(screen.getByRole('radio', { name: 'Bulanan' }))
    expect(screen.getByLabelText(/Harga per bulan/)).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('checkbox', { name: /Periode khusus/ }))
    fireEvent.change(screen.getByLabelText('Harga periode khusus'), { target: { value: '900000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buat tagihan' }))
    expect(await screen.findByText('Isi harga per bulan.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(await repo.list('invoices')).toHaveLength(1)
    expect((await stored()).price_per_period).toBe(250_000)
  })
})
