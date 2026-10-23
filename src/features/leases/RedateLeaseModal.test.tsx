// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Invoice, Lease, Payment } from '../../types/db'
import { RedateLeaseModal } from './RedateLeaseModal'
import type { LeaseActions } from './useLeaseActions'
import type { LeaseRedatePlan } from './redate'

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const lease: Lease = {
  id: 'L1',
  ...ts,
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
const inv = (id: string, number: string, start: string, end: string, status: Invoice['status']): Invoice => ({
  id,
  ...ts,
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
  status,
  notes: null,
})
const invoices = [
  inv('SEP', 'INV-202609-0001', '2026-09-01', '2026-09-30', 'paid'),
  inv('OCT', 'INV-202610-0001', '2026-10-01', '2026-10-31', 'paid'),
  inv('OCT2', 'INV-202610-0002', '2026-10-01', '2026-10-31', 'void'),
  inv('NOV', 'INV-202611-0001', '2026-11-01', '2026-11-30', 'unpaid'),
]
const pay = (id: string): Payment => ({ id: `p-${id}`, ...ts, property_id: 'P1', invoice_id: id, lease_id: 'L1', amount: 1_500_000, paid_at: '2026-09-01', method: 'cash', kind: 'rent', notes: null, created_by: null })
const payments = [pay('SEP'), pay('OCT')]

function setup(opts: { leases?: Lease[]; redate?: LeaseActions['redateLease'] } = {}) {
  const onClose = vi.fn()
  const redateLease = vi.fn(opts.redate ?? (async () => ({ lease: { start_date: '2026-08-18', end_date: '2026-11-17' }, patches: [{}, {}, {}, {}] }) as unknown as LeaseRedatePlan))
  render(
    <ToastProvider>
      <RedateLeaseModal
        onClose={onClose}
        lease={lease}
        invoices={invoices}
        payments={payments}
        leases={[lease, ...(opts.leases ?? [])]}
        tenants={[{ id: 'T2', full_name: 'Siti Rahayu' }]}
        actions={{ redateLease } as unknown as LeaseActions}
      />
    </ToastProvider>,
  )
  return { onClose, redateLease, date: screen.getByLabelText(/Tanggal mulai yang benar/), save: screen.getByRole('button', { name: 'Simpan perubahan' }) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0, 0))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RedateLeaseModal (SPEC 7.6)', () => {
  it('unchanged: no preview and nothing to save', () => {
    const { save } = setup()
    expect(screen.getByTestId('redate-current').textContent).toBe('1 Sep 2026')
    expect(screen.queryByTestId('redate-preview')).toBeNull()
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('a date 14 days earlier previews every invoice, the end, the next bill and today\'s position', () => {
    const { date, save } = setup()
    fireEvent.change(date, { target: { value: '2026-08-18' } })
    const preview = screen.getByTestId('redate-preview')
    const rows = within(preview).getAllByTestId('redate-invoice')
    expect(rows.map((r) => within(r).getByTestId('redate-period').textContent)).toEqual([
      '1 Sep – 1 Okt 202618 Agt – 18 Sep 2026',
      '1 Okt – 1 Nov 202618 Sep – 18 Okt 2026',
      '1 Okt – 1 Nov 202618 Sep – 18 Okt 2026',
      '1 Nov – 1 Des 202618 Okt – 18 Nov 2026',
    ])
    // the void one is greyed
    expect(rows.map((r) => r.dataset.void ?? '')).toEqual(['', '', 'true', ''])
    expect(rows[0].textContent).toContain('1 bulan · 30 → 31 malam · jatuh tempo 1 Sep → 18 Agt')
    expect(rows[0].textContent).toContain('Rp 1.500.000 · dibayar Rp 1.500.000 · tidak berubah')
    const summary = screen.getByTestId('redate-summary')
    expect(summary.textContent).toContain('Check-out1 Des 202618 Nov 2026')
    expect(summary.textContent).toContain('Dibayar s/d1 Nov 202618 Okt 2026')
    expect(screen.getByTestId('redate-next').textContent).toBe('18 Nov – 18 Des 2026')
    expect(screen.getByTestId('redate-state-before').textContent).toBe('Sekarang: sisa Rp 1.500.000 · jatuh tempo 9 hari lagi')
    expect(screen.getByTestId('redate-state-after').textContent).toBe('Setelah diubah: telat 5 hari · sisa Rp 1.500.000')
    expect(screen.queryByTestId('redate-warning')).toBeNull()
    expect(screen.getByTestId('redate-note').textContent).toContain('Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)')
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('a collision names the other tenant and blocks saving', () => {
    const prev: Lease = { ...lease, id: 'PREV', tenant_id: 'T2', start_date: '2026-07-01', end_date: '2026-08-24' }
    const { date, save } = setup({ leases: [prev] })
    fireEvent.change(date, { target: { value: '2026-08-18' } })
    expect(screen.getByRole('alert').textContent).toBe('Bentrok dengan sewa Siti Rahayu di kamar ini (1 Jul – 25 Agt 2026). Pilih tanggal lain.')
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('an emptied date says what is missing', () => {
    const { date, save } = setup()
    fireEvent.change(date, { target: { value: '' } })
    expect(screen.getByText('Isi tanggal mulai yang benar.')).toBeTruthy()
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('saving sends the date and the reason, then closes', async () => {
    const { date, save, redateLease, onClose } = setup()
    fireEvent.change(date, { target: { value: '2026-08-18' } })
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: 'salah ketik' } })
    fireEvent.click(save)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(redateLease).toHaveBeenCalledWith(expect.objectContaining({ lease, invoices, newStart: '2026-08-18', reason: 'salah ketik' }))
    expect(screen.getByText('Tanggal mulai diubah ke 18 Agt 2026; 4 tagihan ikut digeser.')).toBeTruthy()
  })

  it('a refusal is shown and the dialog stays open', async () => {
    const { date, save, onClose } = setup({
      redate: async () => {
        throw new Error('Tagihan atau pembayaran sewa ini baru saja diubah dari perangkat lain. Periksa angka terbaru di layar, lalu coba lagi.')
      },
    })
    fireEvent.change(date, { target: { value: '2026-08-18' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText(/baru saja diubah dari perangkat lain/)).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
  })
})
