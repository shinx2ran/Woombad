import { AlertTriangle } from 'lucide-react'
import type { PriceConfirmState } from './usePriceConfirm'

/**
 * SPEC 7.14: the amber question under a price that looks like a typo, with a large "Harga ini memang benar" tick. Saving
 * waits for the tick (or a corrected price); `showError` adds the reason after a blocked save. Renders nothing when the
 * price looks normal.
 */
export function PriceConfirm({ state, showError }: { state: PriceConfirmState; showError?: boolean }) {
  if (!state.check) return null
  return (
    <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="price-confirm">
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{state.check.message}</span>
      </p>
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input
          id={state.inputId}
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={state.confirmed}
          onChange={(e) => state.setConfirmed(e.target.checked)}
        />
        Harga ini memang benar
      </label>
      {showError && !state.ok && (
        <p className="text-xs font-medium text-red-700" role="alert">
          Centang bila harganya memang benar, atau perbaiki harganya.
        </p>
      )}
    </div>
  )
}
