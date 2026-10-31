import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

// The contractor mockup (mockups/kontraktor-sawit) is one self-contained file: it is opened straight from disk, not
// from the preview server. The walk below is the 10-minute demo in PANDUAN-DEMO.md, so a broken step is caught here.
const FILE = 'file://' + resolve(process.cwd(), 'mockups/kontraktor-sawit/index.html')

async function open(page: Page, hash = 'beranda') {
  await page.goto(`${FILE}#${hash}`)
  const splash = page.locator('.splash')
  if (await splash.isVisible().catch(() => false)) await splash.click()
  await expect(splash).toBeHidden()
}

test.describe('Mockup kontraktor sawit', () => {
  test('Beranda: headline tiles, self-check, no horizontal overflow in both themes', async ({ page }) => {
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
    await open(page)
    await expect(page.getByText('Rp 1,46 M')).toBeVisible()
    await expect(page.getByText('Perlu keputusan Bapak (3)')).toBeVisible()
    await expect(page.locator('.badge')).toHaveText('3')
    expect(logs).toContain('KSM self-check OK')
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([])
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const hash of ['beranda', 'proyek', 'uang', 'alat', 'gudang', 'jejak', 'proyek-SPK-047', 'mandor']) {
        await page.goto(`${FILE}#${hash}`)
        await expect(page.locator('main.view')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${hash} ${scheme}`).toBe(true)
      }
    }
  })

  test('approving the PO is stamped with the owner and reappears on every screen', async ({ page }) => {
    await open(page)
    await page.locator('[data-act="decide"][data-arg="PO-2026-0187"]').first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('+6,7%')).toBeVisible()
    await sheet.getByRole('button', { name: 'Setujui', exact: true }).click()
    await expect(page.locator('#toast')).toContainText('Pak Rahmat, 08:14')
    await expect(page.getByText('Perlu keputusan Bapak (2)')).toBeVisible()
    await expect(page.locator('.badge')).toHaveText('2')
    await expect(page.getByText('PO disetujui Bapak 08:14', { exact: false }).first()).toBeVisible()
    await page.goto(`${FILE}#sparepart-FD-2026-04417`)
    await expect(page.getByText('Pak Rahmat · 31 Okt 2026 08:14 · dari HP')).toBeVisible()
    await page.goto(`${FILE}#jejak`)
    await expect(page.locator('.audit .row').first()).toContainText('menyetujui')
  })

  test('a number explains itself: 72% opens Jejak angka with the correction history and the spreadsheet view', async ({ page }) => {
    await open(page, 'proyek-SPK-047')
    await expect(page.getByText('Rp 539 juta')).toBeVisible()
    await page.locator('[data-act="trace"][data-arg="pct-SPK-047"]').click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Pak Ujang')
    await expect(sheet).toContainText('240 m3')
    await sheet.getByRole('button', { name: 'Spreadsheet', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Diubah oleh: ?')
    await page.keyboard.press('Escape')
    await page.locator('[data-act="termin"][data-arg="SPK-047|T1"]').click()
    await expect(page.getByRole('dialog')).toContainText('Rp 669.156.250')
  })

  test("the mandor's queued report arrives when the signal returns and Beranda updates", async ({ page }) => {
    await open(page, 'mandor')
    await page.locator('[data-act="signal"]').click()
    await expect(page.getByText('Terkirim 31 Okt 08:16')).toBeVisible()
    await page.goto(`${FILE}#beranda`)
    await expect(page.getByText('4/4')).toBeVisible()
    await expect(page.getByText('93,5%').first()).toBeVisible()
    await expect(page.getByText('Rp 1,47 M')).toBeVisible()
  })

  test('Tagihan, Uang, Tanya and Reset', async ({ page }) => {
    await open(page, 'proyek')
    await page.getByRole('button', { name: 'Tagihan' }).click()
    await expect(page.getByText('41 hari', { exact: false })).toBeVisible()
    await expect(page.locator('.card.danger').first()).toContainText('Lewat jatuh tempo')
    await page.goto(`${FILE}#uang`)
    await expect(page.getByText('+Rp 42,7 jt')).toBeVisible()
    await expect(page.getByText('Rp 532,4 jt')).toBeVisible()
    await page.locator('.fab').click()
    await page.locator('[data-act="tanya-q"][data-arg="0"]').click()
    await expect(page.getByRole('dialog')).toContainText('28,6 L/jam')
    await page.keyboard.press('Escape')
    await page.locator('[data-act="tentang"]').first().click()
    await page.getByRole('button', { name: 'Reset data demo' }).click()
    await expect(page.getByText('Perlu keputusan Bapak (3)')).toBeVisible()
  })
})
