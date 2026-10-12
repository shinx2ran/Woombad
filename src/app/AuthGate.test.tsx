// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { AuthSession } from '../lib/auth'

const authState: { session: AuthSession | null; loading: boolean } = { session: null, loading: true }
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }))
vi.mock('../lib/supabase', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/supabase')>()), isSupabaseConfigured: true }))

import { watchedFetch } from '../lib/supabase'
import { AuthGate, GuestOnly, SERVER_PROBLEM_DELAY_MS, SLOW_START_DELAY_MS } from './AuthGate'

const SESSION_KEY = 'sb-abcdefgh-auth-token'
const noAnswer = () => watchedFetch('https://abcdefgh.supabase.co/auth/v1/token', undefined, () => Promise.reject(new TypeError('Failed to fetch'))).catch(() => {})
const paused = () => watchedFetch('https://abcdefgh.supabase.co/auth/v1/token', undefined, async () => new Response('', { status: 540 })).catch(() => {})

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { element: <GuestOnly />, children: [{ path: '/login', element: <p>Formulir masuk</p> }] },
      { element: <AuthGate />, children: [{ path: '/dashboard', element: <p>Beranda</p> }] },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('AuthGate when Supabase does not answer (online)', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    localStorage.clear()
    authState.session = null
    authState.loading = true
    await watchedFetch('https://abcdefgh.supabase.co/rest/v1/', undefined, async () => new Response('[]'))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('a stored session that cannot be refreshed: after a short wait the error screen replaces the spinner', async () => {
    localStorage.setItem(SESSION_KEY, '{"expires_at":1}')
    renderAt('/dashboard')
    await act(noAnswer)
    expect(screen.getByText('Menyiapkan aplikasi…')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(SERVER_PROBLEM_DELAY_MS))
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByText(/proyek Supabase mungkin sedang dijeda/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeTruthy()
  })

  it('keeps the spinner while the server answers', async () => {
    renderAt('/dashboard')
    await act(() => vi.advanceTimersByTimeAsync(SLOW_START_DELAY_MS - 1000))
    expect(screen.getByText('Menyiapkan aplikasi…')).toBeTruthy()
  })

  it('a start-up that neither answers nor fails (very weak signal) offers a way out after a longer wait', async () => {
    renderAt('/dashboard')
    await act(() => vi.advanceTimersByTimeAsync(SLOW_START_DELAY_MS))
    expect(screen.queryByText('Menyiapkan aplikasi…')).toBeNull()
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeTruthy()
  })

  it('signed in on /login: goes to the remembered deep link instead of always the dashboard', async () => {
    authState.loading = false
    authState.session = { user: { id: 'u1', email: 'a@b.c' } }
    const router = createMemoryRouter(
      [
        { element: <GuestOnly />, children: [{ path: '/login', element: <p>Formulir masuk</p> }] },
        { path: '/penyewa', element: <p>Daftar penyewa</p> },
        { path: '/dashboard', element: <p>Beranda</p> },
      ],
      { initialEntries: [{ pathname: '/login', state: { from: '/penyewa?x=1' } }] },
    )
    render(<RouterProvider router={router} />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(router.state.location.pathname + router.state.location.search).toBe('/penyewa?x=1')
  })

  it('an invite link parked on /login by an older version is handed to the join link page', async () => {
    authState.loading = false
    const router = createMemoryRouter(
      [
        { element: <GuestOnly />, children: [{ path: '/login', element: <p>Formulir masuk</p> }] },
        { path: '/gabung', element: <p>Gabung</p> },
      ],
      { initialEntries: [{ pathname: '/login', state: { from: '/gabung?kode=ABCD-EFGH' } }] },
    )
    render(<RouterProvider router={router} />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(router.state.location.pathname + router.state.location.search).toBe('/gabung?kode=ABCD-EFGH')
  })

  it('after the retries, stays on the error screen instead of a login that cannot succeed', async () => {
    localStorage.setItem(SESSION_KEY, '{"expires_at":1}')
    await paused()
    authState.loading = false
    const router = renderAt('/dashboard')
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(screen.getByText('Server Woombad sedang dijeda karena lama tidak dipakai.')).toBeTruthy()
    expect(screen.getByText(/Restore project/)).toBeTruthy()
  })

  it('without a stored session it is a normal sign-in, with the paused hint above the form', async () => {
    await noAnswer()
    authState.loading = false
    const router = renderAt('/dashboard')
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByText('Formulir masuk')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Jika internet lancar, proyek Supabase mungkin sedang dijeda')
  })

  it('the login page has no notice while the server answers', async () => {
    authState.loading = false
    renderAt('/login')
    expect(screen.getByText('Formulir masuk')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
