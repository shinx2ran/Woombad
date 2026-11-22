import { test, expect, type Page } from '@playwright/test'
import { fillMoney } from './money'

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('room-board')).toBeVisible()
}

/** a 1×1 PNG: in Mode Demo the photo is not read, the review shows the labelled sample card (NIK 3273012505900002) */
const PHOTO = {
  name: 'ktp.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
}
const CARD_NIK = '3273012505900002'

async function openCheckIn(page: Page) {
  const vacant = page.getByTestId('board-tile').and(page.locator('[data-tone="vacant"]')).first()
  await vacant.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check-in cepat' }).click()
  return page.getByRole('dialog')
}

/** The tenant found by a NIK on the Penyewa page, opened. */
async function openTenantByNik(page: Page, nik: string, name: RegExp) {
  await page.goto('/penyewa')
  await page.getByLabel('Cari penyewa').fill(nik)
  const rows = page.getByRole('link', { name })
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  await page.waitForURL(/\/penyewa\/[^/?]+$/)
}

test.use({ timezoneId: 'Asia/Jakarta' })

// SPEC 7.30: check-in cepat has a No. KTP (NIK) field: optional, typed by hand or filled by Scan KTP
test.describe('No. KTP (NIK) di check-in cepat (SPEC 7.30)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-22T10:00:00+07:00'))
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)
  })

  test('typed by hand: optional, counted while typing, a short one refused, a full one saved on the new tenant', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const form = await openCheckIn(page)
    const nik = form.getByLabel('No. KTP (NIK)')
    await expect(nik).toHaveValue('')
    await expect(form.getByText('Boleh dikosongkan. Ketik manual, atau isi lewat Scan KTP di atas.')).toBeVisible()
    await form.getByLabel('Nama penyewa').fill('Tamu Ber NIK')
    await fillMoney(form.getByLabel('Total bayar'), '180000')

    await nik.fill('3273 0199')
    await expect(form.getByText('8 dari 16 digit.')).toBeVisible()
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await expect(form.getByText('NIK harus 16 digit (saat ini 8 digit).')).toBeVisible()
    await expect(form.getByRole('heading', { name: /Check-in cepat/ })).toBeVisible()
    // the wrong number is brought into view
    await expect(nik).toBeFocused()

    // typed as printed on some cards, with dashes: the digits count
    await nik.fill('3273-0199-0101-0003')
    await expect(form.getByText(/NIK harus 16 digit/)).toHaveCount(0)
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveText('Dokumen KTP · NIK 3273019901010003')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)

    await openTenantByNik(page, '3273019901010003', /Tamu Ber NIK/)
    await expect(page.getByText('Identitas · KTP')).toBeVisible()
    await expect(page.getByText('3273019901010003')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('left empty: the check-in is saved without a NIK', async ({ page }) => {
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Tamu Tanpa NIK')
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveCount(0)
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)
  })

  test('Scan KTP fills the field; a corrected number is the one saved; Hapus hasil scan empties it', async ({ page }) => {
    const form = await openCheckIn(page)
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    const nik = form.getByLabel('No. KTP (NIK)')
    await expect(nik).toHaveValue(CARD_NIK)
    await expect(form.getByText('Terisi dari scan: cocokkan dengan kartunya.')).toBeVisible()

    // the card was read wrong in one digit: corrected by hand
    await nik.fill('3273012505900009')
    await expect(form.getByText('Terisi dari scan: cocokkan dengan kartunya.')).toHaveCount(0)
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveText('Dokumen KTP · NIK 3273012505900009 · data penyewa diisi dari scan')

    // dropping the scan keeps a number typed over it; a fresh scan puts the card's back
    await form.getByRole('button', { name: 'Hapus hasil scan' }).click()
    await expect(nik).toHaveValue('3273012505900009')
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    await form.getByRole('button', { name: 'Hapus hasil scan' }).click()
    // the review keeps a typed number it differs from unticked, so the field still holds the typed one
    await expect(nik).toHaveValue('3273012505900009')

    await nik.fill('')
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    await expect(nik).toHaveValue(CARD_NIK)
    await form.getByRole('button', { name: 'Hapus hasil scan' }).click()
    await expect(nik).toHaveValue('')
  })

  test('a typed NIK an existing tenant has books the stay for him', async ({ page }) => {
    await page.evaluate((nik) => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const free = db.tenants.find((t: { id: string }) => !db.leases.some((l: { tenant_id: string; status: string }) => l.tenant_id === t.id && l.status === 'active'))
      ;(free ?? db.tenants[0]).nik = nik
      ;(free ?? db.tenants[0]).full_name = 'Siti Lama'
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    }, CARD_NIK)
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Siti')
    await form.getByLabel('No. KTP (NIK)').fill(CARD_NIK)
    await expect(form.getByTestId('quick-checkin-nik-match')).toContainText('NIK ini milik penyewa lama Siti Lama')
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Penyewa lama: Siti Lama')
    await expect(form.getByLabel('Nomor HP')).toHaveCount(0)
    // "Bukan dia?" makes it a new tenant
    await form.getByRole('button', { name: 'Bukan dia?' }).click()
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveText(`Dokumen KTP · NIK ${CARD_NIK}`)
    // a space typed into the same number does not undo "Bukan dia?", nor does deleting a digit and typing it again
    await form.getByLabel('No. KTP (NIK)').fill(`${CARD_NIK} `)
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    await form.getByLabel('No. KTP (NIK)').fill(CARD_NIK.slice(0, 15))
    await form.getByLabel('No. KTP (NIK)').fill(CARD_NIK)
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    // nor does scanning the same card, and it does not claim the stay goes to him
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    await expect(page.getByText('sewa dicatat atas namanya', { exact: false })).toHaveCount(0)
  })

  test('two guests with one name: the field stays for a returning guest who has a NIK, and another NIK is another person', async ({ page }) => {
    await page.evaluate((nik) => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const budi = db.tenants.find((t: { full_name: string }) => t.full_name === 'Budi Santoso')
      budi.nik = nik
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    }, CARD_NIK)
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Budi Santoso')
    const nik = form.getByLabel('No. KTP (NIK)')
    await expect(nik).toBeVisible()
    await expect(form.getByText(`Penyewa lama ini tercatat dengan NIK ${CARD_NIK}. Isi hanya bila tamunya orang lain.`)).toBeVisible()
    await nik.fill('3273019901010003')
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    // the old Budi has another NIK: this is a new tenant
    await expect(form.getByTestId('quick-checkin-summary')).not.toContainText('Penyewa lama')
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveText('Dokumen KTP · NIK 3273019901010003')
    await expect(form.getByLabel('Nomor HP')).toBeVisible()
  })

  test('touching the field does not make a name match count as a pick: a later scan is still a new tenant by default', async ({ page }) => {
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Budi Santoso')
    const nik = form.getByLabel('No. KTP (NIK)')
    await nik.fill('3')
    await nik.fill('')
    await form.getByRole('button', { name: 'Scan KTP / Paspor' }).click()
    await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
    await form.getByRole('button', { name: 'Terapkan' }).click()
    // SPEC 7.19: with a scan nobody is picked by name alone
    await expect(form.getByLabel('Nama ini sudah ada')).toHaveValue('baru')
    await expect(nik).toHaveValue(CARD_NIK)
  })

  test('a returning guest found by name keeps being picked while his NIK is typed, and gets it on his record', async ({ page }) => {
    const form = await openCheckIn(page)
    // the demo's Budi Santoso has no NIK on file: found by his name
    await form.getByLabel('Nama penyewa').fill('Budi Santoso')
    await expect(form.getByLabel('Nama ini sudah ada')).toHaveValue(/.+/)
    await expect(form.getByLabel('Nama ini sudah ada')).not.toHaveValue('baru')
    await expect(form.getByText('Penyewa lama ini belum punya NIK: isi untuk melengkapi datanya.')).toBeVisible()
    await form.getByLabel('No. KTP (NIK)').fill(CARD_NIK)
    await expect(form.getByLabel('Nama ini sudah ada')).not.toHaveValue('baru')
    await expect(form.getByText('NIK ini ditambahkan ke data penyewa lama ini. Pilih "Orang lain" bila bukan dia.')).toBeVisible()
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByTestId('quick-checkin-summary')).toContainText('Penyewa lama: Budi Santoso')
    await expect(form.getByTestId('quick-checkin-scan-fill')).toHaveText('Ditambahkan ke data penyewa: NIK')
    await form.getByRole('button', { name: 'Simpan check-in' }).click()
    await page.waitForURL(/\/sewa\/[^/]+$/)

    // one Budi Santoso, with the NIK; his phone kept
    await openTenantByNik(page, CARD_NIK, /Budi Santoso/)
    await expect(page.getByText(CARD_NIK)).toBeVisible()
    await expect(page.getByText('+6281234567801')).toBeVisible()
  })

  test('"Bukan dia?" for a scanned card holds after Hapus hasil scan and a scan of the same card', async ({ page }) => {
    await page.evaluate((nik) => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const free = db.tenants.find((t: { id: string }) => !db.leases.some((l: { tenant_id: string; status: string }) => l.tenant_id === t.id && l.status === 'active'))
      ;(free ?? db.tenants[0]).nik = nik
      ;(free ?? db.tenants[0]).full_name = 'Andi Wijaya'
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    }, CARD_NIK)
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const form = await openCheckIn(page)
    const scan = async () => {
      await form.getByRole('button', { name: /^Scan (ulang )?KTP \/ Paspor$/ }).click()
      await form.getByTestId('scanner-file-input').setInputFiles(PHOTO)
      await form.getByRole('button', { name: 'Terapkan' }).click()
    }
    await scan()
    await expect(form.getByTestId('quick-checkin-nik-match')).toContainText('Andi Wijaya')
    await form.getByRole('button', { name: 'Bukan dia?' }).click()
    await form.getByRole('button', { name: 'Hapus hasil scan' }).click()
    await page.getByText('sewa dicatat atas namanya', { exact: false }).waitFor({ state: 'detached' }).catch(() => undefined)
    await scan()
    await expect(form.getByTestId('quick-checkin-nik-match')).toHaveCount(0)
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByTestId('quick-checkin-summary')).not.toContainText('Penyewa lama')
  })

  test('a same-name tenant with a passport number on file is another person when a NIK is typed', async ({ page }) => {
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const budi = db.tenants.find((t: { full_name: string }) => t.full_name === 'Budi Santoso')
      Object.assign(budi, { id_type: 'passport', id_number: 'N1234567', nationality: 'AUS', nik: null })
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Budi Santoso')
    await expect(form.getByText('Penyewa lama ini tercatat dengan nomor N1234567. Isi hanya bila tamunya orang lain.')).toBeVisible()
    await form.getByLabel('No. KTP (NIK)').fill(CARD_NIK)
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByLabel('Nama ini sudah ada')).toHaveValue('baru')
    // no promise that the NIK goes on his record: he has another number
    await expect(form.getByText('NIK ini dianggap penyewa baru. Pilih penyewa lama bila orangnya sama.', { exact: true })).toBeVisible()
    await expect(form.getByTestId('quick-checkin-summary')).not.toContainText('Penyewa lama')
    await expect(form.getByTestId('quick-checkin-scanned')).toHaveText(`Dokumen KTP · NIK ${CARD_NIK}`)
    // picked by hand all the same: he stays picked, and the form says the NIK is not saved
    await form.getByLabel('Nama ini sudah ada').selectOption({ label: 'Penyewa lama · +6281234567801' })
    await expect(form.getByText('Penyewa lama ini tercatat dengan nomor N1234567; NIK yang diketik tidak disimpan. Pilih "Orang lain" bila bukan dia.')).toBeVisible()
  })

  test('a tenant picked by hand who does not fit the typed NIK is not swapped for the other same-name tenant', async ({ page }) => {
    // two Budi Santoso: the demo one (no NIK) and a second one with a NIK
    await page.evaluate((nik) => {
      const db = JSON.parse(localStorage.getItem('woombad.local.db.v1') ?? '{}')
      const budi = db.tenants.find((t: { full_name: string }) => t.full_name === 'Budi Santoso')
      db.tenants.push({ ...budi, id: 'budi-2', nik, phone: '+6281299990000' })
      localStorage.setItem('woombad.local.db.v1', JSON.stringify(db))
    }, CARD_NIK)
    await page.reload()
    await expect(page.getByTestId('room-board')).toBeVisible()
    const form = await openCheckIn(page)
    await form.getByLabel('Nama penyewa').fill('Budi Santoso')
    await form.getByLabel('Nama ini sudah ada').selectOption({ label: 'Penyewa lama · +6281299990000' })
    // his NIK with one digit wrong
    await form.getByLabel('No. KTP (NIK)').fill('3273012505900009')
    await fillMoney(form.getByLabel('Total bayar'), '180000')
    await expect(form.getByLabel('Nama ini sudah ada')).toHaveValue('baru')
    await expect(form.getByTestId('quick-checkin-summary')).not.toContainText('Penyewa lama')
  })
})
