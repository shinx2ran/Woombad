import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** Phone screenshots for a human look; RENCANA_SHOTS picks another folder (test-results is git-ignored). */
const SHOTS = process.env.RENCANA_SHOTS ?? join(process.cwd(), 'test-results', 'rencana')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const freeRooms = (page: Page) => page.getByTestId('free-room').evaluateAll((els) => els.map((e) => e.getAttribute('data-room')))

test.use({ timezoneId: 'Asia/Jakarta' })

// Mode Demo on 23 Okt 2026: Kos Melati A3 (Rp 100.000 / malam) and B3 (Rp 120.000) are empty; in Kos Anggrek Hendra's
// daily stay in 102 ends with check-out 27 Okt; every other room has a monthly tenant or is under repair. Daftar tunggu:
// Rina (Kos Melati, 25 Okt, 2 malam, maks. Rp 110.000), Joko (Kos Anggrek, mingguan) and Wulan (batal).
test.describe('Rencana check-in & daftar tunggu (SPEC 7.7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    mkdirSync(SHOTS, { recursive: true })
  })

  test('Harian: free rooms best fit first, Pesan books the room (Dipesan), the same dates are then refused', async ({ page }) => {
    await loginDemo(page)
    const card = page.getByTestId('waitlist-card')
    await expect(card).toHaveText(/Daftar tunggu: 2 orang · 1 ada kamar cocok/)
    expect(await noSideScroll(page)).toBe(true)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(SHOTS, 'dashboard-card.png') })

    await page.getByRole('link', { name: 'Cek kamar kosong' }).click()
    await page.waitForURL(/\/rencana/)
    await expect(page.getByRole('heading', { name: 'Cek kamar & pesan' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Harian' })).toHaveAttribute('aria-checked', 'true')
    await page.getByLabel('Check-in').fill('2026-10-27')
    await page.getByLabel('Jumlah malam').fill('2')
    await expect(page.getByTestId('planner-checkout')).toContainText('Check-out Kamis, 29 Okt 2026 · 2 malam')

    // 102 is free from Hendra's check-out day (no idle night), then the rooms empty since today, cheaper first
    await expect(page.getByTestId('free-room')).toHaveCount(3)
    expect(await freeRooms(page)).toEqual(['102', 'A3', 'B3'])
    const first = page.getByTestId('free-room').first()
    await expect(first).toContainText('Kosong sampai seterusnya')
    await expect(first).toContainText('Hendra Wijaya masih menginap, jadwal check-out 27 Okt')
    await expect(first).toContainText('Rp 260.000')
    const a3 = page.locator('[data-testid="free-room"][data-room="A3"]')
    await expect(a3).toContainText('Rp 200.000')
    await expect(a3).toContainText('Rp 100.000 / malam')
    await expect(a3.getByRole('img')).toHaveAttribute('aria-label', /^Ketersediaan 14 hari mulai 27 Okt: 27 Okt – 9 Nov kosong$/)
    expect(await noSideScroll(page)).toBe(true)
    await page.getByRole('heading', { name: /Kosong untuk seluruh tanggal/ }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(SHOTS, 'planner-harian.png') })

    await a3.getByRole('button', { name: 'Pesan kamar A3' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Pesan · Kamar A3' })).toBeVisible()
    await expect(sheet.getByTestId('booking-summary')).toContainText('27 Okt – 29 Okt 2026 · 2 malam')
    await expect(sheet.getByTestId('booking-summary')).toContainText('Check-out 29 Okt 2026')
    await sheet.getByLabel('Nama penyewa').fill('Taufik Hidayat')
    await expect(sheet.getByText('HP belum diisi: boleh nanti, lengkapi di halaman penyewa.')).toBeVisible()
    await expect(sheet.getByLabel('Total 2 malam')).toHaveValue('200.000')
    await sheet.getByLabel('DP / sudah dibayar (opsional)').fill('50000')
    await sheet.getByRole('radio', { name: 'Transfer' }).click()
    await expect(sheet.getByText(/Batalkan sewa/)).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
    await sheet.getByTestId('booking-summary').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(SHOTS, 'booking-sheet.png') })
    await sheet.getByRole('button', { name: 'Simpan pesanan' }).click()

    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText(/Kamar A3 dipesan 27 Okt – 29 Okt 2026\. Tagihan INV-\S+ DP Rp 50\.000\. HP penyewa belum diisi/)).toBeVisible()
    await expect(page.getByText('Dipesan · mulai 27 Okt')).toBeVisible()
    await expect(page.getByText('Taufik Hidayat').first()).toBeVisible()

    // the room board shows the booking, and the planner no longer offers A3 for those nights
    await page.goto('/dashboard')
    await expect(page.locator('[data-testid="board-tile"][data-room="A3"]')).toHaveAttribute('data-tone', 'reserved')
    await page.goto('/rencana?jenis=harian&mulai=2026-10-27&jumlah=2')
    await expect(page.getByTestId('free-room')).toHaveCount(2)
    expect(await freeRooms(page)).toEqual(['102', 'B3'])
    // asked for that room only (room board: Pesan tanggal lain), it says who has it
    await page.goto('/dashboard')
    await page.locator('[data-testid="board-tile"][data-room="A3"]').click()
    await page.getByRole('dialog').getByRole('link', { name: 'Pesan tanggal lain' }).click()
    await page.waitForURL(/\/rencana\?.*kamar=/)
    await page.getByLabel('Check-in').fill('2026-10-28')
    await expect(page.getByTestId('taken-room')).toContainText('Dipesan Taufik Hidayat 27–29 Okt')
    await expect(page.getByText('Kamar A3 tidak kosong untuk tanggal ini')).toBeVisible()
  })

  test('Daftar tunggu: live matches, Kabari on WhatsApp, Pesan turns the entry into a booking', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/daftar-tunggu')
    await expect(page.getByRole('heading', { name: 'Daftar tunggu' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Menunggu (2)' })).toHaveAttribute('aria-selected', 'true')
    const entries = page.getByTestId('waitlist-entry')
    // soonest wanted day first: Joko (24 Okt) before Rina (25 Okt)
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toHaveAttribute('data-name', 'Joko Susilo')
    await expect(entries.nth(0).getByTestId('waitlist-match')).toHaveText('Belum ada kamar')
    const rina = page.locator('[data-testid="waitlist-entry"][data-name="Rina Kartika"]')
    await expect(rina.getByTestId('waitlist-match')).toHaveText('Kamar cocok: A3 (Rp 200.000)')
    await expect(rina).toContainText('Mulai 25 Okt 2026 · 2 malam (check-out 27 Okt 2026) · maks. Rp 110.000 / malam')
    expect(await noSideScroll(page)).toBe(true)
    await page.screenshot({ path: join(SHOTS, 'waitlist.png') })

    const kabari = rina.getByRole('link', { name: 'Kabari' })
    const href = (await kabari.getAttribute('href')) ?? ''
    expect(href).toMatch(/^https:\/\/wa\.me\/6281234567811\?text=/)
    const text = decodeURIComponent(href.split('?text=')[1])
    expect(text).toContain('Halo Kak Rina, ini dari Kos Melati.')
    expect(text).toContain('kamar A3 kosong untuk 25 Okt 2026 – 27 Okt 2026 (2 malam, check-out 27 Okt 2026)')
    expect(text).toContain('Harganya Rp 200.000 untuk 2 malam.')

    // nothing free within budget: the planner offers the daftar tunggu, prefilled with the dates
    await page.goto('/rencana?jenis=harian&mulai=2026-10-30&jumlah=3&maks=50000')
    await expect(page.getByText('Tidak ada kamar kosong untuk seluruh tanggal')).toBeVisible()
    await page.getByRole('button', { name: 'Masukkan ke daftar tunggu' }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByLabel('Tanggal check-in')).toHaveValue('2026-10-30')
    await expect(form.getByLabel('Jumlah malam')).toHaveValue('3')
    await expect(form.getByLabel('Maks. / malam')).toHaveValue('50.000')
    await form.getByLabel('Nama').fill('Sinta Dewi')
    await form.getByLabel('Nomor HP').fill('0812-1111-2222')
    await form.getByRole('button', { name: 'Simpan' }).click()
    await page.waitForURL(/\/daftar-tunggu$/)
    await expect(page.getByRole('tab', { name: 'Menunggu (3)' })).toBeVisible()
    await expect(page.locator('[data-testid="waitlist-entry"][data-name="Sinta Dewi"]').getByTestId('waitlist-match')).toHaveText('Belum ada kamar')

    // Pesan: the planner opens for Rina, the sheet is filled in, and the entry becomes a booking
    await rina.getByRole('link', { name: 'Pesan' }).click()
    await page.waitForURL(/\/rencana\?.*tunggu=/)
    await expect(page.getByTestId('planner-waitlist-entry')).toContainText('Memesan untuk daftar tunggu: Rina Kartika')
    expect(await freeRooms(page)).toEqual(['A3'])
    await page.getByRole('button', { name: 'Pesan kamar A3' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByLabel('Nama penyewa')).toHaveValue('Rina Kartika')
    await expect(sheet.getByLabel('Nomor HP')).toHaveValue('+6281234567811')
    await sheet.getByRole('button', { name: 'Simpan pesanan' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText('Dipesan · mulai 25 Okt')).toBeVisible()

    await page.goto('/daftar-tunggu')
    await expect(page.getByRole('tab', { name: 'Menunggu (2)' })).toBeVisible()
    await expect(page.locator('[data-testid="waitlist-entry"][data-name="Rina Kartika"]')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Sudah dipesan (1)' }).click()
    await expect(page.locator('[data-testid="waitlist-entry"][data-name="Rina Kartika"]').getByRole('link', { name: 'Lihat sewa' })).toBeVisible()
  })

  test('Mingguan: a guest leaving mid-stay is "Hampir cocok" with the reason; the pages render without errors at 360 px', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    await loginDemo(page)
    await page.goto('/sewa')
    await expect(page.getByRole('link', { name: 'Cek kamar' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Daftar tunggu' })).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)

    await page.getByRole('link', { name: 'Cek kamar' }).click()
    await page.waitForURL(/\/rencana/)
    await page.getByRole('radio', { name: 'Mingguan' }).click()
    await page.getByLabel('Check-in').fill('2026-10-24')
    await expect(page.getByTestId('planner-checkout')).toContainText('Check-out Sabtu, 31 Okt 2026 · 7 malam')
    expect(await freeRooms(page)).toEqual(['A3', 'B3'])
    await expect(page.locator('[data-testid="free-room"][data-room="A3"]')).toContainText('Rp 600.000')
    const partial = page.locator('[data-testid="partial-room"][data-room="102"]')
    await expect(partial).toContainText('Ditempati Hendra Wijaya sampai 27 Okt, lalu kosong 27–31 Okt')
    await expect(partial).toContainText('4 dari 7 malam')
    expect(await noSideScroll(page)).toBe(true)
    await page.goto('/daftar-tunggu?status=cancelled')
    await expect(page.locator('[data-testid="waitlist-entry"][data-name="Wulan Sari"]')).toContainText('HP belum diisi')
    expect(await noSideScroll(page)).toBe(true)
    expect(errors, errors.join('\n')).toEqual([])
  })
})
