import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test('a tenant without a phone: the WhatsApp bubble opens the form at Nomor HP, then becomes WhatsApp', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
  await page.setViewportSize({ width: 360, height: 780 })
  await loginDemo(page)

  // a 2-night guest without a phone: checks out in 2 days, so listed under "Akan berakhir"
  await page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Nama penyewa').fill('Tanpa Nomor')
  await form.getByLabel('Jumlah malam').click()
  await page.keyboard.type('2')
  await form.getByRole('button', { name: 'Simpan check-in' }).click()
  await page.waitForURL(/\/sewa\/[^/]+$/)

  await page.goto('/dashboard')
  const fill = page.getByRole('link', { name: 'Nomor HP Tanpa Nomor belum diisi: isi sekarang' })
  await expect(fill).toBeVisible()
  await fill.click()

  await page.waitForURL(/\/penyewa\/[^/?]+\?isi=hp$/)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Ubah Penyewa' })).toBeVisible()
  const phone = dialog.getByLabel('Nomor HP / WhatsApp')
  await expect(phone).toBeFocused()
  await expect(dialog.getByText(/Isi nomor HP supaya pengingat WhatsApp bisa dikirim/)).toBeVisible()
  await page.keyboard.type('081234567890')
  await dialog.getByRole('button', { name: 'Simpan' }).click()
  await expect(dialog).toBeHidden()
  // the form does not reopen on reload
  await expect(page).toHaveURL(/\/penyewa\/[^/?]+$/)

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: 'Nomor HP Tanpa Nomor belum diisi: isi sekarang' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Tanya perpanjangan lewat WhatsApp ke Tanpa Nomor' })).toHaveAttribute('href', /^https:\/\/wa\.me\/6281234567890\?text=/)
})
