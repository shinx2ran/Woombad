// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../components/ui'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import { LocalRepo } from '../lib/repo/localRepo'
import { bindOrg } from '../lib/repo/types'
import { LAST_BACKUP_KEY, REMINDER_SNOOZE_KEY } from '../features/settings/data/backupReminder'

const org = { isLocalMode: true, role: 'owner', hasKos: true }
vi.mock('../hooks/useOrg', () => ({
  useOrg: () => ({
    isLocalMode: org.isLocalMode,
    role: org.role,
    properties: org.hasKos ? [{ id: 'p1', name: 'Kos Melati' }] : [],
    org: { id: DEMO_ORG_ID, name: 'Kos Keluarga (Demo)' },
    repo: bindOrg(new LocalRepo(buildDemoDb(new Date(2026, 9, 12))), DEMO_ORG_ID),
  }),
}))

import { BackupReminderBanner } from './BackupReminderBanner'

function renderAt(path = '/dashboard') {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <BackupReminderBanner />
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('BackupReminderBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.assign(org, { isLocalMode: true, role: 'owner', hasKos: true })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reminds when this device never made a backup and disappears after downloading one', () => {
    renderAt()
    expect(screen.getByText('Data di perangkat ini belum pernah dicadangkan.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unduh cadangan sekarang' }))
    expect(localStorage.getItem(LAST_BACKUP_KEY)).not.toBeNull()
    expect(screen.queryByText(/belum pernah dicadangkan/)).toBeNull()
  })

  it('reminds when the last backup is older than 7 days', () => {
    localStorage.setItem(LAST_BACKUP_KEY, new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString())
    renderAt()
    expect(screen.getByText('Cadangan terakhir 9 hari lalu.')).toBeTruthy()
  })

  it('stays hidden after a recent backup and on Pengaturan', () => {
    renderAt('/pengaturan')
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
    renderAt()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('online: reminds the owner/admin and downloads the full online backup', async () => {
    org.isLocalMode = false
    renderAt()
    expect(screen.getByText('Data online belum pernah dicadangkan dari perangkat ini.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unduh cadangan sekarang' }))
    await waitFor(() => expect(localStorage.getItem(LAST_BACKUP_KEY)).not.toBeNull())
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const file = JSON.parse(await blob.text())
    expect(file.version).toBe(1)
    expect(file.tables.properties).toHaveLength(2)
    expect(file.tables.organization_members).toHaveLength(1)
    expect(screen.queryByText(/belum pernah dicadangkan/)).toBeNull()
    expect(await screen.findByText('Cadangan diunduh.')).toBeTruthy()
  })

  it('online: hidden for staff and while the organisation has no kos yet', () => {
    org.isLocalMode = false
    org.role = 'staff'
    renderAt()
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
    org.role = 'admin'
    org.hasKos = false
    renderAt()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be dismissed for a few days', () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup pengingat' }))
    expect(screen.queryByText(/belum pernah dicadangkan/)).toBeNull()
    expect(localStorage.getItem(REMINDER_SNOOZE_KEY)).not.toBeNull()
    cleanup()
    renderAt()
    expect(screen.queryByText(/belum pernah dicadangkan/)).toBeNull()
  })
})
