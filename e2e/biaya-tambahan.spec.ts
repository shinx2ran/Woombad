import { test, expect, type Page } from '@playwright/test'
import { fillMoney } from './money'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/** A weekly stay from today (11 Nov), paid 1.000.000, optionally with a deposit received; ends on its lease page. */
async function checkInWeekly(page: Page, name: string, deposit = 0) {
  const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
  await vacant.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Nama penyewa').fill(name)
  await form.getByRole('radio', { name: /Mingguan/ }).click()
  await fillMoney(form.getByLabel('Total bayar'), '1000000')
  if (deposit > 0) await fillMoney(form.getByLabel('Uang jaminan (deposit)'), String(deposit))
  await form.getByRole('button', { name: 'Simpan check-in' }).click()
  await page.waitForURL(/\/sewa\/[^/]+$/)
}

/** A StatCard on the lease page, by its label. */
const statCard = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('xpath=../..')

async function openChargeFromMenu(page: Page) {
  await page.getByRole('button', { name: 'Aksi sewa' }).click()
  await page.getByRole('menuitem', { name: /^Biaya tambahan/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByTestId('charge-sheet')).toBeVisible()
  return sheet
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** the phone list's row of the (only) charge */
const chargeRow = (page: Page) => page.locator('li', { has: page.getByTestId('invoice-charge-title') })
const chargePayments = (page: Page) => page.getByTestId('payment-kind').filter({ hasText: 'Biaya tambahan' })

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.31: a one-off charge on a lease (late check-out, damage, ...), paid now, from the deposit, or later
test.describe('Biaya tambahan pada sewa (SPEC 7.31)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-11T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('a late checkout paid in cash: a charge row and a labelled payment; paid-through and due date unchanged', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await checkInWeekly(page, 'Tamu Telat Keluar')
    // one week from 11 Nov: paid and billed to check-out 18 Nov, next rent due 18 Nov
    await expect(statCard(page, 'Dibayar s/d')).toContainText('18 Nov 2026')
    await expect(statCard(page, 'Sisa tagihan')).toContainText('Jatuh tempo 18 Nov 2026')
    const paidThrough = (await statCard(page, 'Dibayar s/d').textContent()) ?? ''
    const owed = (await statCard(page, 'Sisa tagihan').textContent()) ?? ''

    const sheet = await openChargeFromMenu(page)
    await sheet.getByRole('button', { name: 'Late checkout' }).click()
    await expect(sheet.getByRole('textbox', { name: /^Keterangan/ })).toHaveValue('Late checkout')
    await expect(sheet.getByRole('button', { name: 'Late checkout' })).toHaveAttribute('aria-pressed', 'true')
    await fillMoney(sheet.getByLabel(/^Jumlah/), '100000')
    await expect(sheet.getByLabel(/^Tanggal/)).toHaveValue('2026-11-11')
    await expect(sheet.getByRole('radio', { name: 'Tunai' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByTestId('charge-summary')).toHaveText('Rp 100.000 dibayar Tunai hari ini; biaya langsung lunas.')
    // no deposit held: it cannot pay the charge
    await expect(sheet.getByRole('radio', { name: /^Potong jaminan/ })).toBeDisabled()
    expect(await noHorizontalScroll(page)).toBe(true)
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(page.getByText('Biaya tambahan Rp 100.000 dicatat, lunas (Tunai).')).toBeVisible()
    await expect(sheet).toBeHidden()

    await expect(chargeRow(page)).toContainText('Biaya tambahan · Late checkout')
    await expect(chargeRow(page)).toContainText('11 Nov 2026')
    await expect(chargeRow(page)).toContainText('lunas')
    await expect(chargeRow(page)).not.toContainText('malam')
    await expect(chargePayments(page)).toHaveCount(1)
    // the rent payment keeps its own label
    await expect(page.getByTestId('payment-kind').filter({ hasText: 'Sewa' })).toHaveCount(1)
    // a charge is not rent: the stay and its next due date do not move
    await expect(statCard(page, 'Dibayar s/d')).toHaveText(paidThrough)
    await expect(statCard(page, 'Sisa tagihan')).toHaveText(owed)
    expect(await noHorizontalScroll(page)).toBe(true)
    expect(errors).toEqual([])
  })

  test('Bayar nanti: Sisa tagihan includes the charge, then it is paid from its row', async ({ page }) => {
    await checkInWeekly(page, 'Tamu Bayar Nanti')
    const sheet = await openChargeFromMenu(page)
    // required fields are named when Simpan is tapped too early
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(sheet.getByText('Keterangan wajib diisi.')).toBeVisible()
    await expect(sheet.getByText('Jumlah harus lebih dari 0.')).toBeVisible()

    await sheet.getByRole('button', { name: 'Kebersihan' }).click()
    await fillMoney(sheet.getByLabel(/^Jumlah/), '75000')
    await sheet.getByRole('radio', { name: 'Bayar nanti' }).click()
    await expect(sheet.getByTestId('charge-summary')).toHaveText('Rp 75.000 belum dibayar: masuk Sisa tagihan, bayar nanti dari daftar tagihan.')
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(page.getByText('Biaya tambahan Rp 75.000 dicatat, belum dibayar.')).toBeVisible()

    const owed = statCard(page, 'Sisa tagihan')
    await expect(owed).toContainText('Rp 75.000')
    await expect(page.getByTestId('charges-outstanding')).toHaveText('termasuk biaya tambahan Rp 75.000')
    // the rent's due date stays the next period's, not the charge's day
    await expect(owed).toContainText('Jatuh tempo 18 Nov 2026')
    await expect(chargeRow(page)).toContainText('Biaya tambahan · Kebersihan')
    await expect(chargeRow(page)).toContainText('sisa Rp 75.000')
    await expect(chargePayments(page)).toHaveCount(0)

    await chargeRow(page).getByRole('button', { name: /^Aksi tagihan/ }).click()
    await page.getByRole('menuitem', { name: 'Bayar', exact: true }).click()
    const pay = page.getByRole('dialog')
    await expect(pay.getByTestId('payment-charge-title')).toHaveText('Biaya tambahan · Kebersihan · 11 Nov 2026')
    await expect(pay.getByLabel(/^Jumlah dibayar/)).toHaveValue('75.000')
    expect(await noHorizontalScroll(page)).toBe(true)
    await pay.getByRole('button', { name: 'Simpan pembayaran' }).click()
    await expect(pay.getByText('Tagihan lunas.')).toBeVisible()
    // a charge has no period on the receipt
    await expect(pay.locator('pre')).not.toContainText('Periode')
    await pay.getByRole('button', { name: 'Selesai' }).click()

    await expect(page.getByTestId('charges-outstanding')).toHaveCount(0)
    await expect(owed).toContainText('Rp 0')
    await expect(chargeRow(page)).toContainText('lunas')
    await expect(chargePayments(page)).toHaveCount(1)
  })

  test('Potong jaminan: only up to the deposit held, which then goes down', async ({ page }) => {
    await checkInWeekly(page, 'Tamu Berjaminan', 200_000)
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 0 · dikembalikan Rp 0')).toBeVisible()
    const sheet = await openChargeFromMenu(page)
    await sheet.getByRole('button', { name: 'Kerusakan' }).click()
    await sheet.getByRole('textbox', { name: /^Keterangan/ }).fill('Kerusakan kunci lemari')
    const fromDeposit = sheet.getByRole('radio', { name: /^Potong jaminan/ })
    await expect(fromDeposit).toContainText('dipegang Rp 200.000')
    // more than the deposit held: not offered
    await fillMoney(sheet.getByLabel(/^Jumlah/), '250000')
    await expect(fromDeposit).toBeDisabled()
    await fillMoney(sheet.getByLabel(/^Jumlah/), '50000')
    await fromDeposit.click()
    await expect(fromDeposit).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByTestId('charge-summary')).toHaveText('Rp 50.000 dipotong dari jaminan; jaminan dipegang menjadi Rp 150.000.')
    // chosen, then raised above the deposit: refused with the reason
    await fillMoney(sheet.getByLabel(/^Jumlah/), '250000')
    await expect(sheet.getByText('Jaminan yang dipegang hanya Rp 200.000.')).toBeVisible()
    await fillMoney(sheet.getByLabel(/^Jumlah/), '50000')
    expect(await noHorizontalScroll(page)).toBe(true)
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(page.getByText('Biaya tambahan Rp 50.000 dicatat, dipotong dari jaminan.')).toBeVisible()

    await expect(statCard(page, 'Deposit dipegang')).toContainText('Rp 150.000')
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 50.000 · dikembalikan Rp 0')).toBeVisible()
    await expect(chargeRow(page)).toContainText('Biaya tambahan · Kerusakan kunci lemari')
    await expect(chargeRow(page)).toContainText('lunas')
    await expect(chargePayments(page)).toHaveCount(1)
  })

  test('from the Checkout dialog: add a late checkout, come back, settle the deposit against it, check out', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await checkInWeekly(page, 'Tamu Checkout Telat', 200_000)
    // three days later the tenant leaves, late
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00+07:00'))
    await page.reload()

    await page.getByRole('button', { name: 'Aksi sewa' }).click()
    await page.getByRole('menuitem', { name: /^Checkout/ }).click()
    let checkout = page.getByRole('dialog')
    await expect(checkout.getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
    await expect(checkout.getByLabel(/Tanggal checkout/)).toHaveValue('2026-11-14')
    await checkout.getByRole('button', { name: 'Tambah biaya tambahan (late checkout, kerusakan)' }).click()

    const sheet = page.getByRole('dialog')
    await expect(sheet.getByTestId('charge-sheet')).toBeVisible()
    await sheet.getByRole('button', { name: 'Late checkout' }).click()
    await fillMoney(sheet.getByLabel(/^Jumlah/), '100000')
    await expect(sheet.getByLabel(/^Tanggal/)).toHaveValue('2026-11-14')
    await sheet.getByRole('radio', { name: 'Bayar nanti' }).click()
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(page.getByText('Biaya tambahan Rp 100.000 dicatat, belum dibayar.')).toBeVisible()

    // back in the checkout: the charge is an open invoice, never one to cancel, and the deposit may pay it
    checkout = page.getByRole('dialog')
    await expect(checkout.getByRole('heading', { name: 'Checkout penyewa' })).toBeVisible()
    await expect(checkout.getByLabel(/Tanggal checkout/)).toHaveValue('2026-11-14')
    await expect(checkout.getByText('Sisa tagihan sebelum checkout tetap piutang').locator('..')).toContainText('Rp 100.000')
    await expect(checkout.getByText('Sisa tagihan yang bisa dipotong: Rp 100.000.')).toBeVisible()
    await fillMoney(checkout.getByLabel('Potong untuk sewa'), '100000')
    await fillMoney(checkout.getByLabel('Kembalikan ke penyewa'), '100000')
    await expect(checkout.getByText('Jumlah sudah pas')).toBeVisible()
    expect(await noHorizontalScroll(page)).toBe(true)
    await checkout.getByRole('button', { name: 'Selesaikan checkout' }).click()
    await expect(page.getByText('Checkout dicatat. Sewa selesai.')).toBeVisible()
    await expect(checkout).toBeHidden()

    await expect(chargeRow(page)).toContainText('Biaya tambahan · Late checkout')
    await expect(chargeRow(page)).toContainText('lunas')
    await expect(page.getByTestId('charges-outstanding')).toHaveCount(0)
    await expect(statCard(page, 'Sisa tagihan')).toContainText('Rp 0')
    await expect(page.getByText('Diterima Rp 200.000 · dipotong Rp 100.000 · dikembalikan Rp 100.000')).toBeVisible()
    await expect(chargePayments(page)).toHaveCount(1)
    // an ended lease can still be charged (damage found after the tenant left)
    await page.getByRole('button', { name: 'Aksi sewa' }).click()
    await expect(page.getByRole('menuitem', { name: /^Biaya tambahan/ })).toBeVisible()
    expect(errors).toEqual([])
  })
})
