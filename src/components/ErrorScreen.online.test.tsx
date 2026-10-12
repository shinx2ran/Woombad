// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const signOutThisDevice = vi.fn(async () => {})
vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  isSupabaseConfigured: true,
  signOutThisDevice: () => signOutThisDevice(),
}))

import { watchedFetch } from '../lib/supabase'
import { ErrorScreen } from './ErrorBoundary'

describe('ErrorScreen (online)', () => {
  let assign: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    await watchedFetch('https://x.supabase.co/rest/v1/', undefined, async () => new Response('[]'))
    assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), assign })
    signOutThisDevice.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('names a lost connection as the problem and hints at a paused Supabase project', () => {
    render(<ErrorScreen error={new Error('TypeError: Failed to fetch')} />)
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByText(/proyek Supabase mungkin sedang dijeda/)).toBeTruthy()
    expect(screen.queryByText('Aplikasi mengalami masalah. Coba muat ulang.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unduh data perangkat ini' })).toBeNull()
  })

  it('treats any error as a connection problem while the phone is offline', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    render(<ErrorScreen error={new Error('Gagal memuat')} />)
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByText('Gagal memuat')).toBeTruthy()
  })

  it('says so when Supabase answered that the project is paused', async () => {
    await watchedFetch('https://x.supabase.co/rest/v1/organization_members', undefined, async () => new Response('', { status: 540 })).catch(() => {})
    render(<ErrorScreen error={new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')} />)
    expect(screen.getByText('Server Woombad sedang dijeda karena lama tidak dipakai.')).toBeTruthy()
    expect(screen.getByText(/Restore project/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeTruthy()
  })

  it('keeps the generic text for other errors, without the Supabase hint', () => {
    render(<ErrorScreen error={new Error('Organisasi tidak ditemukan.')} />)
    expect(screen.getByText('Aplikasi mengalami masalah. Coba muat ulang.')).toBeTruthy()
    expect(screen.queryByText(/dijeda/)).toBeNull()
  })

  it('signs out on this device and opens the login page (the only way out of this screen)', async () => {
    render(<ErrorScreen error={new Error('Failed to fetch')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}login`))
    expect(signOutThisDevice).toHaveBeenCalledTimes(1)
  })
})
