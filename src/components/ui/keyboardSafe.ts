/**
 * Keeps dialogs usable while the on-screen keyboard is open.
 *
 * Phones put the keyboard over the page without shrinking it (Chrome on Android since version 108, Safari on
 * iPhone and iPad), so a bottom sheet stays partly behind the keyboard and the field being typed in can be hidden.
 * `window.visualViewport` is the part of the page the user can still see; the dialog is fitted into that area and
 * the focused field is scrolled into its view.
 */

export interface VisibleArea {
  top: number
  height: number
}

type ViewportLike = Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>

/**
 * The visible part of the page in layout pixels, or null to leave the dialog full-window: no visualViewport
 * support, or the page is pinch-zoomed (fitting a zoomed view would squeeze the dialog).
 */
export function visibleArea(vv: ViewportLike | null | undefined): VisibleArea | null {
  if (!vv || !(vv.height > 0) || Math.abs(vv.scale - 1) > 0.01) return null
  return { top: Math.max(0, Math.round(vv.offsetTop)), height: Math.round(vv.height) }
}

interface Span {
  top: number
  bottom: number
}

/** Room kept around the field so its label and the text just typed stay readable. */
export const REVEAL_MARGIN = 24

/**
 * How far to scroll `container` (by scrollTop) so that `field` sits inside it with `margin` to spare; 0 when it
 * already does. A field taller than the room left is aligned by its top edge, where typing starts.
 */
export function revealDelta(container: Span, field: Span, margin: number = REVEAL_MARGIN): number {
  const room = container.bottom - container.top - 2 * margin
  const top = field.top - (container.top + margin)
  if (field.bottom - field.top > room) return top
  const bottom = field.bottom - (container.bottom - margin)
  if (bottom > 0) return bottom
  if (top < 0) return top
  return 0
}

/** Elements that open the on-screen keyboard (or a picker) when focused. */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type)
  return el instanceof HTMLElement && el.isContentEditable === true
}

/** Scrolls `container` so the focused field inside it is in view. */
export function revealFocusedField(container: HTMLElement): void {
  const el = document.activeElement
  if (!isTextEntry(el) || !container.contains(el)) return
  const delta = revealDelta(container.getBoundingClientRect(), el.getBoundingClientRect())
  if (delta !== 0) container.scrollTop += delta
}

/**
 * While `active`, pins `overlay` (a position: fixed element) to the visible part of the page and keeps the focused
 * field inside `scroller` in view whenever that area changes size, i.e. when the keyboard opens or closes.
 * Returns the cleanup function.
 */
export function fitToVisibleArea(overlay: HTMLElement, scroller: HTMLElement | null, vv: VisualViewport | null | undefined = window.visualViewport): () => void {
  if (!vv) return () => {}
  let lastHeight = -1
  const fit = () => {
    const area = visibleArea(vv)
    overlay.style.top = area ? `${area.top}px` : ''
    overlay.style.height = area ? `${area.height}px` : ''
    overlay.style.bottom = area ? 'auto' : ''
    // only on a size change: panning the page must not pull the sheet's scroll position around
    const height = area?.height ?? -1
    if (height !== lastHeight) {
      lastHeight = height
      if (scroller) revealFocusedField(scroller)
    }
  }
  fit()
  vv.addEventListener('resize', fit)
  vv.addEventListener('scroll', fit)
  return () => {
    vv.removeEventListener('resize', fit)
    vv.removeEventListener('scroll', fit)
    overlay.style.top = ''
    overlay.style.height = ''
    overlay.style.bottom = ''
  }
}
