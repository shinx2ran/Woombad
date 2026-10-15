import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.describe('Jumlah periode', () => {
  test('the default 1 can be deleted and replaced on the new lease form', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/sewa/baru')
    await page.getByRole('radio', { name: /Harian/ }).click()
    const qty = page.getByLabel('Jumlah periode (malam)')
    await expect(qty).toHaveValue('1')
    // as on a phone: tap the box, delete, type
    await qty.click()
    await page.keyboard.press('Backspace')
    await expect(qty).toHaveValue('')
    await page.keyboard.type('5')
    await expect(qty).toHaveValue('5')
    await expect(page.getByTestId('stay-preview')).toContainText('5 malam')
    // tapping the box selects the number, so typing replaces it instead of making "57"
    await page.getByLabel('Tanggal check-in').click()
    await qty.click()
    await page.keyboard.type('7')
    await expect(qty).toHaveValue('7')
    // left empty, it falls back to the last count instead of staying blank
    await page.keyboard.press('Backspace')
    await page.getByLabel('Tanggal check-in').click()
    await expect(qty).toHaveValue('7')
    await expect(page.getByTestId('stay-preview')).toContainText('7 malam')
  })
})
