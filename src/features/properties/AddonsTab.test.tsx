// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/ui'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { DELETE_DENIED_MESSAGE, bindOrg, type OrgRepo } from '../../lib/repo/types'
import type { Property } from '../../types/db'

const org = { id: 'org-1', name: 'Kos Melati', created_by: 'me', created_at: '2026-01-01T00:00:00Z' }
const state: { repo: OrgRepo | null } = { repo: null }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org, role: 'owner', repo: state.repo }),
}))

import { AddonsTab } from './AddonsTab'

const property = { id: 'P1', org_id: 'org-1', name: 'Kos Melati' } as Property

afterEach(cleanup)

describe('AddonsTab delete', () => {
  it('an add-on already deleted on another device: the error is shown and the list refreshes, so it does not fail again', async () => {
    const repo = bindOrg(new LocalRepo(emptyLocalDb()), 'org-1')
    state.repo = repo
    const kasur = await repo.insert('addon_catalog', { property_id: 'P1', name: 'Kasur tambahan', default_price: 50_000, billing: 'per_period' })
    await repo.insert('addon_catalog', { property_id: null, name: 'Parkir motor', default_price: 30_000, billing: 'per_period' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AddonsTab property={property} isAdmin />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('Kasur tambahan')

    await repo.remove('addon_catalog', kasur.id) // the other device
    fireEvent.click(screen.getByRole('button', { name: 'Hapus Kasur tambahan' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hapus' }))

    expect(await screen.findByText(DELETE_DENIED_MESSAGE)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Kasur tambahan')).toBeNull())
    expect(screen.getByText('Parkir motor')).toBeTruthy()
  })
})
