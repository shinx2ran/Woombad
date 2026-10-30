// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_THEME, BOOT_MIN_MS, FADE_MS, RESHOW_DELAY_MS, SPLASH_THEME, bootSplashReady, holdBootSplash, resetBootSplash } from './bootSplash'

let reduce = false
let now = 0

beforeEach(() => {
  vi.useFakeTimers()
  reduce = false
  now = 0
  resetBootSplash()
  document.head.innerHTML = `<meta name="theme-color" content="${SPLASH_THEME}">`
  document.body.innerHTML = '<div id="boot-splash" aria-hidden="true"><p>EG Kost</p></div><div id="root"></div>'
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce') })) as unknown as typeof window.matchMedia
  vi.spyOn(window.performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetBootSplash()
})

const splash = () => document.getElementById('boot-splash')
const theme = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')
/** time since the first frame moves on with the timers */
async function wait(ms: number) {
  now += ms
  await vi.advanceTimersByTimeAsync(ms)
}

describe('boot splash', () => {
  it('at the first start the logo gets its moment, then fades out and goes; the status bar turns teal again', async () => {
    now = 300
    bootSplashReady()
    await wait(BOOT_MIN_MS - 300 - 1)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    await wait(1)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
    expect(theme()).toBe(APP_THEME)
    await wait(FADE_MS)
    expect(splash()).toBeNull()
  })

  it("the minimum counts from the splash's own first frame, not from the start of the page", async () => {
    // the page started 400 ms before the splash's animations did (a slow first paint)
    now = 1000
    splash()!.getAnimations = (() => [{ animationName: 'bs-halo', currentTime: 600 }]) as unknown as typeof Element.prototype.getAnimations
    bootSplashReady()
    await wait(BOOT_MIN_MS - 600 - 1)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    await wait(1)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
  })

  it('an app that took longer than that to start loses no time', async () => {
    now = BOOT_MIN_MS + 500
    bootSplashReady()
    await wait(0)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
  })

  it('with "reduce motion" it goes as soon as the app is ready, without a fade', async () => {
    reduce = true
    now = 100
    bootSplashReady()
    await wait(0)
    expect(splash()).toBeNull()
  })

  it('a loading screen keeps it until the last one goes', async () => {
    now = 5000
    const releaseAuth = holdBootSplash()
    const releaseOrg = holdBootSplash()
    bootSplashReady()
    await wait(100)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    releaseAuth()
    await wait(100)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    releaseOrg()
    releaseOrg() // twice is once
    await wait(0)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
  })

  it("StrictMode's trial unmount (hold, release, hold) does not let it go", async () => {
    now = 5000
    const first = holdBootSplash()
    first()
    holdBootSplash()
    bootSplashReady()
    await wait(1000)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
  })

  it('a loading screen during the fade-out keeps it after all', async () => {
    now = 5000
    bootSplashReady()
    await wait(0)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
    const release = holdBootSplash()
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    expect(theme()).toBe(SPLASH_THEME)
    await wait(FADE_MS * 2)
    expect(splash()).not.toBeNull()
    release()
    await wait(FADE_MS)
    expect(splash()).toBeNull()
  })

  it('later (signing in) it comes back only for a loading screen that lasts, and goes with it', async () => {
    now = 5000
    bootSplashReady()
    await wait(FADE_MS)
    expect(splash()).toBeNull()
    // a short one: nothing
    const quick = holdBootSplash()
    await wait(RESHOW_DELAY_MS - 1)
    quick()
    await wait(RESHOW_DELAY_MS)
    expect(splash()).toBeNull()
    // a long one: back, fading in, the status bar dark again
    const slow = holdBootSplash()
    await wait(RESHOW_DELAY_MS)
    expect(splash()).not.toBeNull()
    // fading in with the transition it fades out with (so a hide mid-way turns it round smoothly)
    expect(splash()!.classList.contains('bs-out')).toBe(false)
    expect(splash()!.textContent).toBe('EG Kost')
    expect(theme()).toBe(SPLASH_THEME)
    slow()
    // no first-start minimum this time
    await wait(0)
    expect(splash()!.classList.contains('bs-out')).toBe(true)
    await wait(FADE_MS)
    expect(splash()).toBeNull()
    expect(theme()).toBe(APP_THEME)
  })

  it('without the splash in the page (tests, a page without it) nothing happens', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const release = holdBootSplash()
    bootSplashReady()
    release()
    await wait(BOOT_MIN_MS + RESHOW_DELAY_MS)
    expect(splash()).toBeNull()
    expect(theme()).toBe(SPLASH_THEME)
  })
})
