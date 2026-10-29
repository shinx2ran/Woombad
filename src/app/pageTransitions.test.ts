import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, type DataRouter } from 'react-router'
import { REDRAW_CHECK_MS, UPDATE_LIMIT_MS, installPageTransitions, previousPathname, reportRenderedLocation, seedHistoryKey, targetPathname, withoutBasename } from './pageTransitions'

/** updates held back by a transition that has not run its callback yet (see deferUpdates) */
let heldUpdates: Array<() => unknown> = []
let deferUpdates = false
/** the next transitions never finish (a slide still running) */
let neverFinish = false

/** a transition whose promises reject the way a skipped one does; like a browser it runs the update (even if skipped) */
function fakeTransition(update?: unknown) {
  const skipped = () => Promise.reject(new DOMException('Transition was skipped', 'AbortError'))
  if (typeof update === 'function') {
    if (deferUpdates) heldUpdates.push(update as () => unknown)
    else void (update as () => unknown)()
  }
  const finished = neverFinish ? new Promise<void>(() => undefined) : Promise.resolve()
  return { update, ready: skipped(), updateCallbackDone: Promise.resolve(), finished, skipTransition: vi.fn() }
}

/** just what pageTransitions reads from a window */
function fakeWindow({ viewTransitions = true, reduceMotion = false } = {}) {
  const listeners = new Map<string, (event: Event) => void>()
  const win = {
    document: {
      startViewTransition: viewTransitions ? vi.fn(fakeTransition) : undefined,
      documentElement: { dataset: {} as Record<string, string> },
    },
    matchMedia: (query: string) => ({ matches: reduceMotion && query.includes('reduce') }),
    history: { state: { idx: 0 } as { idx: number } | null },
    addEventListener: (type: string, fn: (event: Event) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    popstate: (init: { hasUAVisualTransition?: boolean }) => listeners.get('popstate')?.(init as unknown as Event),
  }
  return win
}

const routes = ['/', '/dashboard', '/sewa', '/sewa/:id', '/rencana', '/penyewa'].map((path) => ({ path, element: null }))

let router: DataRouter
let win: ReturnType<typeof fakeWindow>
let navigate: ReturnType<typeof vi.spyOn>
let uninstall: () => void

function setup(opts?: Parameters<typeof fakeWindow>[0] & { basename?: string; at?: string }) {
  router = createMemoryRouter(routes, { initialEntries: [`${opts?.basename ?? ''}${opts?.at ?? '/sewa'}`], basename: opts?.basename })
  win = fakeWindow(opts)
  navigate = vi.spyOn(router, 'navigate')
  uninstall = installPageTransitions(router, win as unknown as Window)
  // what RouterProvider does with a change that asks for a transition
  router.subscribe((_state, { viewTransitionOpts }) => {
    if (viewTransitionOpts) win.document.startViewTransition?.(() => undefined)
  })
}
const motion = () => win.document.documentElement.dataset.pageMotion
/** what the router itself was asked for */
const lastOptions = () => navigate.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined

beforeEach(() => {
  deferUpdates = false
  neverFinish = false
  heldUpdates = []
  setup()
})
afterEach(() => {
  uninstall()
  router.dispose()
})

describe('installPageTransitions', () => {
  it('a link to another page asks for a view transition and marks the motion', async () => {
    await router.navigate('/sewa/a1')
    // drawn inside its own transition at once (flushSync), not queued for a later render
    expect(lastOptions()).toMatchObject({ viewTransition: true, flushSync: true })
    expect(motion()).toBe('push')
    win.history.state = { idx: 1 }
    await router.navigate('/penyewa')
    expect(motion()).toBe('tab')
  })

  it('a navigation that only changes the search params gets no transition and keeps the scroll position', async () => {
    await router.navigate('/rencana')
    await router.navigate('?date=2026-10-10', { replace: true, flushSync: true })
    expect(lastOptions()).toMatchObject({ preventScrollReset: true, flushSync: true })
    expect(lastOptions()?.viewTransition).toBeUndefined()
    // the motion of the slide that brought us here stays (a page dropping its own ?action= while it opens)
    expect(motion()).toBe('push')
    await router.navigate({ search: '?date=2026-10-11' })
    expect(lastOptions()?.viewTransition).toBeUndefined()
    await router.navigate('/rencana?date=2026-10-12')
    expect(lastOptions()?.viewTransition).toBeUndefined()
  })

  it('an explicit choice at the call site wins, and links passing undefined still animate', async () => {
    await router.navigate('/sewa/a1', { viewTransition: false })
    expect(lastOptions()).toMatchObject({ viewTransition: false })
    await router.navigate('/dashboard', { viewTransition: undefined, replace: undefined })
    expect(lastOptions()).toMatchObject({ viewTransition: true })
    await router.navigate('?x=1', { preventScrollReset: false })
    expect(lastOptions()).toMatchObject({ preventScrollReset: false })
  })

  it('back pops the pushed page off; the history index tells back from forward', async () => {
    win.history.state = { idx: 1 }
    await router.navigate('/sewa/a1')
    win.history.state = { idx: 0 }
    await router.navigate(-1)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sewa'))
    expect(motion()).toBe('pop')
    win.history.state = { idx: 1 }
    await router.navigate(1)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sewa/a1'))
    expect(motion()).toBe('push')
  })

  it("a back gesture the browser already animated plays no second animation", async () => {
    await router.navigate('/sewa/a1')
    win.popstate({ hasUAVisualTransition: true })
    await router.navigate(-1)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sewa'))
    expect(motion()).toBe('none')
    // only that one step
    await router.navigate('/sewa/a1')
    expect(motion()).toBe('push')
  })

  it('without the API or with reduce motion on, pages change without a transition', async () => {
    uninstall()
    setup({ viewTransitions: false })
    await router.navigate('/sewa/a1')
    expect(lastOptions()).toMatchObject({ viewTransition: false })
    uninstall()
    setup({ reduceMotion: true })
    await router.navigate('/sewa/a1')
    expect(lastOptions()).toMatchObject({ viewTransition: false })
  })

  it("the browser's transitions: a skipped one raises no error; one that should not animate is skipped at once", async () => {
    const unhandled = vi.fn()
    // vitest runs in node: an unhandled rejection is reported there
    const process = (globalThis as unknown as { process: { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void } }).process
    process.on('unhandledRejection', unhandled)
    try {
      const start = win.document.startViewTransition as unknown as (cb: () => void) => ReturnType<typeof fakeTransition>
      await router.navigate('?tab=2')
      win.history.state = { idx: 2 }
      await router.navigate('/sewa/a1')
      const pushed = start(() => undefined)
      expect(pushed.skipTransition).not.toHaveBeenCalled()
      win.history.state = { idx: 1 }
      await router.navigate(-1)
      await vi.waitFor(() => expect(router.state.location.search).toBe('?tab=2'))
      expect(motion()).toBe('pop')
      // back again only drops ?tab=2: React Router replays a transition (the path has one recorded), which is skipped
      win.history.state = { idx: 0 }
      await router.navigate(-1)
      await vi.waitFor(() => expect(router.state.location.search).toBe(''))
      expect(motion()).toBe('none')
      const same = start(() => undefined)
      expect(same.skipTransition).toHaveBeenCalled()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('under the /Woombad base of GitHub Pages the motion and the same-page test read the paths without it', async () => {
    uninstall()
    setup({ basename: '/Woombad' })
    expect(router.state.location.pathname).toBe('/Woombad/sewa')
    await router.navigate('/sewa/a1')
    expect(lastOptions()).toMatchObject({ viewTransition: true })
    expect(motion()).toBe('push')
    win.history.state = { idx: 1 }
    await router.navigate('/dashboard')
    expect(motion()).toBe('tab')
    await router.navigate('/dashboard?x=1')
    expect(lastOptions()?.viewTransition).toBeUndefined()
    expect(lastOptions()).toMatchObject({ preventScrollReset: true })
  })

  it("the start-up redirect from '/' does not animate", async () => {
    uninstall()
    setup({ at: '/' })
    await router.navigate('/dashboard', { replace: true })
    expect(lastOptions()).toMatchObject({ viewTransition: false })
  })

  it('remembers the page before this one in history, for a link back to the list', async () => {
    expect(previousPathname()).toBeNull()
    win.history.state = { idx: 1 }
    await router.navigate('/sewa/a1')
    expect(previousPathname()).toBe('/sewa')
    win.history.state = { idx: 2 }
    await router.navigate('/penyewa')
    expect(previousPathname()).toBe('/sewa/a1')
  })

  it('a same-page change right after a page change not drawn yet joins its transition (a guard after the logout)', async () => {
    deferUpdates = true
    await router.navigate('/dashboard')
    expect(motion()).toBe('tab')
    // React Router has the new page but has not drawn it: the guard's redirect to the same page, with its state
    await router.navigate('/dashboard', { replace: true, state: { from: '/sewa' } })
    expect(lastOptions()).toMatchObject({ viewTransition: true, replace: true, preventScrollReset: true })
    expect(motion()).toBe('tab')
    // once drawn, a same-page change is plain again
    for (const update of heldUpdates) await update()
    await router.navigate('?x=1')
    expect(lastOptions()?.viewTransition).toBeUndefined()
  })

  it("React Router's update that never finishes (quick taps) is cut off, so the transition ends and the last page is drawn", async () => {
    vi.useFakeTimers()
    try {
      deferUpdates = true
      await router.navigate('/dashboard')
      heldUpdates = []
      // React Router's update, waiting for a render that never comes
      win.document.startViewTransition?.((() => new Promise(() => undefined)) as never)
      const update = heldUpdates[0]
      let done = false
      void Promise.resolve(update()).then(() => (done = true))
      // React Router's own wait, left hanging
      await vi.advanceTimersByTimeAsync(UPDATE_LIMIT_MS - 1)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('after a transition, a drawn page behind the router (quick back steps) is drawn again from the router', async () => {
    vi.useFakeTimers()
    const revalidate = vi.spyOn(router, 'revalidate').mockResolvedValue(undefined)
    try {
      await router.navigate('/sewa/a1')
      // the app shell drew the right page: nothing to do
      reportRenderedLocation(router.state.location.key)
      win.document.startViewTransition?.(() => undefined)
      await vi.advanceTimersByTimeAsync(REDRAW_CHECK_MS)
      expect(revalidate).not.toHaveBeenCalled()
      // it shows an older page for a moment (a back step React is about to draw): not yet
      reportRenderedLocation('older')
      win.document.startViewTransition?.(() => undefined)
      await vi.advanceTimersByTimeAsync(REDRAW_CHECK_MS)
      expect(revalidate).not.toHaveBeenCalled()
      reportRenderedLocation(router.state.location.key)
      await vi.advanceTimersByTimeAsync(REDRAW_CHECK_MS)
      expect(revalidate).not.toHaveBeenCalled()
      // it still shows the older page at the next check: drawn again
      reportRenderedLocation('older')
      win.document.startViewTransition?.(() => undefined)
      await vi.advanceTimersByTimeAsync(2 * REDRAW_CHECK_MS)
      expect(revalidate).toHaveBeenCalledTimes(1)
      // not while another transition runs (its end checks again)
      reportRenderedLocation(router.state.location.key)
      await vi.advanceTimersByTimeAsync(4 * REDRAW_CHECK_MS)
      revalidate.mockClear()
      neverFinish = true
      win.document.startViewTransition?.(() => undefined)
      neverFinish = false
      reportRenderedLocation('older')
      win.document.startViewTransition?.(() => undefined)
      await vi.advanceTimersByTimeAsync(4 * REDRAW_CHECK_MS)
      expect(revalidate).not.toHaveBeenCalled()
      // outside the app shell (login) there is nothing to compare
      reportRenderedLocation(null)
      await vi.advanceTimersByTimeAsync(4 * REDRAW_CHECK_MS)
      expect(revalidate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      reportRenderedLocation(null)
    }
  })

  it('links that open a dialog as the page arrives change the page at once', async () => {
    await router.navigate('/sewa/a1?action=bayar')
    expect(lastOptions()).toMatchObject({ viewTransition: false })
    await router.navigate({ pathname: '/penyewa', search: '?new=1' })
    expect(lastOptions()).toMatchObject({ viewTransition: false })
    await router.navigate('/rencana?mulai=2026-10-27')
    expect(lastOptions()).toMatchObject({ viewTransition: true })
  })

  it('uninstalling restores the router and the document', () => {
    const wrapped = win.document.startViewTransition
    uninstall()
    expect(router.navigate).toBe(navigate)
    expect(win.document.startViewTransition).not.toBe(wrapped)
    uninstall = () => undefined
  })
})

describe('targetPathname', () => {
  const here = { pathname: '/sewa/a1', search: '', hash: '', state: null, key: 'k', unstable_mask: undefined } as Parameters<typeof targetPathname>[1]
  it('resolves search-only, absolute, relative and object targets', () => {
    expect(targetPathname('?x=1', here)).toBe('/sewa/a1')
    expect(targetPathname('#top', here)).toBe('/sewa/a1')
    expect(targetPathname('', here)).toBe('/sewa/a1')
    expect(targetPathname(null, here)).toBe('/sewa/a1')
    expect(targetPathname('/dashboard?x=1', here)).toBe('/dashboard')
    expect(targetPathname('..', here)).toBe('/sewa')
    expect(targetPathname({ search: '?a=1' }, here)).toBe('/sewa/a1')
    expect(targetPathname({ pathname: '/penyewa/t1' }, here)).toBe('/penyewa/t1')
  })
})

describe('withoutBasename', () => {
  it('drops the base only when the path starts with it', () => {
    expect(withoutBasename('/Woombad/sewa/a1', '/Woombad')).toBe('/sewa/a1')
    expect(withoutBasename('/Woombad', '/Woombad')).toBe('/')
    expect(withoutBasename('/Woombadx/sewa', '/Woombad')).toBe('/Woombadx/sewa')
    expect(withoutBasename('/sewa', '/')).toBe('/sewa')
  })
})

describe('seedHistoryKey', () => {
  it('gives a freshly opened entry its own key and keeps an existing one', () => {
    const replaced: unknown[] = []
    const win = { history: { state: null as unknown, replaceState: (state: unknown) => replaced.push(state) } } as unknown as Window
    seedHistoryKey(win)
    expect(replaced).toHaveLength(1)
    expect(typeof (replaced[0] as { key: unknown }).key).toBe('string')
    const kept = { history: { state: { key: 'abc', idx: 3, usr: null }, replaceState: (state: unknown) => replaced.push(state) } } as unknown as Window
    seedHistoryKey(kept)
    expect(replaced).toHaveLength(1)
    const partial = { history: { state: { idx: 0, usr: { from: '/sewa' } }, replaceState: (state: unknown) => replaced.push(state) } } as unknown as Window
    seedHistoryKey(partial)
    expect(replaced[1]).toMatchObject({ idx: 0, usr: { from: '/sewa' } })
  })
})
