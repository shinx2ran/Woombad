// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Lease, MemberRole } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { VEHICLE_PLATE_INACTIVE_MESSAGE } from './leaseUtils'

// SPEC 7.11 Nomor kendaraan through useLeaseActions (LocalRepo = Mode Demo), and the sheet on the lease page.
const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: state.role }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useLeaseActions } from './useLeaseActions'
import { VehiclePlateModal } from './VehiclePlateModal'

let repo: OrgRepo
let lease: Lease

beforeEach(async () => {
  invalidate.mockClear()
  repo = bindOrg(new LocalRepo(emptyLocalDb(), { today: () => '2026-10-30' }), 'org-1')
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
    deposit_amount: 500_000,
    start_date: '2026-10-08',
    end_date: '2026-11-07',
    status: 'active',
    checkout_date: null,
    notes: 'Kamar pojok',
  } as never)
})
afterEach(() => cleanup())

const stored = async () => (await repo.get('leases', 'L1')) as Lease
const actions = () => renderHook(() => useLeaseActions()).result.current

describe('setVehiclePlate (useLeaseActions)', () => {
  it('stores the plates as plates are written; nothing else on the lease changes', async () => {
    const saved = await actions().setVehiclePlate(lease, 'kb.1442.gz / b1251sga')
    expect(saved.vehicle_plate).toBe('KB 1442 GZ, B 1251 SGA')
    expect(await stored()).toMatchObject({
      vehicle_plate: 'KB 1442 GZ, B 1251 SGA',
      price_per_period: 1_500_000,
      deposit_amount: 500_000,
      start_date: '2026-10-08',
      end_date: '2026-11-07',
      status: 'active',
      notes: 'Kamar pojok',
    })
    expect(invalidate).toHaveBeenCalledWith('leases')
  })

  it('an empty field or null clears it', async () => {
    await actions().setVehiclePlate(lease, 'KB 1442 GZ')
    await actions().setVehiclePlate(await stored(), '  ')
    expect((await stored()).vehicle_plate).toBeNull()
    await actions().setVehiclePlate(await stored(), 'KB 1442 GZ')
    await actions().setVehiclePlate(await stored(), null)
    expect((await stored()).vehicle_plate).toBeNull()
  })

  it('staff may fill it in and clear it (front-desk work)', async () => {
    state.role = 'staff'
    await actions().setVehiclePlate(lease, 'KB 1604 GR')
    expect((await stored()).vehicle_plate).toBe('KB 1604 GR')
    await actions().setVehiclePlate(await stored(), null)
    expect((await stored()).vehicle_plate).toBeNull()
  })

  it('a stay checked out on another device meanwhile keeps its plate as history', async () => {
    await repo.update('leases', 'L1', { vehicle_plate: 'KB 1442 GZ' })
    await repo.update('leases', 'L1', { status: 'ended', checkout_date: '2026-10-30' })
    await expect(actions().setVehiclePlate(lease, 'B 1 A')).rejects.toThrow(VEHICLE_PLATE_INACTIVE_MESSAGE)
    expect((await stored()).vehicle_plate).toBe('KB 1442 GZ')
    expect(invalidate).toHaveBeenCalledWith('leases')
  })

  it('a refused write still refreshes the screen with what is stored', async () => {
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'))
    await expect(actions().setVehiclePlate(lease, 'KB 1442 GZ')).rejects.toThrow('Tidak dapat terhubung')
    expect(invalidate).toHaveBeenCalledWith('leases')
  })
})

describe('VehiclePlateModal', () => {
  const wrap = (node: React.ReactNode) => render(<ToastProvider>{node}</ToastProvider>)

  it('saves what was typed as plates are written; Simpan waits for a real change', async () => {
    const setVehiclePlate = vi.fn(async (l: Lease, p: string | null) => ({ ...l, vehicle_plate: p }))
    const onClose = vi.fn()
    wrap(<VehiclePlateModal lease={lease} tenantName="Budi" roomName="A1" actions={{ setVehiclePlate }} onClose={onClose} />)
    const input = screen.getByLabelText('No. kendaraan (plat)')
    const save = screen.getByRole('button', { name: 'Simpan' })
    // nothing typed: nothing to save
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: 'kb1442gz' } })
    expect(save).toHaveProperty('disabled', false)
    // saved without leaving the field first: still written as a plate
    fireEvent.click(save)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setVehiclePlate).toHaveBeenCalledWith(lease, 'KB 1442 GZ')
    expect(screen.getByText('No. kendaraan Budi: KB 1442 GZ.')).toBeTruthy()
  })

  it('a stored plate: the same plate typed another way is no change; emptying the field clears it', async () => {
    const withPlate = { ...lease, vehicle_plate: 'KB 1442 GZ' }
    const setVehiclePlate = vi.fn(async (l: Lease, p: string | null) => ({ ...l, vehicle_plate: p }))
    const onClose = vi.fn()
    wrap(<VehiclePlateModal lease={withPlate} tenantName="Budi" roomName="A1" actions={{ setVehiclePlate }} onClose={onClose} />)
    const input = screen.getByLabelText('No. kendaraan (plat)')
    expect(input).toHaveProperty('value', 'KB 1442 GZ')
    fireEvent.change(input, { target: { value: 'kb.1442.gz' } })
    expect(screen.getByRole('button', { name: 'Simpan' })).toHaveProperty('disabled', true)
    // leaving the field writes it the way it is stored
    fireEvent.blur(input)
    expect(input).toHaveProperty('value', 'KB 1442 GZ')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setVehiclePlate).toHaveBeenCalledWith(withPlate, null)
    expect(screen.getByText('No. kendaraan Budi dikosongkan.')).toBeTruthy()
  })

  it('a refusal is shown and the sheet stays open', async () => {
    const setVehiclePlate = vi.fn(async () => {
      throw new Error('No. kendaraan belum bisa disimpan: database server belum diperbarui.')
    })
    const onClose = vi.fn()
    wrap(<VehiclePlateModal lease={lease} tenantName="Budi" roomName="A1" actions={{ setVehiclePlate }} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('No. kendaraan (plat)'), { target: { value: 'KB 1442 GZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(screen.getByText(/belum bisa disimpan/)).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
  })
})
