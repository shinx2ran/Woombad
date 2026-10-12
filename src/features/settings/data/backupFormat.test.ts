import { describe, expect, it } from 'vitest'
import { buildDemoDb } from '../../../lib/repo/demoSeed'
import { TABLE_NAMES } from '../../../types/db'
import {
  BackupFileError,
  MSG_NEWER_VERSION,
  MSG_NOT_BACKUP,
  MSG_NOT_JSON,
  MSG_NO_ORGANIZATION,
  backupToLocalDb,
  describeBackup,
  parseBackupText,
} from './backupFormat'
import { buildBackupFile } from './backupFile'

const parseError = (text: string): string => {
  try {
    parseBackupText(text)
  } catch (err) {
    expect(err).toBeInstanceOf(BackupFileError)
    return (err as Error).message
  }
  throw new Error('expected parseBackupText to throw')
}

describe('parseBackupText', () => {
  it('accepts the version 1 envelope and fills missing tables with empty arrays', () => {
    const file = buildBackupFile({ properties: [{ id: 'p1', name: 'Kos Melati' }] }, 'Kos Saya', new Date('2026-10-12T03:00:00Z'))
    const parsed = parseBackupText(JSON.stringify(file))
    expect(parsed.orgName).toBe('Kos Saya')
    expect(parsed.exportedAt).toBe('2026-10-12T03:00:00.000Z')
    expect(parsed.tables.properties).toEqual([{ id: 'p1', name: 'Kos Melati' }])
    for (const t of TABLE_NAMES) expect(Array.isArray(parsed.tables[t]), t).toBe(true)
  })

  it('accepts the older demo backup (bare snapshot) and takes the name from the organisation row', () => {
    const db = buildDemoDb(new Date(2026, 9, 12))
    const parsed = parseBackupText(JSON.stringify(db))
    expect(parsed.orgName).toBe('Kos Keluarga (Demo)')
    expect(parsed.exportedAt).toBeNull()
    expect(parsed.tables.invoices).toHaveLength(db.invoices.length)
  })

  it('round-trips a demo snapshot through buildBackupFile', () => {
    const db = buildDemoDb(new Date(2026, 9, 12))
    const parsed = parseBackupText(JSON.stringify(buildBackupFile(db, 'Kos Keluarga (Demo)')))
    expect(backupToLocalDb(parsed)).toEqual(db)
  })

  it('ignores unknown tables and keeps unknown columns', () => {
    const parsed = parseBackupText(JSON.stringify({ version: 1, tables: { rooms: [{ id: 'r1', extra: true }], future_table: 'x' } }))
    expect(parsed.tables.rooms).toEqual([{ id: 'r1', extra: true }])
    expect(parsed).not.toHaveProperty('tables.future_table')
  })

  it('rejects text that is not JSON', () => {
    expect(parseError('not json {')).toBe(MSG_NOT_JSON)
    expect(parseError('')).toBe(MSG_NOT_JSON)
  })

  it('rejects JSON that is not a Woombad backup', () => {
    expect(parseError('[1,2,3]')).toBe(MSG_NOT_BACKUP)
    expect(parseError('"hello"')).toBe(MSG_NOT_BACKUP)
    expect(parseError('{"foo": []}')).toBe(MSG_NOT_BACKUP)
    expect(parseError('{"tables": []}')).toBe(MSG_NOT_BACKUP)
    expect(parseError('{"tables": {"foo": []}}')).toBe(MSG_NOT_BACKUP)
  })

  it('rejects files from a newer app version', () => {
    expect(parseError(JSON.stringify({ version: 2, tables: { rooms: [] } }))).toBe(MSG_NEWER_VERSION)
  })

  it('names the broken table and row in Indonesian', () => {
    expect(parseError(JSON.stringify({ version: 1, tables: { tenants: {} } }))).toBe('File cadangan rusak: bagian "Penyewa" tidak valid.')
    expect(parseError(JSON.stringify({ tenants: [{ id: 't1' }, { id: 't2' }, { name: 'tanpa id' }] }))).toBe(
      'File cadangan rusak: bagian "Penyewa" baris ke-3 tidak valid.',
    )
    expect(parseError(JSON.stringify({ invoices: [{ id: '' }] }))).toBe('File cadangan rusak: bagian "Tagihan" baris ke-1 tidak valid.')
    expect(parseError(JSON.stringify({ payments: ['x'] }))).toBe('File cadangan rusak: bagian "Pembayaran" baris ke-1 tidak valid.')
    expect(parseError(JSON.stringify({ rooms: [{ id: 5 }] }))).toBe('File cadangan rusak: bagian "Kamar" baris ke-1 tidak valid.')
  })
})

describe('backupToLocalDb', () => {
  it('refuses a backup without an organisation (the app would have nothing to open)', () => {
    const parsed = parseBackupText(JSON.stringify({ properties: [{ id: 'p1' }] }))
    expect(() => backupToLocalDb(parsed)).toThrow(MSG_NO_ORGANIZATION)
  })
})

describe('describeBackup', () => {
  it('summarises the main tables', () => {
    const parsed = parseBackupText(JSON.stringify(buildDemoDb(new Date(2026, 9, 12))))
    expect(describeBackup(parsed)).toMatch(/^2 kos, 10 kamar, 7 penyewa, \d+ tagihan$/)
  })
})
