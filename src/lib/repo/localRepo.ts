import type { Insert, Row, TableName, Update } from '../../types/db'
import { TABLE_NAMES } from '../../types/db'
import { newId } from '../ids'
import type { ListOptions, MemberAddResult, Repo, StorageBucket } from './types'

const STORAGE_KEY = 'woombad.local.db.v1'

type Db = { [K in TableName]: Row<K>[] }

function emptyDb(): Db {
  const db = {} as Db
  for (const t of TABLE_NAMES) (db as Record<string, unknown[]>)[t] = []
  return db
}

function loadDb(): Db {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    const parsed = JSON.parse(raw) as Partial<Db>
    const db = emptyDb()
    for (const t of TABLE_NAMES) {
      const rows = parsed[t]
      if (Array.isArray(rows)) (db as Record<string, unknown[]>)[t] = rows
    }
    return db
  } catch {
    return emptyDb()
  }
}

function saveDb(db: Db) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch (err) {
    console.error('Gagal menyimpan data lokal', err)
    throw new Error('Penyimpanan browser penuh atau tidak tersedia.')
  }
}

const rec = (r: unknown) => r as Record<string, unknown>

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * Browser-only persistence (localStorage). Used for "Mode Demo" when Supabase is not configured,
 * and for unit tests. Data never leaves the device.
 */
export class LocalRepo implements Repo {
  readonly mode = 'local' as const
  private db: Db

  constructor(initial?: Db) {
    this.db = initial ?? loadDb()
  }

  /** Replace everything (used by demo seeding / reset). */
  replaceAll(db: Db) {
    this.db = db
    saveDb(this.db)
  }

  snapshot(): Db {
    return JSON.parse(JSON.stringify(this.db)) as Db
  }

  isEmpty(): boolean {
    return TABLE_NAMES.every((t) => this.db[t].length === 0)
  }

  async list<T extends TableName>(table: T, opts: ListOptions<Row<T>> = {}): Promise<Row<T>[]> {
    let rows = this.db[table] as Row<T>[]
    const where = opts.where ?? {}
    rows = rows.filter((r) => {
      for (const [col, val] of Object.entries(where)) {
        if (val === undefined) continue
        const actual = rec(r)[col]
        if (Array.isArray(val)) {
          if (!(val as unknown[]).includes(actual)) return false
        } else if (actual !== val) return false
      }
      for (const [col, val] of Object.entries(opts.gte ?? {})) {
        if (val == null) continue
        if (compare(rec(r)[col], val) < 0) return false
      }
      for (const [col, val] of Object.entries(opts.lte ?? {})) {
        if (val == null) continue
        if (compare(rec(r)[col], val) > 0) return false
      }
      return true
    })
    const order = opts.orderBy ?? { column: 'created_at', ascending: false }
    rows = [...rows].sort((a, b) => {
      const c = compare(rec(a)[order.column], rec(b)[order.column])
      return order.ascending === false ? -c : c
    })
    if (opts.limit) rows = rows.slice(0, opts.limit)
    return rows.map((r) => ({ ...r }))
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const row = (this.db[table] as Row<T>[]).find((r) => r.id === id)
    return row ? { ...row } : null
  }

  async insert<T extends TableName>(table: T, row: Insert<T>): Promise<Row<T>> {
    const [created] = await this.insertMany(table, [row])
    return created
  }

  async insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]> {
    const now = new Date().toISOString()
    const created = rows.map((row) => {
      const full = {
        ...row,
        id: (row as { id?: string }).id ?? newId(),
        created_at: (row as { created_at?: string }).created_at ?? now,
      } as Record<string, unknown>
      if (hasUpdatedAt(table)) full.updated_at = (row as { updated_at?: string }).updated_at ?? now
      return full as unknown as Row<T>
    })
    ;(this.db[table] as Row<T>[]).push(...created)
    saveDb(this.db)
    return created.map((r) => ({ ...r }))
  }

  async update<T extends TableName>(table: T, id: string, patch: Update<T>): Promise<Row<T>> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error(`Data tidak ditemukan (${table}/${id})`)
    const next = { ...rows[idx], ...patch } as Record<string, unknown>
    if (hasUpdatedAt(table)) next.updated_at = new Date().toISOString()
    rows[idx] = next as unknown as Row<T>
    saveDb(this.db)
    return { ...rows[idx] }
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx >= 0) rows.splice(idx, 1)
    saveDb(this.db)
  }

  async uploadFile(_bucket: StorageBucket, _path: string, _file: Blob): Promise<string | null> {
    // Files are not persisted in local mode (localStorage is too small for photos).
    return null
  }

  async getFileUrl(): Promise<string | null> {
    return null
  }

  async removeFile(): Promise<void> {
    /* nothing stored */
  }

  async addMemberByEmail(orgId: string, email: string, role: 'admin' | 'staff'): Promise<MemberAddResult> {
    const existing = this.db.organization_members.find(
      (m) => m.org_id === orgId && m.email?.toLowerCase() === email.toLowerCase(),
    )
    if (existing) return { status: 'already_member', message: 'Email ini sudah menjadi anggota.' }
    await this.insert('organization_members', {
      org_id: orgId,
      user_id: `local-${email.toLowerCase()}`,
      email: email.toLowerCase(),
      role,
    })
    return { status: 'added', message: 'Anggota ditambahkan (mode demo: tidak ada login terpisah).' }
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    this.db.organization_members = this.db.organization_members.filter(
      (m) => !(m.org_id === orgId && m.user_id === userId),
    )
    saveDb(this.db)
  }
}

const TABLES_WITH_UPDATED_AT: ReadonlySet<TableName> = new Set<TableName>([
  'properties',
  'rooms',
  'tenants',
  'leases',
  'invoices',
  'expenses',
])

function hasUpdatedAt(table: TableName): boolean {
  return TABLES_WITH_UPDATED_AT.has(table)
}

export type { Db as LocalDb }
export { emptyDb as emptyLocalDb }
