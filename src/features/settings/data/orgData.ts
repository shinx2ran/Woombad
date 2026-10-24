/** Reading the online organisation's data for the full backup and for the demo import. */
import type { ListOptions, OrgRepo } from '../../../lib/repo/types'
import type { OrgTableName, Row, TableName } from '../../../types/db'
import { buildBackupFile, type BackupFile } from './backupFile'
import { IMPORT_ORDER, existingFromRows, type ExistingOnline } from './demoImport'

/** Org tables in a full backup besides `organizations` (this org's row) and the optional `audit_log`. */
export const BACKUP_TABLES = [
  'organization_members',
  'invitations',
  'properties',
  'rooms',
  'addon_catalog',
  'tenants',
  'leases',
  'lease_addons',
  'invoices',
  'payments',
  'expenses',
  'waitlist',
] as const satisfies readonly OrgTableName[]

function listOrdered<T extends OrgTableName>(repo: OrgRepo, table: T, column: string): Promise<Row<T>[]> {
  return repo.list(table, { orderBy: { column, ascending: true } } as ListOptions<Row<T>>)
}

/** Full online backup of the bound organisation (owner/admin: invitations and audit_log are admin-only). */
export async function fetchOrgBackup(repo: OrgRepo, now: Date = new Date()): Promise<BackupFile> {
  const [org, ...lists] = await Promise.all([
    repo.raw.get('organizations', repo.orgId),
    ...BACKUP_TABLES.map((t) => listOrdered(repo, t, 'created_at')),
  ])
  const tables: Partial<Record<TableName, unknown[]>> = { organizations: org ? [org] : [] }
  BACKUP_TABLES.forEach((t, i) => (tables[t] = lists[i] as unknown[]))
  try {
    // audit_log has no created_at; it is optional in a backup, so a failure here does not block the rest
    tables.audit_log = await listOrdered(repo, 'audit_log', 'changed_at')
  } catch {
    /* left out */
  }
  return buildBackupFile(tables, org?.name ?? null, now)
}

/** Ids (and invoice numbers) already in the online organisation, for planDemoImport. */
export async function fetchExistingOnline(repo: OrgRepo): Promise<ExistingOnline> {
  const lists = await Promise.all(IMPORT_ORDER.map((t) => repo.list(t)))
  const rows: Partial<Record<(typeof IMPORT_ORDER)[number], { id: string }[]>> = {}
  IMPORT_ORDER.forEach((t, i) => (rows[t] = lists[i]))
  return existingFromRows(rows)
}
