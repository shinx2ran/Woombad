import { test, expect, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/** Type into a MoneyInput: select what is there first (fill alone can append to the formatted value). */
async function typeMoney(page: Page, input: ReturnType<Page['getByLabel']>, value: string) {
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(value)
}

async function openQuickCheckIn(page: Page) {
  const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
  await vacant.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
  return page.getByRole('dialog')
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.26, the owner's case: a weekly stay of 1.000.000 with a deposit of 200.000
test.describe('Deposit di check-in cepat dan Ubah pembayaran (SPEC 7.26)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-11T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('check-in cepat takes a deposit for a weekly stay; the lease holds it apart from the rent', async ({ page }) => {
    const form = await openQuickCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Tamu Mingguan')
    await form.getByRole('radio', { name: /Mingguan/ }).click()
    await typeMoney(page, form.getByLabel('Total bayar'), '1000000')
    await typeMoney(page, form.getByLabel('Uang jaminan (deposit)'), '200000')
    await expect(form.getByLabel('Deposit sudah diterima')).toBeChecked()
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Lunas Rp 1.000.000')
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Deposit Rp 200.000 diterima')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 0 · dikembalikan Rp 0')).toBeVisible()
    await expect(page.getByText('Lunas', { exact: true }).first()).toBeVisible()
  })

  test('a daily stay has the deposit field too', async ({ page }) => {
    const form = await openQuickCheckIn(page)
    await expect(form.getByLabel('Jumlah malam')).toBeVisible()
    await expect(form.getByLabel('Uang jaminan (deposit)')).toBeVisible()
  })

  test('Ubah pembayaran records a deposit received with the rent, as its own payment', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    // a weekly stay saved without a deposit, paid 1.000.000
    const form = await openQuickCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Lupa Deposit')
    await form.getByRole('radio', { name: /Mingguan/ }).click()
    await typeMoney(page, form.getByLabel('Total bayar'), '1000000')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
    await expect(page.getByText('Diterima Rp 0 · dipotong Rp 0 · dikembalikan Rp 0')).toBeVisible()

    await page.getByRole('button', { name: 'Ubah pembayaran' }).first().click()
    const dialog = page.getByRole('dialog')
    const save = dialog.getByRole('button', { name: 'Simpan' })
    await expect(save).toBeDisabled()
    await typeMoney(page, dialog.getByLabel('Deposit diterima (uang jaminan)'), '200000')
    await expect(dialog.getByTestId('edit-payment-deposit')).toHaveText(
      'Sewa Rp 1.000.000 + deposit Rp 200.000 = diterima Rp 1.200.000. Deposit bukan pendapatan; dikembalikan saat check-out.',
    )
    await expect(save).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await save.click()
    await expect(page.getByText('Deposit Rp 200.000 dicatat.')).toBeVisible()
    await expect(dialog).toBeHidden()

    // the rent payment is untouched; the deposit is a second payment and the agreed deposit follows it
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 0 · dikembalikan Rp 0')).toBeVisible()
    const stored = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const lease = db.leases[db.leases.length - 1]
      const pays = db.payments.filter((p: { lease_id: string }) => p.lease_id === lease.id)
      return { agreed: lease.deposit_amount, pays: pays.map((p: { kind: string; amount: number; invoice_id: string | null }) => [p.kind, p.amount, p.invoice_id === null]) }
    })
    expect(stored.agreed).toBe(200_000)
    expect(stored.pays).toEqual([
      ['rent', 1_000_000, false],
      ['deposit', 200_000, true],
    ])
    await expect(page.getByText('Lunas', { exact: true }).first()).toBeVisible()
    expect(errors).toEqual([])
  })
})
