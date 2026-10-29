/**
 * Page transitions (SPEC 7.9). The browser's View Transitions API animates a page change: React Router wraps the
 * render of the new page in document.startViewTransition() when a navigation asks for it (`viewTransition`), and the
 * CSS in index.css slides or fades the two snapshots according to html[data-page-motion] (pageMotion.ts).
 *
 * installPageTransitions() wires the app's router up:
 * - every navigate() / <Link> / <NavLink> / <Navigate> that changes the page asks for a view transition, so no call
 *   site has to; a navigation that only changes the search params (planner dates, report period, filters) does not,
 *   keeps the scroll position, and keeps its synchronous render (the planner relies on flushSync);
 * - before a transition starts it writes the motion (push / pop / tab / none) on <html>, from the two paths (without
 *   the /Woombad base of GitHub Pages) and whether history went back or forward;
 * - it wraps document.startViewTransition: expected rejections are caught, a 'none' change is skipped at once, and
 *   while the new page is drawn dialogs do not play their exit (see below);
 * - it remembers the path of each history entry, so a "back to the list" link can really go back (BackLink).
 * Without the API (older browsers, jsdom) or with "reduce motion" on, pages change instantly as before.
 */
import { resolvePath, type DataRouter, type Location, type RouterNavigateOptions, type To } from 'react-router'
import { cancelExitAnimations, pauseExitAnimations } from '../components/ui/motion'
import { motionBetween, motionForHistory, type PageMotion } from './pageMotion'

export function canAnimatePages(win: Window = window): boolean {
  return typeof win.document.startViewTransition === 'function' && !win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

/** The pathname a navigation goes to (relative paths resolved against the current one). */
export function targetPathname(to: To | null, current: Location): string {
  if (to == null) return current.pathname
  const pathname = typeof to === 'string' ? to.split(/[?#]/)[0] : to.pathname
  if (!pathname) return current.pathname
  return resolvePath(pathname, current.pathname).pathname
}

/** `pathname` without the router's basename ('/Woombad' on GitHub Pages): the router's own state keeps it. */
export function withoutBasename(pathname: string, basename: string): string {
  if (!basename || basename === '/') return pathname
  if (pathname === basename) return '/'
  return pathname.startsWith(`${basename}/`) ? pathname.slice(basename.length) : pathname
}

function historyIndex(win: Window): number | null {
  const idx = (win.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : null
}

/**
 * React Router keys a freshly opened document's history entry 'default', and <ScrollRestoration/> stores positions by
 * key, so a reload, a deep link or the installed app's start could open at the scroll position of another page that
 * was once opened fresh. A unique key for the entry (kept across reloads, as history.state is) avoids that.
 */
export function seedHistoryKey(win: Window = window): void {
  const state = win.history.state as { key?: unknown } | null
  if (state && typeof state.key === 'string') return
  win.history.replaceState({ ...(state ?? {}), key: Math.random().toString(36).slice(2, 10) }, '')
}

/** the location key the app shell has drawn (null outside it), for the check after each transition */
let renderedKey: string | null = null

/** AppShell reports the location it has drawn (and null when it goes away). */
export function reportRenderedLocation(key: string | null): void {
  renderedKey = key
}

/** the installed router's record of history entries, for BackLink */
let entries: { previous: () => string | null } | null = null

/** The path of the history entry before the current one, if this tab has seen it (none after a reload). */
export function previousPathname(): string | null {
  return entries?.previous() ?? null
}

/**
 * Links that open a dialog as the page arrives (a lease's ?action=bayar|tagih|checkout, ?new=1 on Penyewa and
 * Pengeluaran, ?isi=hp, ?impor=demo) and the camera links (?scan=1): the page changes at once, as before, and the
 * dialog rises over it. In a slide the dialog would open under the still header and tabs, which would cover its bottom.
 */
const OPENS_ON_ARRIVAL = /(?:^|[?&])(?:action|new|isi|impor|scan)=/

/**
 * React Router's update waits for its own render of the new page. When quick taps interleave two transitions, that wait
 * can be left hanging (React Router 8.4): the screen stays frozen, and the last tap is only drawn once the running
 * transition ends, which then never happens, so the page stays behind the URL. The wait is cut off after this long; the
 * transition then plays (or is skipped) and React Router draws the latest page.
 */
export const UPDATE_LIMIT_MS = 1000
/** how long after a transition ends the drawn page is compared with the router's (React Router settles its queue first) */
export const REDRAW_CHECK_MS = 150

function withinLimit(update: Promise<unknown> | unknown): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise((resolve) => {
    timer = setTimeout(resolve, UPDATE_LIMIT_MS)
  })
  return Promise.race([Promise.resolve(update), limit]).finally(() => clearTimeout(timer))
}

function searchOf(to: To | null): string {
  if (to == null) return ''
  if (typeof to === 'string') return to.split('#')[0].split('?')[1] ?? ''
  return to.search ?? ''
}

/** Wire the router up for page transitions; returns the undo (tests). */
export function installPageTransitions(router: DataRouter, win: Window = window): () => void {
  const base = router.basename ?? '/'
  const pathOf = (location: Location) => withoutBasename(location.pathname, base)
  const doc = win.document
  // a page change React Router has started a transition for but not drawn yet (router.state already has it)
  let pending = false

  const navigate = router.navigate
  const animated: typeof router.navigate = (to: To | number | null, opts?: RouterNavigateOptions) => {
    if (typeof to === 'number') return navigate(to)
    const current = router.state.location
    // `to` is given without the basename; the router's location carries it
    const here = pathOf(current)
    if (targetPathname(to, { ...current, pathname: here }) === here) {
      // the same page with other search params: no page animation, and the list stays where it was scrolled to.
      // Right after a page change that is not drawn yet (a guard's <Navigate> after the logout's own navigate), it
      // must go through the transition too, or the older change would be drawn over it.
      const extra = pending && opts?.viewTransition === undefined ? { viewTransition: true, flushSync: opts?.flushSync ?? true } : {}
      return navigate(to, { ...opts, ...extra, preventScrollReset: opts?.preventScrollReset ?? true })
    }
    // the '/' redirect at start-up (and to the login): nothing on screen yet to animate from
    const animate = here !== '/' && !OPENS_ON_ARRIVAL.test(searchOf(to)) && canAnimatePages(win)
    const viewTransition = opts?.viewTransition ?? animate
    // flushSync: each page change draws its own page inside its own transition, at once. Without it React Router
    // queues the change and waits for a later render; quick taps then interleave its queue and can draw an older page
    // over the newest one (React Router 8.4), leaving the screen behind the URL.
    return navigate(to, { ...opts, viewTransition, ...(viewTransition && opts?.flushSync === undefined ? { flushSync: true } : {}) })
  }
  router.navigate = animated

  let last = router.state.location
  let lastIndex = historyIndex(win)
  const paths = new Map<number, string>()
  if (lastIndex != null) paths.set(lastIndex, pathOf(last))
  entries = { previous: () => (lastIndex != null ? (paths.get(lastIndex - 1) ?? null) : null) }

  // Safari's swipe back (and Chrome's predictive back) already animated the change: ours would play it a second time.
  // The browser's animation showed the page being left as it was, dialogs included: no exit copies either, until the
  // page it revealed is drawn.
  let browserAnimated = false
  let resumeAfterSwipe: (() => void) | null = null
  const onPopState = (event: PopStateEvent) => {
    browserAnimated = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true
    if (!browserAnimated) return
    resumeAfterSwipe?.()
    resumeAfterSwipe = pauseExitAnimations()
    cancelExitAnimations()
  }
  win.addEventListener('popstate', onPopState, true)
  const afterNextPaint = (fn: () => void) => {
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.requestAnimationFrame(fn))
    else setTimeout(fn, 32)
  }

  // React Router starts the transitions itself. A skipped transition (a new tap mid-way, the 4 s timeout, the page
  // hidden) rejects promises nobody reads, which the browser reports as errors: they are expected, so they are caught.
  // A change that should not animate ('none': the same page, or a back swipe the browser animated) is skipped at once.
  // Otherwise the old page has just been captured, dialogs included (one closing on screen is in the picture as it
  // was): its exit copies go, and dialogs the page change removes play no exit, until the new page is drawn.
  const start = doc.startViewTransition
  if (typeof start === 'function') {
    doc.startViewTransition = ((arg?: Parameters<typeof start>[0]) => {
      const skip = doc.documentElement.dataset.pageMotion === 'none'
      const update = typeof arg === 'function' ? arg : null
      const wrapped = update
        ? async () => {
            pending = false
            if (skip) return withinLimit(update())
            const resume = pauseExitAnimations()
            cancelExitAnimations()
            try {
              await withinLimit(update())
            } finally {
              resume()
            }
          }
        : arg
      const transition = start.call(doc, wrapped)
      transition.ready.catch(() => undefined)
      transition.updateCallbackDone.catch(() => undefined)
      transition.finished.catch(() => undefined).finally(() => setTimeout(redrawIfBehind, REDRAW_CHECK_MS))
      if (skip) transition.skipTransition()
      return transition
    }) as typeof start
  }

  // Back/forward steps go through React Router's queued path (they cannot use flushSync). If quick steps still left the
  // drawn page behind the router's (see above), React Router is asked to draw its current state again: revalidate()
  // notifies RouterProvider without a transition and without touching history (the app has no loaders).
  const redrawIfBehind = () => {
    if (renderedKey === null || renderedKey === router.state.location.key) return
    if (router.state.navigation.state !== 'idle') return
    void router.revalidate()
  }

  const unsubscribe = router.subscribe((state, { viewTransitionOpts }) => {
    if (state.location.key === last.key) return
    const index = historyIndex(win)
    const from = pathOf(last)
    const to = pathOf(state.location)
    let motion: PageMotion
    if (browserAnimated) motion = 'none'
    else if (state.historyAction === 'POP') {
      const forward = index != null && lastIndex != null && index > lastIndex
      motion = motionForHistory(from, to, forward ? 'forward' : 'back')
    } else motion = motionBetween(from, to)
    browserAnimated = false
    last = state.location
    lastIndex = index
    if (index != null) paths.set(index, to)
    if (resumeAfterSwipe) {
      const resume = resumeAfterSwipe
      resumeAfterSwipe = null
      afterNextPaint(resume)
    }
    // only for a change that runs a transition: a page that drops its own search param as it opens must not turn the
    // slide it is part of into 'none', nor must a same-page change that joins a page change not drawn yet
    if (viewTransitionOpts && typeof doc.startViewTransition === 'function') {
      if (!(pending && from === to)) doc.documentElement.dataset.pageMotion = motion
      pending = true
    }
  })

  return () => {
    router.navigate = navigate
    unsubscribe()
    win.removeEventListener('popstate', onPopState, true)
    if (typeof start === 'function') doc.startViewTransition = start
    delete doc.documentElement.dataset.pageMotion
    resumeAfterSwipe?.()
    entries = null
  }
}
