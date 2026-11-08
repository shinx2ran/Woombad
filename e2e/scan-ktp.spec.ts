import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/** a 1×1 PNG: in Mode Demo the photo is not read, the review shows the labelled sample card */
const PHOTO = {
  name: 'ktp.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.19 Scan KTP via Claude: the reader switch, the review from Claude, the setting, the check-in shortcut
test.describe('Scan KTP via Claude (SPEC 7.19)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-08T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('the tenant form: Claude is the default reader, the sample card is reviewed and applied; the owner can make "Di HP" the default', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/penyewa?new=1')
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: 'Tambah Penyewa' })).toBeVisible()
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    const scanner = form.getByTestId('document-scanner')
    // the switch starts on the organisation's default (Claude) and says what that means
    const claude = scanner.getByRole('radio', { name: 'Claude' })
    await expect(claude).toHaveAttribute('aria-checked', 'true')
    await expect(scanner.getByTestId('scanner-engine-note')).toContainText('Foto dikirim ke Anthropic (Claude)')
    await expect(scanner.getByTestId('scanner-engine-note')).toContainText('Mode Demo: contoh hasil, foto tidak dikirim.')
    await expect(scanner.getByText('Mengunduh data OCR')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await scanner.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await expect(scanner.getByText('Terdeteksi: KTP')).toBeVisible()
    await expect(scanner.getByText('Dibaca Claude')).toBeVisible()
    await expect(scanner.getByTestId('scanner-demo-note')).toHaveText('Mode Demo: contoh hasil Claude, foto tidak dibaca.')
    await expect(scanner.getByTestId('scanner-notes')).toContainText('Baris alamat agak buram, mohon dicek.')
    // 3,000 tokens in × $4 + 900 out × $20 per million = US$0.03, a labelled sample
    await expect(scanner.getByTestId('scan-cost')).toHaveText('Biaya scan ini: US$0,03 (contoh)')
    const address = scanner.getByRole('listitem').filter({ hasText: 'Jl. Melati No. 12' })
    await expect(address).toContainText('Claude kurang yakin, periksa.')
    await expect(scanner.getByRole('listitem').filter({ hasText: 'Budi Santoso' })).not.toContainText('Claude kurang yakin')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await scanner.getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText(/data dari KTP diterapkan ke formulir/)).toBeVisible()
    await expect(form.getByLabel('Nama lengkap')).toHaveValue('Budi Santoso')
    await expect(form.getByLabel('NIK')).toHaveValue('3273012505900002')
    await expect(form.getByLabel('Tempat lahir')).toHaveValue('Bandung')
    await expect(form.getByLabel('Tanggal lahir')).toHaveValue('1990-05-25')
    await expect(form.getByLabel('Alamat')).toHaveValue('Jl. Melati No. 12, RT/RW 003/005, Sukajadi, Coblong, Bandung, Jawa Barat')
    await form.getByRole('button', { name: 'Batal' }).click()

    // the owner makes the on-device reader the default for everyone
    await page.goto('/pengaturan')
    await expect(page.getByRole('heading', { name: 'Scan KTP' })).toBeVisible()
    const device = page.getByRole('radio', { name: /Di HP saja/ })
    await expect(page.getByRole('radio', { name: /Claude/ })).toBeChecked()
    // saved as soon as it is tapped (the radio follows the saved value once the save is through)
    await device.click()
    await expect(page.getByText('Scan KTP sekarang memakai Di HP.')).toBeVisible()
    await expect(device).toBeChecked()
    // the Kredit Claude card lists the KTP scan at its cost
    const scans = page.getByTestId('scan-usage-row')
    await expect(scans).toHaveCount(1)
    await expect(scans.first()).toContainText('16 data · KTP')
    await expect(scans.first()).toContainText('US$0,03')

    // the scanner now starts on "Di HP", and the first-run download notice is back; one scan can still pick Claude
    await page.goto('/penyewa?new=1')
    await page.getByRole('dialog').getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    const again = page.getByRole('dialog').getByTestId('document-scanner')
    await expect(again.getByRole('radio', { name: 'Di HP' })).toHaveAttribute('aria-checked', 'true')
    await expect(again.getByTestId('scanner-engine-note')).toContainText('Dibaca di HP ini, foto tidak dikirim ke mana pun.')
    await expect(again.getByText('Mengunduh data OCR ±15 MB, hanya sekali.')).toBeVisible()
    await again.getByRole('radio', { name: 'Claude' }).click()
    await expect(again.getByTestId('scanner-engine-note')).toContainText('Foto dikirim ke Anthropic (Claude)')

    // kept after a reload
    await page.goto('/pengaturan')
    await expect(page.getByRole('radio', { name: /Di HP saja/ })).toBeChecked()
    expect(errors).toEqual([])
  })

  test('check-in cepat: Scan KTP fills the name, the new tenant carries the card\'s data', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
    const roomName = (await vacant.getAttribute('data-room'))!
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: `Check-in cepat · Kamar ${roomName}` })).toBeVisible()

    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    const scanner = form.getByTestId('document-scanner')
    await scanner.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await expect(scanner.getByText('Terdeteksi: KTP')).toBeVisible()
    await scanner.getByRole('button', { name: 'Terapkan' }).click()
    await expect(form.getByLabel('Nama penyewa')).toHaveValue('Budi Santoso')
    await expect(form.getByRole('button', { name: 'Scan ulang KTP / Paspor' })).toBeVisible()
    // the demo data has a Budi Santoso without a NIK: he may be this person, so he is offered; here it is someone new
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Penyewa lama: Budi Santoso')
    await form.getByLabel('Nama ini sudah ada').selectOption({ label: 'Orang lain (penyewa baru)' })
    await form.getByLabel('Jumlah malam').click()
    await page.keyboard.type('2')
    const summary = form.getByTestId('quick-checkin-summary')
    await expect(summary.getByTestId('quick-checkin-scanned')).toContainText('Dokumen KTP · NIK 3273012505900002 · data penyewa diisi dari scan')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText(/Check-in kamar .* tersimpan/)).toBeVisible()

    // the tenant was created with the card's data
    await page.goto('/penyewa')
    await page.getByLabel('Cari penyewa').fill('3273012505900002')
    await page.getByRole('link', { name: /Budi Santoso/ }).first().click()
    await page.waitForURL(/\/penyewa\/[^/?]+$/)
    await expect(page.getByText('Identitas · KTP')).toBeVisible()
    await expect(page.getByText('3273012505900002')).toBeVisible()
    await expect(page.getByText('Bandung, 25 Mei 1990')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('a scanned NIK that belongs to an existing tenant books the stay for that tenant', async ({ page }) => {
    // give one demo tenant the sample card's NIK
    await page.evaluate(() => {
      const raw = localStorage.getItem('woombad.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      const free = db.tenants.find((t: { id: string }) => !db.leases.some((l: { tenant_id: string; status: string }) => l.tenant_id === t.id && l.status === 'active'))
      ;(free ?? db.tenants[0]).nik = '3273012505900002'
      ;(free ?? db.tenants[0]).full_name = 'Budi Lama'
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText('NIK ini milik penyewa lama Budi Lama: sewa dicatat atas namanya.')).toBeVisible()
    await expect(form.getByTestId('quick-checkin-nik-match')).toContainText('Budi Lama')
    // an existing tenant: no phone field, no "data dari scan" (his record is left as it is)
    await expect(form.getByLabel('Nomor HP')).toHaveCount(0)
    await form.getByLabel('Jumlah malam').click()
    await page.keyboard.type('1')
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Penyewa lama: Budi Lama')
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveCount(0)
    // "Bukan dia?" makes it a new tenant after all
    await form.getByRole('button', { name: 'Bukan dia?' }).click()
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    await expect(form.getByLabel('Nomor HP')).toBeVisible()
    await expect(form.getByTestId('quick-checkin-scanned')).toBeVisible()
  })
})
