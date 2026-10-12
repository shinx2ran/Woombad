// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from '../components/ui'
import { createAppUpdater, UPDATE_CHECK_INTERVAL_MS, watchForUpdates } from './appUpdate'
import { clearDirty, forgetOtherPages, isDirty, markDirty, useDirtyWhile, watchPageInput } from './dirtyState'
import { UpdateBanner } from './UpdateBanner'

describe('dirtyState', () => {
  afterEach(cleanup)

  it('is dirty while any key is registered; a key counts once', () => {
    expect(isDirty()).toBe(false)
    markDirty('invite')
    markDirty('invite')
    markDirty('payment')
    clearDirty('invite')
    expect(isDirty()).toBe(true)
    clearDirty('payment')
    expect(isDirty()).toBe(false)
  })

  it('useDirtyWhile follows its flag and clears on unmount', () => {
    function Form({ active }: { active: boolean }) {
      useDirtyWhile(active)
      return null
    }
    const { rerender, unmount } = render(<Form active={false} />)
    expect(isDirty()).toBe(false)
    rerender(<Form active />)
    expect(isDirty()).toBe(true)
    rerender(<Form active={false} />)
    expect(isDirty()).toBe(false)
    rerender(<Form active />)
    unmount()
    expect(isDirty()).toBe(false)
  })

  it('an open dialog counts as unsaved work', () => {
    function Page() {
      const [open, setOpen] = useState(true)
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Kode undangan">
          ABCD-2345
        </Modal>
      )
    }
    render(<Page />)
    expect(isDirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(isDirty()).toBe(false)
  })
})

describe('watchPageInput', () => {
  let stop: () => void
  /** leave the page and come back: what was entered there is forgotten */
  const leaveAndReturn = () => {
    window.history.pushState(null, '', '/dashboard')
    forgetOtherPages()
    window.history.pushState(null, '', '/sewa/baru')
  }
  beforeEach(() => {
    window.history.replaceState(null, '', '/sewa/baru')
    stop = watchPageInput()
  })
  afterEach(() => {
    stop()
    leaveAndReturn()
    cleanup()
  })

  it('marks the page dirty once something is typed or picked on it, until the user leaves the page', () => {
    render(
      <div>
        <input aria-label="Nama" />
        <select aria-label="Kos">
          <option>Melati</option>
          <option>Mawar</option>
        </select>
      </div>,
    )
    expect(isDirty()).toBe(false)
    fireEvent.input(screen.getByLabelText('Nama'), { target: { value: 'Budi' } })
    expect(isDirty()).toBe(true)
    window.history.pushState(null, '', '/dashboard')
    expect(isDirty()).toBe(false)
    window.history.pushState(null, '', '/sewa/baru')
    expect(isDirty()).toBe(false)

    fireEvent.change(screen.getByLabelText('Kos'), { target: { value: 'Mawar' } })
    // the shell's page-change hook keeps input of the page it arrived at
    forgetOtherPages()
    expect(isDirty()).toBe(true)
    leaveAndReturn()
    expect(isDirty()).toBe(false)
  })

  it('counts opening the camera and choice cards, not search boxes, the kos filter or plain buttons', () => {
    render(
      <div>
        <input type="search" aria-label="Cari" />
        <label data-dirty-ignore>
          <select aria-label="Pilih kos">
            <option value="all">Semua kos</option>
            <option value="k1">Kos Melati</option>
          </select>
        </label>
        <div role="radiogroup" data-dirty-ignore>
          <button type="button" role="radio" aria-checked="false">
            Kamar
          </button>
        </div>
        <button type="button">Isi sendiri</button>
        <input type="file" aria-label="Kamera" />
        <button type="button" aria-pressed="false">
          <span>A1</span>
        </button>
      </div>,
    )
    fireEvent.input(screen.getByLabelText('Cari'), { target: { value: 'Budi' } })
    fireEvent.change(screen.getByLabelText('Pilih kos'), { target: { value: 'k1' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Kamar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Isi sendiri' }))
    expect(isDirty()).toBe(false)

    fireEvent.click(screen.getByLabelText('Kamera'))
    expect(isDirty()).toBe(true)
    leaveAndReturn()
    expect(isDirty()).toBe(false)
    fireEvent.click(screen.getByText('A1'))
    expect(isDirty()).toBe(true)
  })

  it('holds back a new version while the page has input, and applies it on the next page', () => {
    const reload = vi.fn()
    const activate = vi.fn(async () => {})
    const u = createAppUpdater({ isDirty, reload })
    render(<textarea aria-label="Catatan" />)
    fireEvent.input(screen.getByLabelText('Catatan'), { target: { value: 'Bayar minggu depan' } })
    u.needRefresh(activate)
    expect(activate).not.toHaveBeenCalled()
    expect(u.isPending()).toBe(true)
    window.history.pushState(null, '', '/sewa/123')
    u.applyIfIdle()
    expect(activate).toHaveBeenCalledTimes(1)
  })
})

describe('createAppUpdater', () => {
  let dirty: boolean
  let reload: ReturnType<typeof vi.fn<() => void>>
  let activate: ReturnType<typeof vi.fn<() => Promise<void>>>

  beforeEach(() => {
    vi.useFakeTimers()
    dirty = false
    reload = vi.fn<() => void>()
    activate = vi.fn(async () => {})
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const make = () => createAppUpdater({ isDirty: () => dirty, reload })

  it('applies a new version at once when nothing on screen would be lost', () => {
    const u = make()
    u.needRefresh(activate)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(u.isPending()).toBe(false)
    u.needReload()
    expect(reload).toHaveBeenCalledTimes(1)
    // no fallback reload on the automatic path (it could loop)
    vi.advanceTimersByTime(60_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits for a tap while something on screen would be lost, then applies and reloads', () => {
    const u = make()
    const listener = vi.fn()
    u.subscribe(listener)
    dirty = true
    u.needRefresh(activate)
    expect(activate).not.toHaveBeenCalled()
    expect(u.isPending()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    u.applyNow()
    expect(activate).toHaveBeenCalledTimes(1)
    u.needReload()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('after a tap, reloads anyway when the new version does not take over', () => {
    const u = make()
    dirty = true
    u.needRefresh(activate)
    u.applyNow()
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('applies a waiting version on the next page change once nothing would be lost', () => {
    const u = make()
    u.applyIfIdle()
    expect(activate).not.toHaveBeenCalled()
    dirty = true
    u.needRefresh(activate)
    u.applyIfIdle()
    expect(activate).not.toHaveBeenCalled()
    dirty = false
    u.applyIfIdle()
    expect(activate).toHaveBeenCalledTimes(1)
    u.needReload()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload a busy page when another tab applied the update', () => {
    const u = make()
    dirty = true
    u.needReload()
    expect(reload).not.toHaveBeenCalled()
    expect(u.isPending()).toBe(true)
    u.applyNow()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('UpdateBanner shows "Versi baru siap" only while an update waits, and applies it on tap', () => {
    const u = make()
    render(<UpdateBanner updater={u} />)
    expect(screen.queryByText('Versi baru siap')).toBeNull()
    dirty = true
    act(() => u.needRefresh(activate))
    expect(screen.getByText('Versi baru siap')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(activate).toHaveBeenCalledTimes(1)
  })
})

describe('watchForUpdates', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const registration = () => ({ installing: null, update: vi.fn(async () => {}) }) as unknown as ServiceWorkerRegistration

  it('checks every hour, and when the app returns after an hour in the background', () => {
    const r = registration()
    const stop = watchForUpdates(r)
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(r.update).toHaveBeenCalledTimes(1)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(r.update).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + UPDATE_CHECK_INTERVAL_MS)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(r.update).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(3 * UPDATE_CHECK_INTERVAL_MS)
    expect(r.update).toHaveBeenCalledTimes(2)
  })

  it('skips the check while offline', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    const r = registration()
    const stop = watchForUpdates(r)
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(r.update).not.toHaveBeenCalled()
    stop()
  })
})
