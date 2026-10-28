// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../../components/ui'
import { LocalRepo, emptyLocalDb } from '../../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../../lib/repo/types'
import type { Room } from '../../../types/db'
import { ALREADY_RESTORED_MESSAGE, INVOICE_VOID_MESSAGE, PROPERTY_PARTIAL_NOTE } from './restore'

const state: { repo: OrgRepo | null } = { repo: null }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)
vi.mock('../../../hooks/useOrg', () => ({ useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, repo: state.repo, role: 'owner' }) }))
vi.mock('../../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useRestoreDeleted } from './useRestoreDeleted'

let repo: OrgRepo
let room: Room

beforeEach(async () => {
  repo = bindOrg(new LocalRepo(emptyLocalDb()), 'org-1')
  state.repo = repo
  invalidate.mockClear()
  await repo.insert('properties', { id: 'P1', name: 'Kos Melati', address: null, notes: null, payment_info: null, logo_path: null })
  room = await repo.insert('rooms', { id: 'R1', property_id: 'P1', name: 'A3', floor: '1', price_daily: 100_000, price_weekly: null, price_monthly: 1_500_000, status: 'active', notes: null })
})
afterEach(cleanup)

function Probe({ onError }: { onError: (m: string) => void }) {
  const { restore, offerUndo } = useRestoreDeleted()
  return (
    <div>
      <button onClick={() => void repo.remove('rooms', room.id).then(() => offerUndo('rooms', room, `Kamar ${room.name}`))}>Hapus</button>
      <button onClick={() => restore('rooms', room).catch((e: Error) => onError(e.message))}>Pulihkan</button>
    </div>
  )
}

/** the hook alone, for restores called directly */
const hook = () => renderHook(() => useRestoreDeleted(), { wrapper: ToastProvider }).result.current

const setup = (onError = vi.fn()) => {
  render(
    <ToastProvider>
      <Probe onError={onError} />
    </ToastProvider>,
  )
  return onError
}

describe('useRestoreDeleted', () => {
  it('Urungkan on the delete toast puts the room back with its old id and values', async () => {
    setup()
    fireEvent.click(screen.getByText('Hapus'))
    await waitFor(async () => expect(await repo.get('rooms', 'R1')).toBeNull())
    const undo = await screen.findByRole('button', { name: 'Urungkan' })
    expect(screen.getByRole('status').textContent).toContain('Kamar A3 dihapus.')
    await act(async () => {
      fireEvent.click(undo)
    })
    await waitFor(async () => expect(await repo.get('rooms', 'R1')).toMatchObject({ id: 'R1', name: 'A3', price_monthly: 1_500_000, property_id: 'P1' }))
    expect(await screen.findByText('Kamar A3 dipulihkan.')).toBeTruthy()
    expect(invalidate).toHaveBeenCalledWith('rooms')
  })

  it('restoring a row that is already back says so instead of making a duplicate', async () => {
    const onError = setup()
    fireEvent.click(screen.getByText('Pulihkan'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(ALREADY_RESTORED_MESSAGE))
    expect(await repo.list('rooms')).toHaveLength(1)
  })

  it('a rent payment is not put back onto an invoice voided meanwhile', async () => {
    const api = hook()
    const tenant = await repo.insert('tenants', { property_id: 'P1', full_name: 'Budi', phone: null } as never)
    const lease = await repo.insert('leases', { property_id: 'P1', room_id: 'R1', tenant_id: tenant.id, period_type: 'monthly', price_per_period: 1_500_000, deposit_amount: 0, start_date: '2026-10-01', end_date: '2026-10-31', status: 'active', checkout_date: null, notes: null })
    const invoice = await repo.insert('invoices', { property_id: 'P1', lease_id: lease.id, invoice_number: 'INV-202610-0001', period_type: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31', quantity: 1, base_amount: 1_500_000, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: 1_500_000, due_date: '2026-10-01', status: 'void', notes: null } as never)
    const deleted = { id: 'PAY1', property_id: 'P1', invoice_id: invoice.id, lease_id: lease.id, amount: 1_500_000, paid_at: '2026-10-01', method: 'cash', kind: 'rent', notes: null }
    await expect(api.restore('payments', deleted)).rejects.toThrow(INVOICE_VOID_MESSAGE)
    expect(await repo.list('payments')).toHaveLength(0)
    // a deposit does not depend on an invoice
    await api.restore('payments', { ...deleted, id: 'PAY2', invoice_id: null, kind: 'deposit' })
    expect(await repo.list('payments')).toHaveLength(1)
  })

  it('an expense of a split keeps its receipt while another row still shows it; a lone one loses it', async () => {
    const api = hook()
    const base = { property_id: 'P1', lease_id: null, category: 'other', amount: 50_000, expense_date: '2026-10-05', description: 'Lampu', vendor: null, receipt_path: 'org-1/struk.jpg' }
    await repo.insert('expenses', { ...base, id: 'E1' } as never)
    const shared = await api.restore('expenses', { ...base, id: 'E2' })
    expect(shared.fileDropped).toBe(false)
    expect((await repo.get('expenses', 'E2'))!.receipt_path).toBe('org-1/struk.jpg')
    const lone = await api.restore('expenses', { ...base, id: 'E3', receipt_path: 'org-1/lain.jpg' })
    expect(lone.fileDropped).toBe(true)
    expect((await repo.get('expenses', 'E3'))!.receipt_path).toBeNull()
  })

  it('a restored kos says what did not come back with it', async () => {
    const api = hook()
    await repo.remove('rooms', 'R1')
    await repo.remove('properties', 'P1')
    const result = await api.restore('properties', { id: 'P1', name: 'Kos Melati', address: null, notes: null, payment_info: null, logo_path: null })
    expect(result.note).toBe(PROPERTY_PARTIAL_NOTE)
    expect(await repo.get('properties', 'P1')).toMatchObject({ name: 'Kos Melati' })
  })
})
