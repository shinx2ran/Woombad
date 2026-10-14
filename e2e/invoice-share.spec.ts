import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/** What the fake navigator.share receives (the OS share sheet is not available to Playwright). */
interface SharedPayload {
  files: { name: string; type: string; size: number }[]
  text?: string
  title?: string
}

/** The rendered invoice is kept for a human look (test-results is git-ignored). */
const PREVIEW_PATH = join(process.cwd(), 'test-results', 'invoice-preview.png')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

test.describe('Kirim tagihan (SPEC 7.2)', () => {
  test.beforeEach(async ({ page }) => {
    // Web Share with files exists on Android Chrome / iOS Safari only; headless Chromium gets a recorder.
    await page.addInitScript(() => {
      const w = window as Window & { __shared?: SharedPayload }
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: { files?: File[]; text?: string; title?: string }) => {
          w.__shared = { files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })), text: data.text, title: data.title }
        },
      })
    })
  })

  test('renders the invoice as a PNG and hands it to the share sheet with the caption', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/sewa')
    const firstRow = page.getByTestId('lease-row').first()
    await expect(firstRow).toBeVisible()
    const tenant = await firstRow.getAttribute('data-tenant')
    await firstRow.getByRole('button', { name: /^Aksi sewa/ }).click()
    await page.getByRole('menuitem', { name: 'Kirim tagihan' }).click()

    const dialog = page.getByRole('dialog')
    const heading = dialog.getByRole('heading', { name: /^Kirim tagihan / })
    await expect(heading).toBeVisible()
    const number = (await heading.textContent())?.replace('Kirim tagihan', '').trim() ?? ''
    expect(number).toMatch(/^INV-/)

    const preview = dialog.getByRole('img', { name: 'Pratinjau tagihan' })
    await expect(preview).toBeVisible()
    await expect(preview).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => preview.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBeGreaterThan(600)
    expect(await preview.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1080)
    await expect(dialog.getByText(`lalu pilih ${tenant}`)).toBeVisible()

    // keep the image for a human look
    const base64 = await preview.evaluate(async (el: HTMLImageElement) => {
      const blob = await (await fetch(el.src)).blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const b of bytes) binary += String.fromCharCode(b)
      return btoa(binary)
    })
    mkdirSync(dirname(PREVIEW_PATH), { recursive: true })
    writeFileSync(PREVIEW_PATH, Buffer.from(base64, 'base64'))

    await dialog.getByRole('button', { name: 'Bagikan ke WhatsApp' }).click()
    const shared = await page.evaluate(() => (window as Window & { __shared?: SharedPayload }).__shared)
    expect(shared).toBeDefined()
    expect(shared!.files).toHaveLength(1)
    expect(shared!.files[0].type).toBe('image/png')
    expect(shared!.files[0].size).toBeGreaterThan(10_000)
    expect(shared!.files[0].name).toBe(`Tagihan-${number}-Kamar-${await firstRow.getAttribute('data-room')}.png`)
    expect(shared!.title).toBe(`Tagihan ${number}`)
    expect(shared!.text).toContain(number)
    expect(shared!.text).toContain('Halo Kak')

    // the fallbacks are there too: download of the same blob, text-only WhatsApp link
    await expect(dialog.getByRole('link', { name: 'Unduh gambar' })).toHaveAttribute('download', /^Tagihan-.*\.png$/)
    await expect(dialog.getByRole('link', { name: 'Kirim teks saja via WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/)
  })

  test('the share button gives way to an explanation where files cannot be shared', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
    })
    await loginDemo(page)
    await page.goto('/sewa')
    const firstRow = page.getByTestId('lease-row').first()
    await firstRow.getByRole('button', { name: /^Aksi sewa/ }).click()
    await page.getByRole('menuitem', { name: 'Kirim tagihan' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('img', { name: 'Pratinjau tagihan' })).toHaveAttribute('src', /^blob:/)
    await expect(dialog.getByText('Browser ini tidak bisa membagikan gambar')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Bagikan ke WhatsApp' })).toHaveCount(0)
    await expect(dialog.getByRole('link', { name: 'Unduh gambar' })).toBeVisible()
  })

  test('a lease detail offers Kirim tagihan per invoice and opens the modal for that number', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/sewa')
    await page.getByTestId('lease-row').first().getByRole('link').click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    const menu = page.getByRole('button', { name: /^Aksi tagihan INV-/ }).first()
    const number = (await menu.getAttribute('aria-label'))?.replace('Aksi tagihan ', '') ?? ''
    await menu.click()
    await page.getByRole('menuitem', { name: 'Kirim tagihan' }).click()
    await expect(page.getByRole('heading', { name: `Kirim tagihan ${number}` })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Pratinjau tagihan' })).toHaveAttribute('src', /^blob:/)
  })
})
