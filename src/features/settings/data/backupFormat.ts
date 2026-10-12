/**
 * Reading backup files (format: see backupFile.ts). Older demo backups are the bare LocalRepo snapshot
 * ({ <table>: Row[] } at the top level); both are accepted.
 */
import { z } from 'zod'
import { TABLE_NAMES, type TableName } from '../../../types/db'
import type { LocalDb } from '../../../lib/repo/localRepo'
import { BACKUP_VERSION } from './backupFile'

export type BackupRow = { id: string } & Record<string, unknown>

export interface ParsedBackup {
  orgName: string | null
  exportedAt: string | null
  /** every known table; tables missing from the file are empty */
  tables: Record<TableName, BackupRow[]>
}

export const TABLE_LABEL: Record<TableName, string> = {
  organizations: 'Organisasi',
  organization_members: 'Anggota',
  invitations: 'Undangan',
  properties: 'Kos',
  rooms: 'Kamar',
  addon_catalog: 'Add-on',
  tenants: 'Penyewa',
  leases: 'Sewa',
  lease_addons: 'Add-on sewa',
  invoices: 'Tagihan',
  payments: 'Pembayaran',
  expenses: 'Pengeluaran',
  audit_log: 'Riwayat perubahan',
}

/** Thrown with a message that can be shown to the user as is. */
export class BackupFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupFileError'
  }
}

export const MSG_NOT_JSON = 'File tidak bisa dibaca. Pilih file cadangan Woombad (.json).'
export const MSG_NOT_BACKUP = 'File ini bukan cadangan Woombad.'
export const MSG_NEWER_VERSION = 'File cadangan ini dibuat oleh versi aplikasi yang lebih baru. Muat ulang aplikasi lalu coba lagi.'
export const MSG_NO_ORGANIZATION = 'File cadangan tidak berisi data organisasi.'

const rowSchema = z.looseObject({ id: z.string().min(1) })
const tableSchema = z.array(rowSchema)
const envelopeSchema = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  orgName: z.string().nullable().optional(),
  tables: z.record(z.string(), z.unknown()),
})

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function brokenTableMessage(table: TableName, issues: readonly { path: readonly PropertyKey[] }[]): string {
  const index = issues[0]?.path[0]
  const where = typeof index === 'number' ? ` baris ke-${index + 1}` : ''
  return `File cadangan rusak: bagian "${TABLE_LABEL[table]}"${where} tidak valid.`
}

/**
 * Validate a backup file's text. Every known table must be an array of objects with a string `id`;
 * unknown tables are ignored. Throws BackupFileError (Indonesian message) for anything else.
 */
export function parseBackupText(text: string): ParsedBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupFileError(MSG_NOT_JSON)
  }
  if (!isPlainObject(data)) throw new BackupFileError(MSG_NOT_BACKUP)

  let source: Record<string, unknown>
  let orgName: string | null = null
  let exportedAt: string | null = null
  if ('tables' in data) {
    const envelope = envelopeSchema.safeParse(data)
    if (!envelope.success) throw new BackupFileError(MSG_NOT_BACKUP)
    if (envelope.data.version !== undefined && envelope.data.version > BACKUP_VERSION) throw new BackupFileError(MSG_NEWER_VERSION)
    source = envelope.data.tables
    orgName = envelope.data.orgName ?? null
    exportedAt = envelope.data.exportedAt ?? null
  } else {
    source = data // legacy demo snapshot
  }

  if (!TABLE_NAMES.some((t) => t in source)) throw new BackupFileError(MSG_NOT_BACKUP)

  const tables = {} as Record<TableName, BackupRow[]>
  for (const table of TABLE_NAMES) {
    if (source[table] === undefined) {
      tables[table] = []
      continue
    }
    const parsed = tableSchema.safeParse(source[table])
    if (!parsed.success) throw new BackupFileError(brokenTableMessage(table, parsed.error.issues))
    tables[table] = parsed.data as BackupRow[]
  }
  if (orgName === null) {
    const name = tables.organizations[0]?.name
    if (typeof name === 'string') orgName = name
  }
  return { orgName, exportedAt, tables }
}

/** Demo restore: the file must carry the organisation, otherwise the app has nothing to open after the restore. */
export function backupToLocalDb(backup: ParsedBackup): LocalDb {
  if (backup.tables.organizations.length === 0) throw new BackupFileError(MSG_NO_ORGANIZATION)
  return { ...backup.tables } as unknown as LocalDb
}

/** Short Indonesian summary, e.g. "2 kos, 10 kamar, 8 penyewa, 40 tagihan". */
export function describeBackup(backup: ParsedBackup): string {
  const t = backup.tables
  const parts = [`${t.properties.length} kos`, `${t.rooms.length} kamar`, `${t.tenants.length} penyewa`, `${t.invoices.length} tagihan`]
  return parts.join(', ')
}
