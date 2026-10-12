import { test, expect } from '@playwright/test'

test.describe('Service worker', () => {
  test('precaches the app and opens an invitation link without a connection', async ({ page, context }) => {
    await page.goto('/login')
    await page.evaluate(() => navigator.serviceWorker.ready)
    // registerType 'prompt' does not claim the first page; the next navigation is served by the worker
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    const precached = await page.evaluate(async () => {
      const name = (await caches.keys()).find((n) => n.startsWith('workbox-precache'))
      return name ? (await (await caches.open(name)).keys()).length : 0
    })
    expect(precached).toBeGreaterThan(20)

    await context.setOffline(true)
    await page.goto('/gabung?kode=ABCD-2345')
    await expect(page).toHaveURL(/\/daftar$/)
    await expect(page.locator('#root')).not.toBeEmpty()
    expect(await page.evaluate(() => localStorage.getItem('woombad.pendingCode'))).toContain('ABCD-2345')
  })
})
