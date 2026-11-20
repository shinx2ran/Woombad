import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.29: Tanya AI. Mode Demo has no server, so the page answers with a labelled sample built from the same data
// summary Claude would be given; the request itself is covered by unit tests of the function's shared module.
test.describe('Tanya AI (SPEC 7.29)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-19T10:00:00+07:00'))
  })

  test('phone: from the Dashboard button, a suggested question gets a sample answer; a follow-up can be typed', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    await page.getByRole('navigation', { name: 'Aksi cepat' }).getByRole('link', { name: 'Tanya AI' }).click()
    await page.waitForURL(/\/tanya$/)
    await expect(page.getByRole('heading', { name: 'Tanya AI' })).toBeVisible()
    await expect(page.getByTestId('tanya-privacy')).toContainText('Mode Demo: pertanyaan tidak dikirim ke mana pun')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByRole('button', { name: 'Berapa proyeksi pendapatan sewa bulan ini?' }).click()
    const turns = page.getByTestId('tanya-turns')
    await expect(turns.locator('[data-role="user"]')).toHaveText('Berapa proyeksi pendapatan sewa bulan ini?')
    const answer = turns.locator('[data-role="assistant"]')
    await expect(answer).toContainText('Contoh jawaban (Mode Demo')
    await expect(answer).toContainText(/Proyeksi pendapatan sewa bulan ini sekitar Rp [\d.]+\./)
    await expect(answer).toContainText('Sudah diterima: Rp')
    await expect(answer).toContainText('(contoh)')
    await expect(page.getByTestId('tanya-intro')).toHaveCount(0)

    // a typed follow-up joins the same conversation
    await page.getByLabel('Pertanyaan').fill('Siapa yang telat bayar?')
    await page.getByRole('button', { name: 'Kirim' }).click()
    await expect(turns.locator('[data-role="user"]')).toHaveCount(2)
    await expect(turns.locator('[data-role="assistant"]')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Percakapan baru clears it
    await page.getByRole('button', { name: 'Percakapan baru' }).click()
    await expect(page.getByTestId('tanya-turns')).toHaveCount(0)
    await expect(page.getByTestId('tanya-intro')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('wide screen: Tanya AI is in the sidebar and on Laporan', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await loginDemo(page)
    await page.locator('aside').getByRole('link', { name: 'Tanya AI' }).click()
    await page.waitForURL(/\/tanya$/)
    await page.goto('/laporan')
    await page.getByRole('main').getByRole('link', { name: 'Tanya AI' }).click()
    await page.waitForURL(/\/tanya$/)
    await expect(page.getByRole('heading', { name: 'Tanya AI' })).toBeVisible()
  })
})
