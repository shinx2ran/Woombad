import { useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import { appUpdater, type AppUpdater } from './appUpdate'

/**
 * "Versi baru siap — Muat ulang": shown when a new version arrived while something on screen would be lost by a
 * reload. Rendered outside all providers (main.tsx); above dialogs (clear of a bottom sheet on phones and of a
 * centred dialog on larger screens), below toasts.
 */
export function UpdateBanner({ updater = appUpdater }: { updater?: AppUpdater }) {
  const pending = useSyncExternalStore(updater.subscribe, updater.isPending, () => false)
  if (!pending) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[55] flex justify-center px-4 sm:top-auto sm:bottom-4 sm:justify-start sm:px-6">
      <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900 py-1.5 pr-1.5 pl-4 text-sm text-white shadow-lg">
        <span>Versi baru siap</span>
        <button
          type="button"
          onClick={updater.applyNow}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 font-medium text-slate-900 hover:bg-slate-100"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Muat ulang
        </button>
      </div>
    </div>
  )
}
