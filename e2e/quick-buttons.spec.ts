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
    // paid to the night of 12 Okt: next due (check-out) 13 Okt, 2 days away -> orange with the days left
    await expect(taken).toHaveAttribute('data-tone', 'soon')
    await expect(taken).toContainText('2 hari')
    await taken.click()
    const sheet2 = page.getByRole('dialog')
    await expect(sheet2).toContainText('Taufik Kusnadi')
    await expect(sheet2.getByRole('link', { name: /HP belum diisi/ })).toBeVisible()
    await sheet2.getByRole('link', { name: 'Check-out' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
  })

  test('a room with rent owed opens the existing payment dialog', async ({ page }) => {
    // past due: a solid red tile captioned Telat
    const owing = tiles(page).and(page.locator('[data-tone="overdue"]')).first()
    await expect(owing).toContainText(/Telat/i)
    await expect(owing).toHaveCSS('background-color', /rgb\(2\d\d, \d+, \d+\)|oklch/)
    await owing.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText(/Sisa Rp/)
    await expect(sheet).toContainText(/Telat \d+ hari · jatuh tempo/)
    // the same pre-filled WhatsApp reminder as on the lease list, one tap away
    const wa = sheet.getByRole('link', { name: 'Kirim pengingat WhatsApp' })
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/62\d+\?text=/)
    expect(decodeURIComponent((await wa.getAttribute('href'))!)).toMatch(/Tagihan kamar \S+ periode .* jatuh tempo/)
    await sheet.getByRole('link', { name: 'Bayar' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Catat pembayaran' })).toBeVisible()
  })

  test('a room due within the week offers the WhatsApp reminder; a safe room does not', async ({ page }) => {
    const soon = tiles(page).and(page.locator('[data-tone="soon"]')).first()
    await expect(soon).toContainText(/\d+ hari|Hari ini/)
    await soon.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('link', { name: 'Kirim pengingat WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\//)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await tiles(page).and(page.locator('[data-tone="occupied"]')).first().click()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Perpanjang' })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Kirim pengingat WhatsApp' })).toHaveCount(0)
  })

  test('due today has its own orange-red tile, softer than the solid red of TELAT', async ({ page }) => {
    // the demo's daily guest in 102 was seeded paid to the night of 14 Okt (today = 11 Okt): due 15 Okt
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00+07:00'))
    await page.goto('/dashboard')
    const today = page.locator('[data-testid="board-tile"][data-room="102"]')
    await expect(today).toHaveAttribute('data-tone', 'today')
    await expect(today).toContainText('Hari ini')
    const late = tiles(page).and(page.locator('[data-tone="overdue"]')).first()
    const bg = (l: typeof late) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(today)).not.toBe(await bg(late))
    await expect(page.getByRole('list', { name: 'Keterangan warna' })).toContainText('Jatuh tempo hari ini (1)')
    await today.click()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Kirim pengingat WhatsApp' })).toBeVisible()
  })

  test('released: the board is a regular part of the Dashboard, with no experiment switch or badge', async ({ page }) => {
    await expect(page.getByTestId('room-board')).toBeVisible()
    await expect(page.getByTestId('room-board').getByText('Percobaan', { exact: true })).toHaveCount(0)
    await page.goto('/pengaturan')
    await expect(page.getByRole('heading', { name: 'Pengaturan' })).toBeVisible()
    await expect(page.getByText('Fitur percobaan')).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Tombol cepat' })).toHaveCount(0)
  })

  test('long room names wrap to two lines on a 360px phone instead of being cut to the same "Kama…"', async ({ page }) => {
    await expect(page.getByTestId('room-board')).toBeVisible()
    const names = ['Kamar 12', 'Kamar 13', 'Melati 3']
    await page.evaluate((renamed) => {
      const raw = localStorage.getItem('woombad.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      db.rooms.slice(0, renamed.length).forEach((r: { name: string }, i: number) => (r.name = renamed[i]))
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    }, names)
    await page.reload()
    for (const name of names) {
      const label = page.locator(`[data-testid="board-tile"][data-room="${name}"] [data-testid="board-tile-name"]`)
      await expect(label).toHaveText(name)
      const clip = await label.evaluate((el) => ({ w: el.scrollWidth - el.clientWidth, h: el.scrollHeight - el.clientHeight }))
      expect(clip, name).toEqual({ w: 0, h: 0 })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
