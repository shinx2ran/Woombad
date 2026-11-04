// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Lease, Payment } from '../../types/db'
import { CheckoutModal } from './LifecycleModals'
import type { LeaseActions } from './useLeaseActions'

// SPEC 7.15: at checkout the settlement only returns the deposit recorded as received; an agreed deposit that was never
// recorded (5 live leases, Rp 3.500.000, Nov 2026) is pointed out before the owner settles with Rp 0.
const lease: Lease = {
  id: 'L1',
  org_id: 'o',
  created_at: '2026-10-13T00:00:00Z',
  updated_at: '2026-10-13T00:00:00Z',
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_700_000,
  deposit_amount: 1_000_000,
  start_date: '2026-10-04',
  end_date: '2026-11-03',
  status: 'active',
  checkout_date: null,
  notes: null,
}

const deposit = (amount: number): Payment =>
  ({ id: `D${amount}`, org_id: 'o', property_id: 'P1', invoice_id: null, lease_id: 'L1', amount, paid_at: '2026-10-04', method: 'cash', kind: 'deposit', notes: null, created_at: '2026-10-04T00:00:00Z' }) as Payment

function renderCheckout(payments: Payment[], onRecordDeposit?: () => void) {
  render(
    <ToastProvider>
      <CheckoutModal open onClose={() => {}} lease={lease} invoices={[]} payments={payments} expenses={[]} actions={{ canEditInvoices: true } as LeaseActions} onRecordDeposit={onRecordDeposit} />
    </ToastProvider>,
  )
}

afterEach(cleanup)

describe('Checkout: an agreed deposit never recorded as received (SPEC 7.15)', () => {
  it('nothing recorded: the red line names both amounts and opens "Catat deposit diterima"', () => {
    const onRecordDeposit = vi.fn()
    renderCheckout([], onRecordDeposit)
    const box = screen.getByTestId('checkout-deposit-shortfall')
    expect(box.textContent).toContain('Deposit disepakati Rp 1.000.000, tercatat diterima Rp 0.')
    expect(box.textContent).toContain('Pengembalian di bawah hanya menghitung deposit yang tercatat diterima.')
    fireEvent.click(screen.getByRole('button', { name: 'Catat deposit diterima' }))
    expect(onRecordDeposit).toHaveBeenCalledTimes(1)
  })

  it('part recorded: the line shows what was recorded', () => {
    renderCheckout([deposit(400_000)], vi.fn())
    expect(screen.getByTestId('checkout-deposit-shortfall').textContent).toContain('Deposit disepakati Rp 1.000.000, tercatat diterima Rp 400.000.')
  })

  it('all recorded: no line', () => {
    renderCheckout([deposit(1_000_000)], vi.fn())
    expect(screen.queryByTestId('checkout-deposit-shortfall')).toBeNull()
  })

  it('no deposit agreed: no line', () => {
    render(
      <ToastProvider>
        <CheckoutModal open onClose={() => {}} lease={{ ...lease, deposit_amount: 0 }} invoices={[]} payments={[]} expenses={[]} actions={{ canEditInvoices: true } as LeaseActions} />
      </ToastProvider>,
    )
    expect(screen.queryByTestId('checkout-deposit-shortfall')).toBeNull()
  })

  it('without the shortcut the line says where to record it; checkout itself is never blocked by it', () => {
    renderCheckout([])
    expect(screen.getByTestId('checkout-deposit-shortfall').textContent).toContain('catat dulu lewat Lainnya → Catat deposit diterima.')
    expect(screen.queryByRole('button', { name: 'Catat deposit diterima' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Selesaikan checkout' })).toHaveProperty('disabled', false)
  })
})
