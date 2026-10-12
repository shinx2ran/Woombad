/**
 * New app versions (service worker, registerType 'prompt'). A new version is applied at once (the page reloads)
 * unless something on screen would be lost (dirtyState); then UpdateBanner offers "Muat ulang", and the next page
 * change without unsaved work applies it too.
 */
import { isDirty } from './dirtyState'

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** after a tap, reload anyway when the new version does not take over (e.g. another tab already applied it) */
const APPLY_FALLBACK_MS = 5000

export interface AppUpdater {
  /** registerSW onNeedRefresh: a new version is installed and waiting; `activate` lets it take over */
  needRefresh: (activate: () => Promise<void>) => void
  /** registerSW onNeedReload: the new version now controls this page */
  needReload: () => void
  /** "Muat ulang" in the banner */
  applyNow: () => void
  /** on a page change: apply a waiting version once nothing on screen would be lost */
  applyIfIdle: () => void
  /** true while the banner should show */
  isPending: () => boolean
  subscribe: (listener: () => void) => () => void
}

export function createAppUpdater(deps: { isDirty: () => boolean; reload: () => void }): AppUpdater {
  let activate: (() => Promise<void>) | null = null
  let controlling = false
  let applying = false
  let pending = false
  const listeners = new Set<() => void>()

  const setPending = (value: boolean) => {
    if (pending === value) return
    pending = value
    for (const l of listeners) l()
  }

  const apply = (fallback: boolean) => {
    applying = true
    if (controlling || !activate) return deps.reload()
    void activate().catch(() => {})
    // only after a tap: an automatic retry could reload in a loop
    if (fallback) setTimeout(deps.reload, APPLY_FALLBACK_MS)
  }

  return {
    needRefresh: (fn) => {
      activate = fn
      if (deps.isDirty()) setPending(true)
      else apply(false)
    },
    needReload: () => {
      controlling = true
      if (applying || !deps.isDirty()) deps.reload()
      else setPending(true)
    },
    applyNow: () => apply(true),
    applyIfIdle: () => {
      if (pending && !applying && !deps.isDirty()) apply(true)
    },
    isPending: () => pending,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const appUpdater = createAppUpdater({ isDirty, reload: () => window.location.reload() })

/** Look for a new version every hour and when the app comes back to the foreground after an hour (PWAs stay open for days). */
export function watchForUpdates(registration: Pick<ServiceWorkerRegistration, 'installing' | 'update'>, intervalMs = UPDATE_CHECK_INTERVAL_MS): () => void {
  let lastCheck = Date.now()
  const check = () => {
    if (registration.installing || globalThis.navigator?.onLine === false) return
    lastCheck = Date.now()
    registration.update().catch(() => {})
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= intervalMs) check()
  }
  const timer = setInterval(check, intervalMs)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
