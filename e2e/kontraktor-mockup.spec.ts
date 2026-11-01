import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

// The contractor mockup (mockups/kontraktor-sawit) is one self-contained file: it is opened straight from disk, not
// from the preview server. The walk below is the 10-minute demo in PANDUAN-DEMO.md, so a broken step is caught here.
const FILE = 'file://' + resolve(process.cwd(), 'mockups/kontraktor-sawit/index.html')

async function open(page: Page, hash = 'beranda') {
  await page.goto(`${FILE}#${hash}`)
  const splash = page.locator('.splash')
  // the greeting addresses the management team, never "Bapak"
  if (await splash.isVisible().catch(() => false)) {
    await expect(splash).toContainText('Selamat pagi, Manajemen LBS')
    await splash.click()
  }
  await expect(splash).toBeHidden()
}

test.describe('Mockup kontraktor sawit', () => {
  test('Beranda: headline tiles, self-check, no horizontal overflow in both themes', async ({ page }) => {
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
    await open(page)
    await expect(page.getByText('Rp 1,46 M')).toBeVisible()
    // the portfolio overview names every running job by its SPK number
    for (const spk of ['047/KPC-SMT/VIII/2026', '052/LS-PKS/VIII/2026', '038/PGM-BLN/VIII/2026', '055/MAS-BNT/IX/2026']) await expect(page.locator('.glance')).toContainText(`SPK ${spk}`)
    await expect(page.getByText('Perlu keputusan manajemen (3)')).toBeVisible()
    await expect(page.locator('.badge')).toHaveText('3')
    expect(logs).toContain('LBS self-check OK')
    expect(await page.evaluate(() => document.body.innerText.includes('Bapak'))).toBe(false)
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
    await expect(page.locator('#toast')).toContainText('Lenny, 08:14')
    await expect(page.getByText('Perlu keputusan manajemen (2)')).toBeVisible()
    await expect(page.locator('.badge')).toHaveText('2')
    await expect(page.getByText('PO disetujui Lenny 08:14', { exact: false }).first()).toBeVisible()
    await page.goto(`${FILE}#sparepart-FD-2026-04417`)
    await expect(page.getByText('Lenny · 31 Okt 08:14 · dari HP')).toBeVisible()
    await page.goto(`${FILE}#jejak`)
    await expect(page.locator('.audit .row').first()).toContainText('menyetujui')
    await expect(page.locator('.audit .row').first()).toContainText('Lenny (Manajemen LBS)')
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
    await expect(page.getByText('94%').first()).toBeVisible()
    await expect(page.getByText('Rp 1,47 M')).toBeVisible()
  })

  test('Tagihan, Uang, Perlu dicek and Reset', async ({ page }) => {
    await open(page, 'proyek')
    await page.getByRole('button', { name: 'Tagihan' }).click()
    // every progress card leads with its SPK number
    await expect(page.locator('main .card .spkline').first()).toContainText('SPK ')
    await expect(page.getByText('41 hari', { exact: false })).toBeVisible()
    await expect(page.locator('.card.danger').first()).toContainText('Lewat jatuh tempo')
    await page.goto(`${FILE}#uang`)
    await expect(page.getByText('+Rp 42,7 jt')).toBeVisible()
    await expect(page.getByText('Rp 532,4 jt')).toBeVisible()
    // AI examples are switched off (AI_ON = false): no floating "Tanya" button; the checks are plain rules
    await expect(page.locator('.fab')).toHaveCount(0)
    await page.goto(`${FILE}#beranda`)
    await expect(page.getByText('Hitungan otomatis').first()).toBeVisible()
    await page.locator('[data-act="link"][data-arg="unit:EX-07"]').click()
    await expect(page.getByText('28,6 L/jam').first()).toBeVisible()
    await page.locator('[data-act="tentang"]').first().click()
    await page.getByRole('button', { name: 'Reset data demo' }).click()
    await expect(page.getByText('Perlu keputusan manajemen (3)')).toBeVisible()
  })
})
