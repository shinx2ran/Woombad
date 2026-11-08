// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/ui'
import type { Organization } from '../../types/db'

// SPEC 7.19 Scan KTP card: the organisation's default reader, saved as soon as it is picked
const state: { org: Organization; update: ReturnType<typeof vi.fn> } = {
  org: { id: 'org-1', name: 'Kos', created_by: 'me', created_at: '2026-01-01T00:00:00Z' },
  update: vi.fn(async () => undefined),
}
vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: state.org, role: 'owner', isLocalMode: false, repo: { raw: { update: state.update } } }),
}))

import { KtpScanCard } from './KtpScanCard'

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  )
}

describe('KtpScanCard', () => {
  afterEach(() => {
    cleanup()
    state.update.mockClear()
    state.org = { id: 'org-1', name: 'Kos', created_by: 'me', created_at: '2026-01-01T00:00:00Z' }
  })

  it('reads Claude as the default when the organisation has no saved choice, and saves "Di HP" on a tap', async () => {
    render(wrap(<KtpScanCard isLocalMode={false} />))
    const claude = screen.getByRole('radio', { name: /Claude/ }) as HTMLInputElement
    const device = screen.getByRole('radio', { name: /Di HP saja/ }) as HTMLInputElement
    expect(claude.checked).toBe(true)
    expect(device.checked).toBe(false)
    fireEvent.click(device)
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('organizations', 'org-1', { ktp_scan_engine: 'tesseract' }))
    await waitFor(() => expect(screen.getByText('Scan KTP sekarang memakai Di HP.')).toBeTruthy())
  })

  it('shows the saved choice and does not save it again', () => {
    state.org = { ...state.org, ktp_scan_engine: 'tesseract' }
    render(wrap(<KtpScanCard isLocalMode={false} />))
    const device = screen.getByRole('radio', { name: /Di HP saja/ }) as HTMLInputElement
    expect(device.checked).toBe(true)
    fireEvent.click(device)
    expect(state.update).not.toHaveBeenCalled()
  })

  it('tells the owner when the server refused', async () => {
    state.update.mockRejectedValueOnce(new Error('Pilihan pembaca Scan KTP belum bisa disimpan: database server belum diperbarui. Minta operator memperbaruinya.'))
    render(wrap(<KtpScanCard isLocalMode={false} />))
    fireEvent.click(screen.getByRole('radio', { name: /Di HP saja/ }))
    await waitFor(() => expect(screen.getByText(/database server belum diperbarui/)).toBeTruthy())
  })
})
