// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../../components/ui'
import type { Lease, Room } from '../../types/db'
import { MoveRoomModal } from './LifecycleModals'
import type { LeaseActions } from './useLeaseActions'

// SPEC 7.14 in Pindah kamar: a NEW price is checked (a typo is questioned, a cleared field is never saved as Rp 0).
const room = (id: string, name: string, monthly: number | null): Room =>
  ({ id, org_id: 'o', property_id: 'P1', name, floor: null, price_daily: null, price_weekly: null, price_monthly: monthly, status: 'active', notes: null }) as Room
const lease: Lease = {
  id: 'L1',
  org_id: 'o',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  property_id: 'P1',
  room_id: 'A',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'active',
  checkout_date: null,
  notes: null,
}
const rooms = [room('A', 'A1', 1_500_000), room('B', 'B1', 1_800_000)]

function open(moveRoom = vi.fn(async () => undefined), canEditLeaseTerms = true) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <MoveRoomModal open onClose={() => {}} lease={lease} rooms={rooms} leases={[lease]} currentRoom={rooms[0]} actions={{ canEditLeaseTerms, moveRoom } as unknown as LeaseActions} />
      </ToastProvider>
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/Kamar tujuan/), { target: { value: 'B' } })
  return moveRoom
}

afterEach(cleanup)

describe('Pindah kamar: the new price (SPEC 7.14)', () => {
  it('the new room rate prefilled: no question, the move saves with it', () => {
    const moveRoom = open()
    expect(screen.queryByTestId('price-confirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(moveRoom).toHaveBeenCalledWith(lease, rooms[0], rooms[1], 1_800_000, expect.any(String))
  })

  it('a cleared price field is refused, not saved as Rp 0', () => {
    const moveRoom = open()
    fireEvent.change(screen.getByLabelText(/Harga baru per bulan/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(screen.getByText('Harga per bulan harus lebih dari 0.')).toBeTruthy()
    expect(moveRoom).not.toHaveBeenCalled()
  })

  it('a zero too few waits for the tick', () => {
    const moveRoom = open()
    fireEvent.change(screen.getByLabelText(/Harga baru per bulan/), { target: { value: '170000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(moveRoom).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Harga ini memang benar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(moveRoom).toHaveBeenCalledWith(lease, rooms[0], rooms[1], 170_000, expect.any(String))
  })

  it('keeping the current price asks nothing (the lease price is not this dialog\'s business)', () => {
    const moveRoom = open()
    fireEvent.change(screen.getByLabelText(/Harga baru per bulan/), { target: { value: '1500000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(moveRoom).toHaveBeenCalledWith(lease, rooms[0], rooms[1], null, expect.any(String))
  })

  it('staff keep the agreed price: no field, no question', () => {
    const moveRoom = open(vi.fn(async () => undefined), false)
    expect(screen.queryByLabelText(/Harga baru per bulan/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan' }))
    expect(moveRoom).toHaveBeenCalledWith(lease, rooms[0], rooms[1], null, expect.any(String))
  })
})
