/**
 * Undo a delete (SPEC 6.3): every deleted row is kept whole in audit_log.old_data (online), and the page that deleted it
 * still holds the row. Restoring = inserting that row again with its old id, through the same repo and the same
 * database rules as any insert (RLS, triggers, FK checks). Files that went with the row (a KTP photo, a receipt, a
 * logo) were removed from storage and do not come back; their path is cleared so the row does not point at nothing.
 */
import type { AuditLogEntry, OrgInsert, OrgTableName } from '../../../types/db'

export const RESTORABLE_TABLES = ['tenants', 'rooms', 'properties', 'addon_catalog', 'payments', 'invoices', 'expenses', 'lease_addons', 'waitlist'] as const
export type RestorableTable = (typeof RESTORABLE_TABLES)[number]

export function isRestorableTable(table: string): table is RestorableTable {
  return (RESTORABLE_TABLES as readonly string[]).includes(table)
}

/** the file column of tables whose file is deleted with the row (SPEC 6.4) */
const FILE_COLUMN: Partial<Record<RestorableTable, string>> = { tenants: 'ktp_image_path', expenses: 'receipt_path', properties: 'logo_path' }

/** what to refresh after a restore: the table and what the database recomputes from it */
export const RESTORE_INVALIDATES: Record<RestorableTable, OrgTableName[]> = {
  tenants: ['tenants'],
  rooms: ['rooms'],
  properties: ['properties', 'rooms'],
  addon_catalog: ['addon_catalog'],
  payments: ['payments', 'invoices'],
  invoices: ['invoices', 'payments', 'leases'],
  expenses: ['expenses'],
  lease_addons: ['lease_addons', 'leases'],
  waitlist: ['waitlist'],
}

export const ALREADY_RESTORED_MESSAGE = 'Data ini sudah ada kembali (sudah dipulihkan).'
export const REFERENCE_GONE_MESSAGE = 'Data yang dirujuk sudah tidak ada (sewa, tagihan, kamar, atau kos). Pulihkan itu dulu.'

/** The insert payload for a deleted row: its old id and values, minus what the server fills in, minus a lost file. */
export function restorePayload<T extends RestorableTable>(table: T, row: object): { payload: OrgInsert<T>; fileDropped: boolean } {
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  delete copy.org_id
  delete copy.created_at
  delete copy.updated_at
  delete copy.created_by
  let fileDropped = false
  const fileColumn = FILE_COLUMN[table]
  if (fileColumn && copy[fileColumn]) {
    copy[fileColumn] = null
    fileDropped = true
  }
  return { payload: copy as unknown as OrgInsert<T>, fileDropped }
}

export type RestoreState = 'restorable' | 'restored' | 'unsupported'

/** Whether a history entry offers Pulihkan: a delete of a supported table that no later insert of the same row undid. */
export function restoreState(entry: AuditLogEntry, entries: AuditLogEntry[]): RestoreState {
  if (entry.action !== 'delete' || !entry.old_data || !entry.row_id || !isRestorableTable(entry.table_name)) return 'unsupported'
  const restored = entries.some((e) => e.action === 'insert' && e.table_name === entry.table_name && e.row_id === entry.row_id && e.changed_at > entry.changed_at)
  return restored ? 'restored' : 'restorable'
}

/** The owner's words for what went wrong with a restore. */
export function restoreErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/duplicate key|unique constraint|sudah ada|23505/i.test(message)) return ALREADY_RESTORED_MESSAGE
  if (/violates foreign key constraint|23503|tidak ditemukan/i.test(message)) return REFERENCE_GONE_MESSAGE
  return message
}
