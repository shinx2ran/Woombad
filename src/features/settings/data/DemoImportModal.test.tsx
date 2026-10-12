// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildDemoDb } from '../../../lib/repo/demoSeed'
import { LocalRepo, emptyLocalDb } from '../../../lib/repo/localRepo'
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

  it('previews a demo backup file per kos, imports the selected kos and shows the result', async () => {
    const demo = buildDemoDb(new Date(2026, 9, 12))
    renderModal()
    expect(screen.queryByText('Pakai data Mode Demo di perangkat ini')).toBeNull()
    pickFile(JSON.stringify(buildBackupFile(demo, 'Kos Keluarga (Demo)')))

    expect(await screen.findByText('Kos Melati')).toBeTruthy()
    expect(screen.getByText('Kos Anggrek')).toBeTruthy()
    expect(screen.getByText(/mungkin berisi data contoh/)).toBeTruthy()
    expect(screen.getByText(/^6 kamar · 4 penyewa · 4 sewa/)).toBeTruthy()
    expect(screen.getByText('Pengeluaran bersama (tanpa kos)')).toBeTruthy()

    // keep only Kos Melati, without shared expenses
    fireEvent.click(screen.getByRole('checkbox', { name: /Kos Anggrek/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Pengeluaran bersama/ }))
    const melati = demo.properties.find((p) => p.name === 'Kos Melati')!
    const expected =
      1 +
      demo.rooms.filter((r) => r.property_id === melati.id).length +
      demo.addon_catalog.length +
      4 + // tenants
      4 + // leases
      demo.lease_addons.filter((a) => demo.leases.some((l) => l.id === a.lease_id && l.property_id === melati.id)).length +
      demo.invoices.filter((i) => i.property_id === melati.id).length +
      demo.payments.filter((p) => p.property_id === melati.id).length +
      demo.expenses.filter((e) => e.property_id === melati.id).length
    fireEvent.click(screen.getByRole('button', { name: `Impor ${expected} data` }))

    expect(await screen.findByText(`Impor selesai. ${expected} data masuk.`)).toBeTruthy()
    const repo = state.repo!
    expect((await repo.list('properties')).map((p) => p.name)).toEqual(['Kos Melati'])
    expect(await repo.list('expenses')).toHaveLength(demo.expenses.filter((e) => e.property_id === melati.id).length)
  })

  it('offers the Mode Demo data still stored on this device and skips what is already online', async () => {
    const demo = buildDemoDb(new Date(2026, 9, 12))
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(demo))
    renderModal()
    fireEvent.click(screen.getByText('Pakai data Mode Demo di perangkat ini'))
    expect(await screen.findByText('Kos Melati')).toBeTruthy()
    const total = Number(/Impor (\d+) data/.exec(screen.getByRole('button', { name: /^Impor \d+ data$/ }).textContent ?? '')?.[1])
    fireEvent.click(screen.getByRole('button', { name: /^Impor \d+ data$/ }))
    expect(await screen.findByText(`Impor selesai. ${total} data masuk.`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    cleanup()
    // the LocalRepo standing in for the server also writes to localStorage; put the demo data back
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(demo))

    renderModal()
    fireEvent.click(screen.getByText('Pakai data Mode Demo di perangkat ini'))
    expect(await screen.findAllByText('Sudah pernah diimpor')).toHaveLength(2)
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
    fireEvent.click(await screen.findByRole('button', { name: /^Impor \d+ data$/ }))
    expect(await screen.findByText(/^Impor terhenti\./)).toBeTruthy()
    expect(screen.getByText('Tidak dapat terhubung ke server. Periksa koneksi internet.')).toBeTruthy()
    expect(screen.getByText(/Jalankan impor lagi/)).toBeTruthy()
    expect(await repo.list('properties')).toHaveLength(2)
    expect(await repo.list('leases')).toHaveLength(0)
  })
})
