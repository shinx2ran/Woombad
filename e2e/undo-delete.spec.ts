import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Urungkan hapus (SPEC 6.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('a room deleted by mistake comes back with Urungkan on the toast', async ({ page }) => {
    // a fresh room: rooms that were ever rented cannot be deleted
    await page.goto('/kos')
    await page.getByRole('link', { name: /Kos Melati/ }).first().click()
    await page.waitForURL(/\/kos\/[^/]+$/)
    await page.getByRole('button', { name: /Tambah kamar/i }).first().click()
    const form = page.getByRole('dialog').last()
    await form.getByLabel('Nama kamar').fill('Z9')
    await form.getByLabel('Bulanan').fill('1500000')
    await form.getByRole('button', { name: /^Tambah( \d+)? Kamar$/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Z9', { exact: true }).first()).toBeVisible()

    await page.getByText('Z9', { exact: true }).first().click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Hapus' }).click()
    // the confirmation sheet opens on top of the room sheet
    await page.getByRole('dialog').last().getByRole('button', { name: 'Hapus' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Kamar Z9 dihapus.' })
    await expect(toast).toBeVisible()
    await expect(page.getByText('Z9', { exact: true })).toHaveCount(0)

    await toast.getByRole('button', { name: 'Urungkan' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Kamar Z9 dipulihkan.' })).toBeVisible()
    await expect(page.getByText('Z9', { exact: true }).first()).toBeVisible()
  })
})
