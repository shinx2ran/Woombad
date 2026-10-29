/**
 * Page transitions (SPEC 7.9). The browser's View Transitions API animates a page change: React Router wraps the
 * render of the new page in document.startViewTransition() when a navigation asks for it (`viewTransition`), and the
 * CSS in index.css slides or fades the two snapshots according to html[data-page-motion] (pageMotion.ts).
 *
 * installPageTransitions() does two things to the app's router:
 * - every navigate() / <Link> / <NavLink> that changes the page asks for a view transition, so no call site has to;
 *   a navigation that only changes the search params (planner dates, report period, filters) does not, keeps the
 *   scroll position, and keeps its synchronous render (the planner relies on flushSync);
 * - before each new page renders it writes the motion (push / pop / tab / none) on <html>, from the two paths and
 *   whether history went back or forward.
 * Without the API (older browsers, jsdom) or with "reduce motion" on, pages change instantly as before.
 */
import { resolvePath, type DataRouter, type Location, type RouterNavigateOptions, type To } from 'react-router'
import { cancelExitAnimations, holdExitAnimations } from '../components/ui/motion'
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

function historyIndex(win: Window): number | null {
  const idx = (win.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : null
}

/** Wire the router up for page transitions; returns the undo (tests). */
export function installPageTransitions(router: DataRouter, win: Window = window): () => void {
  const navigate = router.navigate
  const animated: typeof router.navigate = (to: To | number | null, opts?: RouterNavigateOptions) => {
    if (typeof to === 'number') return navigate(to)
    const current = router.state.location
    if (targetPathname(to, current) === current.pathname) {
      // the same page with other search params: no page animation, and the list stays where it was scrolled to
      return navigate(to, { ...opts, preventScrollReset: opts?.preventScrollReset ?? true })
    }
    return navigate(to, { ...opts, viewTransition: opts?.viewTransition ?? canAnimatePages(win) })
  }
  router.navigate = animated

  let last = router.state.location
  let lastIndex = historyIndex(win)
  // Safari's swipe back (and Chrome's predictive back) already animated the change: ours would play it a second time
  let browserAnimated = false
  const onPopState = (event: PopStateEvent) => {
    browserAnimated = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true
  }
  win.addEventListener('popstate', onPopState, true)

  // React Router starts the transitions itself. A skipped transition (a new tap mid-way, the 4 s timeout, the page
  // hidden) rejects promises nobody reads, which the browser reports as errors: they are expected, so they are caught.
  // And a change that should not animate ('none': the same page, or a back swipe the browser animated) is skipped at
  // once instead of running an empty animation.
  const doc = win.document
  const start = doc.startViewTransition
  if (typeof start === 'function') {
    doc.startViewTransition = ((update?: Parameters<typeof start>[0]) => {
      const transition = start.call(doc, update)
      transition.ready.catch(() => undefined)
      transition.updateCallbackDone.catch(() => undefined)
      transition.finished.catch(() => undefined)
      if (doc.documentElement.dataset.pageMotion === 'none') transition.skipTransition()
      return transition
    }) as typeof start
  }

  const unsubscribe = router.subscribe((state, { viewTransitionOpts }) => {
    if (state.location.key === last.key) return
    const index = historyIndex(win)
    let motion: PageMotion
    if (browserAnimated) motion = 'none'
    else if (state.historyAction === 'POP') {
      const forward = index != null && lastIndex != null && index > lastIndex
      motion = motionForHistory(last.pathname, state.location.pathname, forward ? 'forward' : 'back')
    } else motion = motionBetween(last.pathname, state.location.pathname)
    browserAnimated = false
    last = state.location
    lastIndex = index
    doc.documentElement.dataset.pageMotion = motion
    if (viewTransitionOpts) {
      // a dialog closing as the page changes is part of the old page's snapshot: no separate exit animation on top
      cancelExitAnimations()
      holdExitAnimations(1000)
    }
  })

  return () => {
    router.navigate = navigate
    unsubscribe()
    win.removeEventListener('popstate', onPopState, true)
    if (typeof start === 'function') doc.startViewTransition = start
    delete doc.documentElement.dataset.pageMotion
  }
}
