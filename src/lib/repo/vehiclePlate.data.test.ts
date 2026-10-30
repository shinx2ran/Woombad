import { afterEach, describe, expect, it } from 'vitest'
import { buildDemoDb } from './demoSeed'
import { LocalRepo, STORAGE_KEY, emptyLocalDb } from './localRepo'
import { translateDbError } from './supabaseRepo'
import { REDATE_NOT_DEPLOYED_MESSAGE, VEHICLE_PLATE_NOT_DEPLOYED_MESSAGE, bindOrg } from './types'
import { normalizeRow } from '../../features/settings/data/demoImport'
import type { BackupRow } from '../../features/settings/data/backupFormat'
import { summarizeAuditEntry } from '../../features/settings/audit/auditSummary'
import { normalizePlate } from '../../domain/plate'

// SPEC 7.11: leases.vehicle_plate through the data paths (Mode Demo seed and storage, import, history, errors).
describe('demo seed', () => {
  it('two monthly tenants have a plate, written as plates are; one of them two vehicles', () => {
    const db = buildDemoDb(new Date(2026, 9, 23, 10, 0, 0))
    const withPlate = db.leases.filter((l) => l.vehicle_plate)
    const names = withPlate.map((l) => db.tenants.find((t) => t.id === l.tenant_id)?.full_name).sort()
    expect(names).toEqual(['Budi Santoso', 'Rizky Maulana'])
    for (const l of withPlate) expect(l.vehicle_plate).toBe(normalizePlate(l.vehicle_plate))
    expect(withPlate.some((l) => l.vehicle_plate!.includes(', '))).toBe(true)
  })
})

describe('Mode Demo storage', () => {
  afterEach(() => globalThis.localStorage?.removeItem(STORAGE_KEY))

  it('rows stored before the column existed read as no plate; a plate is set, kept by a room move, and cleared', async () => {
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
      const repo = bindOrg(new LocalRepo(), 'o')
      expect((await repo.get('leases', 'L1'))?.vehicle_plate).toBeNull()
      await repo.update('leases', 'L1', { vehicle_plate: 'KB 1442 GZ' })
      // Pindah kamar updates the same lease: the plate goes along
      await repo.update('leases', 'L1', { room_id: 'R2', notes: 'Pindah kamar' })
      expect((await repo.get('leases', 'L1'))?.vehicle_plate).toBe('KB 1442 GZ')
      await repo.update('leases', 'L1', { vehicle_plate: null })
      expect((await repo.get('leases', 'L1'))?.vehicle_plate).toBeNull()
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

  it('carries the plate; an older backup without it imports with none', () => {
    expect(normalizeRow('leases', lease({ vehicle_plate: 'KB 1442 GZ, B 1251 SGA' }))?.vehicle_plate).toBe('KB 1442 GZ, B 1251 SGA')
    expect(normalizeRow('leases', lease())?.vehicle_plate).toBeNull()
  })
})

describe('Riwayat perubahan', () => {
  it("reads 'No. kendaraan: – → KB 1442 GZ' and back", () => {
    const row = { tenant_id: 'T1', room_id: 'R1', period_type: 'monthly', price_per_period: 1500000, end_date: '2026-11-30', vehicle_plate: null }
    expect(summarizeAuditEntry({ table_name: 'leases', action: 'update', old_data: row, new_data: { ...row, vehicle_plate: 'KB 1442 GZ' } }).changes).toEqual([
      'No. kendaraan: – → KB 1442 GZ',
    ])
    expect(summarizeAuditEntry({ table_name: 'leases', action: 'update', old_data: { ...row, vehicle_plate: 'KB 1442 GZ' }, new_data: row }).changes).toEqual([
      'No. kendaraan: KB 1442 GZ → –',
    ])
  })
})

describe('translateDbError', () => {
  it('a server without the column says so in Indonesian, naming the field', () => {
    expect(translateDbError({ code: 'PGRST204', message: "Could not find the 'vehicle_plate' column of 'leases' in the schema cache" })).toBe(VEHICLE_PLATE_NOT_DEPLOYED_MESSAGE)
    expect(translateDbError({ code: '42703', message: 'column "vehicle_plate" of relation "leases" does not exist' })).toBe(VEHICLE_PLATE_NOT_DEPLOYED_MESSAGE)
    // the Rencana keluar mapping is unchanged
    expect(translateDbError({ code: 'PGRST204', message: "Could not find the 'planned_checkout_date' column of 'leases' in the schema cache" })).toBe(REDATE_NOT_DEPLOYED_MESSAGE)
  })
})
