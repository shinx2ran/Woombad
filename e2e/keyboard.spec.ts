import { test, expect, type Page } from '@playwright/test'

// Headless Chromium has no on-screen keyboard. The page gets a stand-in visualViewport instead, which shrinks the
// way Chrome on Android and Safari on iPhone shrink it when the keyboard opens over the bottom of the page.
const KEYBOARD = 340

async function withFakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    class FakeViewport extends EventTarget {
      width = window.innerWidth
      height = window.innerHeight
      offsetLeft = 0
      offsetTop = 0
      pageLeft = 0
      pageTop = 0
      scale = 1
    }
    const fake = new FakeViewport()
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake })
    ;(window as unknown as { keyboard: (height: number, offsetTop?: number) => void }).keyboard = (height, offsetTop = 0) => {
      fake.height = window.innerHeight - height
      fake.offsetTop = offsetTop
      fake.dispatchEvent(new Event('resize'))
    }
  })
}

async function keyboard(page: Page, height: number, offsetTop = 0) {
  await page.evaluate(([h, t]) => (window as unknown as { keyboard: (h: number, t: number) => void }).keyboard(h, t), [height, offsetTop])
}

async function openAddRoom(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await page.goto('/kos')
  await page.locator('a[href^="/kos/"]').first().click()
  await page.getByRole('button', { name: 'Tambah Kamar' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('Dialog dan keyboard layar', () => {
  test('the add-room sheet moves above the keyboard and keeps Catatan in view', async ({ page }) => {
    await withFakeKeyboard(page)
    await openAddRoom(page)
    const dialog = page.getByRole('dialog')
    const notes = dialog.getByLabel('Catatan')
    await notes.focus()
    await keyboard(page, KEYBOARD)
    await notes.pressSequentially('AC, kamar mandi dalam')

    const visibleBottom = page.viewportSize()!.height - KEYBOARD
    const box = (await notes.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(visibleBottom)
    // the title and the save button stay on screen too
    const title = (await dialog.getByRole('heading', { name: 'Tambah Kamar' }).boundingBox())!
    expect(title.y).toBeGreaterThanOrEqual(0)
    const save = (await dialog.getByRole('button', { name: 'Tambah Kamar' }).boundingBox())!
    expect(save.y + save.height).toBeLessThanOrEqual(visibleBottom)

    // keyboard closes: the sheet is back at the bottom of the screen
    await keyboard(page, 0)
    const sheet = (await dialog.locator(':scope > div').last().boundingBox())!
    expect(Math.round(sheet.y + sheet.height)).toBe(page.viewportSize()!.height)
  })

  test('follows the view when the browser pans it (Safari on iPhone)', async ({ page }) => {
    await withFakeKeyboard(page)
    await openAddRoom(page)
    const dialog = page.getByRole('dialog')
    const name = dialog.getByLabel('Nama kamar')
    await name.focus()
    await keyboard(page, KEYBOARD, 120)
    const overlay = (await dialog.boundingBox())!
    expect(overlay.y).toBe(120)
    expect(overlay.height).toBe(page.viewportSize()!.height - KEYBOARD)
  })
})
