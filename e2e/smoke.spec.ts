import { test, expect } from '@playwright/test'

test.describe('Mode Demo', () => {
  test('login demo -> dashboard shell renders', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Woombad' })).toBeVisible()
    await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByText('Mode Demo', { exact: false }).first()).toBeVisible()
    // bottom navigation present on mobile viewport
    await expect(page.getByRole('link', { name: 'Penyewa', exact: true })).toBeVisible()
    // property switcher lists the two demo properties
    const switcher = page.getByLabel('Pilih kos')
    await expect(switcher).toBeVisible()
    await expect(switcher.locator('option')).toHaveCount(3)
  })

  test('a phone reaches Pengaturan (Anggota, Undang) from the top bar', async ({ page }) => {
    // narrowest common Android width: the gear, the kos switcher and Keluar all fit
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
    await page.waitForURL(/\/dashboard$/)
    const gear = page.getByRole('link', { name: 'Pengaturan' })
    await expect(gear).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keluar' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await gear.click()
    await expect(page).toHaveURL(/\/pengaturan$/)
    await expect(page.getByRole('heading', { name: 'Anggota' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undang' })).toBeVisible()
  })
})
