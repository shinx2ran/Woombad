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
})
