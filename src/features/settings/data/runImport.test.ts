import { describe, expect, it, vi } from 'vitest'
import { buildDemoDb } from '../../../lib/repo/demoSeed'
import { LocalRepo, emptyLocalDb } from '../../../lib/repo/localRepo'
import { bindOrg } from '../../../lib/repo/types'
import { TABLE_NAMES, type TableName } from '../../../types/db'
import type { BackupRow, ParsedBackup } from './backupFormat'
import { IMPORT_ORDER, planDemoImport, plannedCount, previewBackup, type ImportPlan, type ImportSelection, type ImportTable, type PlannedRow } from './demoImport'
import { fetchExistingOnline } from './orgData'
import { importedCount, runImportPlan, type InsertRows } from './runImport'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function planOf(rows: Partial<Record<ImportTable, PlannedRow[]>>): ImportPlan {
  const tables = {} as ImportPlan['tables']
  for (const t of IMPORT_ORDER) {
    tables[t] = { rows: rows[t] ?? [], skipped: { exists: 0, invalid_id: 0, other_org: 0, invalid_data: 0, broken_ref: 0 } }
  }
  return { tables, renumberedInvoices: 0, partialSplits: [] }
}

const planned = (id: string, deps: string[] = []): PlannedRow => ({ id, row: { id }, deps })

function recorder(fail?: (table: ImportTable, rows: Record<string, unknown>[]) => string | null) {
  const calls: { table: ImportTable; ids: unknown[] }[] = []
  const insert: InsertRows = async (table, rows) => {
    calls.push({ table, ids: rows.map((r) => r.id) })
    const message = fail?.(table, rows)
    if (message) throw new Error(message)
    return rows
  }
  return { calls, insert }
}

describe('runImportPlan', () => {
  it('inserts tables in dependency order, in chunks, and reports progress', async () => {
    const plan = planOf({
      properties: [planned(u(1))],
      rooms: [planned(u(11), [u(1)]), planned(u(12), [u(1)]), planned(u(13), [u(1)])],
      expenses: [planned(u(71))],
    })
    const { calls, insert } = recorder()
    const progress = vi.fn()
    const result = await runImportPlan(plan, insert, { chunkSize: 2, onProgress: progress })
    expect(calls).toEqual([
      { table: 'properties', ids: [u(1)] },
      { table: 'rooms', ids: [u(11), u(12)] },
      { table: 'rooms', ids: [u(13)] },
      { table: 'expenses', ids: [u(71)] },
    ])
    expect(result.error).toBeNull()
    expect(result.tables.rooms.imported).toBe(3)
    expect(importedCount(result)).toBe(5)
    expect(progress).toHaveBeenLastCalledWith({ table: 'expenses', done: 5, total: 5 })
  })

  it('retries a rejected chunk row by row and skips the rows that depend on a rejected row', async () => {
    const plan = planOf({
      properties: [planned(u(1)), planned(u(2))],
      rooms: [planned(u(11), [u(1)]), planned(u(12), [u(2)])],
    })
    const { calls, insert } = recorder((_table, rows) => (rows.some((r) => r.id === u(2)) ? 'new row violates check constraint' : null))
    const result = await runImportPlan(plan, insert)
    expect(result.error).toBeNull()
    expect(result.tables.properties).toMatchObject({ imported: 1, failed: 1, firstError: 'new row violates check constraint' })
    expect(result.tables.rooms).toMatchObject({ imported: 1, failed: 0 })
    expect(result.tables.rooms.skipped.broken_ref).toBe(1)
    expect(calls.filter((c) => c.table === 'rooms')).toEqual([{ table: 'rooms', ids: [u(11)] }])
  })

  it('keeps the skip counts of the plan', async () => {
    const plan = planOf({ rooms: [planned(u(11))] })
    plan.tables.rooms.skipped.exists = 4
    plan.renumberedInvoices = 2
    const result = await runImportPlan(plan, recorder().insert)
    expect(result.tables.rooms.skipped.exists).toBe(4)
    expect(result.renumberedInvoices).toBe(2)
  })

  it('stops on a connection or permission error and keeps what was inserted', async () => {
    const plan = planOf({ properties: [planned(u(1))], rooms: [planned(u(11), [u(1)])], expenses: [planned(u(71))] })
    const { calls, insert } = recorder((table) => (table === 'rooms' ? 'Tidak dapat terhubung ke server. Periksa koneksi internet.' : null))
    const result = await runImportPlan(plan, insert)
    expect(result.error).toBe('Tidak dapat terhubung ke server. Periksa koneksi internet.')
    expect(result.tables.properties.imported).toBe(1)
    expect(calls.map((c) => c.table)).toEqual(['properties', 'rooms'])
  })

  it('stops when the server rejects too many rows', async () => {
    const plan = planOf({ expenses: [planned(u(71)), planned(u(72)), planned(u(73)), planned(u(74))] })
    const result = await runImportPlan(plan, recorder(() => 'column "x" does not exist').insert, { maxFailures: 3 })
    expect(result.error).toBe('Terlalu banyak data ditolak server: column "x" does not exist')
    expect(result.tables.expenses.failed).toBe(3)
  })
})

describe('demo import end to end (LocalRepo as the online organisation)', () => {
  function demoBackup(): ParsedBackup {
    const db = buildDemoDb(new Date(2026, 9, 12))
    const tables = {} as Record<TableName, BackupRow[]>
    for (const t of TABLE_NAMES) tables[t] = db[t] as unknown as BackupRow[]
    return { orgName: db.organizations[0].name, exportedAt: null, tables }
  }

  function onlineOrg() {
    const db = emptyLocalDb()
    const orgId = crypto.randomUUID()
    db.organizations.push({ id: orgId, name: 'Kos Saya', created_by: 'owner', created_at: new Date().toISOString() })
    return bindOrg(new LocalRepo(db), orgId)
  }

  it('imports every row with the new org_id and intact references, then skips everything on a second run', async () => {
    const backup = demoBackup()
    const repo = onlineOrg()
    // everything ticked, the sample data included
    const selection: ImportSelection = { propertyIds: previewBackup(backup).properties.map((p) => p.id), includeShared: true, includeSample: true }
    const plan = planDemoImport(backup, selection, await fetchExistingOnline(repo))
    const result = await runImportPlan(plan, (table, rows) => repo.insertMany(table, rows as never))
    expect(result.error).toBeNull()
    expect(importedCount(result)).toBe(plannedCount(plan))

    for (const t of IMPORT_ORDER) {
      const rows = await repo.list(t)
      expect(rows.length, t).toBe(backup.tables[t].length)
      expect(rows.every((r) => r.org_id === repo.orgId)).toBe(true)
    }
    const roomIds = new Set((await repo.list('rooms')).map((r) => r.id))
    const tenantIds = new Set((await repo.list('tenants')).map((r) => r.id))
    const invoiceIds = new Set((await repo.list('invoices')).map((r) => r.id))
    expect((await repo.list('leases')).every((l) => roomIds.has(l.room_id) && tenantIds.has(l.tenant_id))).toBe(true)
    expect((await repo.list('payments')).every((p) => p.invoice_id === null || invoiceIds.has(p.invoice_id))).toBe(true)

    const again = planDemoImport(backup, selection, await fetchExistingOnline(repo))
    expect(plannedCount(again)).toBe(0)
  })
})
