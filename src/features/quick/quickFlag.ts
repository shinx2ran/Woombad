import { useCallback, useEffect, useState } from 'react'

/**
 * "Fitur percobaan: Tombol cepat" (SPEC 7.4). Per device, OFF by default with real data; always ON in Mode Demo so
 * the owner can try it with fake data first. Turning it off hides every quick-button screen again: the rest of the
 * app does not depend on it.
 */
export const QUICK_BUTTONS_KEY = 'woombad.quickButtons'
const CHANGED_EVENT = 'woombad:quick-buttons'

export function quickButtonsEnabled(isLocalMode: boolean, stored: string | null): boolean {
  return isLocalMode || stored === '1'
}

/** Storage may be blocked (private window, cleared site data): then the switch simply reads OFF. */
function readStored(): string | null {
  try {
    return localStorage.getItem(QUICK_BUTTONS_KEY)
  } catch {
    return null
  }
}

function writeStored(on: boolean): void {
  try {
    if (on) localStorage.setItem(QUICK_BUTTONS_KEY, '1')
    else localStorage.removeItem(QUICK_BUTTONS_KEY)
  } catch {
    // nothing to do: the switch stays as it was
  }
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function useQuickButtons(isLocalMode: boolean): { enabled: boolean; stored: boolean; setStored: (on: boolean) => void } {
  const [stored, setStoredState] = useState(() => readStored() === '1')

  useEffect(() => {
    const sync = () => setStoredState(readStored() === '1')
    window.addEventListener(CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setStored = useCallback((on: boolean) => writeStored(on), [])
  return { enabled: quickButtonsEnabled(isLocalMode, stored ? '1' : null), stored, setStored }
}
