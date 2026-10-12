// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { ToastProvider } from '../components/ui'
import { setRepoForTests, type Repo } from '../lib/repo'
import type { MemberRole } from '../types/db'
import { readPendingCode, savePendingCode } from '../features/auth/pendingCode'

vi.mock('./useAuth', () => ({
  useAuth: () => ({ auth: { signOut: vi.fn() }, session: { user: { id: 'u1', email: 'istri@contoh.id' } }, loading: false }),
}))

import { OrgProvider, useOrg } from './useOrg'

const org = { id: 'org-1', name: 'Kos Melati', created_by: 'owner', created_at: '2026-01-01T00:00:00Z' }

function fakeRepo(state: { role: MemberRole; failMembership?: Error }) {
  return {
    mode: 'supabase' as const,
    ensureMembership: vi.fn(async () => {
      if (state.failMembership) throw state.failMembership
      return org.id
    }),
    get: vi.fn(async (table: string) => (table === 'organizations' ? org : null)),
    list: vi.fn(async (table: string) =>
      table === 'organization_members' ? [{ id: 'm1', org_id: org.id, user_id: 'u1', email: null, role: state.role }] : [],
    ),
    update: vi.fn(async () => {
      throw new Error('Data tidak ditemukan atau Anda tidak memiliki izin untuk mengubahnya.')
    }),
    insert: vi.fn(async () => {
      throw new Error('Nomor tagihan sudah dipakai. Coba lagi.')
    }),
  }
}

function Probe() {
  const { role, repo } = useOrg()
  const [error, setError] = useState('')
  const attempt = (write: () => Promise<unknown>) => write().catch((err: Error) => setError(err.message))
  return (
    <div>
      <p>Peran: {role}</p>
      <button onClick={() => attempt(() => repo.update('invoices', 'inv-1', { status: 'void' }))}>Batalkan tagihan</button>
      <button onClick={() => attempt(() => repo.insert('expenses', {} as never))}>Tambah</button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

function setup(repo: ReturnType<typeof fakeRepo>) {
  setRepoForTests(repo as unknown as Repo)
  // OrgProvider retries a failed membership load once; no need to wait for it
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OrgProvider fallback={<p>Memuat…</p>}>
          <Probe />
        </OrgProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return client
}

describe('OrgProvider', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
    setRepoForTests(null)
  })

  it('re-reads the role when the app is opened again after a minute', async () => {
    const state = { role: 'admin' as MemberRole }
    const repo = fakeRepo(state)
    setup(repo)
    expect(await screen.findByText('Peran: admin')).toBeTruthy()

    // the owner demotes this account on his phone
    state.role = 'staff'
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    // still fresh: no extra request yet
    expect(repo.ensureMembership).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 61_000)
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    expect(await screen.findByText('Peran: staff')).toBeTruthy()
    focusManager.setFocused(undefined)
  })

  it('re-reads the role right after the database refuses a write', async () => {
    const state = { role: 'admin' as MemberRole }
    const repo = fakeRepo(state)
    setup(repo)
    await screen.findByText('Peran: admin')

    // an unrelated failure does not
    fireEvent.click(screen.getByRole('button', { name: 'Tambah' }))
    await screen.findByRole('alert')
    expect(repo.ensureMembership).toHaveBeenCalledTimes(1)

    state.role = 'staff'
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan tagihan' }))
    expect(await screen.findByText('Peran: staff')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/tidak memiliki izin/)
    expect(repo.update).toHaveBeenCalledWith('invoices', 'inv-1', { status: 'void' }, 'org-1')
  })

  it('keeps the app open when a background refresh cannot reach the server', async () => {
    const state: { role: MemberRole; failMembership?: Error } = { role: 'admin' }
    const repo = fakeRepo(state)
    const client = setup(repo)
    await screen.findByText('Peran: admin')

    state.failMembership = new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
    await act(async () => {
      await client.refetchQueries({ queryKey: ['membership'] })
      // React Query passes the result on in a later task
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(client.getQueryState(['membership', 'u1'])?.status).toBe('error')
    expect(screen.getByText('Peran: admin')).toBeTruthy()
    expect(screen.queryByText('Terjadi kesalahan')).toBeNull()
  })

  it('drops an invitation code opened by someone who is already a member, and says so', async () => {
    savePendingCode('ABCD-EFGH')
    setup(fakeRepo({ role: 'owner' }))
    await screen.findByText('Peran: owner')
    await waitFor(() => expect(screen.getByText(/sudah menjadi anggota; kode undangan tidak dipakai/)).toBeTruthy())
    expect(readPendingCode()).toBe('')
  })

  it('says nothing when no invitation code is waiting', async () => {
    setup(fakeRepo({ role: 'owner' }))
    await screen.findByText('Peran: owner')
    expect(screen.queryByText(/sudah menjadi anggota/)).toBeNull()
  })
})
