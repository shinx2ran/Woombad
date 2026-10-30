import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

const tiles = (page: Page) => page.getByTestId('board-tile')
const tileOf = (page: Page, tenant: string) => page.locator(`[data-testid="board-tile"][aria-label*="(${tenant})"]`)
const fitsPage = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** no plate on the board is cut (an ellipsis would hide its letters), and the page is not wider than the phone */
async function expectPlatesWhole(page: Page) {
  const cut = await page.getByTestId('board-tile-plate').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent))
  expect(cut).toEqual([])
  expect(await fitsPage(page)).toBe(true)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Nomor kendaraan (SPEC 7.11)', () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    // a React error in a sheet (e.g. two tile lines with one key) fails the test even when the screen looks right
    errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.clock.setFixedTime(new Date('2026-10-30T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test.afterEach(() => {
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('the room board shows each plate on its tile, whole on a 360px phone, and in the tile\'s sheet', async ({ page }) => {
    const budi = tileOf(page, 'Budi Santoso')
    await expect(budi.getByTestId('board-tile-plate')).toHaveText('KB 1234 AB')
    // screen readers hear it with the room
    expect(await budi.getAttribute('aria-label')).toContain(', kendaraan KB 1234 AB')
    // two vehicles: one plate per line
    await expect(tileOf(page, 'Rizky Maulana').getByTestId('board-tile-plate')).toHaveText(['B 9012 XYZ', 'KB 5678 CD'])
    // every plate fits its tile uncut, and nothing widens the page
    await expectPlatesWhole(page)
    // a tenant without a vehicle has no plate line
    await expect(tileOf(page, 'Siti Rahayu').getByTestId('board-tile-plate')).toHaveCount(0)
    await expect(tiles(page).and(page.locator('[data-tone="vacant"]')).first().getByTestId('board-tile-plate')).toHaveCount(0)

    await tileOf(page, 'Rizky Maulana').click()
    await expect(page.getByRole('dialog').getByTestId('board-vehicle-plate')).toHaveText('No. kendaraan B 9012 XYZ, KB 5678 CD')
  })

  test('check-in cepat takes an optional plate, written as plates are; it reaches the lease and the board', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    const roomName = (await vacant.getAttribute('data-room'))!
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: `Check-in cepat · Kamar ${roomName}` })).toBeVisible()

    await form.getByLabel('Nama penyewa').fill('Taufik Kusnadi')
    const plate = form.getByLabel('No. kendaraan (plat)')
    // not required: the field says so, and the phone's keyboard types capitals
    await expect(plate).not.toHaveAttribute('required')
    await expect(plate).toHaveAttribute('autocapitalize', 'characters')
    await plate.fill('kb.1442.gz.')
    await plate.blur()
    await expect(plate).toHaveValue('KB 1442 GZ')
    await form.getByLabel('Total bayar').fill('180000')
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Kendaraan KB 1442 GZ')

    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByRole('heading', { name: `Kamar ${roomName}` })).toBeVisible()
    await expect(page.getByTestId('lease-vehicle-plate')).toHaveText('KB 1442 GZ')

    await page.goto('/dashboard')
    const taken = page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`)
    await expect(taken.getByTestId('board-tile-plate')).toHaveText('KB 1442 GZ')
    await taken.click()
    await expect(page.getByRole('dialog').getByTestId('board-vehicle-plate')).toContainText('KB 1442 GZ')
  })

  test('check-in cepat without a plate saves as before', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    const roomName = (await vacant.getAttribute('data-room'))!
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama penyewa').fill('Tanpa Motor')
    await form.getByLabel('Total bayar').fill('180000')
    await expect(form.getByTestId('quick-checkin-summary')).not.toContainText('Kendaraan')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByTestId('lease-vehicle-plate')).toHaveText('Belum diisi')
    await page.goto('/dashboard')
    await expect(page.locator(`[data-testid="board-tile"][data-room="${roomName}"]`).getByTestId('board-tile-plate')).toHaveCount(0)
  })

  test('the lease page fills in, changes and clears the plate; the board follows', async ({ page }) => {
    await tileOf(page, 'Siti Rahayu').click()
    await page.getByRole('dialog').getByRole('link', { name: 'Lihat detail sewa' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    const shown = page.getByTestId('lease-vehicle-plate')
    await expect(shown).toHaveText('Belum diisi')

    await page.getByRole('button', { name: 'Isi no. kendaraan' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: /^No\. kendaraan · Kamar / })).toBeVisible()
    const input = sheet.getByLabel('No. kendaraan (plat)')
    await expect(input).toBeFocused()
    // nothing changed yet: nothing to save
    await expect(sheet.getByRole('button', { name: 'Simpan' })).toBeDisabled()
    // the widest plates of the owner's list, two vehicles
    await input.fill('b 1251 sga / kb1829gn')
    await sheet.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('No. kendaraan Siti Rahayu: B 1251 SGA, KB 1829 GN.')).toBeVisible()
    await expect(shown).toHaveText('B 1251 SGA, KB 1829 GN')

    await page.goto('/dashboard')
    await expect(tileOf(page, 'Siti Rahayu').getByTestId('board-tile-plate')).toHaveText(['B 1251 SGA', 'KB 1829 GN'])
    await expectPlatesWhole(page)
    await page.goBack()
    await page.waitForURL(/\/sewa\/[^/]+$/)

    // the same sheet from Lainnya, at the top of the page
    await page.getByRole('button', { name: 'Aksi sewa' }).click()
    await page.getByRole('menuitem', { name: /No\. kendaraan/ }).click()
    const again = page.getByRole('dialog')
    await expect(again.getByLabel('No. kendaraan (plat)')).toHaveValue('B 1251 SGA, KB 1829 GN')
    await again.getByLabel('No. kendaraan (plat)').fill('')
    await again.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('No. kendaraan Siti Rahayu dikosongkan.')).toBeVisible()
    await expect(shown).toHaveText('Belum diisi')
    await page.goto('/dashboard')
    await expect(tileOf(page, 'Siti Rahayu').getByTestId('board-tile-plate')).toHaveCount(0)
  })

  test('Sewa baru has the same optional field; the plate is saved with the lease', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    const roomName = (await vacant.getAttribute('data-room'))!
    await vacant.click()
    await page.getByRole('dialog').getByRole('link', { name: 'Form lengkap' }).click()
    await page.waitForURL(/\/sewa\/baru\?room=/)
    await page.getByRole('button', { name: 'Isi sendiri' }).click()
    await page.getByLabel('Nama lengkap').fill('Gilang Ramadhan')
    await page.getByLabel('Nomor HP (WhatsApp)').fill('081234567890')
    const field = page.getByLabel('No. kendaraan (plat)')
    await expect(field).not.toHaveAttribute('required')
    await expect(field).toHaveAttribute('placeholder', 'mis. KB 1442 GZ')
    await field.fill('kb 8297 gt')
    await page.getByRole('radio', { name: /^Belum bayar/ }).check()
    await page.getByRole('button', { name: 'Simpan & check-in' }).click()
    await page.waitForURL(/\/sewa\/(?!baru)[^/?]+$/)
    await expect(page.getByRole('heading', { name: `Kamar ${roomName}` })).toBeVisible()
    await expect(page.getByTestId('lease-vehicle-plate')).toHaveText('KB 8297 GT')
  })

  test('the lease list finds a tenant by plate, typed without spaces', async ({ page }) => {
    await page.goto('/sewa')
    await page.getByLabel('Cari sewa').fill('kb1234')
    await expect(page.getByText('Budi Santoso').locator('visible=true').first()).toBeVisible()
    await expect(page.getByText('Siti Rahayu').locator('visible=true')).toHaveCount(0)
    // the row says why it was found
    await expect(page.getByTestId('lease-plate')).toHaveText('KB 1234 AB')
    // a name search shows no plate
    await page.getByLabel('Cari sewa').fill('budi')
    await expect(page.getByText('Budi Santoso').locator('visible=true').first()).toBeVisible()
    await expect(page.getByTestId('lease-plate')).toHaveCount(0)
  })
})
