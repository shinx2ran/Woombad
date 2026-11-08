import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made with the date of the dashboard's first draw (SPEC 7.9)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.18 Ringkasan WhatsApp: the board's news as a message for the wife or the staff group.
test.describe('Ringkasan WA dari papan kamar (SPEC 7.18)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-11T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
    // the demo's daily guest in 102 is paid to the night of 14 Okt: on 15 Okt the stay ends that day
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00+07:00'))
    await page.goto('/dashboard')
    await expect(page.locator('[data-testid="board-tile"][data-room="102"]')).toHaveAttribute('data-tone', 'today')
  })

  test('the message lists the late rooms and today\'s, opens WhatsApp with it, and can be edited first', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.getByTestId('board-summary-open').click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Kirim ringkasan ke WhatsApp' })).toBeVisible()
    const field = sheet.getByTestId('board-summary-text')
    const text = await field.inputValue()

    // title: all kos shown, so the organisation, and the day in Indonesian
    expect(text.split('\n')[0]).toMatch(/^\*.+\* · Kamis, 15 Okt 2026$/)
    // a block per kos with news
    expect(text).toMatch(/\n_Kos [^_]+_\n/)
    // the daily stay in 102 ends today
    expect(text).toMatch(/• Kamar 102 \([^)]+\) habis sewa hari ini \(harian\)/)
    // every red tile is one line under "Telat bayar"
    const late = await page.locator('[data-testid="board-tile"][data-tone="overdue"]').count()
    expect(late).toBeGreaterThan(0)
    expect(text.match(/• Kamar \S+ \([^)]+\) telat \d+ hari \((harian|mingguan|bulanan)\)/g) ?? []).toHaveLength(late)
    // the owner's closing line
    expect(text.endsWith('\n\nMohon ditindaklanjuti.')).toBe(true)

    // "Buka WhatsApp": no number, so WhatsApp asks which chat or group; the text goes along
    const open = sheet.getByTestId('board-summary-whatsapp')
    await expect(open).toHaveAttribute('target', '_blank')
    const href = (await open.getAttribute('href')) ?? ''
    const PREFIX = 'https://api.whatsapp.com/send?text='
    expect(href.startsWith(PREFIX)).toBe(true)
    expect(decodeURIComponent(href.slice(PREFIX.length))).toBe(text)

    // edited before sending: the link follows
    await field.fill(`${text}\n\nTolong ditagih ya.`)
    expect(decodeURIComponent(((await open.getAttribute('href')) ?? '').slice(PREFIX.length))).toContain('Tolong ditagih ya.')
    // emptied: nothing to send
    await field.fill('')
    await expect(open).toHaveAttribute('aria-disabled', 'true')
    // still a link for screen readers (no href, so an explicit role), announced as disabled like Salin
    await expect(sheet.getByRole('link', { name: 'Buka WhatsApp' })).toHaveAttribute('aria-disabled', 'true')
    await expect(sheet.getByRole('button', { name: 'Salin' })).toBeDisabled()

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await sheet.getByRole('button', { name: /Tutup/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('one kos chosen: that kos as the title, no kos headings', async ({ page }) => {
    const filter = page.getByRole('combobox', { name: 'Pilih kos' }).filter({ visible: true }).first()
    const options = await filter.locator('option').allInnerTexts()
    const kos = options.find((o) => o.startsWith('Kos '))
    test.skip(!kos, 'the demo has no named kos option')
    await filter.selectOption({ label: kos! })
    await page.getByTestId('board-summary-open').click()
    const text = await page.getByRole('dialog').getByTestId('board-summary-text').inputValue()
    expect(text.startsWith(`*${kos}* · Kamis, 15 Okt 2026`)).toBe(true)
    expect(text).not.toMatch(/\n_Kos [^_]+_\n/)
  })
})
