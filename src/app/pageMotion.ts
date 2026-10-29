/**
 * Which animation a page change plays (iOS-style navigation, SPEC 7.9):
 * - 'push': a page opened from another (a lease from the list, the planner from the dashboard) slides in from the right
 *   over the page it came from;
 * - 'pop': going back up (the browser/phone back, or a link back to the list) slides it away to the right again;
 * - 'tab': switching between the sections of the bottom tabs / sidebar, or in and out of the login screens, crossfades;
 * - 'none': the same page with other search params (planner dates, report period): no page animation at all.
 */
export type PageMotion = 'push' | 'pop' | 'tab' | 'none'

/** the sections of the bottom tabs and the sidebar (NAV_ITEMS in AppShell): a page at depth 1 */
const SECTION_ROOTS = new Set(['dashboard', 'sewa', 'penyewa', 'kos', 'pengeluaran', 'laporan', 'pengaturan'])
/** screens outside the app shell (login, sign-up, password reset, invitation links) */
const OUTSIDE_APP = new Set(['login', 'daftar', 'reset-sandi', 'gabung'])

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

/**
 * How deep a page sits: a section root is 1, a page opened from it (sewa/:id, sewa/baru, kos/:id) is 2; pages that are
 * not a section of their own (rencana, daftar-tunggu: opened from the dashboard or the lease list) count as opened from one.
 */
export function pageDepth(pathname: string): number {
  const parts = segments(pathname)
  if (parts.length === 0) return 0
  return SECTION_ROOTS.has(parts[0]) ? parts.length : parts.length + 1
}

/** The animation for a page change made by a link or a navigate() call (forward in history). */
export function motionBetween(fromPathname: string, toPathname: string): PageMotion {
  const from = trimSlash(fromPathname)
  const to = trimSlash(toPathname)
  if (from === to) return 'none'
  const fromParts = segments(from)
  const toParts = segments(to)
  // login ↔ app, '/' redirects: a plain crossfade
  if (fromParts.length === 0 || toParts.length === 0 || OUTSIDE_APP.has(fromParts[0]) || OUTSIDE_APP.has(toParts[0])) return 'tab'
  const fromDepth = pageDepth(from)
  const toDepth = pageDepth(to)
  if (toDepth === 1) {
    if (fromDepth === 1) return 'tab'
    // back up to the list the page belongs to (sewa/:id → sewa); another section's tab is a tab switch
    return fromParts[0] === toParts[0] ? 'pop' : 'tab'
  }
  if (toDepth < fromDepth) return 'pop'
  // deeper, or a sibling / cross link (lease → tenant, planner → waiting list): opened on top
  return 'push'
}

/**
 * The animation for a back/forward step through history: back plays the reverse of the step that led here
 * (a pushed page pops off again), forward replays it.
 */
export function motionForHistory(fromPathname: string, toPathname: string, direction: 'back' | 'forward'): PageMotion {
  if (direction === 'forward') return motionBetween(fromPathname, toPathname)
  const original = motionBetween(toPathname, fromPathname)
  if (original === 'push') return 'pop'
  if (original === 'pop') return 'push'
  return original
}

function trimSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}
