// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { Modal } from '../components/ui/Modal'
import { cancelExitAnimations } from '../components/ui/motion'
import { installPageTransitions } from './pageTransitions'

/** a page with an open sheet, then the page after it (the sheet goes with the page) */
function Page({ withSheet }: { withSheet: boolean }) {
  if (!withSheet) return null
  return (
    <Modal open onClose={() => undefined} title="Catat pembayaran">
      <input aria-label="Jumlah" />
    </Modal>
  )
}

const copies = () => document.querySelectorAll('body > [data-exit-copy]').length

/** back from a lease with its sheet open; `browserAnimated`: Safari's swipe back already animated it */
async function backWithSheetOpen(browserAnimated: boolean) {
  Element.prototype.animate = vi.fn(() => ({ finished: new Promise(() => undefined) }) as unknown as Animation)
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia
  let update: (() => unknown) | undefined
  const skip = vi.fn()
  ;(document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => unknown) => {
    update = cb
    return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition: skip }
  }
  const listeners = new Map<string, (e: Event) => void>()
  const win = {
    document,
    matchMedia: window.matchMedia,
    history: { state: { idx: 0 } as { idx: number } },
    addEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, f),
    removeEventListener: () => undefined,
  }
  const router = createMemoryRouter(['/sewa', '/sewa/:id'].map((path) => ({ path, element: null })), { initialEntries: ['/sewa'] })
  const uninstall = installPageTransitions(router, win as unknown as Window)
  win.history.state = { idx: 1 }
  await router.navigate('/sewa/a1')
  if (browserAnimated) listeners.get('popstate')?.({ hasUAVisualTransition: true } as unknown as Event)
  win.history.state = { idx: 0 }
  await router.navigate(-1)
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sewa'))
  const motion = document.documentElement.dataset.pageMotion

  const view = render(<Page withSheet />)
  // what RouterProvider does: draw the new page inside startViewTransition (the lease page and its open sheet go)
  document.startViewTransition(() => act(() => view.rerender(<Page withSheet={false} />)))
  await update!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const result = { motion, skipped: skip.mock.calls.length > 0, copies: copies() }
  uninstall()
  router.dispose()
  view.unmount()
  cancelExitAnimations()
  return result
}

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
})

it('our back slide: the sheet leaves with the old page, no exit copy over the new one', async () => {
  expect(await backWithSheetOpen(false)).toEqual({ motion: 'pop', skipped: false, copies: 0 })
})

it("Safari's swipe back: no second animation, and no exit copy over the page the browser revealed", async () => {
  expect(await backWithSheetOpen(true)).toEqual({ motion: 'none', skipped: true, copies: 0 })
})
