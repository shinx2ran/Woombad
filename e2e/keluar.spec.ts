import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** Phone screenshots for a human look; KELUAR_SHOTS picks another folder (test-results is git-ignored). */
const SHOTS = process.env.KELUAR_SHOTS ?? join(process.cwd(), 'test-results', 'keluar')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
/** scroll an element to just under the sticky app header (top bar + Mode Demo bar) for a screenshot */
const scrollUnderHeader = (page: Page, name: RegExp) =>
  page.getByRole('heading', { name }).evaluate((el) => {
    el.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -112)
  })
const roomsOf = (page: Page, testId: string) => page.getByTestId(testId).evaluateAll((els) => els.map((e) => e.getAttribute('data-room')))

test.use({ timezoneId: 'Asia/Jakarta' })

// Mode Demo on 24 Okt 2026: five monthly tenants (Kos Melati A1 Budi, A2 Siti, B1 Agus; Kos Anggrek 101 Rizky, 201 Putri)
// are billed through the night of 20 Nov (check-out 21 Nov) and have not said whether they extend; Dewi (B2) is paid
// through 13 Nov and has a Rencana keluar on 14 Nov; Hendra's daily stay in 102 ends with check-out 28 Okt; A3 and B3 are
// empty; 202 is under repair.
test.describe('Rencana keluar & "Bisa kosong" (SPEC 7.8)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-24T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    mkdirSync(SHOTS, { recursive: true })
  })

  test('1 night on 24 Des: free rooms say when they empty, monthly rooms are "Bisa kosong"; Tandai akan keluar frees one and Pesan books it', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    await loginDemo(page)
    // the room board shows Dewi's plan on her tile
    const tile = page.locator('[data-testid="board-tile"][data-room="B2"]')
    await expect(tile).toContainText('Keluar 14 Nov')
    await expect(tile).toHaveAttribute('aria-label', 'Kamar B2: Terisi, aman (> 7 hari), akan keluar 14 Nov')
    await tile.click()
    await expect(page.getByRole('dialog').getByTestId('board-planned-checkout')).toHaveText('Akan keluar 14 Nov')
    await page.getByTestId('room-board').evaluate((el) => {
      el.scrollIntoView({ block: 'start' })
      window.scrollBy(0, -112)
    })
    await page.screenshot({ path: join(SHOTS, 'board-sheet.png') })
    await page.keyboard.press('Escape')

    await page.goto('/rencana?jenis=harian&mulai=2026-12-24&jumlah=1')
    await expect(page.getByTestId('planner-checkout')).toContainText('Check-out Jumat, 25 Des 2026 · 1 malam')

    // free: Dewi's room from her planned check-out, Hendra's after his, then the empty rooms; never "sampai seterusnya"
    // next to a guest still staying
    expect(await roomsOf(page, 'free-room')).toEqual(['B2', '102', 'A3', 'B3'])
    const b2 = page.locator('[data-testid="free-room"][data-room="B2"]')
    await expect(b2).toContainText('Kosong mulai 14 Nov (Dewi Lestari akan keluar)')
    await expect(b2).toContainText('Dewi Lestari masih menginap, rencana keluar 14 Nov')
    const r102 = page.locator('[data-testid="free-room"][data-room="102"]')
    await expect(r102).toContainText('Kosong mulai 28 Okt (setelah Hendra Wijaya check-out)')
    await expect(r102).toContainText('Hendra Wijaya masih menginap, jadwal check-out 28 Okt')
    await expect(r102).not.toContainText('Kosong sampai seterusnya')
    await expect(page.locator('[data-testid="free-room"][data-room="A3"]')).toContainText('Kosong sampai seterusnya')
    await expect(page.getByRole('heading', { name: 'Kosong untuk seluruh tanggal (4)' })).toBeVisible()

    // "Bisa kosong": the five monthly rooms paid through 20 Nov (check-out 21 Nov), by room name; no Pesan there
    await expect(page.getByRole('heading', { name: 'Bisa kosong — penyewa bulanan belum konfirmasi (5)' })).toBeVisible()
    expect(await roomsOf(page, 'maybe-free-room')).toEqual(['101', '201', 'A1', 'A2', 'B1'])
    const a1 = page.locator('[data-testid="maybe-free-room"][data-room="A1"]')
    await expect(a1).toContainText('Budi Santoso')
    await expect(a1).toContainText('dibayar s/d 21 Nov')
    await expect(page.locator('[data-testid="maybe-free-room"][data-room="A2"]')).toContainText(/ditagih s\/d 21 Nov · sisa Rp/)
    await expect(a1.getByRole('button', { name: /Pesan/ })).toHaveCount(0)
    const ask = a1.getByRole('link', { name: 'Tanya perpanjang' })
    await expect(ask).toHaveAttribute('href', /^https:\/\/wa\.me\/6281234567801\?text=/)
    expect(decodeURIComponent((await ask.getAttribute('href'))!.split('?text=')[1])).toContain('Masa sewa kamar A1 berakhir pada 21 Nov 2026 (hari check-out).')
    expect(await noSideScroll(page)).toBe(true)

    await scrollUnderHeader(page, /Kosong untuk seluruh tanggal/)
    await page.screenshot({ path: join(SHOTS, 'planner-free.png') })
    await scrollUnderHeader(page, /Bisa kosong/)
    await page.screenshot({ path: join(SHOTS, 'planner-bisa-kosong.png') })

    // Budi says he leaves at the end of his paid month: the sheet starts on his check-out day
    await a1.getByRole('button', { name: 'Tandai Budi Santoso akan keluar' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Rencana keluar · Kamar A1' })).toBeVisible()
    await expect(sheet.getByLabel(/Tanggal keluar/)).toHaveValue('2026-11-21')
    await expect(sheet).toContainText('Ditagih s/d (check-out)21 Nov 2026')
    await expect(sheet).toContainText('Rencana keluar sekarangBelum ada')
    expect(await noSideScroll(page)).toBe(true)
    await page.screenshot({ path: join(SHOTS, 'rencana-keluar-sheet.png') })
    await sheet.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('Rencana keluar Budi Santoso dicatat: check-out 21 Nov 2026.')).toBeVisible()

    // the room moves up to the free list at once
    await expect(page.getByRole('heading', { name: 'Bisa kosong — penyewa bulanan belum konfirmasi (4)' })).toBeVisible()
    expect(await roomsOf(page, 'maybe-free-room')).toEqual(['101', '201', 'A2', 'B1'])
    const freeA1 = page.locator('[data-testid="free-room"][data-room="A1"]')
    await expect(freeA1).toContainText('Kosong mulai 21 Nov (Budi Santoso akan keluar)')
    await expect(page.getByRole('heading', { name: 'Kosong untuk seluruh tanggal (5)' })).toBeVisible()

    // Pesan works: the booking goes through the usual re-check and the database rule (after his billed nights)
    await freeA1.getByRole('button', { name: 'Pesan kamar A1' }).click()
    const booking = page.getByRole('dialog')
    await expect(booking.getByRole('heading', { name: 'Pesan · Kamar A1' })).toBeVisible()
    await booking.getByLabel('Nama penyewa').fill('Tamu Natal')
    await booking.getByRole('button', { name: 'Simpan pesanan' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText('Dipesan · mulai 24 Des')).toBeVisible()
    await expect(page.getByText(/Kamar A1 dipesan 24 Des – 25 Des 2026/)).toBeVisible()

    // Budi's lease says he leaves; the list row too; Tagih warns; Checkout starts on that day
    await page.goto('/sewa')
    const row = page.locator('[data-testid="lease-row"][data-tenant="Budi Santoso"]')
    await expect(row.getByTestId('lease-planned-checkout')).toHaveText('Akan keluar 21 Nov')
    await expect(page.locator('[data-testid="lease-row"][data-tenant="Dewi Lestari"]').getByTestId('lease-planned-checkout')).toHaveText('Akan keluar 14 Nov')
    expect(await noSideScroll(page)).toBe(true)
    await row.getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByTestId('planned-checkout-badge')).toHaveText('Akan keluar 21 Nov')
    await expect(page.getByText('Rencana keluar', { exact: true })).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(SHOTS, 'lease-akan-keluar.png') })

    await page.getByRole('button', { name: 'Buat tagihan berikutnya' }).first().click()
    await expect(page.getByRole('dialog').getByTestId('planned-checkout-warning')).toContainText('Penyewa berencana keluar 21 Nov 2026.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Checkout/ }).click()
    await expect(page.getByRole('dialog').getByLabel(/Tanggal checkout/)).toHaveValue('2026-11-21')
    await page.keyboard.press('Escape')

    // the plan can be cancelled from the lease page (the booking after it stays: extending Budi into it would be refused)
    await page.getByRole('button', { name: 'Aksi sewa', exact: true }).click()
    const item = page.getByRole('menuitem', { name: /Rencana keluar/ })
    await expect(item).toContainText('Keluar 21 Nov 2026 · ubah atau batalkan')
    await item.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Batalkan rencana keluar' }).click()
    await expect(page.getByText('Rencana keluar Budi Santoso dibatalkan.')).toBeVisible()
    await expect(page.getByTestId('planned-checkout-badge')).toHaveCount(0)
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('daftar tunggu: free matches only, with a "+N bisa kosong" hint', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/daftar-tunggu')
    await page.getByRole('button', { name: 'Tambah' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama').fill('Tamu Desember')
    await form.getByLabel('Tanggal check-in').fill('2026-12-24')
    await form.getByRole('button', { name: 'Simpan' }).click()
    const card = page.locator('[data-testid="waitlist-entry"][data-name="Tamu Desember"]')
    await expect(card.getByTestId('waitlist-match')).toHaveText(/^Kamar cocok: B2, 102, A3 \+1 lainnya/)
    await expect(card.getByTestId('waitlist-maybe-free')).toHaveText('+5 bisa kosong')
    expect(await noSideScroll(page)).toBe(true)
  })
})
