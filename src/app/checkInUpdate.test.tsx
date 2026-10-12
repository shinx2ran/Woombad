// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createAppUpdater } from './appUpdate'
import { isDirty, watchPageInput } from './dirtyState'

// Check-in (/sewa/baru) is a page, not a dialog: what the owner entered there must hold back an automatic update too.
describe('a new version while Check-in has input (Mode Demo)', () => {
  let stop: () => void

  beforeAll(() => {
    localStorage.setItem('woombad.local.session.v1', JSON.stringify({ user: { id: 'local-user', email: 'demo@woombad.local' } }))
    window.history.replaceState(null, '', '/sewa/baru')
    stop = watchPageInput()
  })
  afterAll(() => {
    stop()
    cleanup()
    localStorage.clear()
  })

  it('waits while the form has input and applies on the next page', async () => {
    const { default: App } = await import('../App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Isi sendiri' }, { timeout: 5000 }))

    const reload = vi.fn()
    const activate = vi.fn(async () => {})
    const updater = createAppUpdater({ isDirty, reload })
    expect(isDirty()).toBe(false)

    fireEvent.input(await screen.findByLabelText(/Nama lengkap/), { target: { value: 'Budi Santoso' } })
    updater.needRefresh(activate)
    expect(activate).not.toHaveBeenCalled()
    expect(updater.isPending()).toBe(true)

    await act(async () => fireEvent.click(screen.getAllByRole('link', { name: /Dashboard|Beranda/ })[0]))
    expect(window.location.pathname).toBe('/dashboard')
    updater.applyIfIdle()
    expect(activate).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('the dashboard\'s Check-in (?scan=1) opens the camera at once: that already holds back an update', async () => {
    const { router } = await import('./routes')
    expect(isDirty()).toBe(false)
    // the scanner opens the camera in an effect of the same render that the shell notices the page change in
    await act(() => router.navigate('/sewa/baru?scan=1'))
    expect(screen.getByTestId('scanner-camera-input')).toBeTruthy()
    expect(isDirty()).toBe(true)
  })
})
