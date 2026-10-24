import { afterEach, describe, expect, it } from 'vitest'
import { buildDemoDb } from './demoSeed'
import { LocalRepo, STORAGE_KEY, emptyLocalDb } from './localRepo'
import { translateDbError } from './supabaseRepo'
import { PLANNED_CHECKOUT_BEFORE_START_MESSAGE, REDATE_NOT_DEPLOYED_MESSAGE } from './types'
import { normalizeRow } from '../../features/settings/data/demoImport'
import type { BackupRow } from '../../features/settings/data/backupFormat'
import { summarizeAuditEntry } from '../../features/settings/audit/auditSummary'
import { toDateISO } from '../format'

// SPEC 7.8: leases.planned_checkout_date through the data paths (Mode Demo seed and storage, import, history, errors).
describe('demo seed', () => {
  it('one monthly tenant has a Rencana keluar on the check-out day of her paid period, three weeks after today', () => {
    const today = new Date(2026, 9, 23, 10, 0, 0)
    const db = buildDemoDb(today)
    const planned = db.leases.filter((l) => l.planned_checkout_date)
    expect(planned).toHaveLength(1)
    const [lease] = planned
    const tenant = db.tenants.find((t) => t.id === lease.tenant_id)
    expect(tenant?.full_name).toBe('Dewi Lestari')
    expect(lease).toMatchObject({ period_type: 'monthly', status: 'active', start_date: '2026-06-13', end_date: '2026-11-12', planned_checkout_date: '2026-11-13' })
    expect(lease.planned_checkout_date).toBe(toDateISO(new Date(2026, 9, 23 + 21)))
    // her five months are billed and paid, so she is no "Perlu perhatian" case
    const invoices = db.invoices.filter((i) => i.lease_id === lease.id)
    expect(invoices.map((i) => [i.period_start, i.period_end, i.status])).toEqual([
      ['2026-06-13', '2026-07-12', 'paid'],
      ['2026-07-13', '2026-08-12', 'paid'],
      ['2026-08-13', '2026-09-12', 'paid'],
      ['2026-09-13', '2026-10-12', 'paid'],
      ['2026-10-13', '2026-11-12', 'paid'],
    ])
  })
})

describe('Mode Demo storage', () => {
  afterEach(() => globalThis.localStorage?.removeItem(STORAGE_KEY))

  it('rows stored before the column existed read as no plan', async () => {
    const store = new Map<string, string>()
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
    try {
      const old = emptyLocalDb()
      old.leases.push({
        id: 'L1', org_id: 'o', property_id: 'P', room_id: 'R', tenant_id: 'T', period_type: 'monthly', price_per_period: 1, deposit_amount: 0,
        start_date: '2026-01-01', end_date: '2026-01-31', status: 'active', checkout_date: null, notes: null, created_at: 'x', updated_at: 'x',
      })
      ls.setItem(STORAGE_KEY, JSON.stringify(old))
      const repo = new LocalRepo()
      expect((await repo.get('leases', 'L1'))?.planned_checkout_date).toBeNull()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})

describe('Impor dari Mode Demo / cadangan', () => {
  const lease = (extra: Record<string, unknown> = {}) =>
    ({
      id: 'a0000000-0000-4000-8000-000000000031', org_id: 'o', property_id: 'a0000000-0000-4000-8000-000000000001', room_id: 'a0000000-0000-4000-8000-000000000011',
      tenant_id: 'a0000000-0000-4000-8000-000000000021', period_type: 'monthly', price_per_period: 1_500_000, deposit_amount: 0,
      start_date: '2026-06-01', end_date: '2026-11-30', status: 'active', checkout_date: null, notes: null, ...extra,
    }) as BackupRow

  it('carries the Rencana keluar; an older backup without it imports with none', () => {
    expect(normalizeRow('leases', lease({ planned_checkout_date: '2026-12-01' }))?.planned_checkout_date).toBe('2026-12-01')
    expect(normalizeRow('leases', lease())?.planned_checkout_date).toBeNull()
  })

  it('a row the database would refuse (planned on or before the start) is skipped like any invalid row', () => {
    expect(normalizeRow('leases', lease({ planned_checkout_date: '2026-06-01' }))).toBeNull()
  })
})

describe('Riwayat perubahan', () => {
  it("reads 'Rencana keluar: – → 1 Des 2026' (a check-out day, shown as is)", () => {
    const row = { tenant_id: 'T1', room_id: 'R1', period_type: 'monthly', price_per_period: 1500000, end_date: '2026-11-30', planned_checkout_date: null }
    expect(summarizeAuditEntry({ table_name: 'leases', action: 'update', old_data: row, new_data: { ...row, planned_checkout_date: '2026-12-01' } }).changes).toEqual([
      'Rencana keluar: – → 1 Des 2026',
    ])
    expect(summarizeAuditEntry({ table_name: 'leases', action: 'update', old_data: { ...row, planned_checkout_date: '2026-12-01' }, new_data: row }).changes).toEqual([
      'Rencana keluar: 1 Des 2026 → –',
    ])
  })
})

describe('translateDbError', () => {
  it('maps the check constraint and a server without the column to Indonesian', () => {
    expect(translateDbError({ code: '23514', message: 'new row for relation "leases" violates check constraint "leases_planned_checkout_check"' })).toBe(
      PLANNED_CHECKOUT_BEFORE_START_MESSAGE,
    )
    expect(translateDbError({ code: 'PGRST204', message: "Could not find the 'planned_checkout_date' column of 'leases' in the schema cache" })).toBe(REDATE_NOT_DEPLOYED_MESSAGE)
    expect(translateDbError({ code: '42703', message: 'column "planned_checkout_date" of relation "leases" does not exist' })).toBe(REDATE_NOT_DEPLOYED_MESSAGE)
  })
})
