import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

const tiles = (page: Page) => page.getByTestId('board-tile')

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Tombol cepat: papan kamar (SPEC 7.4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('Mode Demo shows the board on the dashboard, fitting a 360px phone', async ({ page }) => {
    await expect(page.getByTestId('room-board')).toBeVisible()
    expect(await tiles(page).count()).toBeGreaterThan(5)
    await expect(page.getByRole('list', { name: 'Keterangan warna' })).toContainText('Kosong')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('check-in cepat: an empty room, a name, 2 nights, 360k -> a paid daily lease with check-out 13 Okt', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    const roomName = (await vacant.getAttribute('data-room'))!
    await vacant.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: `Kamar ${roomName}` })).toBeVisible()
    await sheet.getByRole('button', { name: 'Check-in cepat' }).click()

    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: `Check-in cepat · Kamar ${roomName}` })).toBeVisible()
    // nothing typed yet: saving is refused with the reason under the name
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await expect(form.getByText('Nama wajib diisi.')).toBeVisible()

    await form.getByLabel('Nama penyewa').fill('Taufik Kusnadi')
    const nights = form.getByLabel('Jumlah malam')
    await nights.click()
    await page.keyboard.type('2')
    await form.getByLabel('Total bayar').fill('360000')
    await expect(form.getByText('= Rp 180.000 / malam')).toBeVisible()
    const summary = form.getByTestId('quick-checkin-summary')
    await expect(summary).toContainText('11 Okt – 13 Okt 2026 · 2 malam')
    await expect(summary).toContainText('Check-out 13 Okt 2026')
    await expect(summary).toContainText('Lunas Rp 360.000')

    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText(/HP penyewa belum diisi/)).toBeVisible()
    await expect(page.getByRole('heading', { name: `Kamar ${roomName}` })).toBeVisible()
    await expect(page.getByText('11 Okt – 13 Okt 2026 · 2 malam')).toBeVisible()
    await expect(page.getByText('Lunas', { exact: true }).first()).toBeVisible()

    // back on the board the room is taken; its sheet reminds about the phone and offers Check-out
    await page.goto('/dashboard')
    const taken = page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`)
    await expect(taken).not.toHaveAttribute('data-tone', 'vacant')
    await taken.click()
    const sheet2 = page.getByRole('dialog')
    await expect(sheet2).toContainText('Taufik Kusnadi')
    await expect(sheet2.getByRole('link', { name: /HP belum diisi/ })).toBeVisible()
    await sheet2.getByRole('link', { name: 'Check-out' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
  })

  test('a room with rent owed opens the existing payment dialog', async ({ page }) => {
    const owing = tiles(page).and(page.locator('[data-tone="overdue"], [data-tone="due"]')).first()
    await owing.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText(/Sisa Rp/)
    await sheet.getByRole('link', { name: 'Bayar' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Catat pembayaran' })).toBeVisible()
  })

  test('Pengaturan shows the switch, always on in Mode Demo', async ({ page }) => {
    await page.goto('/pengaturan')
    const box = page.getByRole('checkbox', { name: 'Tombol cepat' })
    await expect(box).toBeChecked()
    await expect(box).toBeDisabled()
    await expect(page.getByText(/Selalu aktif di Mode Demo/)).toBeVisible()
  })
})
