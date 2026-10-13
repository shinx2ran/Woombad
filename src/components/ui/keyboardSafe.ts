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

/**
 * Below this visible height (a phone held sideways with the keyboard open) a fixed title bar and button row would
 * leave almost no room for the field, so the whole sheet scrolls as one instead (`data-compact` on the overlay).
 */
export const COMPACT_HEIGHT = 320

interface Span {
  top: number
  bottom: number
}

/** Room kept around the field so its label and the text just typed stay readable. */
export const REVEAL_MARGIN = 24

/**
 * How far to scroll `container` (by scrollTop) so that `field` sits inside it; 0 when it already does. The margin
 * shrinks when space is short so a field that fits is always shown whole; a field taller than the container is
 * aligned by its top edge, where typing starts.
 */
export function revealDelta(container: Span, field: Span, margin: number = REVEAL_MARGIN): number {
  const space = container.bottom - container.top - (field.bottom - field.top)
  const m = Math.max(0, Math.min(margin, space / 2))
  const top = field.top - (container.top + m)
  if (space < 0) return top
  const bottom = field.bottom - (container.bottom - m)
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

/** The nearest element between `el` and `root` (inclusive) that scrolls vertically. */
function scrollParent(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
    if (node === root) break
  }
  return null
}

/** Scrolls the focused field inside `root` into the view of whatever scrolls it (the dialog body, or the whole sheet). */
export function revealFocusedField(root: HTMLElement): void {
  const el = document.activeElement
  if (!isTextEntry(el) || !root.contains(el)) return
  const scroller = scrollParent(el, root)
  if (!scroller) return
  const delta = revealDelta(scroller.getBoundingClientRect(), el.getBoundingClientRect())
  if (delta !== 0) scroller.scrollTop += delta
}

/**
 * While running, pins `overlay` (a position: fixed element) to the visible part of the page, marks it
 * `data-compact` when that part is short, and keeps the focused field in view whenever the area changes size,
 * i.e. when the keyboard opens or closes. Returns the function that stops it.
 */
export function fitToVisibleArea(overlay: HTMLElement, vv: VisualViewport | null | undefined = window.visualViewport): () => void {
  if (!vv) return () => {}
  let lastHeight = -1
  const fit = () => {
    const area = visibleArea(vv)
    overlay.style.top = area ? `${area.top}px` : ''
    overlay.style.height = area ? `${area.height}px` : ''
    overlay.style.bottom = area ? 'auto' : ''
    overlay.toggleAttribute('data-compact', !!area && area.height < COMPACT_HEIGHT)
    // only on a size change: panning the page must not pull the sheet's scroll position around
    const height = area?.height ?? -1
    if (height !== lastHeight) {
      lastHeight = height
      revealFocusedField(overlay)
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
    overlay.removeAttribute('data-compact')
  }
}
