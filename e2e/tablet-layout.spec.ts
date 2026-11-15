import { test, expect, type Page } from '@playwright/test'
import { fillMoney } from './money'

async function newDailyLease(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
  await vacant.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Nama penyewa').fill('Tamu Tablet')
  await fillMoney(form.getByLabel('Total bayar'), '180000')
  await form.getByRole('button', { name: 'Simpan check-in' }).click()
  await page.waitForURL(/\/sewa\/[^/]+$/)
}

/** The whole menu is on the screen and nothing covers or cuts its corners. */
async function expectMenuWhole(page: Page) {
  const menu = page.getByTestId('action-menu')
  await expect(menu).toBeVisible()
  const whole = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const inside = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
    const corners = [
      [r.left + 4, r.top + 4],
      [r.right - 4, r.top + 4],
      [r.left + 4, r.bottom - 4],
      [r.right - 4, r.bottom - 4],
    ]
    return inside && corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
  })
  expect(whole).toBe(true)
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.28, the owner's iPad: the invoice row was squeezed and its menu cut off
test.describe('Tata letak tablet (SPEC 7.28)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-15T10:00:00+07:00'))
  })

  test('portrait: invoices are a list beside the sidebar, and the row menu is whole', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 })
    await newDailyLease(page)
    const row = page.locator('li', { has: page.getByRole('button', { name: /^Aksi tagihan/ }) })
    await expect(row).toContainText('Lunas')
    // the table is in the page for wide screens, and not shown here
    await expect(page.locator('table')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await row.getByRole('button', { name: /^Aksi tagihan/ }).click()
    await expectMenuWhole(page)
    await expect(page.getByRole('menuitem', { name: /Kirim tagihan/ })).toBeVisible()
    // scrolling the page: the menu follows its button and stays whole; Escape closes it
    await page.mouse.wheel(0, 120)
    await expectMenuWhole(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('action-menu')).toHaveCount(0)
  })

  test('landscape: the table shows, and its row menu is drawn over the table, not cut by it', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await newDailyLease(page)
    const table = page.locator('table')
    await expect(table).toBeVisible()
    await table.getByRole('button', { name: /^Aksi tagihan/ }).click()
    await expectMenuWhole(page)
    await page.getByRole('menuitem', { name: /Kirim tagihan/ }).click()
    await expect(page.getByTestId('action-menu')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
