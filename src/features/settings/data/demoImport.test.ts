import { describe, expect, it } from 'vitest'
import { buildDemoDb } from '../../../lib/repo/demoSeed'
import { TABLE_NAMES, type TableName } from '../../../types/db'
import type { BackupRow, ParsedBackup } from './backupFormat'
import {
  IMPORT_ORDER,
  defaultSelection,
  emptyExisting,
  existingFromRows,
  isUuid,
  normalizeRow,
  planDemoImport,
  plannedCount,
  previewBackup,
  sampleOutsideKosCount,
  skippedByReason,
  sourceOrgId,
  type ExistingOnline,
  type ImportPlan,
  type ImportTable,
} from './demoImport'

const ORG = 'demo-org'
/** deterministic UUIDs: u(1) = 00000000-0000-4000-8000-000000000001 */
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function backupFrom(tables: Partial<Record<TableName, Record<string, unknown>[]>>): ParsedBackup {
  const full = {} as Record<TableName, BackupRow[]>
  for (const t of TABLE_NAMES) full[t] = (tables[t] ?? []) as BackupRow[]
  return { orgName: 'Kos Saya', exportedAt: null, tables: full }
}

function demoBackup(): ParsedBackup {
  return backupFrom(buildDemoDb(new Date(2026, 9, 12)) as unknown as Record<TableName, Record<string, unknown>[]>)
}

const ts = { org_id: ORG, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
const property = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, address: null, notes: null, payment_info: null, ...ts, ...extra })
const room = (id: string, property_id: string, name = 'A1') => ({ id, property_id, name, floor: null, price_daily: null, price_weekly: null, price_monthly: 1_000_000, status: 'active', notes: null, ...ts })
const tenant = (id: string, property_id: string | null, extra: Record<string, unknown> = {}) => ({ id, property_id, full_name: `Penyewa ${id.slice(-2)}`, id_type: 'ktp', ...ts, ...extra })
const lease = (id: string, property_id: string, room_id: string, tenant_id: string, extra: Record<string, unknown> = {}) => ({
  id, property_id, room_id, tenant_id, period_type: 'monthly', price_per_period: 1_000_000, deposit_amount: 0,
  start_date: '2026-01-01', end_date: '2026-01-31', status: 'active', checkout_date: null, notes: null, ...ts, ...extra,
})
const invoice = (id: string, property_id: string, lease_id: string, invoice_number: string, extra: Record<string, unknown> = {}) => ({
  id, property_id, lease_id, invoice_number, period_type: 'monthly', period_start: '2026-01-01', period_end: '2026-01-31', quantity: 1,
  base_amount: 1_000_000, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: 1_000_000, due_date: '2026-01-01',
  status: 'paid', notes: null, ...ts, ...extra,
})
const payment = (id: string, property_id: string, invoice_id: string | null, lease_id: string | null, extra: Record<string, unknown> = {}) => ({
  id, property_id, invoice_id, lease_id, amount: 1_000_000, paid_at: '2026-01-02', method: 'cash', kind: invoice_id ? 'rent' : 'deposit', notes: null, created_by: null, ...ts, ...extra,
})
const expense = (id: string, property_id: string | null, extra: Record<string, unknown> = {}) => ({
  id, property_id, lease_id: null, category: 'utilities', amount: 100_000, expense_date: '2026-01-05', description: 'Listrik', vendor: null, receipt_path: null, created_by: null, ...ts, ...extra,
})

/**
 * Two kos (K1, K2), one room/tenant/lease/invoice/payment each, plus kos-specific and shared expenses.
 * All rows were added by the owner after the organisation was created (so none of them is sample data).
 */
function smallBackup(): ParsedBackup {
  return backupFrom({
    organizations: [{ id: ORG, name: 'Kos Saya', created_by: 'local-user', created_at: '2025-12-01T00:00:00.000Z' }],
    properties: [property(u(1), 'Kos Melati'), property(u(2), 'Kos Anggrek')],
    rooms: [room(u(11), u(1)), room(u(12), u(2), 'B1')],
    tenants: [tenant(u(21), u(1)), tenant(u(22), u(2))],
    leases: [lease(u(31), u(1), u(11), u(21)), lease(u(32), u(2), u(12), u(22))],
    lease_addons: [{ id: u(41), lease_id: u(31), name: 'Parkir', amount: 50_000, billing: 'per_period', ...ts }],
    invoices: [invoice(u(51), u(1), u(31), 'INV-202601-0001'), invoice(u(52), u(2), u(32), 'INV-202601-0002')],
    payments: [payment(u(61), u(1), u(51), u(31)), payment(u(62), u(2), u(52), u(32))],
    expenses: [expense(u(71), u(1)), expense(u(72), u(2)), expense(u(73), null, { category: 'wages', description: 'Gaji' })],
    addon_catalog: [
      { id: u(81), property_id: null, name: 'Laundry', default_price: 100_000, billing: 'per_period', ...ts },
      { id: u(82), property_id: u(2), name: 'AC', default_price: 200_000, billing: 'per_period', ...ts },
    ],
  })
}

const ids = (plan: ImportPlan, table: ImportTable) => plan.tables[table].rows.map((r) => r.id)
const rowOf = (plan: ImportPlan, table: ImportTable, id: string) => plan.tables[table].rows.find((r) => r.id === id)?.row

function existingOf(rows: Partial<Record<ImportTable, { id: string; invoice_number?: string }[]>>): ExistingOnline {
  return existingFromRows(rows)
}

const all = (b: ParsedBackup) => defaultSelection(previewBackup(b))

describe('previewBackup', () => {
  it('counts rows per kos in the demo seed and its shared expenses as sample data', () => {
    const backup = demoBackup()
    const preview = previewBackup(backup)
    expect(preview.properties.map((p) => p.name)).toEqual(['Kos Anggrek', 'Kos Melati'])
    const melati = preview.properties.find((p) => p.name === 'Kos Melati')!
    const anggrek = preview.properties.find((p) => p.name === 'Kos Anggrek')!
    expect(melati).toMatchObject({ rooms: 6, leases: 4, tenants: 4, alreadyOnline: false, sample: true })
    expect(anggrek).toMatchObject({ rooms: 4, leases: 3, tenants: 3, sample: true })
    const t = backup.tables
    expect(melati.invoices + anggrek.invoices).toBe(t.invoices.length)
    expect(melati.payments + anggrek.payments).toBe(t.payments.length)
    expect(melati.expenses + anggrek.expenses + preview.sample.expenses).toBe(t.expenses.length)
    expect(preview.sharedExpenses).toBe(0)
    expect(preview.sample).toEqual({ expenses: t.expenses.filter((e) => e.property_id === null).length, addons: 4, tenants: 0 })
  })

  it('counts tenants without a lease under their home kos and marks kos that are already online', () => {
    const backup = smallBackup()
    backup.tables.tenants.push(tenant(u(23), u(1)) as BackupRow)
    const preview = previewBackup(backup, existingOf({ properties: [{ id: u(2) }] }))
    const [anggrek, melati] = preview.properties
    expect(melati).toMatchObject({ name: 'Kos Melati', tenants: 2, rooms: 1, leases: 1, invoices: 1, payments: 1, expenses: 1, alreadyOnline: false })
    expect(anggrek.alreadyOnline).toBe(true)
    expect(preview.sharedExpenses).toBe(1)
  })

  it('treats expenses whose kos is gone as shared and hides kos of other organisations', () => {
    const backup = smallBackup()
    backup.tables.expenses.push(expense(u(74), u(99)) as BackupRow)
    backup.tables.properties.push(property(u(3), 'Kos Lain', { org_id: 'other-org' }) as BackupRow)
    const preview = previewBackup(backup)
    expect(preview.sharedExpenses).toBe(2)
    expect(preview.properties.map((p) => p.name)).not.toContain('Kos Lain')
  })

  it('selects every kos by default and shared expenses only when there are some', () => {
    const backup = smallBackup()
    expect(previewBackup(backup).properties.some((p) => p.sample)).toBe(false)
    expect(defaultSelection(previewBackup(backup))).toEqual({ propertyIds: [u(2), u(1)], includeShared: true, includeSample: false })
    backup.tables.expenses = backup.tables.expenses.filter((e) => e.property_id !== null)
    expect(defaultSelection(previewBackup(backup)).includeShared).toBe(false)
  })
})

const LATER = { org_id: ORG, created_at: '2026-10-13T08:00:00.000Z', updated_at: '2026-10-13T08:00:00.000Z' }
/** Rows the owner added to his Mode Demo next to the sample data (ids 1xx), in import order. */
const OWN_IDS = [101, 111, 181, 121, 131, 151, 161, 171, 172].map(u)

/** The owner's Mode Demo: the sample seed, his own kos "Kos Mawar" added a day later, the organisation renamed. */
function ownerDemoBackup(): ParsedBackup {
  const backup = demoBackup()
  const t = backup.tables
  t.organizations[0].name = 'Kos Pak Budi'
  backup.orgName = 'Kos Pak Budi'
  t.properties.push(property(u(101), 'Kos Mawar', LATER) as BackupRow)
  t.rooms.push({ ...room(u(111), u(101), 'M1'), ...LATER } as BackupRow)
  t.tenants.push(tenant(u(121), u(101), LATER) as BackupRow)
  t.leases.push(lease(u(131), u(101), u(111), u(121), LATER) as BackupRow)
  t.invoices.push(invoice(u(151), u(101), u(131), 'INV-202610-0100', LATER) as BackupRow)
  t.payments.push(payment(u(161), u(101), u(151), u(131), LATER) as BackupRow)
  t.expenses.push(
    expense(u(171), u(101), LATER) as BackupRow,
    expense(u(172), null, { ...LATER, category: 'wages', description: 'Gaji penjaga Kos Mawar', amount: 1_000_000 }) as BackupRow,
  )
  t.addon_catalog.push({ id: u(181), property_id: null, name: 'Galon', default_price: 20_000, billing: 'per_period', ...LATER } as BackupRow)
  return backup
}

const plannedIds = (plan: ImportPlan) => IMPORT_ORDER.flatMap((t) => ids(plan, t))
const sumAmounts = (plan: ImportPlan) => plan.tables.expenses.rows.reduce((s, r) => s + (r.row.amount as number), 0)

describe('Mode Demo sample data', () => {
  it('marks the sample kos and leaves them, the sample shared expenses and the sample add-ons unticked', () => {
    const backup = ownerDemoBackup()
    const preview = previewBackup(backup)
    expect(preview.properties.map((p) => [p.name, p.sample])).toEqual([
      ['Kos Anggrek', true],
      ['Kos Mawar', false],
      ['Kos Melati', true],
    ])
    expect(preview.sharedExpenses).toBe(1)
    expect(preview.sample).toEqual({ expenses: 7, addons: 4, tenants: 0 })
    expect(sampleOutsideKosCount(preview)).toBe(11)
    expect(defaultSelection(preview)).toEqual({ propertyIds: [u(101)], includeShared: true, includeSample: false })
  })

  it('imports only the owner\'s own rows by default (no fake wages, PBB or add-ons in the online books)', () => {
    const backup = ownerDemoBackup()
    for (const selection of [all(backup), { propertyIds: [u(101)], includeShared: true }]) {
      const plan = planDemoImport(backup, selection)
      expect(plannedIds(plan)).toEqual(OWN_IDS)
      expect(ids(plan, 'expenses')).toEqual([u(171), u(172)])
      expect(sumAmounts(plan)).toBe(1_100_000)
      expect(ids(plan, 'addon_catalog')).toEqual([u(181)])
      expect(Object.values(skippedByReason(plan)).every((n) => n === 0)).toBe(true)
    }
  })

  it('imports a sample kos the owner ticks, and the sample rows outside any kos only when asked', () => {
    const backup = ownerDemoBackup()
    const melati = previewBackup(backup).properties.find((p) => p.name === 'Kos Melati')!
    const t = backup.tables
    const melatiExpenses = t.expenses.filter((e) => e.property_id === melati.id).length
    const sampleShared = t.expenses.filter((e) => e.property_id === null && e.created_at !== LATER.created_at).length

    const withKos = planDemoImport(backup, { propertyIds: [melati.id], includeShared: false })
    expect(ids(withKos, 'properties')).toEqual([melati.id])
    expect(ids(withKos, 'rooms')).toHaveLength(6)
    expect(ids(withKos, 'leases')).toHaveLength(4)
    expect(ids(withKos, 'expenses')).toHaveLength(melatiExpenses)
    expect(ids(withKos, 'addon_catalog')).toEqual([u(181)]) // the owner's org-wide add-on follows any kos

    const withSample = planDemoImport(backup, { propertyIds: [], includeShared: false, includeSample: true })
    expect(ids(withSample, 'expenses')).toHaveLength(sampleShared)
    expect(sumAmounts(withSample)).toBe(9_500_000)
    expect(ids(withSample, 'addon_catalog')).toHaveLength(4)
    expect(ids(withSample, 'properties')).toEqual([])
  })

  it('treats a sample tenant without lease or kos as sample data outside any kos', () => {
    const backup = ownerDemoBackup()
    const stamp = backup.tables.organizations[0].created_at as string
    backup.tables.tenants.push(tenant(u(129), u(98), { created_at: stamp, updated_at: stamp }) as BackupRow)
    expect(previewBackup(backup).sample.tenants).toBe(1)
    expect(ids(planDemoImport(backup, all(backup)), 'tenants')).toEqual([u(121)])
    expect(ids(planDemoImport(backup, { ...all(backup), includeSample: true }), 'tenants')).toEqual([u(121), u(129)])
  })

  it('never marks rows of an online organisation as sample data', () => {
    const backup = smallBackup()
    const orgId = u(900)
    backup.tables.organizations[0] = { ...backup.tables.organizations[0], id: orgId, created_at: ts.created_at }
    for (const table of TABLE_NAMES) for (const r of backup.tables[table]) if ('org_id' in r) r.org_id = orgId
    const preview = previewBackup(backup)
    expect(preview.properties.every((p) => !p.sample)).toBe(true)
    expect(sampleOutsideKosCount(preview)).toBe(0)
    expect(defaultSelection(preview).propertyIds).toHaveLength(2)
  })
})

/** Rows the owner added inside the sample kos Melati in Mode Demo (B14b), and a split expense over three kos (B13). */
function ownerUsedSampleBackup() {
  const backup = ownerDemoBackup()
  const t = backup.tables
  const melati = t.properties.find((p) => p.name === 'Kos Melati')!
  const anggrek = t.properties.find((p) => p.name === 'Kos Anggrek')!
  const melatiLease = t.leases.find((l) => l.property_id === melati.id)!
  t.invoices.push(invoice(u(201), melati.id, melatiLease.id, 'INV-202610-0005', { ...LATER, total_amount: 1_800_000, base_amount: 1_800_000 }) as BackupRow)
  t.payments.push(
    payment(u(211), melati.id, u(201), melatiLease.id, LATER) as BackupRow,
    payment(u(212), melati.id, u(201), melatiLease.id, { ...LATER, amount: 825_000 }) as BackupRow,
  )
  t.expenses.push(
    expense(u(221), melati.id, { ...LATER, category: 'deposit_refund', lease_id: melatiLease.id, amount: 1_200_000 }) as BackupRow,
    ...[melati.id, anggrek.id, u(101)].map(
      (pid, i) => expense(u(231 + i), pid, { ...LATER, category: 'marketing', description: `Iklan Facebook (${i + 1}/3)` }) as BackupRow,
    ),
  )
  return { backup, melati, anggrek }
}

describe('Mode Demo sample kos the owner used', () => {
  it('is the owner\'s once he added rows under it: ticked by default, with the count of his own rows', () => {
    const { backup, melati, anggrek } = ownerUsedSampleBackup()
    const preview = previewBackup(backup)
    const m = preview.properties.find((p) => p.id === melati.id)!
    // invoice, two payments, deposit refund and one part of the split expense
    expect(m).toMatchObject({ sample: false, usedSample: true, ownRows: 5 })
    expect(m.sampleRows).toBeGreaterThan(20)
    // Anggrek only got one part of the split expense: also used
    expect(preview.properties.find((p) => p.id === anggrek.id)).toMatchObject({ sample: false, usedSample: true, ownRows: 1 })
    expect(defaultSelection(preview).propertyIds).toEqual([anggrek.id, u(101), melati.id])
  })

  it('imports the owner\'s rows inside it by default, so none of them stays behind', () => {
    const { backup } = ownerUsedSampleBackup()
    const plan = planDemoImport(backup, all(backup))
    const planned = new Set(plannedIds(plan))
    for (const id of [201, 211, 212, 221, 231, 232, 233].map(u)) expect(planned.has(id), id).toBe(true)
    expect(plan.partialSplits).toEqual([])
  })

  it('a renamed sample kos is the owner\'s even without new rows; untouched ones stay sample data', () => {
    const backup = ownerDemoBackup()
    const melati = backup.tables.properties.find((p) => p.name === 'Kos Melati')!
    Object.assign(melati, { name: 'Kos Bu Sari', address: 'Jl. Sari 3', updated_at: LATER.updated_at })
    const preview = previewBackup(backup)
    expect(preview.properties.map((p) => [p.name, p.sample, p.usedSample, p.ownRows])).toEqual([
      ['Kos Anggrek', true, false, 0],
      ['Kos Bu Sari', false, true, 0],
      ['Kos Mawar', false, false, 0],
    ])
    expect(defaultSelection(preview).propertyIds).toEqual([melati.id, u(101)])
  })

  it('a changed sample row under the kos (a new room price) also makes it the owner\'s', () => {
    const backup = ownerDemoBackup()
    const anggrek = backup.tables.properties.find((p) => p.name === 'Kos Anggrek')!
    const room = backup.tables.rooms.find((r) => r.property_id === anggrek.id)!
    Object.assign(room, { price_monthly: 1_100_000, updated_at: LATER.updated_at })
    expect(previewBackup(backup).properties.find((p) => p.id === anggrek.id)).toMatchObject({ sample: false, usedSample: true, ownRows: 0 })
  })

  it('reports a split expense that would be imported only in part', () => {
    const { backup, melati, anggrek } = ownerUsedSampleBackup()
    expect(planDemoImport(backup, { propertyIds: [u(101)], includeShared: true }).partialSplits).toEqual(['Iklan Facebook'])
    expect(planDemoImport(backup, { propertyIds: [u(101), melati.id, anggrek.id], includeShared: true }).partialSplits).toEqual([])
    // parts already online count as present; a group with no part in this import is not reported
    const online = existingOf({ expenses: [{ id: u(231) }, { id: u(232) }] })
    expect(planDemoImport(backup, { propertyIds: [u(101)], includeShared: true }, online).partialSplits).toEqual([])
    expect(planDemoImport(backup, { propertyIds: [], includeShared: true }).partialSplits).toEqual([])
  })
})

describe('planDemoImport: selection', () => {
  it('imports the whole demo seed when everything is ticked, in dependency order, without server columns', () => {
    const backup = demoBackup()
    const kos = previewBackup(backup).properties.map((p) => p.id)
    const plan = planDemoImport(backup, { propertyIds: kos, includeShared: true, includeSample: true })
    for (const t of IMPORT_ORDER) {
      expect(plan.tables[t].rows.length, t).toBe(backup.tables[t].length)
    }
    expect(Object.values(skippedByReason(plan)).every((n) => n === 0)).toBe(true)
    expect(plan.renumberedInvoices).toBe(0)

    const inserted = new Set<string>()
    for (const t of IMPORT_ORDER) {
      for (const r of plan.tables[t].rows) {
        for (const col of ['org_id', 'created_at', 'updated_at', 'created_by']) expect(r.row, `${t}.${col}`).not.toHaveProperty(col)
        for (const dep of r.deps) expect(inserted.has(dep), `${t} ${r.id} depends on ${dep}`).toBe(true)
        inserted.add(r.id)
      }
    }
    expect(plannedCount(plan)).toBe(inserted.size)
  })

  it('lists every foreign key that is part of the same import as a dependency', () => {
    const backup = smallBackup()
    const plan = planDemoImport(backup, all(backup))
    expect(plan.tables.leases.rows.find((r) => r.id === u(31))?.deps).toEqual([u(1), u(11), u(21)])
    expect(plan.tables.payments.rows.find((r) => r.id === u(61))?.deps).toEqual([u(1), u(51), u(31)])
  })

  it('imports only the selected kos, its tenants and the org-wide add-ons', () => {
    const backup = smallBackup()
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(ids(plan, 'properties')).toEqual([u(1)])
    expect(ids(plan, 'rooms')).toEqual([u(11)])
    expect(ids(plan, 'tenants')).toEqual([u(21)])
    expect(ids(plan, 'leases')).toEqual([u(31)])
    expect(ids(plan, 'lease_addons')).toEqual([u(41)])
    expect(ids(plan, 'invoices')).toEqual([u(51)])
    expect(ids(plan, 'payments')).toEqual([u(61)])
    expect(ids(plan, 'expenses')).toEqual([u(71)])
    expect(ids(plan, 'addon_catalog')).toEqual([u(81)])
    expect(Object.values(skippedByReason(plan)).every((n) => n === 0)).toBe(true)
  })

  it('imports only shared expenses when no kos is selected', () => {
    const backup = smallBackup()
    const plan = planDemoImport(backup, { propertyIds: [], includeShared: true })
    expect(ids(plan, 'expenses')).toEqual([u(73)])
    expect(plannedCount(plan)).toBe(1)
  })

  it('imports nothing for an empty selection', () => {
    const backup = smallBackup()
    expect(plannedCount(planDemoImport(backup, { propertyIds: [], includeShared: false }))).toBe(0)
  })

  it('turns expenses of a kos that no longer exists into shared expenses', () => {
    const backup = smallBackup()
    backup.tables.expenses.push(expense(u(74), u(99)) as BackupRow)
    const withShared = planDemoImport(backup, { propertyIds: [u(1)], includeShared: true })
    expect(ids(withShared, 'expenses')).toEqual([u(71), u(73), u(74)])
    expect(rowOf(withShared, 'expenses', u(74))?.property_id).toBeNull()
    expect(ids(planDemoImport(backup, { propertyIds: [u(1)], includeShared: false }), 'expenses')).toEqual([u(71)])
  })
})

describe('planDemoImport: tenants', () => {
  it('adds tenants without any lease when their home kos is selected, unset or gone', () => {
    const backup = smallBackup()
    backup.tables.tenants.push(
      tenant(u(23), u(1)) as BackupRow, // home kos selected
      tenant(u(24), u(2)) as BackupRow, // home kos not selected
      tenant(u(25), null) as BackupRow, // no home kos
      tenant(u(26), u(98)) as BackupRow, // home kos deleted in demo
    )
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(ids(plan, 'tenants')).toEqual([u(21), u(23), u(25), u(26)])
    expect(rowOf(plan, 'tenants', u(26))?.property_id).toBeNull()
    expect(ids(planDemoImport(backup, { propertyIds: [], includeShared: true }), 'tenants')).toEqual([])
  })

  it('keeps a tenant whose lease is imported but clears a home kos that is not imported', () => {
    const backup = smallBackup()
    backup.tables.tenants[0].property_id = u(2) // lives in K1 (lease) but home kos K2
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(ids(plan, 'tenants')).toEqual([u(21)])
    expect(rowOf(plan, 'tenants', u(21))?.property_id).toBeNull()
    expect(plan.tables.tenants.rows[0].deps).toEqual([])
  })

  it('keeps the home kos when it is already online', () => {
    const backup = smallBackup()
    backup.tables.tenants[0].property_id = u(2)
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false }, existingOf({ properties: [{ id: u(2) }] }))
    expect(rowOf(plan, 'tenants', u(21))?.property_id).toBe(u(2))
  })

  it('does not import the tenant of a lease that cannot be imported (missing room)', () => {
    const backup = smallBackup()
    backup.tables.rooms = backup.tables.rooms.filter((r) => r.id !== u(11))
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(ids(plan, 'tenants')).toEqual([])
    expect(plan.tables.leases.skipped.broken_ref).toBe(1)
  })
})

describe('planDemoImport: skipping', () => {
  it('skips rows that are already online but still uses them as references (second import)', () => {
    const backup = smallBackup()
    const first = planDemoImport(backup, all(backup))
    const online = existingOf(Object.fromEntries(IMPORT_ORDER.map((t) => [t, first.tables[t].rows.map((r) => ({ id: r.id, invoice_number: r.row.invoice_number as string }))])))
    const second = planDemoImport(backup, all(backup), online)
    expect(plannedCount(second)).toBe(0)
    expect(skippedByReason(second).exists).toBe(plannedCount(first))
    expect(second.renumberedInvoices).toBe(0)
  })

  it('imports new rows under a kos that is already online without re-inserting the kos', () => {
    const backup = smallBackup()
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false }, existingOf({ properties: [{ id: u(1) }] }))
    expect(plan.tables.properties.skipped.exists).toBe(1)
    expect(ids(plan, 'rooms')).toEqual([u(11)])
    expect(plan.tables.rooms.rows[0].deps).toEqual([])
  })

  it('skips non-UUID ids and everything that depends on them', () => {
    const backup = smallBackup()
    backup.tables.properties[0].id = 'kos-1'
    for (const t of ['rooms', 'leases', 'invoices', 'payments', 'expenses', 'tenants'] as const) {
      for (const r of backup.tables[t]) if (r.property_id === u(1)) r.property_id = 'kos-1'
    }
    const plan = planDemoImport(backup, { propertyIds: ['kos-1'], includeShared: false })
    expect(plan.tables.properties.skipped.invalid_id).toBe(1)
    expect(plan.tables.rooms.skipped.broken_ref).toBe(1)
    expect(plan.tables.leases.skipped.broken_ref).toBe(1)
    expect(plan.tables.invoices.skipped.broken_ref).toBe(1)
    expect(plan.tables.payments.skipped.broken_ref).toBe(1)
    expect(plan.tables.expenses.skipped.broken_ref).toBe(1)
    expect(plannedCount(plan)).toBe(1) // only the org-wide add-on
  })

  it('skips rows that belong to another organisation', () => {
    const backup = smallBackup()
    backup.tables.rooms.push({ ...room(u(13), u(1), 'X9'), org_id: 'other-org' } as BackupRow)
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(ids(plan, 'rooms')).toEqual([u(11)])
    expect(plan.tables.rooms.skipped.other_org).toBe(1)
  })

  it('skips rows that would break a column rule, and their dependants', () => {
    const backup = smallBackup()
    backup.tables.invoices[0].total_amount = 999 // components do not add up
    backup.tables.rooms[1].status = 'kosong' // unknown enum value
    const plan = planDemoImport(backup, all(backup))
    expect(plan.tables.invoices.skipped.invalid_data).toBe(1) // K1
    expect(plan.tables.rooms.skipped.invalid_data).toBe(1) // K2
    expect(plan.tables.leases.skipped.broken_ref).toBe(1) // K2: room
    expect(plan.tables.invoices.skipped.broken_ref).toBe(1) // K2: lease
    expect(plan.tables.payments.skipped.broken_ref).toBe(2) // K1: invoice, K2: invoice
    expect(ids(plan, 'leases')).toEqual([u(31)])
    expect(ids(plan, 'tenants')).toEqual([u(21)]) // K2's tenant is only needed by the broken lease
  })

  it('skips a duplicated id within the file', () => {
    const backup = smallBackup()
    backup.tables.expenses.push({ ...backup.tables.expenses[0] })
    const plan = planDemoImport(backup, all(backup))
    expect(ids(plan, 'expenses')).toEqual([u(71), u(72), u(73)])
    expect(plan.tables.expenses.skipped.invalid_data).toBe(1)
  })

  it('skips refunds whose lease is not imported', () => {
    const backup = smallBackup()
    backup.tables.expenses.push(expense(u(75), u(1), { category: 'deposit_refund', lease_id: u(32) }) as BackupRow)
    const plan = planDemoImport(backup, { propertyIds: [u(1)], includeShared: false })
    expect(plan.tables.expenses.skipped.broken_ref).toBe(1)
    expect(ids(planDemoImport(backup, all(backup)), 'expenses')).toContain(u(75))
  })

  it('matches ids case-insensitively and writes them lowercase', () => {
    const backup = smallBackup()
    backup.tables.rooms[0].id = u(11).toUpperCase().replace('0000-4000', 'ABCD-4000')
    backup.tables.leases[0].room_id = backup.tables.rooms[0].id.toLowerCase()
    const plan = planDemoImport(backup, { propertyIds: [u(1).toUpperCase()], includeShared: false })
    expect(ids(plan, 'rooms')).toEqual([backup.tables.rooms[0].id.toLowerCase()])
    expect(ids(plan, 'leases')).toEqual([u(31)])
  })
})

describe('planDemoImport: invoice numbers', () => {
  it('gives a number already used online the next free number of that month and keeps the old one in notes', () => {
    const backup = smallBackup()
    const online = existingOf({ invoices: [{ id: u(500), invoice_number: 'INV-202601-0001' }, { id: u(501), invoice_number: 'INV-202601-0007' }] })
    const plan = planDemoImport(backup, all(backup), online)
    expect(rowOf(plan, 'invoices', u(51))).toMatchObject({ invoice_number: 'INV-202601-0008', notes: 'Nomor tagihan di Mode Demo: INV-202601-0001' })
    expect(rowOf(plan, 'invoices', u(52))?.invoice_number).toBe('INV-202601-0002')
    expect(plan.renumberedInvoices).toBe(1)
  })

  it('renumbers duplicates inside the file without taking a number another invoice in the file uses', () => {
    const backup = smallBackup()
    backup.tables.invoices[1].invoice_number = 'INV-202601-0001'
    backup.tables.invoices.push(invoice(u(53), u(2), u(32), 'INV-202601-0002', { notes: 'Token listrik' }) as BackupRow)
    const plan = planDemoImport(backup, all(backup))
    expect(plan.tables.invoices.rows.map((r) => r.row.invoice_number)).toEqual(['INV-202601-0001', 'INV-202601-0003', 'INV-202601-0002'])
    expect(rowOf(plan, 'invoices', u(53))?.notes).toBe('Token listrik')
  })

  it('appends a suffix to numbers in another format', () => {
    const backup = smallBackup()
    const online = existingOf({ invoices: [{ id: u(500), invoice_number: 'INV-202601-0001' }, { id: u(501), invoice_number: 'A-1' }] })
    backup.tables.invoices[0].invoice_number = 'A-1'
    const plan = planDemoImport(backup, all(backup), online)
    expect(rowOf(plan, 'invoices', u(51))).toMatchObject({ invoice_number: 'A-1-2', notes: 'Nomor tagihan di Mode Demo: A-1' })
  })
})

describe('normalizeRow', () => {
  it('fills database defaults for columns missing in old backups and drops unknown columns', () => {
    const row = normalizeRow('tenants', { id: u(21), full_name: 'Budi', some_future_column: 1 } as BackupRow)
    expect(row).toMatchObject({ full_name: 'Budi', id_type: 'ktp', property_id: null, phone: null, nik: null })
    expect(row).not.toHaveProperty('some_future_column')
    expect(row).not.toHaveProperty('id')
    expect(normalizeRow('invoices', invoice(u(51), u(1), u(31), 'X', { period_type: undefined }) as BackupRow)?.period_type).toBeNull()
  })

  it('clears photo paths, blank dates and trims timestamps to dates', () => {
    expect(normalizeRow('tenants', tenant(u(21), null, { ktp_image_path: 'org/ktp.jpg', birth_date: '' }) as BackupRow)).toMatchObject({ ktp_image_path: null, birth_date: null })
    expect(normalizeRow('expenses', expense(u(71), null, { receipt_path: 'org/a.jpg' }) as BackupRow)?.receipt_path).toBeNull()
    expect(normalizeRow('payments', payment(u(61), u(1), u(51), u(31), { paid_at: '2026-01-02T08:00:00.000Z' }) as BackupRow)?.paid_at).toBe('2026-01-02')
  })

  it('rejects missing required values, wrong types and broken CHECK rules', () => {
    expect(normalizeRow('leases', lease(u(31), u(1), u(11), u(21), { start_date: null }) as BackupRow)).toBeNull()
    expect(normalizeRow('leases', lease(u(31), u(1), u(11), u(21), { end_date: '2025-12-31' }) as BackupRow)).toBeNull()
    expect(normalizeRow('leases', lease(u(31), u(1), u(11), u(21), { price_per_period: '1000' }) as BackupRow)).toBeNull()
    expect(normalizeRow('payments', payment(u(61), u(1), null, u(31), { kind: 'rent' }) as BackupRow)).toBeNull()
    expect(normalizeRow('payments', payment(u(61), u(1), u(51), u(31), { amount: 0 }) as BackupRow)).toBeNull()
    expect(normalizeRow('expenses', expense(u(71), u(1), { category: 'rent_refund' }) as BackupRow)).toBeNull()
    expect(normalizeRow('rooms', room(u(11), u(1)) as BackupRow)).not.toBeNull()
    expect(normalizeRow('rooms', { ...room(u(11), u(1)), price_daily: -1 } as BackupRow)).toBeNull()
    expect(normalizeRow('invoices', invoice(u(51), u(1), u(31), 'X', { quantity: 0 }) as BackupRow)).toBeNull()
  })
})

describe('helpers', () => {
  it('isUuid accepts any UUID version and rejects demo-style ids', () => {
    expect(isUuid(u(1))).toBe(true)
    expect(isUuid(crypto.randomUUID())).toBe(true)
    expect(isUuid('demo-org')).toBe(false)
    expect(isUuid(42)).toBe(false)
  })

  it('sourceOrgId uses the organizations row, else the most common org of the kos', () => {
    expect(sourceOrgId(smallBackup())).toBe(ORG)
    const noOrg = smallBackup()
    noOrg.tables.organizations = []
    noOrg.tables.properties.push(property(u(3), 'Lain', { org_id: 'x' }) as BackupRow)
    expect(sourceOrgId(noOrg)).toBe(ORG)
    expect(sourceOrgId(backupFrom({}))).toBeNull()
  })

  it('existingFromRows lowercases ids and collects invoice numbers', () => {
    const existing = existingFromRows({ rooms: [{ id: u(11).toUpperCase() }], invoices: [{ id: u(51), invoice_number: 'INV-1' } as { id: string }] })
    expect(existing.ids.rooms.has(u(11))).toBe(true)
    expect(existing.invoiceNumbers.has('INV-1')).toBe(true)
    expect(emptyExisting().ids.properties.size).toBe(0)
  })
})
