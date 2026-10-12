// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { ToastProvider } from '../../../components/ui'

vi.mock('../../../hooks/useOrg', () => ({ useOrg: () => ({ repo: {} }) }))
vi.mock('./DemoImportModal', () => ({
  DemoImportModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Tutup impor
    </button>
  ),
}))

import { OnlineBackupSection } from './OnlineBackupSection'

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/pengaturan', element: <OnlineBackupSection /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  return router
}

describe('OnlineBackupSection', () => {
  afterEach(cleanup)

  it('opens the Mode Demo import straight away when the dashboard checklist links here', () => {
    const router = renderAt('/pengaturan?impor=demo')
    fireEvent.click(screen.getByRole('button', { name: 'Tutup impor' }))
    expect(screen.queryByRole('button', { name: 'Tutup impor' })).toBeNull()
    expect(router.state.location.search).toBe('')
  })

  it('keeps it closed otherwise', () => {
    renderAt('/pengaturan')
    expect(screen.queryByRole('button', { name: 'Tutup impor' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Impor dari Mode Demo' }))
    expect(screen.getByRole('button', { name: 'Tutup impor' })).toBeTruthy()
  })
})
