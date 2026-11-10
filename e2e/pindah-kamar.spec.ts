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
    await dialog.getByRole('button', { name: 'Lanjut: check-out' }).click()

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
