import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.12: Hendra's daily stay in 102 (Mode Demo) is extended as weekly; the sheet asks for the uang jaminan.
test.describe('Perpanjang harian → mingguan: deposit (SPEC 7.12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-30T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('switching to Mingguan asks for the deposit; it is saved on the lease and received in one go', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.locator('[data-testid="board-tile"][aria-label*="(Hendra Wijaya)"]').click()
    await page.getByRole('dialog').getByRole('link', { name: 'Perpanjang' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Buat tagihan berikutnya' })).toBeVisible()
    // still daily: no deposit question
    await expect(sheet.getByTestId('extension-deposit')).toHaveCount(0)

    await sheet.getByRole('radio', { name: 'Mingguan' }).click()
    const deposit = sheet.getByLabel('Uang jaminan (deposit)')
    await expect(deposit).toBeVisible()
    await expect(sheet.getByTestId('extension-deposit-missing')).toBeVisible()
    await deposit.fill('200000')
    await expect(sheet.getByTestId('extension-deposit-missing')).toHaveCount(0)
    await expect(sheet.getByRole('checkbox', { name: 'Deposit Rp 200.000 sudah diterima' })).toBeChecked()
    await sheet.getByLabel('Metode deposit').selectOption('transfer')
    await sheet.getByRole('button', { name: 'Buat tagihan' }).click()

    await expect(page.getByText(/Sewa kini Mingguan .* Deposit Rp 200\.000, diterima Rp 200\.000 \(Transfer\)\./)).toBeVisible()
    // the fresh bill opens in the share sheet: close it, the lease page is underneath
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Deposit dipegang: received by transfer, nothing returned or used
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 0 · dikembalikan Rp 0')).toBeVisible()
    await expect(page.getByText('Deposit disepakati').locator('..')).toContainText('Rp 200.000')
    expect(errors).toEqual([])
  })
})
