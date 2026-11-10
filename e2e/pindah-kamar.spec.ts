import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.22 Pindah kamar from the room board: the same lease in another room, or another kind of stay (check-out + new lease)
test.describe('Pindah kamar (SPEC 7.22)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('from the board: the same stay moves to an empty room', async ({ page }) => {
    const kos = page.getByRole('region', { name: 'Kamar Kos Melati' })
    const occupied = kos.getByTestId('board-tile').and(page.locator('[data-tone="occupied"]')).first()
    const from = (await occupied.getAttribute('data-room'))!
    const to = (await kos.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first().getAttribute('data-room'))!
    await occupied.click()
    await page.getByRole('dialog').getByRole('link', { name: 'Pindah kamar' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Pindah kamar' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /\(tetap\)/ })).toHaveAttribute('aria-checked', 'true')
    const pick = dialog.getByLabel('Kamar tujuan').locator('option', { hasText: new RegExp(`^${to}\\b`) }).first()
    await dialog.getByLabel('Kamar tujuan').selectOption((await pick.getAttribute('value'))!)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Pindahkan' }).click()
    await expect(page.getByText(`Pindah ke kamar ${to} dicatat.`)).toBeVisible()
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${from}"]`)).toHaveAttribute('data-tone', 'vacant')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${to}"]`)).not.toHaveAttribute('data-tone', 'vacant')
  })

  test('another kind of stay: check-out of the old lease, then Sewa baru preset with tenant, room, type and day', async ({ page }) => {
    const kos = page.getByRole('region', { name: 'Kamar Kos Melati' })
    const occupied = kos.getByTestId('board-tile').and(page.locator('[data-tone="occupied"]')).first()
    const from = (await occupied.getAttribute('data-room'))!
    const to = (await kos.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first().getAttribute('data-room'))!
    await occupied.click()
    const tenantName = await page.getByRole('dialog').getByTestId('board-current-tenant').locator('p').nth(1).innerText()
    await page.getByRole('dialog').getByRole('link', { name: 'Pindah kamar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Pindah kamar' })).toBeVisible()
    // the demo tenants are monthly: the guest goes on per week in the new room
    await dialog.getByRole('radio', { name: 'Mingguan' }).click()
    await expect(dialog.getByTestId('move-change-type-note')).toContainText('sewa mingguan baru')
    const option = dialog.getByLabel('Kamar tujuan').locator('option', { hasText: new RegExp(`^${to}\\b`) }).first()
    await dialog.getByLabel('Kamar tujuan').selectOption((await option.getAttribute('value'))!)
    // the demo tenant has paid for this month: the paid nights are taken off the new stay's price
    await expect(dialog.getByTestId('move-unused')).toContainText('sudah dibayar')
    await dialog.getByRole('button', { name: /^Potong Rp/ }).click()

    const checkout = page.getByRole('dialog')
    await expect(checkout.getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
    await checkout.getByRole('button', { name: 'Selesaikan checkout' }).click()
    await page.waitForURL(/\/sewa\/baru\?/)
    expect(new URL(page.url()).searchParams.get('jenis')).toBe('weekly')
    expect(new URL(page.url()).searchParams.get('mulai')).toBe('2026-11-10')
    await expect(page.getByText(`Langkah 2: buat sewa mingguan di kamar ${to}.`)).toBeVisible()
    await expect(page.getByText(tenantName).first()).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${to}\\b`) })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('radiogroup', { name: 'Jenis sewa' }).getByRole('radio', { name: /Mingguan/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByLabel('Tanggal check-in')).toHaveValue('2026-11-10')
    // the old room is free again
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${from}"]`)).toHaveAttribute('data-tone', 'vacant')
  })
})

// SPEC 7.24: nights already paid in the old stay when the guest moves into another kind of stay (the owner's example:
// 3 nights paid, moving after 2)
test.describe('Pindah kamar dengan sisa malam yang sudah dibayar (SPEC 7.24)', () => {
  test.use({ timezoneId: 'Asia/Jakarta' })

  async function threeNightsThenDayThree(page: Page): Promise<{ from: string; to: string }> {
    await page.clock.setFixedTime(new Date('2026-11-10T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    const kos = page.getByRole('region', { name: 'Kamar Kos Melati' })
    const vacant = kos.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]'))
    const from = (await vacant.nth(0).getAttribute('data-room'))!
    const to = (await vacant.nth(1).getAttribute('data-room'))!
    // 3 nights (10, 11, 12 Nov) for Rp 450.000, paid in full
    await vacant.nth(0).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama penyewa').fill('Tamu Tiga Malam')
    await form.getByLabel('Jumlah malam').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('3')
    await form.getByLabel('Total bayar').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('450000')
    await expect(form.getByText('= Rp 150.000 / malam')).toBeVisible()
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    // the third day: two nights used, one paid night left
    await page.clock.setFixedTime(new Date('2026-11-12T10:00:00+07:00'))
    await page.goto('/dashboard')
    await expect(page.getByTestId('room-board')).toBeVisible()
    await page.locator(`[data-testid="board-tile"][data-room="${from}"]`).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Pindah kamar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Pindah kamar' })).toBeVisible()
    // same kind of stay: no question about paid nights (the lease just changes rooms)
    await expect(dialog.getByTestId('move-unused')).toHaveCount(0)
    await dialog.getByRole('radio', { name: 'Mingguan' }).click()
    await expect(dialog.getByTestId('move-unused')).toContainText('Sisa 1 malam sudah dibayar (Rp 150.000), sampai malam 12 Nov')
    await expect(dialog.getByText('Pilih kamar tujuan dulu.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Lanjut: check-out' })).toHaveCount(0)
    const option = dialog.getByLabel('Kamar tujuan').locator('option', { hasText: new RegExp(`^${to}\\b`) }).first()
    await dialog.getByLabel('Kamar tujuan').selectOption((await option.getAttribute('value'))!)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    return { from, to }
  }

  test('"Potong dari harga": the week starts today and its first invoice is Rp 150.000 less', async ({ page }) => {
    const { from, to } = await threeNightsThenDayThree(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Potong Rp 150.000 dari harga mingguan' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Selesaikan checkout' }).click()
    await page.waitForURL(/\/sewa\/baru\?/)
    const q = new URL(page.url()).searchParams
    expect([q.get('jenis'), q.get('mulai'), q.get('potong'), q.get('malam')]).toEqual(['weekly', '2026-11-12', '150000', '1'])
    const credit = page.getByTestId('lease-credit')
    await expect(credit).toContainText('Potongan sisa 1 malam sewa lama')
    await expect(credit).toContainText('− Rp 150.000')
    // total = the week's price minus the credit
    const week = Number((await page.getByText(/^Mingguan 1 minggu/).locator('xpath=..').innerText()).replace(/\D/g, '').slice(1))
    const total = Number((await page.getByText('Total tagihan pertama').locator('xpath=..').innerText()).replace(/\D/g, ''))
    expect(week).toBeGreaterThan(150_000)
    expect(total).toBe(week - 150_000)
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${from}"]`)).toHaveAttribute('data-tone', 'vacant')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${to}"]`)).toHaveAttribute('data-tone', 'vacant')
  })

  test('"Pakai dulu": the guest moves now, the old stay is checked out the day after the paid night, the week starts then at full price', async ({ page }) => {
    const { from, to } = await threeNightsThenDayThree(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Pakai dulu: mingguan mulai 13 Nov' }).click()
    await expect(page.getByText(`Pindah ke kamar ${to} dicatat. Lanjut: check-out 13 Nov, lalu sewa baru.`)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Selesaikan checkout' }).click()
    await page.waitForURL(/\/sewa\/baru\?/)
    const q = new URL(page.url()).searchParams
    expect([q.get('jenis'), q.get('mulai'), q.get('potong')]).toEqual(['weekly', '2026-11-13', null])
    await expect(page.getByTestId('lease-credit')).toHaveCount(0)
    await expect(page.getByLabel('Tanggal check-in')).toHaveValue('2026-11-13')
    // the room card is free from 13 Nov for the new stay
    await expect(page.getByRole('button', { name: new RegExp(`^${to}\\b`) })).toHaveAttribute('aria-pressed', 'true')
    // today the guest is in the new room for his last paid night; the old room is free
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${from}"]`)).toHaveAttribute('data-tone', 'vacant')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${to}"]`)).not.toHaveAttribute('data-tone', 'vacant')
  })
})
