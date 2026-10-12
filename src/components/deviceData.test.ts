import { describe, expect, it } from 'vitest'
import { buildDemoDb } from '../lib/repo/demoSeed'
import { emptyLocalDb } from '../lib/repo/localRepo'
import { deviceDataProblem } from './deviceData'

describe('deviceDataProblem', () => {
  it('accepts nothing stored, an empty database and the demo data', () => {
    expect(deviceDataProblem(null)).toBeNull()
    expect(deviceDataProblem('{}')).toBeNull()
    expect(deviceDataProblem(JSON.stringify(emptyLocalDb()))).toBeNull()
    expect(deviceDataProblem(JSON.stringify(buildDemoDb(new Date(2026, 9, 12))))).toBeNull()
  })

  it('reports text that is not JSON or not an object of tables', () => {
    expect(deviceDataProblem('{"properties": [rusak')).toBe('Data di perangkat ini bukan JSON yang valid.')
    expect(deviceDataProblem('')).toBe('Data di perangkat ini bukan JSON yang valid.')
    expect(deviceDataProblem('[]')).toBe('Data di perangkat ini tidak berisi tabel.')
    expect(deviceDataProblem('null')).toBe('Data di perangkat ini tidak berisi tabel.')
  })

  it('reports a table that is not a list of rows', () => {
    const db = buildDemoDb(new Date(2026, 9, 12)) as unknown as Record<string, unknown>
    expect(deviceDataProblem(JSON.stringify({ ...db, rooms: 'x' }))).toBe('Tabel "rooms" di perangkat ini rusak.')
    expect(deviceDataProblem(JSON.stringify({ ...db, tenants: [null] }))).toBe('Tabel "tenants" di perangkat ini rusak.')
  })

  it('reports rows without their organisation (the app could not open them)', () => {
    const db = buildDemoDb(new Date(2026, 9, 12))
    expect(deviceDataProblem(JSON.stringify({ ...db, organizations: [] }))).toBe('Data organisasi di perangkat ini hilang.')
    const withoutOrg: Record<string, unknown> = { ...db }
    delete withoutOrg.organizations
    expect(deviceDataProblem(JSON.stringify(withoutOrg))).toBe('Data organisasi di perangkat ini hilang.')
  })
})
