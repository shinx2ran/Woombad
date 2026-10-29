// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from './Modal'
import { ToastProvider, useToast } from './Toast'
import { cancelExitAnimations, pauseExitAnimations } from './motion'

// jsdom has no Web Animations API: these tests lend it one whose animations finish when told to
let finish: () => void = () => undefined
function lendAnimate() {
  const finished = new Promise<void>((resolve) => (finish = resolve))
  Element.prototype.animate = vi.fn(() => ({ finished }) as unknown as Animation)
}
let reduceMotion = false

beforeEach(() => {
  reduceMotion = false
  window.matchMedia = ((query: string) => ({ matches: reduceMotion && query.includes('reduce') })) as unknown as typeof window.matchMedia
  lendAnimate()
})
afterEach(() => {
  cleanup()
  cancelExitAnimations()
  delete (Element.prototype as { animate?: unknown }).animate
  delete (window as { matchMedia?: unknown }).matchMedia
})

/** the copies' hosts (the copy itself sits in their shadow root, or inside them where that is not available: jsdom) */
const copies = () => document.querySelectorAll<HTMLElement>('body > [data-exit-copy]')

function Harness({ mounted = true }: { mounted?: boolean }) {
  const [open, setOpen] = useState(true)
  if (!mounted) return null
  return (
    <>
      <button onClick={() => setOpen(false)}>tutup dari luar</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Catat pengeluaran">
        <label htmlFor="desc">Deskripsi</label>
        <input id="desc" data-testid="desc" />
      </Modal>
    </>
  )
}

describe('dialog exit', () => {
  it('closing leaves a copy of the last frame that animates away; the dialog itself is gone at once', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Deskripsi'), { target: { value: 'Lampu teras' } })
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(copies()).toHaveLength(1)
    const host = copies()[0]
    // not a second dialog for screen readers, taps or tests: hidden, inert, no ids or test ids, typed text kept
    expect(host.getAttribute('aria-hidden')).toBe('true')
    expect(host.hasAttribute('inert')).toBe(true)
    expect(host.style.pointerEvents).toBe('none')
    expect(host.style.zIndex).toBe('49')
    expect(host.querySelector('[id], [for], [data-testid]')).toBeNull()
    expect(host.querySelector('input')!.value).toBe('Lampu teras')
    expect(screen.queryByTestId('desc')).toBeNull()
    // the sheet slides and the dimming fades
    expect(Element.prototype.animate).toHaveBeenCalledTimes(2)
    await act(async () => finish())
    expect(copies()).toHaveLength(0)
  })

  it('a dialog whose whole component goes away animates out too', async () => {
    const { rerender } = render(<Harness />)
    rerender(<Harness mounted={false} />)
    await act(async () => undefined)
    expect(copies()).toHaveLength(1)
  })

  it('the X button and a tap on the dimming close it the same way', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(copies()).toHaveLength(1)
  })

  it('a tap on the dimming while the sheet is still rising (a double tap) does not close it', () => {
    let rising = true
    HTMLElement.prototype.getAnimations = function (this: HTMLElement) {
      return this.classList.contains('modal-panel') && rising ? [{ playState: 'running' } as Animation] : []
    }
    try {
      render(<Harness />)
      const backdrop = document.querySelector('.modal-backdrop')!
      fireEvent.click(backdrop)
      expect(screen.getByRole('dialog')).toBeTruthy()
      rising = false
      fireEvent.click(backdrop)
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations
    }
  })

  it('no copy with reduce motion on, without the Web Animations API, or while a page transition is starting', async () => {
    reduceMotion = true
    const first = render(<Harness />)
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(copies()).toHaveLength(0)
    first.unmount()

    reduceMotion = false
    delete (Element.prototype as { animate?: unknown }).animate
    const second = render(<Harness />)
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(copies()).toHaveLength(0)
    second.unmount()

    lendAnimate()
    const resume = pauseExitAnimations()
    const third = render(<Harness />)
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(copies()).toHaveLength(0)
    third.unmount()
    // once the new page is drawn, dialogs animate out again
    resume()
    render(<Harness />)
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(copies()).toHaveLength(1)
  })

  it('in a browser the copy sits in a closed shadow root with the page styles: text and role queries cannot find it', async () => {
    const adopted: unknown[] = []
    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', { configurable: true, get: () => adopted, set: (v: unknown[]) => adopted.push(...v) })
    const replaced: string[] = []
    const original = window.CSSStyleSheet
    window.CSSStyleSheet = class {
      replaceSync(text: string) {
        replaced.push(text)
      }
    } as unknown as typeof CSSStyleSheet
    try {
      render(<Harness />)
      fireEvent.click(screen.getByText('tutup dari luar'))
      expect(copies()).toHaveLength(1)
      expect(copies()[0].children).toHaveLength(0)
      expect(screen.queryByText('Catat pengeluaran')).toBeNull()
      expect(screen.queryAllByLabelText('Deskripsi')).toHaveLength(0)
      expect(adopted).toHaveLength(1)
      expect(replaced).toHaveLength(1)
    } finally {
      window.CSSStyleSheet = original
      delete (ShadowRoot.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets
    }
  })

  it('a page transition removes copies still on screen before its snapshot', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('tutup dari luar'))
    expect(copies()).toHaveLength(1)
    cancelExitAnimations()
    expect(copies()).toHaveLength(0)
  })
})

function ToastButton() {
  const toast = useToast()
  return <button onClick={() => toast.success('Tersimpan.')}>simpan</button>
}

describe('toast exit', () => {
  it('a closed toast fades away on a copy; the toast itself is gone at once', async () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('simpan'))
    expect(screen.getByRole('status').textContent).toContain('Tersimpan.')
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(copies()).toHaveLength(1)
    expect(copies()[0].style.zIndex).toBe('60')
    expect((copies()[0].firstElementChild as HTMLElement).style.position).toBe('fixed')
    await act(async () => finish())
    expect(copies()).toHaveLength(0)
  })
})
