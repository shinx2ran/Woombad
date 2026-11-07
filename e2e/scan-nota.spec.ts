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

    await expect(sheet.getByTestId('scan-included')).toHaveText('Dicentang: 8 baris · Rp 2.098.500')

    // "Foto ulang" by mistake: the result checked so far comes back
    await sheet.getByRole('button', { name: 'Foto ulang' }).click()
    await sheet.getByRole('button', { name: 'Kembali ke hasil sebelumnya' }).click()
    await expect(rows).toHaveCount(8)

    // no kos chosen yet (filter is "Semua kos"): refused with the reason
    await sheet.getByRole('button', { name: 'Simpan 8 pengeluaran' }).click()
    await expect(page.getByText('Pilih kos untuk pengeluaran ini.')).toBeVisible()
    await sheet.getByLabel('Kos *', { exact: true }).selectOption({ label: 'Kos Melati' })

    // leave one line out
    await rows.filter({ hasText: 'Upah bersih selokan' }).getByRole('checkbox').uncheck()
    // the ticked total follows; the paper's total still counts every line read
    await expect(sheet.getByTestId('scan-included')).toHaveText('Dicentang: 7 baris · Rp 1.998.500')
    await expect(sheet.getByTestId('scan-total-ok')).toBeVisible()
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

  // SPEC 7.17 Kredit Claude: what each scan cost, and an estimate of the credit left (Anthropic has no balance API)
  test('the owner sees what each scan cost and the credit left, and sets the monthly credit and renewal day', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.getByRole('button', { name: 'Scan nota' }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByTestId('scan-input').setInputFiles(PHOTO)
    await expect(sheet.getByTestId('scan-row')).toHaveCount(8)
    // 2,500 tokens in × $4 + 3,500 out × $20 per million = US$0.08, a labelled sample in Mode Demo
    await expect(sheet.getByTestId('scan-cost')).toHaveText('Biaya scan ini: US$0,08 (contoh)')
    // a second reading is a second cost, even when nothing is saved
    await sheet.getByRole('button', { name: 'Foto ulang' }).click()
    await sheet.getByTestId('scan-input').setInputFiles(PHOTO)
    await expect(sheet.getByTestId('scan-row')).toHaveCount(8)
    await sheet.getByRole('button', { name: 'Batal' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.goto('/pengaturan')
    await expect(page.getByRole('heading', { name: 'Kredit Claude' })).toBeVisible()
    await expect(page.getByTestId('credit-demo-note')).toBeVisible()
    // Claude Max by default: US$100 renewing on the 1st; 2 scans of US$0.08 since 1 Nov
    const remaining = page.getByTestId('credit-remaining')
    await expect(remaining).toContainText('US$99,84')
    await expect(remaining).toContainText('dari US$100,00 · diperbarui tiap tgl 1 (berikutnya 1 Des 2026)')
    await expect(page.getByTestId('credit-cycle')).toHaveText('Sejak 1 Nov 2026: 2 scan · US$0,16 · rata-rata US$0,08 per scan')
    const scans = page.getByTestId('scan-usage-row')
    await expect(scans).toHaveCount(2)
    await expect(scans.first()).toContainText('8 baris · catatan tulisan tangan')
    await expect(scans.first()).toContainText('US$0,08')
    await expect(scans.first()).toContainText('demo@woombad.local · 7 Nov 2026, 10.00 · claude-opus-5-5')
    const link = page.getByTestId('credit-console-link')
    await expect(link).toHaveAttribute('href', 'https://platform.claude.com/settings/billing')
    await expect(link).toHaveAttribute('target', '_blank')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // the owner's real renewal day and a smaller credit
    const save = page.locator('form').filter({ hasText: 'Pengaturan kredit' }).getByRole('button', { name: 'Simpan' })
    await expect(save).toBeDisabled()
    await page.getByLabel('Tanggal pembaruan').fill('15')
    await page.getByLabel('Kredit per bulan (US$)').fill('5')
    await save.click()
    await expect(page.getByText('Pengaturan kredit disimpan.')).toBeVisible()
    await expect(remaining).toContainText('US$4,84')
    await expect(remaining).toContainText('dari US$5,00 · diperbarui tiap tgl 15 (berikutnya 15 Nov 2026)')
    await expect(page.getByTestId('credit-cycle')).toContainText('Sejak 15 Okt 2026: 2 scan')

    // kept after a reload
    await page.reload()
    await expect(page.getByTestId('credit-remaining')).toContainText('US$4,84')
    await expect(page.getByLabel('Tanggal pembaruan')).toHaveValue('15')
    expect(errors).toEqual([])
  })

  test('staff see neither the cost of a scan nor the Kredit Claude card', async ({ page }) => {
    await page.evaluate(() => {
      const raw = localStorage.getItem('woombad.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await expect(page.getByRole('link', { name: 'Laporan' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Scan nota' }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByTestId('scan-input').setInputFiles(PHOTO)
    await expect(sheet.getByTestId('scan-row')).toHaveCount(8)
    await expect(sheet.getByTestId('scan-cost')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Batal' }).click()
    await page.goto('/pengaturan')
    await expect(page.getByRole('heading', { name: 'Pengaturan', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kredit Claude' })).toHaveCount(0)
  })
})
