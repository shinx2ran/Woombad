// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../../components/ui'
import { LocalRepo, emptyLocalDb } from '../../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../../lib/repo/types'
import type { Room } from '../../../types/db'
import { ALREADY_RESTORED_MESSAGE } from './restore'

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
})
