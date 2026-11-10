import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/**
 * Book an empty room from `start` (a copy of a demo lease moved to that room and day), as the Rencana planner would.
 * Returns the room's name.
 */
async function bookRoom(page: Page, start: string, end: string): Promise<string> {
  const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
  const roomName = (await vacant.getAttribute('data-room'))!
  await page.evaluate(
    ({ roomName, start, end }) => {
      const raw = localStorage.getItem('woombad.local.db.v1')
      if (!raw) throw new Error('no demo data')
      const db = JSON.parse(raw)
      const room = db.rooms.find((r: { name: string }) => r.name === roomName)
      const model = db.leases[0]
      db.leases.push({
        ...model,
        id: 'booked-later',
        room_id: room.id,
        property_id: room.property_id,
        period_type: 'daily',
        price_per_period: 150_000,
        deposit_amount: 0,
        start_date: start,
        end_date: end,
        status: 'active',
        checkout_date: null,
        planned_checkout_date: null,
        vehicle_plate: null,
        notes: 'Pesanan',
      })
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    },
    { roomName, start, end },
  )
  await page.reload()
  await expect(page.getByTestId('room-board')).toBeVisible()
  return roomName
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.20: a room booked for later is let until the booked guest arrives (the owner's example: 10A booked for the 15th)
test.describe('Kamar dipesan tetap bisa disewakan sebelum pesanannya (SPEC 7.20)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('the board says when the booking starts and offers Check-in cepat for the nights before it', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const roomName = await bookRoom(page, '2026-11-15', '2026-11-16')

    const tile = page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`)
    await expect(tile).toHaveAttribute('data-tone', 'reserved')
    await expect(tile.getByTestId('board-tile-booked')).toHaveText('Dipesan 15 Nov')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await tile.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: `Kamar ${roomName}` })).toBeVisible()
    await expect(sheet.getByTestId('board-free-until')).toHaveText('Kosong sampai 15 Nov: bisa disewakan maks 5 malam (check-out paling lambat 15 Nov).')
    // SPEC 7.21: nobody is in the room now; the booked guest is named with his stay
    await expect(sheet.getByTestId('board-now')).toHaveText('Sekarang kosong')
    const upcoming = sheet.getByTestId('board-upcoming')
    await expect(upcoming).toContainText('Dipesan oleh')
    await expect(upcoming).toContainText('Mulai 15 Nov 2026 · 15 Nov – 17 Nov 2026 (harian)')
    await expect(sheet.getByTestId('board-current-tenant')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Check-in cepat (sebelum pesanan)' }).click()

    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: `Check-in cepat · Kamar ${roomName}` })).toBeVisible()
    await expect(form.getByTestId('quick-checkin-booking')).toHaveText('Kamar ini dipesan mulai 15 Nov 2026: check-out paling lambat 15 Nov (maks 5 malam).')
    await form.getByLabel('Nama penyewa').fill('Tamu Sela')
    const nights = form.getByLabel('Jumlah malam')

    // 6 nights reach the booked guest's first night: refused, with the day
    await nights.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('6')
    await expect(form.getByRole('alert')).toHaveText(
      `Kamar ${roomName} dipesan mulai 15 Nov 2026: check-out paling lambat 15 Nov 2026. Kurangi lamanya, atau pilih kamar lain.`,
    )
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await expect(form.getByRole('heading', { name: `Check-in cepat · Kamar ${roomName}` })).toBeVisible()

    // 5 nights: check-out 15 Nov, the day the booked guest arrives
    await nights.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('5')
    await expect(form.getByRole('alert')).toHaveCount(0)
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Check-out 15 Nov 2026')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText(new RegExp(`Check-in kamar ${roomName} tersimpan`))).toBeVisible()

    // the room is now occupied tonight, and the booking is still there
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`)).not.toHaveAttribute('data-tone', 'reserved')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`)).not.toHaveAttribute('data-tone', 'vacant')
    // the sheet now names both: the guest staying, and the booking that follows
    // SPEC 7.23: two colours on the tile: its own, and a violet band for the booking that follows
    await expect(page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`).getByTestId('board-tile-booked-next')).toBeVisible()
    await expect(page.getByTestId('board-legend-booked-next')).toHaveText('Garis ungu: ada pesanan berikutnya (1)')
    await page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`).click()
    const both = page.getByRole('dialog')
    await expect(both.getByTestId('board-current-tenant')).toHaveText('Penyewa sekarangTamu Sela')
    await expect(both.getByTestId('board-upcoming')).toContainText('Pesanan berikutnya')
    await expect(both.getByTestId('board-upcoming')).toContainText('Mulai 15 Nov 2026')
    await expect(both.getByRole('link', { name: 'Lihat pesanan' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })

  test('a booking that starts tomorrow still leaves tonight; Sewa baru offers the room for a stay that ends in time', async ({ page }) => {
    const roomName = await bookRoom(page, '2026-11-11', '2026-11-12')
    await page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`).click()
    await expect(page.getByRole('dialog').getByTestId('board-free-until')).toContainText('maks 1 malam')

    // the full form (Sewa baru, the room preset): a month runs into the booking, a night does not
    const roomId = await page.evaluate((name) => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      return db.rooms.find((r: { name: string }) => r.name === name).id as string
    }, roomName)
    await page.goto(`/sewa/baru?room=${roomId}`)
    const card = page.getByRole('button', { name: new RegExp(`^${roomName}\\b`) })
    await expect(card).toContainText('Dipesan')
    await expect(card.getByTestId('room-booked-from')).toHaveText('Dipesan mulai 11 Nov')
    await expect(page.getByText('Kamar dipesan mulai 11 Nov 2026: check-out paling lambat 11 Nov 2026.', { exact: false })).toHaveCount(0)
    await page.getByRole('radiogroup', { name: 'Jenis sewa' }).getByRole('radio', { name: /Harian/ }).click()
    await expect(card).toBeEnabled()
    await expect(card).toContainText('Kosong')
    await expect(card.getByTestId('room-booked-from')).toHaveText('Dipesan mulai 11 Nov')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
