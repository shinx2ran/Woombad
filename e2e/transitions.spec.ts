import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** Mid-animation phone screenshots for a human look (test-results is git-ignored). */
const SHOTS = process.env.TRANSITION_SHOTS ?? join(process.cwd(), 'test-results', 'transitions')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

/** counts the view transitions the app starts (React Router calls document.startViewTransition) and those still running */
async function countTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __transitions: number; __running: number }
    w.__transitions = 0
    w.__running = 0
    const start = document.startViewTransition?.bind(document)
    if (start) {
      document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
        w.__transitions++
        w.__running++
        const transition = start(arg)
        void transition.finished.finally(() => w.__running--)
        return transition
      }) as typeof document.startViewTransition
    }
  })
}
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __transitions: number }).__transitions)
const motion = (page: Page) => page.evaluate(() => document.documentElement.dataset.pageMotion)
/**
 * The page change has finished: the URL changes first, the new page is drawn inside the transition, so wait for the
 * transition the app started to end (with countTransitions) and for something only the new page has.
 */
async function settled(page: Page, newPage: () => Promise<void>) {
  await newPage()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __running?: number }).__running ?? 0)).toBe(0)
}
const exitCopies = (page: Page) => page.locator('body > [data-exit-copy]')

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Transisi halaman & jendela (SPEC 7.9)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+07:00'))
    mkdirSync(SHOTS, { recursive: true })
  })

  test('a lease slides in from the list and back out; the tabs crossfade; the bar and tabs stay put', async ({ page, context }) => {
    await countTransitions(page)
    await loginDemo(page)
    const before = await transitions(page)

    await page.locator('nav.app-tabbar').getByRole('link', { name: 'Sewa' }).click()
    await page.waitForURL(/\/sewa$/)
    expect(await motion(page)).toBe('tab')
    await settled(page, () => expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toBeVisible())

    // slowed down 10x for a screenshot halfway through the push
    const cdp = await context.newCDPSession(page)
    await cdp.send('Animation.enable')
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
    await page.locator('main a[href*="/sewa/"]').first().click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    expect(await motion(page)).toBe('push')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(SHOTS, 'push-halfway.png') })
    // the chrome has its own snapshot, so it is not part of the sliding page
    const named = await page.evaluate(() => ['.app-header', '.app-tabbar'].map((s) => getComputedStyle(document.querySelector(s)!).viewTransitionName))
    expect(named).toEqual(['app-header', 'app-tabbar'])
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
    await settled(page, () => expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toHaveCount(0))

    await page.goBack()
    await page.waitForURL(/\/sewa$/)
    expect(await motion(page)).toBe('pop')
    await settled(page, () => expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toBeVisible())
    expect(await transitions(page)).toBe(before + 3)
    // the page answers taps once it has settled
    await page.locator('main a[href*="/sewa/"]').first().click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
  })

  test('a new page starts at the top and back returns to where the list was; search-only changes keep the scroll and do not animate', async ({ page }) => {
    await countTransitions(page)
    await page.setViewportSize({ width: 360, height: 640 })
    await loginDemo(page)
    await page.goto('/sewa')
    await expect(page.locator('main a[href*="/sewa/"]').first()).toBeVisible()
    const lastLease = page.locator('main a[href*="/sewa/"]').last()
    await lastLease.scrollIntoViewIfNeeded()
    const listY = await page.evaluate(() => window.scrollY)
    expect(listY).toBeGreaterThan(100)
    await lastLease.click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await settled(page, () => expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toHaveCount(0))
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.goBack()
    await page.waitForURL(/\/sewa$/)
    await settled(page, () => expect(page.getByRole('heading', { name: 'Sewa & Tagihan' })).toBeVisible())
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(listY)

    // the planner's date arrows only change the search params: no transition, the scroll position stays
    await page.goto('/rencana')
    await expect(page.getByRole('heading', { name: 'Cek kamar & pesan' })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 120))
    const y = await page.evaluate(() => window.scrollY)
    const count = await transitions(page)
    await page.getByLabel('Check-in').fill('2026-10-27')
    await expect(page).toHaveURL(/mulai=2026-10-27/)
    expect(await transitions(page)).toBe(count)
    expect(await page.evaluate(() => window.scrollY)).toBe(y)
  })

  test('a sheet rises and slides away; its copy is never found by text, role or label and leaves no trace', async ({ page, context }) => {
    await loginDemo(page)
    await page.goto('/pengeluaran')
    await page.getByRole('button', { name: 'Catat pengeluaran' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const panelAnimation = await dialog.locator('.modal-panel').evaluate((el) => getComputedStyle(el).animationName)
    expect(panelAnimation).toBe('sheet-in')

    const cdp = await context.newCDPSession(page)
    await cdp.send('Animation.enable')
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
    await dialog.getByRole('button', { name: 'Tutup' }).click()
    // the dialog is gone at once; its picture slides away on top
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(exitCopies(page)).toHaveCount(1)
    await expect(page.getByText('Template cepat')).toHaveCount(0)
    await expect(page.getByLabel('Deskripsi')).toHaveCount(0)
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(SHOTS, 'sheet-closing.png') })
    // taps go through the copy to the page
    await page.getByRole('button', { name: 'Catat pengeluaran' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
    await expect(exitCopies(page)).toHaveCount(0)
  })

  test('quick taps during a transition end on the last page with nothing left over', async ({ page }) => {
    await countTransitions(page)
    await loginDemo(page)
    const tabs = page.locator('nav.app-tabbar')
    // dispatched straight away, without waiting for the previous transition
    for (const name of ['Sewa', 'Penyewa', 'Keluar', 'Laporan', 'Dashboard', 'Sewa']) await tabs.getByRole('link', { name }).dispatchEvent('click')
    await page.waitForURL(/\/sewa$/)
    await settled(page, () => expect(page.getByRole('heading', { level: 1 })).toHaveText('Sewa & Tagihan'))
    await expect(exitCopies(page)).toHaveCount(0)
  })

  test('with reduce motion on, pages and dialogs change at once', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Jakarta' })
    const page = await context.newPage()
    await countTransitions(page)
    await loginDemo(page)
    await page.locator('nav.app-tabbar').getByRole('link', { name: 'Sewa' }).click()
    await page.waitForURL(/\/sewa$/)
    await page.locator('main a[href*="/sewa/"]').first().click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await page.goBack()
    await page.waitForURL(/\/sewa$/)
    expect(await transitions(page)).toBe(0)
    await page.goto('/pengeluaran')
    await page.getByRole('button', { name: 'Catat pengeluaran' }).click()
    expect(await page.getByRole('dialog').locator('.modal-panel').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    await page.getByRole('dialog').getByRole('button', { name: 'Tutup' }).click()
    await expect(exitCopies(page)).toHaveCount(0)
    await context.close()
  })
})
