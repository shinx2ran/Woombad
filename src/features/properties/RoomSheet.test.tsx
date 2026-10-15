// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../../components/ui'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg } from '../../lib/repo/types'
import type { Lease, Room } from '../../types/db'
import { roomDisplayState } from './roomUtils'

const org = { id: 'org-1', name: 'Kos Melati', created_by: 'me', created_at: '2026-01-01T00:00:00Z' }
const repo = bindOrg(new LocalRepo(emptyLocalDb()), 'org-1')

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org, role: 'owner', repo }),
}))

import { RoomSheet } from './RoomSheet'

const ts = { org_id: 'org-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const room: Room = { id: 'R1', ...ts, property_id: 'P1', name: 'A1', floor: null, price_daily: null, price_weekly: null, price_monthly: 1_500_000, status: 'active', notes: null }
const base: Lease = {
  id: 'L1',
  ...ts,
  property_id: 'P1',
  room_id: 'R1',
  tenant_id: 'T1',
  period_type: 'monthly',
  price_per_period: 1_500_000,
  deposit_amount: 0,
  start_date: '2026-10-15',
  end_date: '2026-11-14',
  status: 'active',
  checkout_date: null,
  notes: null,
}

function renderSheet(lease: Lease, today: string) {
  const state = roomDisplayState(room, [lease], new Map(), [], [], today)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <RoomSheet item={{ room, state, hasLeases: true }} open onClose={() => {}} onEdit={() => {}} isAdmin />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('RoomSheet occupant end (SPEC 7.3)', () => {
  it('an active lease shows its check-out day, end_date + 1', () => {
    renderSheet(base, '2026-11-01')
    expect(screen.getByText('Mulai 15 Okt 2026 · Check-out 15 Nov 2026')).toBeTruthy()
  })

  it('an ended lease still in the room until its checkout_date shows that day as is, not end_date + 1', () => {
    // overstay: end_date 14 Nov kept, checkout recorded for 20 Nov; on 17 Nov the tenant is still in the room
    renderSheet({ ...base, status: 'ended', checkout_date: '2026-11-20' }, '2026-11-17')
    expect(screen.getByText('Mulai 15 Okt 2026 · Checkout 20 Nov 2026')).toBeTruthy()
    cleanup()
    // an older row written with end_date = checkout_date: still the checkout day, not one day later
    renderSheet({ ...base, status: 'ended', end_date: '2026-10-20', checkout_date: '2026-10-20' }, '2026-10-18')
    expect(screen.getByText('Mulai 15 Okt 2026 · Checkout 20 Okt 2026')).toBeTruthy()
  })
})
