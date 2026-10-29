import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** Phone screenshots for a human look; REDATE_SHOTS picks another folder (test-results is git-ignored). */
const SHOTS = process.env.REDATE_SHOTS ?? join(process.cwd(), 'test-results', 'redate')
/** the phone project's screenshots in SHOTS, the motion project's (frames mid-animation) beside them */
const shotsDir = () => (test.info().project.name === 'phone' ? SHOTS : join(SHOTS, test.info().project.name))

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Ubah tanggal mulai sewa (SPEC 7.6)', () => {
  test('a monthly lease typed 14 days late is moved back; the preview shows it all and the next bill follows the new dates', async ({ page }) => {
    // The demo's monthly leases started 5 months and 3 days before today: with today = 23 Okt that is 20 Mei, billed
    // monthly through 19 Nov (6 invoices). Siti (A2) paid five of them; the October bill (due 20 Okt) is open.
    await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    mkdirSync(shotsDir(), { recursive: true })
    await loginDemo(page)
    await page.goto('/sewa')
    await page.locator('[data-testid="lease-row"][data-room="A2"]').getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Kamar A2' })).toBeVisible()
    await expect(page.getByText('Mulai 20 Mei 2026')).toBeVisible()

    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    const item = page.getByRole('menuitem', { name: /Ubah tanggal mulai/ })
    await expect(item).toContainText('Salah input tanggal mulai? Semua periode tagihan ikut digeser')
    await item.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Ubah tanggal mulai sewa' })).toBeVisible()
    await expect(dialog.getByTestId('redate-current')).toHaveText('20 Mei 2026')
    const save = dialog.getByRole('button', { name: 'Simpan perubahan' })
    await expect(save).toBeDisabled()

    // the tenant really moved in 14 days earlier
    await dialog.getByLabel('Tanggal mulai yang benar').fill('2026-05-06')
    const preview = dialog.getByTestId('redate-preview')
    await expect(preview).toBeVisible()
    const rows = preview.getByTestId('redate-invoice')
    await expect(rows).toHaveCount(6)
    await expect(rows.first().getByTestId('redate-period')).toContainText('20 Mei – 20 Jun 2026')
    await expect(rows.first().getByTestId('redate-period')).toContainText('6 Mei – 6 Jun 2026')
    await expect(rows.last().getByTestId('redate-period')).toContainText('20 Okt – 20 Nov 2026')
    await expect(rows.last().getByTestId('redate-period')).toContainText('6 Okt – 6 Nov 2026')
    await expect(rows.last()).toContainText('jatuh tempo 20 Okt → 6 Okt')
    await expect(rows.last()).toContainText('Rp 1.200.000 · dibayar Rp 0 · tidak berubah')
    const summary = dialog.getByTestId('redate-summary')
    await expect(summary).toContainText(/Check-out\s*20 Nov 2026\s*6 Nov 2026/)
    await expect(summary).toContainText(/Dibayar s\/d\s*20 Okt 2026\s*6 Okt 2026/)
    await expect(dialog.getByTestId('redate-next')).toHaveText('6 Nov – 6 Des 2026')
    await expect(dialog.getByTestId('redate-state-before')).toHaveText('Sekarang: lewat 3 hari (tenggang) · sisa Rp 1.200.000')
    await expect(dialog.getByTestId('redate-state-after')).toHaveText('Setelah diubah: telat 17 hari · sisa Rp 1.200.000')
    await expect(dialog.getByTestId('redate-warning')).toHaveCount(0)
    await dialog.getByLabel(/Alasan/).fill('salah input bulan')
    await expect(dialog.getByTestId('redate-note')).toContainText('Tanggal mulai dikoreksi dari 20 Mei 2026 ke 6 Mei 2026 (23 Okt 2026): salah input bulan')
    await expect(save).toBeEnabled()
    expect(await noSideScroll(page)).toBe(true)
    // the 360 x 780 phone view: the summary of the change, then the invoice list
    await summary.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), 'redate-dialog.png') })
    await rows.nth(3).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), 'redate-dialog-invoices.png') })

    await save.click()
    await expect(page.getByText('Tanggal mulai diubah ke 6 Mei 2026; 6 tagihan ikut digeser.')).toBeVisible()
    await expect(dialog).toBeHidden()

    // the lease page shows the new dates
    await expect(page.getByText('Mulai 6 Mei 2026')).toBeVisible()
    await expect(page.getByText('6 Okt – 6 Nov 2026 · 1 bulan')).toBeVisible()
    await expect(page.getByText('6 Mei – 6 Jun 2026 · 1 bulan')).toBeVisible()
    await expect(page.getByText(/Tanggal mulai dikoreksi dari 20 Mei 2026 ke 6 Mei 2026 \(23 Okt 2026\): salah input bulan/)).toBeVisible()
    await expect(page.getByText('Terlambat', { exact: true }).first()).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(shotsDir(), 'redate-lease-page.png') })
    await page.getByText('6 Okt – 6 Nov 2026 · 1 bulan').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), 'redate-lease-invoices.png') })

    // "Tagih": the next invoice continues on the new grid, from 6 Nov
    await page.getByRole('button', { name: 'Buat tagihan berikutnya' }).first().click()
    const next = page.getByRole('dialog')
    await expect(next.getByText('Periode berikutnya mulai')).toContainText('6 Nov 2026')
    await expect(next.getByTestId('invoice-draft')).toContainText('6 Nov – 6 Des 2026')
    await next.getByRole('button', { name: 'Buat tagihan' }).click()
    await expect(page.getByText(/Sewa diperpanjang, check-out 6 Des 2026/)).toBeVisible()
    await expect(next.getByRole('heading', { name: /^Kirim tagihan INV-/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(next).toBeHidden()
    await expect(page.getByText('6 Nov – 6 Des 2026 · 1 bulan')).toBeVisible()
    await expect(page.getByText('Ditagih s/d 6 Des 2026')).toBeVisible()
  })

  test('a start inside the previous stay of the room is refused with that tenant and dates; ended leases have no such item', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    // the daily guest in 102 (Hendra, since 19 Okt) leaves today; a new guest checks in to 102 right after
    await page.goto('/sewa')
    await page.locator('[data-testid="lease-row"][data-room="102"]').getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Checkout/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Selesaikan checkout' }).click()
    await expect(page.getByText('Checkout dicatat. Sewa selesai.')).toBeVisible()
    // an ended lease keeps its dates: no menu at all any more (no Ubah tanggal mulai)
    await expect(page.getByRole('button', { name: 'Aksi sewa', exact: true })).toHaveCount(0)

    await page.goto('/dashboard')
    await page.locator('[data-testid="board-tile"][data-room="102"]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama penyewa').fill('Tamu Baru')
    await form.getByLabel('Jumlah malam').click()
    await page.keyboard.type('2')
    await form.getByLabel('Total bayar').fill('260000')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)

    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    await page.getByRole('menuitem', { name: /Ubah tanggal mulai/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('redate-current')).toHaveText('23 Okt 2026')
    const save = dialog.getByRole('button', { name: 'Simpan perubahan' })
    // two days earlier would put both guests in 102 on 21-22 Okt
    await dialog.getByLabel('Tanggal mulai yang benar').fill('2026-10-21')
    await expect(dialog.getByRole('alert')).toHaveText('Bentrok dengan sewa Hendra Wijaya di kamar ini (19 Okt – 23 Okt 2026). Pilih tanggal lain.')
    await expect(save).toBeDisabled()
    // a day later is free: 2 nights move with the start
    await dialog.getByLabel('Tanggal mulai yang benar').fill('2026-10-24')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByTestId('redate-period').first()).toContainText('24 Okt – 26 Okt 2026')
    await expect(dialog.getByTestId('redate-invoice').first()).toContainText('2 malam')
    await expect(save).toBeEnabled()
    expect(await noSideScroll(page)).toBe(true)
    await save.click()
    await expect(page.getByText('Tanggal mulai diubah ke 24 Okt 2026; 1 tagihan ikut digeser.')).toBeVisible()
    await expect(page.getByText('24 Okt – 26 Okt 2026 · 2 malam')).toBeVisible()
  })
})
