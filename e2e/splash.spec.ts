import { test, expect, type Page } from '@playwright/test'

interface SplashLog {
  /** status bar colour while the splash is up */
  themeAtStart?: string
  /** ms since the start of the page when it began to fade, and when it was gone */
  outAt?: number
  goneAt?: number
  /** the page title the app had drawn under it when it began to fade */
  h1AtOut?: string
  /** how long its own animation had run then (from its first frame) */
  animAtOut?: number
}

/** records when the "EG Kost" splash leaves and what the app shows under it then */
async function watchSplash(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __splash: SplashLog }
    w.__splash = {}
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('boot-splash')
      if (!el) return
      w.__splash.themeAtStart = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? ''
      const check = () => {
        if (w.__splash.outAt === undefined && (el.classList.contains('bs-out') || !el.isConnected)) {
          w.__splash.outAt = performance.now()
          w.__splash.h1AtOut = document.querySelector('#root h1')?.textContent ?? ''
          const beat = el.getAnimations({ subtree: true }).find((a) => (a as CSSAnimation).animationName === 'bs-halo')
          if (typeof beat?.currentTime === 'number') w.__splash.animAtOut = beat.currentTime
        }
        if (w.__splash.goneAt === undefined && !el.isConnected) w.__splash.goneAt = performance.now()
      }
      new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    })
  })
}
const splashLog = (page: Page) => page.evaluate(() => (window as unknown as { __splash: SplashLog }).__splash)
const theme = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

test.describe('Layar pembuka EG Kost (SPEC 7.10)', () => {
  test.describe('with motion', () => {
    test.use({ reducedMotion: 'no-preference' })

    test('shows "EG Kost" from the first frame, in the dark, then fades away after its moment', async ({ page }) => {
      await watchSplash(page)
      await page.goto('/login')
      const splash = page.locator('#boot-splash')
      await expect(splash).toBeVisible()
      await expect(splash.locator('text.bs-text')).toHaveText('EG Kost')
      // decorative for screen readers (the app's own loading text is under it) and for role queries
      await expect(splash).toHaveAttribute('aria-hidden', 'true')
      // taps reach the app once it is ready
      await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
      await page.waitForURL(/\/dashboard$/)
      await expect.poll(async () => (await splashLog(page)).goneAt).toBeDefined()
      const log = await splashLog(page)
      expect(log.themeAtStart).toBe('#0b0a08')
      // the letters drew themselves, filled and beat once before it went (BOOT_MIN_MS from its own first frame)
      expect(log.animAtOut!).toBeGreaterThanOrEqual(1140)
      // and it faded out
      expect(log.goneAt! - log.outAt!).toBeGreaterThan(300)
      expect(await theme(page)).toBe('#0f766e')
      await expect(splash).toHaveCount(0)
    })

    test('a deep link to a page still loading its code keeps the splash until that page is drawn', async ({ browser }) => {
      // without the service worker, which would serve the code from its cache past the delay below
      const context = await browser.newContext({ reducedMotion: 'no-preference', serviceWorkers: 'block' })
      const page = await context.newPage()
      await loginDemo(page)
      await watchSplash(page)
      // a slow phone: the lease list's code arrives after the logo's moment is over
      await page.route('**/assets/LeasesPage-*.js', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        await route.continue()
      })
      await page.goto('/sewa')
      await expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toBeVisible()
      await expect.poll(async () => (await splashLog(page)).goneAt).toBeDefined()
      expect((await splashLog(page)).h1AtOut).toBe('Sewa & Tagihan')
      await context.close()
    })
  })

  test.describe('with "reduce motion"', () => {
    test.use({ reducedMotion: 'reduce' })

    test('goes as soon as the app is ready, without a fade', async ({ page }) => {
      await watchSplash(page)
      await page.goto('/login')
      await expect(page.getByRole('button', { name: 'Masuk ke Mode Demo' })).toBeVisible()
      await expect.poll(async () => (await splashLog(page)).goneAt).toBeDefined()
      const log = await splashLog(page)
      expect(log.goneAt! - log.outAt!).toBeLessThan(50)
      expect(await theme(page)).toBe('#0f766e')
    })
  })
})
