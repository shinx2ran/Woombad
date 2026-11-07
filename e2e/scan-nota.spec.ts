import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/** a 1×1 PNG: in Mode Demo the photo is not read, the review shows the labelled sample */
const PHOTO = {
  name: 'catatan-oktober.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.16 Scan nota: photo → lines to check → expenses. Mode Demo reads a made-up sample month (it says so).
test.describe('Scan nota (SPEC 7.16)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-07T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    await page.goto('/pengeluaran')
    await expect(page.getByRole('heading', { name: 'Pengeluaran', level: 1 })).toBeVisible()
  })

  test('a page of expenses becomes checked rows, then expenses in October; a second scan flags what is already recorded', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.getByRole('button', { name: 'Scan nota' }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Scan nota' })).toBeVisible()
    await expect(sheet).toContainText('Mode Demo: foto tidak dikirim')
    await sheet.getByTestId('scan-input').setInputFiles(PHOTO)

    // the review: sample note, 8 lines, the total on the paper matches
    await expect(sheet.getByTestId('scan-demo-note')).toBeVisible()
    const rows = sheet.getByTestId('scan-row')
    await expect(rows).toHaveCount(8)
    await expect(sheet.getByTestId('scan-summary')).toContainText('8 baris terbaca')
    await expect(sheet.getByTestId('scan-total-ok')).toContainText('Rp 2.098.500')
    // the hard-to-read line starts open, with what was read on the photo
    const unclear = rows.filter({ hasText: 'Servis pompa air' })
    await expect(unclear).toContainText('Periksa: tulisan kurang jelas')
    await expect(unclear).toContainText('Terbaca di foto: “18/10 Servis pompa air 175.0?0”')
    await expect(unclear.getByLabel('Jumlah')).toHaveValue('175.000')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // a misread corrected shows on the total check; put it back
    await unclear.getByLabel('Jumlah').fill('175900')
    await expect(sheet.getByTestId('scan-total-mismatch')).toContainText('selisih Rp 900')
    await unclear.getByLabel('Jumlah').fill('175000')
    await expect(sheet.getByTestId('scan-total-ok')).toBeVisible()

    // no kos chosen yet (filter is "Semua kos"): refused with the reason
    await sheet.getByRole('button', { name: 'Simpan 8 pengeluaran' }).click()
    await expect(page.getByText('Pilih kos untuk pengeluaran ini.')).toBeVisible()
    await sheet.getByLabel('Kos *', { exact: true }).selectOption({ label: 'Kos Melati' })

    // leave one line out
    await rows.filter({ hasText: 'Upah bersih selokan' }).getByRole('checkbox').uncheck()
    await sheet.getByRole('button', { name: 'Simpan 7 pengeluaran' }).click()
    await expect(page.getByText('7 pengeluaran dicatat dari scan nota.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the page moves to the scanned month
    await expect(page.getByText('Menampilkan Oktober 2026.')).toBeVisible()
    // phone list (the desktop table is in the page too, hidden at 360 px)
    await expect(page.getByText('Token listrik bawah tangga').filter({ visible: true })).toBeVisible()
    await expect(page.getByText('Upah bersih selokan')).toHaveCount(0)

    // the same page again: the 7 saved lines are flagged and unticked, only the one left out is offered
    await page.getByRole('button', { name: 'Scan nota' }).first().click()
    await page.getByRole('dialog').getByTestId('scan-input').setInputFiles(PHOTO)
    const again = page.getByRole('dialog')
    await expect(again.getByTestId('scan-row')).toHaveCount(8)
    await expect(again.getByText('Mungkin sudah tercatat')).toHaveCount(7)
    await expect(again.getByRole('button', { name: 'Simpan 1 pengeluaran' })).toBeVisible()
    await again.getByRole('button', { name: 'Batal' }).click()
    expect(errors).toEqual([])
  })

  test('the Catat form offers Scan nota; a line without a date must be completed or left out', async ({ page }) => {
    await page.getByRole('button', { name: 'Catat pengeluaran' }).first().click()
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: 'Catat pengeluaran' })).toBeVisible()
    await form.getByRole('button', { name: /Scan nota/ }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Scan nota' })).toBeVisible()
    await sheet.getByTestId('scan-input').setInputFiles(PHOTO)
    await expect(sheet.getByTestId('scan-row')).toHaveCount(8)

    await sheet.getByLabel('Kos *', { exact: true }).selectOption({ label: 'Bersama (semua kos)' })
    const first = sheet.getByTestId('scan-row').first()
    await first.getByRole('button', { name: /Token listrik bawah tangga/ }).click()
    await first.getByLabel('Tanggal').fill('')
    await sheet.getByRole('button', { name: 'Simpan 8 pengeluaran' }).click()
    await expect(first).toContainText('Isi tanggalnya.')
    await expect(page.getByText('Lengkapi baris yang ditandai merah, atau hapus centangnya.')).toBeVisible()
    await first.getByRole('checkbox').uncheck()
    await sheet.getByRole('button', { name: 'Simpan 7 pengeluaran' }).click()
    await expect(page.getByText('7 pengeluaran dicatat dari scan nota.')).toBeVisible()
  })
})
