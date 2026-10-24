// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildDemoDb, DEMO_ORG_ID } from '../../../lib/repo/demoSeed'
import { LocalRepo, emptyLocalDb, type LocalDb } from '../../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../../lib/repo/types'
import { LOCAL_DB_KEY } from '../../../components/deviceData'
import { buildBackupFile } from './backupFile'

const state: { repo: OrgRepo | null } = { repo: null }
vi.mock('../../../hooks/useOrg', () => ({ useOrg: () => ({ repo: state.repo }) }))

import { DemoImportModal } from './DemoImportModal'

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function onlineRepo(): OrgRepo {
  const db = emptyLocalDb()
  db.organizations.push({ id: ORG_ID, name: 'Kos Saya', created_by: 'owner', created_at: '2026-10-01T00:00:00.000Z' })
  return bindOrg(new LocalRepo(db), ORG_ID)
}

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <DemoImportModal onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

/** The sample seed plus the owner's own kos and shared expense, added later; the organisation renamed. */
function ownerDemoDb(): { db: LocalDb; ownKosId: string } {
  const db = buildDemoDb(new Date(2026, 9, 12))
  const later = { created_at: '2026-10-13T08:00:00.000Z', updated_at: '2026-10-13T08:00:00.000Z' }
  const ownKosId = crypto.randomUUID()
  db.organizations[0].name = 'Kos Pak Budi'
  db.properties.push({ id: ownKosId, org_id: DEMO_ORG_ID, name: 'Kos Mawar', address: null, notes: null, payment_info: null, logo_path: null, ...later })
  db.rooms.push({
    id: crypto.randomUUID(), org_id: DEMO_ORG_ID, property_id: ownKosId, name: 'M1', floor: null, price_daily: null, price_weekly: null,
    price_monthly: 900_000, status: 'active', notes: null, ...later,
  })
  db.expenses.push({
    id: crypto.randomUUID(), org_id: DEMO_ORG_ID, property_id: null, lease_id: null, category: 'wages', amount: 1_000_000,
    expense_date: '2026-10-13', description: 'Gaji penjaga Kos Mawar', vendor: null, receipt_path: null, created_by: null, ...later,
  })
  return { db, ownKosId }
}

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement

function pickFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([text], 'woombad-cadangan.json', { type: 'application/json' })] } })
}

describe('DemoImportModal', () => {
  beforeEach(() => {
    localStorage.clear()
    state.repo = onlineRepo()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('leaves the Mode Demo sample data unticked and imports only the owner\'s own data by default', async () => {
    const { db } = ownerDemoDb()
    renderModal()
    expect(screen.queryByText('Pakai data Mode Demo di perangkat ini')).toBeNull()
    pickFile(JSON.stringify(buildBackupFile(db, 'Kos Pak Budi')))

    expect(await screen.findByText('Kos Mawar')).toBeTruthy()
    expect(screen.getByText(/adalah data contoh Mode Demo dan tidak dicentang, termasuk pengeluaran bersama dan add-on contoh/)).toBeTruthy()
    expect(checkbox(/Kos Mawar/).checked).toBe(true)
    expect(checkbox(/Kos Melati/).checked).toBe(false)
    expect(checkbox(/Kos Anggrek/).checked).toBe(false)
    expect(checkbox(/Kos Melati/).parentElement?.textContent).toContain('Contoh')
    expect(checkbox(/Pengeluaran bersama/).checked).toBe(true)
    expect(screen.getByText('1 pengeluaran')).toBeTruthy()
    expect(checkbox(/Data contoh tanpa kos/).checked).toBe(false)
    expect(screen.getByText('7 pengeluaran bersama · 4 add-on')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Impor 3 data' }))
    expect(await screen.findByText('Impor selesai. 3 data masuk.')).toBeTruthy()
    const repo = state.repo!
    expect((await repo.list('properties')).map((p) => p.name)).toEqual(['Kos Mawar'])
    expect((await repo.list('expenses')).map((e) => e.description)).toEqual(['Gaji penjaga Kos Mawar'])
    expect(await repo.list('addon_catalog')).toEqual([])
  })

  it('ticks a sample kos the owner used, says how much of it is his, and warns about the sample data it brings along', async () => {
    const { db, ownKosId } = ownerDemoDb()
    const melati = db.properties.find((p) => p.name === 'Kos Melati')!
    const lease = db.leases.find((l) => l.property_id === melati.id)!
    const invoice = db.invoices.find((i) => i.lease_id === lease.id)!
    const later = { created_at: '2026-10-14T09:00:00.000Z', updated_at: '2026-10-14T09:00:00.000Z' }
    db.payments.push({
      id: crypto.randomUUID(), org_id: DEMO_ORG_ID, property_id: melati.id, invoice_id: invoice.id, lease_id: lease.id, amount: 825_000,
      paid_at: '2026-10-14', method: 'cash', kind: 'rent', notes: null, created_by: null, created_at: later.created_at,
    })
    for (const [i, pid] of [melati.id, ownKosId].entries()) {
      db.expenses.push({
        id: crypto.randomUUID(), org_id: DEMO_ORG_ID, property_id: pid, lease_id: null, category: 'marketing', amount: 100_000,
        expense_date: '2026-10-14', description: `Iklan Facebook (${i + 1}/2)`, vendor: null, receipt_path: null, created_by: null, ...later,
      })
    }
    renderModal()
    pickFile(JSON.stringify(buildBackupFile(db, 'Kos Pak Budi')))

    expect(await screen.findByText('Kos Melati')).toBeTruthy()
    expect(checkbox(/Kos Melati/).checked).toBe(true)
    expect(checkbox(/Kos Melati/).parentElement?.textContent).not.toContain('Contoh')
    // the payment is his; the part of the split expense does not count
    expect(screen.getByText(/^Berisi 1 data yang Anda tambahkan dan \d+ data contoh\.$/)).toBeTruthy()
    expect(checkbox(/Kos Anggrek/).checked).toBe(false)
    const melatiPayments = db.payments.filter((p) => p.property_id === melati.id && p.created_at !== later.created_at)
    expect(screen.getByText(new RegExp(`termasuk ${melatiPayments.length} pembayaran contoh senilai`))).toBeTruthy()
    expect(screen.getByText(/Setelah online, data ini sulit dihapus/)).toBeTruthy()

    // unticked, its part of the split expense comes along as a shared expense instead of asking to tick the kos
    fireEvent.click(checkbox(/Kos Melati/))
    expect(screen.queryByText(/sulit dihapus/)).toBeNull()
    expect(screen.getByText(/Bagian “Iklan Facebook” untuk kos contoh ikut sebagai pengeluaran bersama/)).toBeTruthy()
    expect(screen.queryByText(/hanya ikut sebagian/)).toBeNull()
  })

  it('keeps sample kos unticked when the owner only split an expense over every kos', async () => {
    const { db, ownKosId } = ownerDemoDb()
    const later = { created_at: '2026-10-14T09:00:00.000Z', updated_at: '2026-10-14T09:00:00.000Z' }
    const kos = [...db.properties.filter((p) => p.id !== ownKosId).map((p) => p.id), ownKosId]
    for (const [i, pid] of kos.entries()) {
      db.expenses.push({
        id: crypto.randomUUID(), org_id: DEMO_ORG_ID, property_id: pid, lease_id: null, category: 'utilities', amount: 100_000,
        expense_date: '2026-10-14', description: `Wifi (${i + 1}/3)`, vendor: null, receipt_path: null, created_by: null, ...later,
      })
    }
    renderModal()
    pickFile(JSON.stringify(buildBackupFile(db, 'Kos Pak Budi')))

    expect(await screen.findByText('Kos Mawar')).toBeTruthy()
    expect(checkbox(/Kos Melati/).checked).toBe(false)
    expect(checkbox(/Kos Anggrek/).checked).toBe(false)
    expect(screen.queryByText(/sulit dihapus/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Impor 6 data' }))
    expect(await screen.findByText('Impor selesai. 6 data masuk.')).toBeTruthy()
    const expenses = await state.repo!.list('expenses')
    expect(expenses.filter((e) => e.description.startsWith('Wifi')).map((e) => [e.description, e.property_id === null])).toEqual(
      expect.arrayContaining([
        ['Wifi (1/3)', true],
        ['Wifi (2/3)', true],
        ['Wifi (3/3)', false],
      ]),
    )
    expect(await state.repo!.list('payments')).toEqual([])
  })

  it('imports a sample kos the owner ticks and shows the result', async () => {
    const demo = buildDemoDb(new Date(2026, 9, 12))
    renderModal()
    pickFile(JSON.stringify(buildBackupFile(demo, 'Kos Keluarga (Demo)')))

    expect(await screen.findByText('Kos Melati')).toBeTruthy()
    expect(screen.getByText('Kos Anggrek')).toBeTruthy()
    expect(screen.getByText(/^6 kamar · 4 penyewa · 4 sewa/)).toBeTruthy()
    expect(screen.queryByText('Pengeluaran bersama (tanpa kos)')).toBeNull()
    expect(screen.getByRole('button', { name: 'Impor 0 data' })).toHaveProperty('disabled', true)

    fireEvent.click(checkbox(/Kos Melati/))
    const melati = demo.properties.find((p) => p.name === 'Kos Melati')!
    const expected =
      1 +
      demo.rooms.filter((r) => r.property_id === melati.id).length +
      4 + // tenants
      4 + // leases
      demo.lease_addons.filter((a) => demo.leases.some((l) => l.id === a.lease_id && l.property_id === melati.id)).length +
      demo.invoices.filter((i) => i.property_id === melati.id).length +
      demo.payments.filter((p) => p.property_id === melati.id).length +
      demo.expenses.filter((e) => e.property_id === melati.id).length +
      demo.waitlist.filter((w) => w.property_id === melati.id).length // daftar tunggu of the kos (SPEC 7.7)
    fireEvent.click(screen.getByRole('button', { name: `Impor ${expected} data` }))

    expect(await screen.findByText(`Impor selesai. ${expected} data masuk.`)).toBeTruthy()
    const repo = state.repo!
    expect((await repo.list('properties')).map((p) => p.name)).toEqual(['Kos Melati'])
    expect(await repo.list('expenses')).toHaveLength(demo.expenses.filter((e) => e.property_id === melati.id).length)
    expect(await repo.list('addon_catalog')).toEqual([])
  })

  it('offers the Mode Demo data still stored on this device and skips what is already online', async () => {
    const demo = buildDemoDb(new Date(2026, 9, 12))
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(demo))
    const tickEverything = () => {
      for (const name of [/Kos Melati/, /Kos Anggrek/, /Data contoh tanpa kos/]) fireEvent.click(checkbox(name))
    }
    renderModal()
    fireEvent.click(screen.getByText('Pakai data Mode Demo di perangkat ini'))
    expect(await screen.findByText('Kos Melati')).toBeTruthy()
    tickEverything()
    const total = Number(/Impor (\d+) data/.exec(screen.getByRole('button', { name: /^Impor \d+ data$/ }).textContent ?? '')?.[1])
    expect(total).toBe(Object.values(demo).reduce((n, rows) => n + rows.length, 0) - 2) // all but the organisation and its member
    fireEvent.click(screen.getByRole('button', { name: /^Impor \d+ data$/ }))
    expect(await screen.findByText(`Impor selesai. ${total} data masuk.`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    cleanup()
    // the LocalRepo standing in for the server also writes to localStorage; put the demo data back
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(demo))

    renderModal()
    fireEvent.click(screen.getByText('Pakai data Mode Demo di perangkat ini'))
    expect(await screen.findAllByText('Sudah pernah diimpor')).toHaveLength(2)
    tickEverything()
    expect(screen.getByRole('button', { name: 'Impor 0 data' })).toHaveProperty('disabled', true)
    expect(screen.getByText(`Dilewati ${total}: sudah ada online: ${total}`)).toBeTruthy()
  })

  it('shows an Indonesian error for a file that is not a backup', async () => {
    renderModal()
    pickFile('{"hello": "world"}')
    expect(await screen.findByText('File ini bukan cadangan Woombad.')).toBeTruthy()
    pickFile('bukan json')
    await waitFor(() => expect(screen.getByText('File tidak bisa dibaca. Pilih file cadangan Woombad (.json).')).toBeTruthy())
  })

  it('reports a stopped import and what already went in', async () => {
    const repo = state.repo!
    const insertMany = repo.insertMany
    state.repo = {
      ...repo,
      insertMany: ((table, rows) =>
        table === 'leases' ? Promise.reject(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')) : insertMany(table, rows)) as OrgRepo['insertMany'],
    }
    renderModal()
    pickFile(JSON.stringify(buildDemoDb(new Date(2026, 9, 12))))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Kos Melati/ }))
    fireEvent.click(checkbox(/Kos Anggrek/))
    fireEvent.click(screen.getByRole('button', { name: /^Impor \d+ data$/ }))
    expect(await screen.findByText(/^Impor terhenti\./)).toBeTruthy()
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByText(/Jalankan impor lagi/)).toBeTruthy()
    expect(await repo.list('properties')).toHaveLength(2)
    expect(await repo.list('leases')).toHaveLength(0)
  })
})
