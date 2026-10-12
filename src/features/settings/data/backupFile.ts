/**
 * Writing backups: { version: 1, exportedAt, orgName, tables: { <table>: Row[] } }, the same format in Mode Demo
 * and online. Kept free of zod (parsing lives in backupFormat.ts) because the app shell's reminder uses it.
 */
import type { OrgRepo } from '../../../lib/repo/types'
import { LocalRepo } from '../../../lib/repo/localRepo'
import type { TableName } from '../../../types/db'
import { datedFileName, downloadText } from '../../../components/deviceData'
import { markBackupDone } from './backupReminder'

export const BACKUP_VERSION = 1

export interface BackupFile {
  version: typeof BACKUP_VERSION
  exportedAt: string
  orgName: string | null
  tables: Partial<Record<TableName, unknown[]>>
}

export function buildBackupFile(tables: Partial<Record<TableName, unknown[]>>, orgName: string | null, now: Date = new Date()): BackupFile {
  return { version: BACKUP_VERSION, exportedAt: now.toISOString(), orgName, tables }
}

/** Mode Demo backup: everything stored on this device. */
export function localBackupFile(repo: OrgRepo, orgName: string | null, now: Date = new Date()): BackupFile {
  if (!(repo.raw instanceof LocalRepo)) throw new Error('Cadangan perangkat hanya tersedia di Mode Demo.')
  return buildBackupFile(repo.raw.snapshot(), orgName, now)
}

/** Download a backup file and remember the time for the backup reminder. */
export function downloadBackup(file: BackupFile, name = 'cadangan'): void {
  downloadText(JSON.stringify(file, null, 2), datedFileName(name))
  markBackupDone()
}
