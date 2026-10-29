/**
 * Motion shared by dialogs, toasts and page transitions (SPEC 7.9). One easing and a few durations, close to iOS:
 * sheets and pages decelerate quickly and settle softly. With "reduce motion" on, or without the Web Animations API
 * (jsdom in unit tests), nothing animates and everything appears and disappears at once, as before.
 */

/** iOS-like curve: fast start, long soft settle (sheets, dialogs, page pushes); the CSS twin is --ease-ios in index.css */
export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** a quick accelerating exit (a dialog fading away), --ease-out-quick in index.css */
export const EASE_OUT_QUICK = 'cubic-bezier(0.4, 0, 1, 1)'
/** how long a closing sheet / dialog / toast takes to leave (a sheet's curve has it 90% gone in under half of it) */
export const EXIT_MS = { sheet: 400, dialog: 180, toast: 200 }

export function prefersReducedMotion(win: Window = window): boolean {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

/** exit animations need the Web Animations API (absent in jsdom) and motion not turned down */
export function canAnimate(win: Window = window): boolean {
  return typeof (win as Window & typeof globalThis).Element?.prototype.animate === 'function' && !prefersReducedMotion(win)
}

const ghosts = new Set<HTMLElement>()
let heldUntil = 0

/** Exit animations are skipped for a while (a page transition snapshots the closing dialog with the old page). */
export function holdExitAnimations(ms: number): void {
  heldUntil = performance.now() + ms
}

/** Remove every copy still animating away, at once (before a page transition takes its snapshot). */
export function cancelExitAnimations(): void {
  for (const ghost of ghosts) ghost.remove()
  ghosts.clear()
}

export interface ExitCopy {
  /** call right after React has removed the original: plays the exit if the original is really gone */
  play: () => void
}

/**
 * Copy a dialog (or toast) that is about to disappear, before React removes it from the page, so its exit can still be
 * animated: the copy stays on screen as a picture of the last frame, animates away, and is removed. The real element is
 * gone at once, so nothing in the app waits for the animation. The copy lives in a closed shadow root (with the page's
 * styles): screen readers, taps, focus, the app's own DOM queries and the e2e tests' text locators never see it.
 * `animate` gets the copy and returns the animations to wait for; `layer` is its z-index.
 */
export function copyForExit(original: HTMLElement | null, animate: (copy: HTMLElement) => Animation[], layer: number, win: Window = window): ExitCopy | null {
  if (!original || !original.isConnected || !canAnimate(win) || performance.now() < heldUntil) return null
  // a camera preview cannot be copied; it just disappears
  if (original.querySelector('video, iframe')) return null
  const copy = original.cloneNode(true) as HTMLElement
  copyLiveState(original, copy)
  const scrolled = scrolledElements(original)
  return {
    play: () => {
      // StrictMode's trial unmount in development leaves the original in place: then there is nothing to animate
      if (original.isConnected) return
      const doc = win.document
      const host = doc.createElement('div')
      host.setAttribute('data-exit-copy', '')
      host.setAttribute('aria-hidden', 'true')
      host.setAttribute('inert', '')
      host.style.cssText = `position: fixed; inset: 0; z-index: ${layer}; pointer-events: none;`
      copy.setAttribute('data-exit-copy', '')
      const styles = pageStyles(win)
      if (styles) {
        const root = host.attachShadow({ mode: 'closed' })
        root.adoptedStyleSheets = [styles]
        root.appendChild(copy)
      } else host.appendChild(copy)
      doc.body.appendChild(host)
      ghosts.add(host)
      // scroll positions only apply once the copy is in the page
      for (const [path, top] of scrolled) {
        const el = elementAt(copy, path)
        if (el) el.scrollTop = top
      }
      const done = () => {
        host.remove()
        ghosts.delete(host)
      }
      const animations = animate(copy)
      // removed when the animations end, and in any case shortly after (an animation that never finishes must not
      // leave a copy behind)
      void Promise.allSettled(animations.map((a) => a.finished)).then(done)
      win.setTimeout(done, 1000)
    },
  }
}

let cachedStyles: { sources: CSSStyleSheet[]; sheet: CSSStyleSheet } | null = null

/** The page's own CSS as one constructed sheet for the copy's shadow root (built once; rebuilt if the page's CSS changes). */
function pageStyles(win: Window): CSSStyleSheet | null {
  const Sheet = (win as Window & typeof globalThis).CSSStyleSheet
  if (typeof Sheet !== 'function' || !('adoptedStyleSheets' in (win as Window & typeof globalThis).ShadowRoot.prototype)) return null
  const sources = Array.from(win.document.styleSheets)
  if (cachedStyles && cachedStyles.sources.length === sources.length && cachedStyles.sources.every((s, i) => s === sources[i])) return cachedStyles.sheet
  try {
    const text = sources
      .map((source) => {
        try {
          return Array.from(source.cssRules, (rule) => rule.cssText).join('\n')
        } catch {
          return '' // a sheet from another origin cannot be read
        }
      })
      .join('\n')
    const sheet = new Sheet()
    sheet.replaceSync(text)
    cachedStyles = { sources, sheet }
    return sheet
  } catch {
    return null
  }
}

/** what cloneNode does not copy: typed values, ticks, the picture on a canvas; ids and test ids must stay unique */
function copyLiveState(original: HTMLElement, copy: HTMLElement): void {
  const fields = original.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  const copies = copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  fields.forEach((field, i) => {
    const twin = copies[i]
    if (!twin) return
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) (twin as HTMLInputElement).checked = field.checked
    else if (!(field instanceof HTMLInputElement && field.type === 'file')) twin.value = field.value
  })
  const canvases = original.querySelectorAll('canvas')
  const canvasCopies = copy.querySelectorAll('canvas')
  canvases.forEach((canvas, i) => {
    try {
      canvasCopies[i]?.getContext('2d')?.drawImage(canvas, 0, 0)
    } catch {
      // a tainted or WebGL canvas stays blank in the copy
    }
  })
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    // (also when the copy cannot go into a shadow root: older browsers)
    el.removeAttribute('id')
    el.removeAttribute('for')
    el.removeAttribute('name')
    el.removeAttribute('data-testid')
    el.removeAttribute('autofocus')
  }
}

/** child-index paths and scrollTop of every scrolled element inside `root` (the dialog body, a long list) */
function scrolledElements(root: HTMLElement): Array<[number[], number]> {
  const result: Array<[number[], number]> = []
  const walk = (el: Element, path: number[]) => {
    if (el.scrollTop > 0) result.push([path, el.scrollTop])
    Array.from(el.children).forEach((child, i) => walk(child, [...path, i]))
  }
  walk(root, [])
  return result
}

function elementAt(root: Element, path: number[]): Element | null {
  let el: Element | null = root
  for (const i of path) el = el?.children[i] ?? null
  return el
}
