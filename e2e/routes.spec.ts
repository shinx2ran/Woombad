import { test, expect, type Page } from '@playwright/test'

const ROUTES = ['/dashboard', '/sewa', '/sewa/baru', '/penyewa', '/kos', '/pengeluaran', '/laporan', '/pengaturan']

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.describe('Semua halaman (Mode Demo)', () => {
  test('every route renders without page errors or console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    await loginDemo(page)
    for (const route of ROUTES) {
      await page.goto(route)
      await expect(page.locator('#root')).not.toBeEmpty()
      // the placeholder empty state from the scaffold must be gone
      await expect(page.getByText('Modul ini sedang dibangun')).toHaveCount(0)
      await page.waitForTimeout(300)
    }
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('404 page for unknown routes', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/halaman-tidak-ada')
    await expect(page.getByText('Halaman tidak ditemukan.')).toBeVisible()
  })

  test('staff role hides Laporan from navigation', async ({ page }) => {
    await loginDemo(page)
    // The URL is /dashboard before the organisation has loaded; wait for the shell (and the app's own start-up
    // writes to the demo database) before editing that database, or the edit is overwritten on a slow runner.
    await expect(page.getByRole('link', { name: 'Laporan' }).first()).toBeVisible()
    await page.evaluate(() => {
      const raw = localStorage.getItem('woombad.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await page.waitForURL(/\/dashboard$/)
    await expect(page.getByRole('link', { name: 'Laporan' })).toHaveCount(0)
  })
})
