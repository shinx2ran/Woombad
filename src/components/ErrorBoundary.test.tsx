// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppErrorBoundary, DeviceDataGate, ErrorScreen } from './ErrorBoundary'
import { LOCAL_DB_KEY } from './deviceData'
import { RouteErrorPage } from '../app/RouteErrorPage'

function Boom({ message = 'Cannot read properties of undefined' }: { message?: string }): never {
  throw new Error(message)
}

describe('AppErrorBoundary', () => {
  let reload: ReturnType<typeof vi.fn>
  let createObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reload = vi.fn()
    createObjectURL = vi.fn(() => 'blob:x')
    vi.stubGlobal('location', { ...window.location, reload })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders its children when nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>Isi aplikasi</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('Isi aplikasi')).toBeTruthy()
  })

  it('shows the error screen with reload and, in Mode Demo, the data actions', () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Unduh data perangkat ini' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset data di perangkat ini' })).toBeTruthy()
    expect(screen.getByText('Cannot read properties of undefined')).toBeTruthy()
    // nothing to sign out of in Mode Demo
    expect(screen.queryByRole('button', { name: 'Keluar' })).toBeNull()
  })

  it('shows a lost connection as such, without the online-only Supabase hint', () => {
    render(<ErrorScreen error={new TypeError('Failed to fetch')} />)
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.queryByText(/Supabase/)).toBeNull()
  })

  it('downloads the raw device data, even when it is not valid JSON', () => {
    render(<ErrorScreen error={new Error('x')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unduh data perangkat ini' }))
    expect(screen.getByText('Tidak ada data tersimpan di perangkat ini.')).toBeTruthy()
    expect(createObjectURL).not.toHaveBeenCalled()

    localStorage.setItem(LOCAL_DB_KEY, '{"properties": [rusak')
    fireEvent.click(screen.getByRole('button', { name: 'Unduh data perangkat ini' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.size).toBe('{"properties": [rusak'.length)
    expect(screen.getByText('Data diunduh. Simpan file ini baik-baik.')).toBeTruthy()
  })

  it('asks for confirmation before resetting the device data', () => {
    localStorage.setItem(LOCAL_DB_KEY, '{}')
    localStorage.setItem('woombad.selectedProperty', 'p1')
    render(<ErrorScreen error={new Error('x')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset data di perangkat ini' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(localStorage.getItem(LOCAL_DB_KEY)).toBe('{}')

    fireEvent.click(screen.getByRole('button', { name: 'Reset data di perangkat ini' }))
    expect(screen.getByText(/Semua data di perangkat ini dihapus/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, reset' }))
    expect(localStorage.getItem(LOCAL_DB_KEY)).toBeNull()
    expect(localStorage.getItem('woombad.selectedProperty')).toBe('p1')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('explains a stale app chunk after an update instead of showing the technical message', () => {
    render(<ErrorScreen error={new TypeError('Failed to fetch dynamically imported module: /assets/SettingsPage-abc.js')} />)
    expect(screen.getByText('Aplikasi baru saja diperbarui. Tekan Muat ulang.')).toBeTruthy()
    expect(screen.queryByText('Detail teknis')).toBeNull()
  })
})

describe('DeviceDataGate', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const renderGate = () =>
    render(
      <DeviceDataGate>
        <p>Isi aplikasi</p>
      </DeviceDataGate>,
    )

  it('opens the app when nothing is stored yet or the stored data can be read', () => {
    renderGate()
    expect(screen.getByText('Isi aplikasi')).toBeTruthy()
    cleanup()
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify({ organizations: [{ id: 'demo-org', name: 'Kos' }], properties: [] }))
    renderGate()
    expect(screen.getByText('Isi aplikasi')).toBeTruthy()
  })

  it('keeps unreadable data and offers download and reset instead of opening the app (which would replace it)', () => {
    localStorage.setItem(LOCAL_DB_KEY, '{"properties": [rusak')
    renderGate()
    expect(screen.queryByText('Isi aplikasi')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeTruthy()
    expect(screen.getByText(/Data di perangkat ini rusak/)).toBeTruthy()
    expect(screen.getByText('Data di perangkat ini bukan JSON yang valid.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unduh data perangkat ini' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Buka Dashboard' })).toBeNull()
    expect(localStorage.getItem(LOCAL_DB_KEY)).toBe('{"properties": [rusak')

    fireEvent.click(screen.getByRole('button', { name: 'Reset data di perangkat ini' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya, reset' }))
    expect(localStorage.getItem(LOCAL_DB_KEY)).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stops at the error screen when the organisation is missing but other data is not', () => {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify({ organizations: [], properties: [{ id: 'p1', name: 'Kos Mawar' }] }))
    renderGate()
    expect(screen.queryByText('Isi aplikasi')).toBeNull()
    expect(screen.getByText('Data organisasi di perangkat ini hilang.')).toBeTruthy()
  })
})

describe('RouteErrorPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('catches render errors inside routes', async () => {
    const router = createMemoryRouter([{ errorElement: <RouteErrorPage />, children: [{ path: '/', element: <Boom message="rusak di rute" /> }] }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: 'Terjadi kesalahan' })).toBeTruthy()
    expect(screen.getByText('rusak di rute')).toBeTruthy()
  })

  it('shows status and text of a route error response', async () => {
    const router = createMemoryRouter([
      {
        errorElement: <RouteErrorPage />,
        children: [
          {
            path: '/',
            loader: () => {
              throw new Response('', { status: 404, statusText: 'Not Found' })
            },
            element: <p>tidak tampil</p>,
          },
        ],
      },
    ])
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('404 Not Found')).toBeTruthy()
  })
})
