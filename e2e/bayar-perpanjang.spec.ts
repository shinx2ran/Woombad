import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // Mode Demo's sample data is made at the dashboard's first draw (SPEC 7.9): wait for it
  await expect(page.getByTestId('room-board')).toBeVisible()
}

const tiles = (page: Page) => page.getByTestId('board-tile')
const hendra = (page: Page) => page.locator('[data-testid="board-tile"][aria-label*="(Hendra Wijaya)"]')

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Bayar & perpanjang, Cek harga, deposit at checkout (SPEC 7.13-7.15)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-30T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('room board: a guest with nothing open pays the next night and stays, in one sheet', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await hendra(page).click()
    const sheet = page.getByRole('dialog')
    // the invoice-only Perpanjang stays next to it
    await expect(sheet.getByRole('link', { name: 'Perpanjang', exact: true })).toBeVisible()
    await sheet.getByRole('link', { name: 'Bayar & perpanjang' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)

    const pay = page.getByRole('dialog')
    await expect(pay.getByRole('heading', { name: 'Bayar & perpanjang' })).toBeVisible()
    await expect(pay.getByRole('checkbox', { name: /^Sudah dibayar lunas Rp/ })).toBeChecked()
    await expect(pay.getByLabel('Tanggal bayar')).toHaveValue('2026-10-30')
    await pay.getByLabel('Metode bayar').selectOption('transfer')
    await pay.getByRole('button', { name: 'Simpan & perpanjang' }).click()
    await expect(page.getByText(/Tagihan INV-\S+ lunas, Rp [\d.]+ diterima \(Transfer\)\. Sewa diperpanjang, check-out/)).toBeVisible()

    // the paid bill opens in the share sheet, as a receipt
    const share = page.getByRole('dialog')
    await expect(share.getByRole('heading', { name: /Kirim tagihan/ })).toBeVisible()
    const text = share.getByRole('link', { name: 'Kirim teks saja via WhatsApp' })
    if (await text.count()) expect(decodeURIComponent((await text.getAttribute('href'))!)).toContain('Status: *LUNAS*')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // nothing open again: the lease page offers the same action instead of a greyed-out "Catat pembayaran"
    await expect(page.getByRole('button', { name: 'Bayar & perpanjang' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Catat pembayaran' })).toHaveCount(0)
    // the rent is on the lease: paid today by transfer
    await expect(page.locator('li', { hasText: '30 Okt 2026' }).filter({ hasText: 'Transfer' }).first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('Perlu perhatian: a row with nothing open says Bayar & perpanjang, a row with rent owed keeps Bayar', async ({ page }) => {
    // Hendra was paid to 2 Nov: on 4 Nov he is late with nothing billed yet (the demo data stays, only the day moves)
    await page.clock.setFixedTime(new Date('2026-11-04T10:00:00+07:00'))
    await page.reload()
    const rows = page.locator('[data-attention-row]')
    await expect(page.locator('[data-attention-row]', { hasText: 'Hendra' })).toBeVisible()
    await expect(rows.first()).toBeVisible()
    const extend = rows.getByRole('link', { name: 'Bayar & perpanjang' })
    const owed = rows.getByRole('link', { name: 'Bayar', exact: true })
    expect(await extend.count()).toBeGreaterThan(0)
    expect(await owed.count()).toBeGreaterThan(0)
    for (const link of await extend.all()) await expect(link).toHaveAttribute('href', /\/sewa\/[^/?]+\?action=bayar-perpanjang$/)
    for (const link of await owed.all()) await expect(link).toHaveAttribute('href', /\/sewa\/[^/?]+\?action=bayar$/)
    // the longer label fits its button on a 360 px phone (two centred lines at most, nothing spills out)
    for (const link of await extend.all()) expect(await link.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.locator('[data-attention-row]', { hasText: 'Hendra' }).getByRole('link', { name: 'Bayar & perpanjang' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Bayar & perpanjang' })).toBeVisible()
  })

  test('checkout: a deposit agreed but not received is pointed out, and recording it from there fixes the refund', async ({ page }) => {
    // Hendra goes weekly with a Rp 200.000 deposit he has not handed over yet (SPEC 7.12)
    await hendra(page).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Bayar & perpanjang' }).click()
    const pay = page.getByRole('dialog')
    await pay.getByRole('radio', { name: 'Mingguan' }).click()
    await pay.getByLabel('Uang jaminan (deposit)').fill('200000')
    await pay.getByRole('checkbox', { name: 'Deposit Rp 200.000 sudah diterima' }).uncheck()
    await pay.getByRole('button', { name: 'Simpan & perpanjang' }).click()
    await expect(page.getByText(/Deposit Rp 200\.000 belum diterima\./)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByText('Lainnya ▾').click()
    await page.getByRole('menuitem', { name: /^Checkout/ }).click()
    const checkout = page.getByRole('dialog')
    await expect(checkout.getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
    // the day he leaves is typed first; the round trip below must keep it
    await checkout.getByLabel('Tanggal checkout').fill('2026-11-02')
    await expect(checkout.getByTestId('checkout-deposit-shortfall')).toContainText('Deposit disepakati Rp 200.000, tercatat diterima Rp 0.')
    await checkout.getByRole('button', { name: 'Catat deposit diterima' }).click()

    const deposit = page.getByRole('dialog')
    await expect(deposit.getByRole('heading', { name: 'Catat deposit diterima' })).toBeVisible()
    await expect(deposit.getByLabel('Jumlah diterima')).toHaveValue('200.000')
    await deposit.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('Deposit dicatat.')).toBeVisible()

    // back in the checkout, which now settles the Rp 200.000 it holds
    const again = page.getByRole('dialog')
    await expect(again.getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
    await expect(again.getByTestId('checkout-deposit-shortfall')).toHaveCount(0)
    await expect(again.getByLabel('Tanggal checkout')).toHaveValue('2026-11-02')
    await expect(again).toContainText('200.000')
    await again.getByRole('button', { name: 'Batal' }).click()
  })

  test('Check-in cepat: Rp 18.000 for a night waits for "Harga ini memang benar"', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    await vacant.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Nama penyewa').fill('Salah Ketik')
    await form.getByLabel('Total bayar').fill('18000')
    await expect(form.getByTestId('price-confirm')).toContainText(/Harga Rp 18\.000 \/ malam .*Kurang angka nol\?/)
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await expect(form.getByText('Centang bila harganya memang benar, atau perbaiki harganya.')).toBeVisible()
    await expect(form.getByRole('checkbox', { name: 'Harga ini memang benar' })).toBeFocused()
    // a corrected total asks nothing more
    await form.getByLabel('Total bayar').fill('180000')
    await expect(form.getByTestId('price-confirm')).toHaveCount(0)
    await form.getByLabel('Total bayar').fill('18000')
    await form.getByRole('checkbox', { name: 'Harga ini memang benar' }).check()
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/?]+$/)
  })

  test('Sewa baru: Rp 1 a month (the A13 slip) waits for the tick', async ({ page }) => {
    const vacant = tiles(page).and(page.locator('[data-tone="vacant"]')).first()
    await vacant.click()
    await page.getByRole('dialog').getByRole('link', { name: 'Form lengkap' }).click()
    await page.waitForURL(/\/sewa\/baru\?room=/)
    await page.getByRole('button', { name: 'Isi sendiri' }).click()
    await page.getByLabel('Nama lengkap').fill('Harga Satu')
    await page.getByLabel('Nomor HP (WhatsApp)').fill('081234567891')
    await page.getByRole('radio', { name: /^Bulanan/ }).click()
    await page.getByLabel(/Harga disepakati per bulan/).fill('1')
    await expect(page.getByTestId('price-confirm')).toContainText('Harga Rp 1 / bulan')
    await page.getByRole('radio', { name: /^Belum bayar/ }).check()
    await page.getByRole('button', { name: 'Simpan & check-in' }).click()
    await expect(page.getByTestId('wizard-errors')).toContainText('Harga perlu dicek')
    await expect(page).toHaveURL(/\/sewa\/baru/)
    // the only thing left: the tick is brought into view
    await expect(page.getByRole('checkbox', { name: 'Harga ini memang benar' })).toBeFocused()
    await page.getByRole('checkbox', { name: 'Harga ini memang benar' }).check()
    await page.getByRole('button', { name: 'Simpan & check-in' }).click()
    await page.waitForURL(/\/sewa\/(?!baru)[^/?]+$/)
  })
})
