// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { fitToVisibleArea, isTextEntry, revealDelta, revealFocusedField, visibleArea, REVEAL_MARGIN } from './keyboardSafe'
import { Modal } from './Modal'

/** A stand-in for window.visualViewport that tests can resize like an opening keyboard. */
class FakeViewport extends EventTarget {
  height = 800
  offsetTop = 0
  scale = 1
  resize(height: number, offsetTop = 0) {
    this.height = height
    this.offsetTop = offsetTop
    this.dispatchEvent(new Event('resize'))
  }
}

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

describe('visibleArea', () => {
  it('is the visible part of the page, rounded', () => {
    expect(visibleArea({ height: 431.6, offsetTop: 0, scale: 1 })).toEqual({ top: 0, height: 432 })
    expect(visibleArea({ height: 400, offsetTop: 312.4, scale: 1 })).toEqual({ top: 312, height: 400 })
  })
  it('leaves the dialog alone without support, while pinch-zoomed or for a nonsense size', () => {
    expect(visibleArea(null)).toBeNull()
    expect(visibleArea(undefined)).toBeNull()
    expect(visibleArea({ height: 300, offsetTop: 40, scale: 1.6 })).toBeNull()
    expect(visibleArea({ height: 0, offsetTop: 0, scale: 1 })).toBeNull()
    expect(visibleArea({ height: Number.NaN, offsetTop: 0, scale: 1 })).toBeNull()
  })
  it('never places the dialog above the page', () => {
    expect(visibleArea({ height: 500, offsetTop: -3, scale: 1 })).toEqual({ top: 0, height: 500 })
  })
})

describe('revealDelta', () => {
  const box = { top: 100, bottom: 400 }
  it('does nothing for a field already in view with room to spare', () => {
    expect(revealDelta(box, { top: 200, bottom: 240 })).toBe(0)
  })
  it('scrolls down to a field below the view, keeping the margin under it', () => {
    expect(revealDelta(box, { top: 500, bottom: 580 })).toBe(580 - (400 - REVEAL_MARGIN))
  })
  it('scrolls up to a field above the view, keeping the margin over it', () => {
    expect(revealDelta(box, { top: 20, bottom: 60 })).toBe(20 - (100 + REVEAL_MARGIN))
  })
  it('shows the top of a field taller than the view', () => {
    expect(revealDelta(box, { top: 300, bottom: 700 })).toBe(300 - (100 + REVEAL_MARGIN))
  })
})

describe('isTextEntry', () => {
  it('counts typing fields and pickers, not buttons or checkboxes', () => {
    const make = (html: string) => {
      const div = document.createElement('div')
      div.innerHTML = html
      return div.firstElementChild
    }
    expect(isTextEntry(make('<input>'))).toBe(true)
    expect(isTextEntry(make('<input type="number">'))).toBe(true)
    expect(isTextEntry(make('<input type="date">'))).toBe(true)
    expect(isTextEntry(make('<textarea></textarea>'))).toBe(true)
    expect(isTextEntry(make('<select></select>'))).toBe(true)
    expect(isTextEntry(make('<input type="checkbox">'))).toBe(false)
    expect(isTextEntry(make('<input type="file">'))).toBe(false)
    expect(isTextEntry(make('<button></button>'))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('revealFocusedField', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('scrolls the container to the focused field only', () => {
    document.body.innerHTML = '<div id="c"><textarea id="t"></textarea></div><input id="outside">'
    const c = document.getElementById('c')!
    const t = document.getElementById('t')!
    c.getBoundingClientRect = () => rect(0, 300)
    t.getBoundingClientRect = () => rect(400, 480)
    revealFocusedField(c)
    expect(c.scrollTop).toBe(0) // nothing focused yet
    document.getElementById('outside')!.focus()
    revealFocusedField(c)
    expect(c.scrollTop).toBe(0) // focus is outside the container
    t.focus()
    revealFocusedField(c)
    // jsdom keeps scrollTop as set; the field's bottom ends REVEAL_MARGIN above the container's bottom
    expect(c.scrollTop).toBe(480 - (300 - REVEAL_MARGIN))
  })
})

describe('fitToVisibleArea', () => {
  it('pins the overlay to the visible part of the page and lets go when stopped', () => {
    const vv = new FakeViewport()
    const overlay = document.createElement('div')
    const stop = fitToVisibleArea(overlay, null, vv as unknown as VisualViewport)
    expect(overlay.style.top).toBe('0px')
    expect(overlay.style.height).toBe('800px')
    expect(overlay.style.bottom).toBe('auto')
    vv.resize(430) // keyboard opens over the bottom (Android)
    expect(overlay.style.height).toBe('430px')
    vv.offsetTop = 120 // the browser pans the view (iPhone)
    vv.dispatchEvent(new Event('scroll'))
    expect(overlay.style.top).toBe('120px')
    vv.scale = 2 // pinch zoom: back to full window
    vv.dispatchEvent(new Event('resize'))
    expect(overlay.style.top).toBe('')
    expect(overlay.style.height).toBe('')
    vv.scale = 1
    stop()
    vv.resize(300)
    expect(overlay.style.top).toBe('')
    expect(overlay.style.height).toBe('')
    expect(overlay.style.bottom).toBe('')
  })

  it('is a no-op without visualViewport', () => {
    const overlay = document.createElement('div')
    fitToVisibleArea(overlay, null, null)()
    expect(overlay.getAttribute('style')).toBeNull()
  })

  it('reveals the focused field when the keyboard changes the visible height, not when the view only pans', () => {
    const vv = new FakeViewport()
    document.body.innerHTML = '<div id="o"><div id="s"><input id="i"></div></div>'
    const scroller = document.getElementById('s')!
    const input = document.getElementById('i') as HTMLInputElement
    let scrollerBottom = 700
    scroller.getBoundingClientRect = () => rect(50, scrollerBottom)
    input.getBoundingClientRect = () => rect(600 - scroller.scrollTop, 640 - scroller.scrollTop)
    const stop = fitToVisibleArea(document.getElementById('o')!, scroller, vv as unknown as VisualViewport)
    input.focus()
    scrollerBottom = 350 // keyboard opens; the sheet shrinks with the overlay
    vv.resize(400)
    expect(scroller.scrollTop).toBe(640 - (350 - REVEAL_MARGIN))
    scroller.scrollTop = 0 // the user scrolls the sheet back up to look at another field
    vv.offsetTop = 30
    vv.dispatchEvent(new Event('scroll'))
    expect(scroller.scrollTop).toBe(0)
    stop()
    document.body.innerHTML = ''
  })
})

describe('Modal with the on-screen keyboard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('follows the visible area while open and is full-window again once closed', () => {
    const vv = new FakeViewport()
    vi.stubGlobal('visualViewport', vv)
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Tambah Kamar">
        <textarea aria-label="Catatan" />
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.height).toBe('800px')
    act(() => vv.resize(420))
    expect(dialog.style.height).toBe('420px')
    expect(dialog.style.top).toBe('0px')
    rerender(
      <Modal open={false} onClose={() => {}} title="Tambah Kamar">
        <textarea aria-label="Catatan" />
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    // listeners are gone: a later resize does not throw on the unmounted overlay
    act(() => vv.resize(800))
  })

  it('renders as before where visualViewport is missing', () => {
    vi.stubGlobal('visualViewport', undefined)
    render(
      <Modal open onClose={() => {}} title="Tambah Kamar">
        <input aria-label="Nama kamar" />
      </Modal>,
    )
    expect(screen.getByRole('dialog').getAttribute('style')).toBeNull()
  })
})
