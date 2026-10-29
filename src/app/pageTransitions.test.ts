import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, type DataRouter } from 'react-router'
import { installPageTransitions, targetPathname } from './pageTransitions'

/** a transition whose promises reject the way a skipped one does */
function fakeTransition(update?: unknown) {
  const skipped = () => Promise.reject(new DOMException('Transition was skipped', 'AbortError'))
  return { update, ready: skipped(), updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition: vi.fn() }
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

const routes = ['/dashboard', '/sewa', '/sewa/:id', '/rencana', '/penyewa'].map((path) => ({ path, element: null }))

let router: DataRouter
let win: ReturnType<typeof fakeWindow>
let navigate: ReturnType<typeof vi.spyOn>
let uninstall: () => void

function setup(opts?: Parameters<typeof fakeWindow>[0]) {
  router = createMemoryRouter(routes, { initialEntries: ['/sewa'] })
  win = fakeWindow(opts)
  navigate = vi.spyOn(router, 'navigate')
  uninstall = installPageTransitions(router, win as unknown as Window)
}
const motion = () => win.document.documentElement.dataset.pageMotion
/** what the router itself was asked for */
const lastOptions = () => navigate.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined

beforeEach(() => setup())
afterEach(() => {
  uninstall()
  router.dispose()
})

describe('installPageTransitions', () => {
  it('a link to another page asks for a view transition and marks the motion', async () => {
    await router.navigate('/sewa/a1')
    expect(lastOptions()).toMatchObject({ viewTransition: true })
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
    expect(motion()).toBe('none')
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
      await router.navigate('/sewa/a1')
      const start = win.document.startViewTransition as unknown as (cb: () => void) => ReturnType<typeof fakeTransition>
      const pushed = start(() => undefined)
      expect(pushed.skipTransition).not.toHaveBeenCalled()
      await router.navigate('?tab=2')
      const same = start(() => undefined)
      expect(same.skipTransition).toHaveBeenCalled()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
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
