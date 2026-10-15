// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Lease } from '../../types/db'
import { CancelLeaseModal } from './LifecycleModals'
import type { LeaseActions } from './useLeaseActions'

const booking: Lease = {
  id: 'L1',
  org_id: 'o',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_000_000,
  deposit_amount: 0,
  start_date: '2026-10-20',
  end_date: '2026-11-19',
  status: 'active',
  checkout_date: null,
  notes: null,
}

afterEach(cleanup)

describe('CancelLeaseModal preview (SPEC 7.3)', () => {
  it('says no night was stayed exactly when the saved row will show none (cancel up to the day after the start)', () => {
    render(
      <ToastProvider>
        <CancelLeaseModal open onClose={() => {}} lease={booking} invoices={[]} payments={[]} expenses={[]} actions={{} as LeaseActions} />
      </ToastProvider>,
    )
    const date = screen.getByLabelText(/Tanggal pembatalan/)
    const preview = () => screen.getByText('Sewa berakhir menjadi').nextElementSibling?.textContent
    for (const day of ['2026-10-10', '2026-10-20', '2026-10-21']) {
      fireEvent.change(date, { target: { value: day } })
      expect(preview()).toBe('Belum ada malam menginap')
    }
    // a night is left on the row: the typed day is its check-out day, as the list shows it after saving
    fireEvent.change(date, { target: { value: '2026-10-22' } })
    expect(preview()).toBe('22 Okt 2026')
  })
})
