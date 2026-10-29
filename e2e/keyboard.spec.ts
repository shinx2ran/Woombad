import { test, expect, type Locator, type Page } from '@playwright/test'

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
  // the sheet rises for half a second (SPEC 7.9): measure where it settles
  await page.getByRole('dialog').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
}

/** Share of the element the user can see: clipped by every scrolling box up to the dialog and by the keyboard. */
function visibleShare(field: Locator, keyboardHeight: number): Promise<number> {
  return field.evaluate((el, kb) => {
    const r = el.getBoundingClientRect()
    let top = Math.max(r.top, 0)
    let bottom = Math.min(r.bottom, window.innerHeight - kb)
    for (let n = el.parentElement; n && n.getAttribute('role') !== 'dialog'; n = n.parentElement) {
      if (getComputedStyle(n).overflowY === 'visible') continue
      const c = n.getBoundingClientRect()
      top = Math.max(top, c.top)
      bottom = Math.min(bottom, c.bottom)
    }
    return Math.max(0, bottom - top) / r.height
  }, keyboardHeight)
}

test.describe('Dialog dan keyboard layar', () => {
  test('the add-room sheet moves above the keyboard and keeps Catatan in view', async ({ page }) => {
    await withFakeKeyboard(page)
    await openAddRoom(page)
    const dialog = page.getByRole('dialog')
    const notes = dialog.getByLabel('Catatan')
    await notes.focus()
    await keyboard(page, KEYBOARD)
    // in view as soon as the keyboard is up, before typing (typing makes the browser scroll to the caret by itself)
    expect(await visibleShare(notes, KEYBOARD)).toBeCloseTo(1, 2)
    await notes.pressSequentially('AC, kamar mandi dalam')
    expect(await visibleShare(notes, KEYBOARD)).toBeCloseTo(1, 2)
    // the title and the save button stay on screen too
    expect(await visibleShare(dialog.getByRole('heading', { name: 'Tambah Kamar' }), KEYBOARD)).toBeCloseTo(1, 2)
    expect(await visibleShare(dialog.getByRole('button', { name: 'Tambah Kamar' }), KEYBOARD)).toBeCloseTo(1, 2)
    await expect(dialog).not.toHaveAttribute('data-compact')

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

  test('a phone held sideways scrolls the whole sheet so the field still shows', async ({ page }) => {
    const LANDSCAPE_KEYBOARD = 230
    await page.setViewportSize({ width: 839, height: 412 })
    await withFakeKeyboard(page)
    await openAddRoom(page)
    const dialog = page.getByRole('dialog')
    const notes = dialog.getByLabel('Catatan')
    await notes.focus()
    await keyboard(page, LANDSCAPE_KEYBOARD)
    await expect(dialog).toHaveAttribute('data-compact')
    expect(await visibleShare(notes, LANDSCAPE_KEYBOARD)).toBeCloseTo(1, 2)
    // moving to another field brings that one into view as well
    const name = dialog.getByLabel('Nama kamar')
    await name.focus()
    await expect.poll(() => visibleShare(name, LANDSCAPE_KEYBOARD)).toBeCloseTo(1, 2)
    await keyboard(page, 0)
    await expect(dialog).not.toHaveAttribute('data-compact')
  })
})
