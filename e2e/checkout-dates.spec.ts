import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** The dialog is kept for a human look (test-results is git-ignored). */
const SHOT_PATH = join(process.cwd(), 'test-results', 'checkout-dates.png')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Tanggal check-out (SPEC 7.3)', () => {
  test('2 malam from 15 Okt read 15 Okt – 17 Okt, and a typed end date is the check-out day', async ({ page }) => {
    // The demo's daily guest (room 102) stays from 4 days before today to 3 days after: with today = 11 Okt that is
    // 7 Okt – 14 Okt as last night, so the next period starts on 15 Okt like the owner's screenshot.
    await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
    await loginDemo(page)
    await page.goto('/sewa')

    const row = page.locator('[data-testid="lease-row"][data-room="102"]')
    await expect(row).toContainText('lunas s/d 15 Okt')
    await expect(row).toContainText('check-out')
    await row.getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Kamar 102' })).toBeVisible()

    await page.getByRole('button', { name: 'Buat tagihan berikutnya' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Periode berikutnya mulai')).toContainText('15 Okt 2026')

    // the owner's case: 2 nights from 15 Okt -> check-out 17 Okt, next period 17 Okt – 18 Okt
    const qty = dialog.getByLabel('Jumlah periode (malam)')
    await qty.click()
    await page.keyboard.type('2')
    const draft = dialog.getByTestId('invoice-draft')
    await expect(draft).toContainText('Sewa 2 malam')
    await expect(draft).toContainText('15 Okt – 17 Okt 2026')
    await expect(draft).toContainText(/Check-out menjadi\s*17 Okt 2026/)
    await expect(dialog.getByTestId('following-period')).toContainText('17 Okt – 18 Okt 2026')
    mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
    await dialog.screenshot({ path: SHOT_PATH })

    // a typed end date is the day the tenant leaves: check-out 20 Okt = 5 nights (15-19 Okt)
    await dialog.getByLabel('atau sampai tanggal check-out').fill('2026-10-20')
    await expect(dialog.getByText('Dihitung 5 malam, check-out 20 Okt 2026')).toBeVisible()
    await expect(qty).toHaveValue('5')
    await expect(draft).toContainText('15 Okt – 20 Okt 2026')
    await expect(draft).toContainText(/Check-out menjadi\s*20 Okt 2026/)

    // the day the next period starts is not a check-out day of this one (0 nights)
    await dialog.getByLabel('atau sampai tanggal check-out').fill('2026-10-15')
    await expect(dialog.getByText('Tanggal check-out harus setelah 15 Okt 2026.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Buat tagihan' })).toBeDisabled()

    await dialog.getByLabel('atau sampai tanggal check-out').fill('2026-10-17')
    await expect(qty).toHaveValue('2')
    await dialog.getByRole('button', { name: 'Buat tagihan' }).click()
    await expect(page.getByText(/Sewa diperpanjang, check-out 17 Okt 2026/)).toBeVisible()
    // "Kirim tagihan" follows; the invoice image is kept for a human look
    await expect(dialog.getByRole('heading', { name: /^Kirim tagihan INV-/ })).toBeVisible()
    const preview = dialog.getByRole('img', { name: 'Pratinjau tagihan' })
    await expect.poll(() => preview.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBeGreaterThan(600)
    await preview.screenshot({ path: join(process.cwd(), 'test-results', 'checkout-dates-invoice.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // the new invoice is listed with its check-out day
    await expect(page.getByText('15 Okt – 17 Okt 2026 · 2 malam')).toBeVisible()
    await expect(page.getByText('Ditagih s/d 17 Okt 2026')).toBeVisible()
  })

  test('a stay cancelled on its first day shows no check-out day, in the dialog and after saving', async ({ page }) => {
    // the demo's daily guest in 102 checked in 4 days before today (7 Okt with today = 11 Okt), paid in full, no deposit
    await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
    await loginDemo(page)
    await page.goto('/sewa')
    await page.locator('[data-testid="lease-row"][data-room="102"]').getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)

    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    await page.getByRole('menuitem', { name: /Batalkan sewa/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Tanggal pembatalan/).fill('2026-10-07')
    await expect(dialog.getByText('Belum ada malam menginap')).toBeVisible()
    await dialog.getByRole('button', { name: 'Batalkan sewa' }).click()
    await expect(page.getByText('Sewa dibatalkan.')).toBeVisible()

    // end_date is clamped to the start day for the DB only: the lease ends on 7 Okt, not 'Berakhir 8 Okt'
    await expect(page.getByText('Berakhir', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('7 Okt 2026', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('8 Okt 2026', { exact: true })).toHaveCount(0)
    await page.goto('/sewa')
    await page.getByRole('tab', { name: /Selesai\/Batal/ }).click()
    await expect(page.locator('[data-testid="lease-row"][data-room="102"]')).toContainText('Berakhir 7 Okt 2026')
  })
})
