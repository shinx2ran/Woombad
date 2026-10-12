/**
 * Work on screen that a page reload would lose (a one-time invite code, a half-filled form). While anything is
 * registered, a new app version waits for the user's tap instead of reloading by itself (see appUpdate.ts).
 * Keys are per source: marking the same key twice and clearing it once leaves it clean.
 */
import { useEffect, useId } from 'react'

const dirty = new Set<string>()

export function markDirty(key: string): void {
  dirty.add(key)
}

export function clearDirty(key: string): void {
  dirty.delete(key)
}

export function isDirty(): boolean {
  return dirty.size > 0
}

/** Marks the calling component dirty while `active` is true and until it unmounts. */
export function useDirtyWhile(active: boolean): void {
  const key = useId()
  useEffect(() => {
    if (!active) return
    markDirty(key)
    return () => clearDirty(key)
  }, [active, key])
}
