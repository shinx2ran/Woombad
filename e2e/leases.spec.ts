import { test, expect, type Page } from '@playwright/test'

const PHONE = { width: 412, height: 839 }

async function openLeases(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await page.goto('/sewa')
  await expect(page.getByTestId('lease-row').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('lease-row')

/** One attribute of every row, in display order. */
function attribute(page: Page, name: string): Promise<(string | null)[]> {
  return rows(page).evaluateAll((els, attr) => els.map((el) => el.getAttribute(attr)), name)
}

/** data-days of the rows that have one (finished leases and leases without a due date carry none). */
async function days(page: Page): Promise<number[]> {
  return (await attribute(page, 'data-days')).filter((d): d is string => d !== null).map(Number)
}

test.describe('Daftar sewa ringkas (SPEC 7.1)', () => {
  test('a phone screen shows at least six lease rows without scrolling', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openLeases(page)
    // The one-time "belum pernah dicadangkan" card of the app shell is dismissable; the Mode Demo bar stays.
    const reminder = page.getByRole('button', { name: 'Tutup pengingat' })
    if (await reminder.isVisible()) await reminder.click()
    await expect(reminder).toHaveCount(0)
    const bottoms = await rows(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom))
    expect(bottoms.length).toBeGreaterThanOrEqual(6)
    expect(bottoms.filter((b) => b <= PHONE.height).length).toBeGreaterThanOrEqual(6)
    // every row names its room and tenant
    expect(await attribute(page, 'data-room')).not.toContain(null)
    expect(await attribute(page, 'data-tenant')).not.toContain(null)
  })

  test('Nama penyewa sorts the rows A-Z', async ({ page }) => {
    await openLeases(page)
    await page.getByLabel('Urutkan sewa').selectOption({ label: 'Nama penyewa' })
    await expect(page).toHaveURL(/urut=nama/)
    const names = (await attribute(page, 'data-tenant')).filter((n): n is string => n !== null)
    expect(names.length).toBeGreaterThan(1)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' })))
  })

  test('Sisa hari paling banyak is the mirror image of paling sedikit', async ({ page }) => {
    await openLeases(page)
    await expect(page.getByLabel('Urutkan sewa')).toHaveValue('jatuh-tempo')
    const fewest = await days(page)
    expect(fewest.length).toBeGreaterThan(1)
    expect(fewest).toEqual([...fewest].sort((a, b) => a - b))
    await page.getByLabel('Urutkan sewa').selectOption({ label: 'Sisa hari paling banyak' })
    await expect(page).toHaveURL(/urut=jatuh-tempo-terjauh/)
    await expect.poll(() => days(page)).toEqual([...fewest].reverse())
  })

  test('an iPad held upright (768px) still shows every tenant name and nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await openLeases(page)
    const names = await rows(page).evaluateAll((els) => els.map((el) => (el.querySelector('[data-testid="lease-tenant"]') as HTMLElement).getBoundingClientRect().width))
    expect(names.length).toBeGreaterThan(1)
    for (const w of names) expect(w).toBeGreaterThan(60)
    // the menu button sits beside the row, never on top of the day count
    const first = rows(page).first()
    const days = await first.locator('a > span').last().boundingBox()
    const menu = await first.getByRole('button', { name: /^Aksi sewa/ }).boundingBox()
    expect(menu!.x).toBeGreaterThanOrEqual(days!.x + days!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('a narrow phone (360px) never cuts the amount owed', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await openLeases(page)
    // the amount span must end inside its line box (only the period/kos tail may truncate)
    const clipped = await rows(page).evaluateAll((els) =>
      els.map((el) => {
        const amount = el.querySelector('[data-testid="lease-amount"]') as HTMLElement
        const line = amount.parentElement as HTMLElement
        return amount.getBoundingClientRect().right > line.getBoundingClientRect().right + 0.5
      }),
    )
    expect(clipped).not.toContain(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('tapping a row opens the lease', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openLeases(page)
    const first = rows(page).first()
    const room = await first.getAttribute('data-room')
    await first.getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByRole('heading', { name: `Kamar ${room}` })).toBeVisible()
  })
})
