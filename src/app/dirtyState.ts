/**
 * Work on screen that a page reload would lose (a one-time invite code, a half-filled form). While anything is
 * registered, a new app version waits for the user's tap instead of reloading by itself (see appUpdate.ts).
 * Keys are per source: marking the same key twice and clearing it once leaves it clean.
 * Pages need no wiring: watchPageInput marks the current page dirty once the user enters something on it.
 */
import { useEffect, useId } from 'react'

const dirty = new Set<string>()
/** location.pathname of the page the user entered something on; it stays dirty until he leaves it */
let inputPath: string | null = null

const currentPath = () => globalThis.location?.pathname ?? ''

export function markDirty(key: string): void {
  dirty.add(key)
}

export function clearDirty(key: string): void {
  dirty.delete(key)
}

export function isDirty(): boolean {
  forgetOtherPages()
  return dirty.size > 0 || inputPath !== null
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

/**
 * A page change: what was entered on another page is gone already. Input on the new page stays, also when it came
 * in the same render (the Check-in scanner opens the camera in an effect, which runs before the shell's).
 */
export function forgetOtherPages(): void {
  if (inputPath !== null && inputPath !== currentPath()) inputPath = null
}

// Controls that only change what is shown (a search box, the kos filter: [data-dirty-ignore]) are not work.
const IGNORE = '[data-dirty-ignore]'
// Buttons that hold a form choice (room cards, period type cards).
const CHOICE = '[aria-pressed], [role="radio"], [role="checkbox"], [role="switch"]'

function isEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(IGNORE)) return false
  if (target instanceof HTMLInputElement) return target.type !== 'search'
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

function isChoiceOrCamera(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(IGNORE)) return false
  return (target instanceof HTMLInputElement && target.type === 'file') || target.closest(CHOICE) !== null
}

/**
 * Typing or picking something (also opening the camera for a KTP scan, or a room card) marks the current page
 * dirty until the user leaves it, so page forms such as Check-in (/sewa/baru), sign-up and joining survive a new
 * version. Capture phase: a component that stops propagation still counts.
 */
export function watchPageInput(doc: Document = document): () => void {
  const onEntry = (e: Event) => {
    if (isEntry(e.target)) inputPath = currentPath()
  }
  const onClick = (e: Event) => {
    if (isChoiceOrCamera(e.target)) inputPath = currentPath()
  }
  doc.addEventListener('input', onEntry, true)
  doc.addEventListener('change', onEntry, true)
  doc.addEventListener('click', onClick, true)
  return () => {
    doc.removeEventListener('input', onEntry, true)
    doc.removeEventListener('change', onEntry, true)
    doc.removeEventListener('click', onClick, true)
  }
}
