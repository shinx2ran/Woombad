import { useId, useState } from 'react'
import { implausiblePrice, type PriceCheck } from '../../domain/priceCheck'

export interface PriceConfirmState {
  /** what looks wrong about the price, or null (nothing to ask) */
  check: PriceCheck | null
  /** nothing to ask, or "Harga ini memang benar" was ticked for exactly this price */
  ok: boolean
  /** the box is ticked for the price shown now */
  confirmed: boolean
  setConfirmed: (yes: boolean) => void
  /** forget the tick (a form that stays mounted calls this when it opens again) */
  reset: () => void
  /** bring the question into view after a blocked save */
  focus: () => void
  /** id of the "Harga ini memang benar" checkbox (PriceConfirm) */
  inputId: string
}

/**
 * SPEC 7.14 Cek harga for one price field: implausiblePrice against the room's rate, plus the owner's "memang benar"
 * tick. The tick belongs to the price it was given for: typing another price asks again. `enabled` false asks nothing.
 */
export function usePriceConfirm(price: number, standard: number | null | undefined, unit: string, enabled = true): PriceConfirmState {
  const [confirmedPrice, setConfirmedPrice] = useState<number | null>(null)
  const inputId = useId()
  const check = enabled ? implausiblePrice(price, standard, unit) : null
  const confirmed = check !== null && confirmedPrice === price
  return {
    check,
    ok: check === null || confirmed,
    confirmed,
    setConfirmed: (yes) => setConfirmedPrice(yes ? price : null),
    reset: () => setConfirmedPrice(null),
    focus: () => {
      const input = document.getElementById(inputId)
      if (!input) return
      input.focus()
      input.scrollIntoView?.({ block: 'center' })
    },
    inputId,
  }
}
