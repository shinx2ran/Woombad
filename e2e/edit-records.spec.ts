import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Ubah pembayaran & tagihan (SPEC 7.5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    // a fresh guest: 2 nights, recorded as 360.000 paid in full
    const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama penyewa').fill('Salah Ketik')
    await form.getByLabel('Jumlah malam').click()
    await page.keyboard.type('2')
    await form.getByLabel('Total bayar').fill('360000')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
  })

  test('a payment typed wrong is corrected from the ✏️ button; the invoice follows', async ({ page }) => {
    await page.getByRole('button', { name: 'Ubah pembayaran' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Ubah pembayaran' })).toBeVisible()
    await expect(dialog.getByText('Paling banyak Rp 360.000')).toBeVisible()
    // unchanged: nothing to save
    await expect(dialog.getByRole('button', { name: 'Simpan' })).toBeDisabled()

    // more than the invoice is refused with the reason
    await dialog.getByLabel('Jumlah').fill('400000')
    await expect(dialog.getByRole('alert')).toHaveText(/Jumlah melebihi sisa tagihan INV-\S+ \(Rp 360\.000\)\./)
    await expect(dialog.getByRole('button', { name: 'Simpan' })).toBeDisabled()

    // the guest actually paid 300.000 by transfer
    await dialog.getByLabel('Jumlah').fill('300000')
    await dialog.getByLabel('Metode').selectOption('transfer')
    await expect(dialog.getByText(/Mode Demo tidak mencatat riwayat/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('Pembayaran diperbarui.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Rp 300.000').filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByText('Sebagian').filter({ visible: true }).first()).toBeVisible()
  })

  test('the rent of one invoice is corrected from Ubah; the invoice becomes paid', async ({ page }) => {
    // first make the payment smaller, then the rent matches it
    await page.getByRole('button', { name: 'Ubah pembayaran' }).first().click()
    await page.getByRole('dialog').getByLabel('Jumlah').fill('300000')
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.getByRole('button', { name: /^Aksi tagihan/ }).first().click()
    await page.getByRole('menuitem', { name: /^Ubah/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Ubah tagihan INV-/ })).toBeVisible()
    const rent = dialog.getByLabel('Harga sewa (tagihan ini)')
    await expect(rent).toHaveValue(/360/)
    // below what is already paid is refused
    await rent.fill('250000')
    await expect(dialog.getByText('Total tidak boleh lebih kecil dari yang sudah dibayar (Rp 300.000).')).toBeVisible()
    await rent.fill('300000')
    await expect(dialog.getByText(/Sebelumnya Rp 360\.000/)).toBeVisible()
    await expect(dialog.getByText(/Mode Demo tidak mencatat riwayat/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('Tagihan diperbarui.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Lunas', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  })
})
