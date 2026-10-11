import type { Insert, OrgInsert, OrgTableName, Row, TableName, Update } from '../../types/db'

export type RepoMode = 'supabase' | 'local'

/** Equality filter; an array value means "IN (...)". */
export type Where<T> = { [K in keyof T]?: T[K] | NonNullable<T[K]>[] }

export interface ListOptions<T> {
  where?: Where<T>
  /** column >= value (inclusive) */
  gte?: { [K in keyof T]?: T[K] }
  /** column <= value (inclusive) */
  lte?: { [K in keyof T]?: T[K] }
  orderBy?: { column: keyof T & string; ascending?: boolean }
  limit?: number
}

export type StorageBucket = 'ktp' | 'receipts'

export interface MemberAddResult {
  status: 'added' | 'invited' | 'already_member'
  message: string
}

/**
 * Minimal, table-generic persistence API. Both the Supabase adapter and the local (browser)
 * adapter implement this. All aggregation is done client-side in `src/domain` with pure functions,
 * which keeps both adapters tiny and the business logic testable.
 */
export interface Repo {
  readonly mode: RepoMode
  list<T extends TableName>(table: T, opts?: ListOptions<Row<T>>): Promise<Row<T>[]>
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends TableName>(table: T, row: Insert<T>): Promise<Row<T>>
  insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]>
  update<T extends TableName>(table: T, id: string, patch: Update<T>): Promise<Row<T>>
  remove<T extends TableName>(table: T, id: string): Promise<void>

  /** Upload a file; returns the storage path to persist on the row. Local mode returns null (not stored). */
  uploadFile(bucket: StorageBucket, path: string, file: Blob, contentType?: string): Promise<string | null>
  /** Resolve a storage path to a viewable URL (signed, short-lived in Supabase mode). */
  getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null>
  removeFile(bucket: StorageBucket, path: string): Promise<void>

  /** Add a member by email: adds immediately if the user exists, otherwise records an invitation. */
  addMemberByEmail(orgId: string, email: string, role: 'admin' | 'staff'): Promise<MemberAddResult>
  removeMember(orgId: string, userId: string): Promise<void>
}

/**
 * Repo bound to one organisation: fills `org_id` on insert and filters lists by it.
 * Feature modules should use this (via `useRepo()`) rather than the raw Repo.
 */
export interface OrgRepo {
  readonly mode: RepoMode
  readonly orgId: string
  list<T extends OrgTableName>(table: T, opts?: ListOptions<Row<T>>): Promise<Row<T>[]>
  get<T extends OrgTableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends OrgTableName>(table: T, row: OrgInsert<T>): Promise<Row<T>>
  insertMany<T extends OrgTableName>(table: T, rows: OrgInsert<T>[]): Promise<Row<T>[]>
  update<T extends OrgTableName>(table: T, id: string, patch: Update<T>): Promise<Row<T>>
  remove<T extends OrgTableName>(table: T, id: string): Promise<void>
  uploadFile(bucket: StorageBucket, fileName: string, file: Blob, contentType?: string): Promise<string | null>
  getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null>
  removeFile(bucket: StorageBucket, path: string): Promise<void>
  addMemberByEmail(email: string, role: 'admin' | 'staff'): Promise<MemberAddResult>
  removeMember(userId: string): Promise<void>
  /** underlying unscoped repo, for the rare cross-org operations (organisation switcher, etc.) */
  readonly raw: Repo
}

export function bindOrg(repo: Repo, orgId: string): OrgRepo {
  const withOrg = <T extends OrgTableName>(opts?: ListOptions<Row<T>>): ListOptions<Row<T>> => ({
    ...opts,
    where: { ...(opts?.where ?? {}), org_id: orgId } as ListOptions<Row<T>>['where'],
  })
  return {
    mode: repo.mode,
    orgId,
    raw: repo,
    list: (table, opts) => repo.list(table, withOrg(opts)),
    get: async (table, id) => {
      const row = await repo.get(table, id)
      return row && row.org_id === orgId ? row : null
    },
    insert: (table, row) => repo.insert(table, { ...row, org_id: orgId } as unknown as Insert<typeof table>),
    insertMany: (table, rows) =>
      repo.insertMany(
        table,
        rows.map((r) => ({ ...r, org_id: orgId }) as unknown as Insert<typeof table>),
      ),
    update: (table, id, patch) => repo.update(table, id, patch),
    remove: (table, id) => repo.remove(table, id),
    uploadFile: (bucket, fileName, file, contentType) =>
      repo.uploadFile(bucket, `${orgId}/${fileName}`, file, contentType),
    getFileUrl: (bucket, path) => repo.getFileUrl(bucket, path),
    removeFile: (bucket, path) => repo.removeFile(bucket, path),
    addMemberByEmail: (email, role) => repo.addMemberByEmail(orgId, email, role),
    removeMember: (userId) => repo.removeMember(orgId, userId),
  }
}
