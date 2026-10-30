/**
 * The boot splash (SPEC 7.10): "EG Kost" drawn in glowing orange and yellow while the app starts. It is plain HTML and
 * CSS in index.html, on screen from the first frame; this takes it away once the app has something to show.
 *
 * - A loading screen holds it (`holdBootSplash`, the "Menyiapkan aplikasi…" screens and the router's start-up
 *   fallback): while one is up the splash stays, and when the last one goes, so does the splash.
 * - `bootSplashReady` runs after the app's first render: with no loading screen up (the login page at once, an error
 *   screen) the splash goes then.
 * - At the first start it stays at least BOOT_MIN_MS from the first frame, so the logo has drawn itself and beaten once
 *   (not with "reduce motion": nothing moves there). It fades out; taps reach the app at once.
 * - A loading screen later on (signing in) brings it back, only if that screen lasts longer than RESHOW_DELAY_MS.
 * - While it shows, the phone's status bar takes its dark colour; the app's teal comes back with the app.
 */

const SPLASH_ID = 'boot-splash'
/** index.html's theme-color while the splash shows, and the app's own */
export const SPLASH_THEME = '#0b0a08'
export const APP_THEME = '#0f766e'
/** at the first start the logo has this long from its first frame: the letters drawn and filled, the first heartbeat */
export const BOOT_MIN_MS = 1150
/** a later loading screen shows the splash only when it lasts longer than this */
export const RESHOW_DELAY_MS = 400
/** how long the fade-out takes (index.html: transition: opacity 0.45s) */
export const FADE_MS = 450

let holds = 0
let shownBefore = false
/** a clean copy of the splash, to bring it back later */
let template: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | undefined
let removeTimer: ReturnType<typeof setTimeout> | undefined
let reshowTimer: ReturnType<typeof setTimeout> | undefined

function splash(doc: Document): HTMLElement | null {
  return doc.getElementById(SPLASH_ID)
}

function reducedMotion(win: Window): boolean {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

function setThemeColor(doc: Document, color: string): void {
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

/** Keep the splash on screen while a loading screen is up; returns the release. */
export function holdBootSplash(win: Window = window): () => void {
  const doc = win.document
  holds++
  clearTimeout(hideTimer)
  const el = splash(doc)
  if (el?.classList.contains('bs-out')) {
    // fading out as a new loading screen comes: it stays after all
    clearTimeout(removeTimer)
    el.classList.remove('bs-out')
    setThemeColor(doc, SPLASH_THEME)
  } else if (!el && template && reshowTimer === undefined) {
    reshowTimer = setTimeout(() => {
      reshowTimer = undefined
      if (holds > 0 && !splash(doc) && template) {
        // fades in with the same opacity transition it fades out with, so a hide during the fade-in turns it round
        const again = template.cloneNode(true) as HTMLElement
        again.classList.add('bs-out')
        doc.body.prepend(again)
        void again.offsetWidth
        again.classList.remove('bs-out')
        setThemeColor(doc, SPLASH_THEME)
      }
    }, RESHOW_DELAY_MS)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    if (holds > 0) return
    clearTimeout(reshowTimer)
    reshowTimer = undefined
    scheduleHide(win)
  }
}

/** The app has rendered: unless a loading screen holds it, the splash goes. */
export function bootSplashReady(win: Window = window): void {
  if (holds === 0) scheduleHide(win)
}

/**
 * How long the splash's animation has run: from its first frame (the time since the page started, without the API).
 * Read from the halo's heartbeat, which repeats for ever: a finished animation's clock stops at its end.
 */
function splashAge(el: HTMLElement, win: Window): number {
  const beat = el.getAnimations?.({ subtree: true }).find((a) => (a as CSSAnimation).animationName === 'bs-halo')
  const time = beat?.currentTime
  return typeof time === 'number' ? time : win.performance.now()
}

function scheduleHide(win: Window): void {
  const el = splash(win.document)
  if (!el || el.classList.contains('bs-out')) return
  const wait = shownBefore || reducedMotion(win) ? 0 : Math.max(0, BOOT_MIN_MS - splashAge(el, win))
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (holds === 0) hide(win)
  }, wait)
}

function hide(win: Window): void {
  const doc = win.document
  const el = splash(doc)
  if (!el || el.classList.contains('bs-out')) return
  if (!template) {
    template = el.cloneNode(true) as HTMLElement
    template.classList.remove('bs-out')
  }
  shownBefore = true
  el.classList.add('bs-out')
  setThemeColor(doc, APP_THEME)
  clearTimeout(removeTimer)
  if (reducedMotion(win)) el.remove()
  else removeTimer = setTimeout(() => el.remove(), FADE_MS)
}

/** tests: forget everything */
export function resetBootSplash(): void {
  holds = 0
  shownBefore = false
  template = null
  clearTimeout(hideTimer)
  clearTimeout(removeTimer)
  clearTimeout(reshowTimer)
  reshowTimer = undefined
}
