// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../components/ui'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import { LocalRepo } from '../lib/repo/localRepo'
import { bindOrg } from '../lib/repo/types'
import { LAST_BACKUP_KEY, REMINDER_SNOOZE_KEY } from '../features/settings/data/backupReminder'

const org = { isLocalMode: true }
vi.mock('../hooks/useOrg', () => ({
  useOrg: () => ({
    isLocalMode: org.isLocalMode,
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
    org.isLocalMode = true
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

  it('stays hidden after a recent backup, on Pengaturan and in online mode', () => {
    renderAt('/pengaturan')
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
    org.isLocalMode = false
    renderAt()
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
    org.isLocalMode = true
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
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
