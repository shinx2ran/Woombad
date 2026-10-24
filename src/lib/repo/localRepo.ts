import type { Insert, Row, TableName, Update } from '../../types/db'
import { TABLE_NAMES } from '../../types/db'
import { newId } from '../ids'
import type { CreatedInvitation, ListOptions, RedateLeaseInput, Repo, StorageBucket } from './types'
import {
  CODE_ALPHABET,
  DELETE_DENIED_MESSAGE,
  IN_USE_MESSAGE,
  REDATE_BAD_PERIOD_MESSAGE,
  REDATE_END_BEFORE_START_MESSAGE,
  REDATE_INACTIVE_MESSAGE,
  REDATE_INCOMPLETE_MESSAGE,
  REDATE_NOT_FOUND_MESSAGE,
  REDATE_OVERLAP_MESSAGE,
  REDATE_SAME_DATE_MESSAGE,
  StaleWriteError,
  UPDATE_DENIED_MESSAGE,
  VOID_PAID_INVOICE_MESSAGE,
  formatCode,
} from './types'
import type { MemberRole } from '../../types/db'
import { leaseOverlaps } from '../../domain/occupancy'

export const STORAGE_KEY = 'woombad.local.db.v1'

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
      if (Array.isArray(rows)) (db as Record<string, unknown[]>)[t] = rows.map((r) => withColumnDefaults(t, r as unknown as Record<string, unknown>))
    }
    return db
  } catch {
    // keep unreadable data for recovery; the demo seed would otherwise overwrite it on start
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
      if (raw) globalThis.localStorage?.setItem(`${STORAGE_KEY}.corrupt`, raw)
    } catch {
      // storage blocked or full
    }
    return emptyDb()
  }
}

/** Columns added after the first release default to null (like a DB migration) for rows stored earlier. */
const COLUMN_DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  invoices: { period_type: null },
  invitations: { label: null, expires_at: '2099-12-31T00:00:00.000Z', accepted_by: null },
  tenants: { id_type: 'ktp', id_number: null, nationality: null },
  payments: { created_by: null },
  expenses: { lease_id: null, created_by: null },
  properties: { payment_info: null, logo_path: null },
}

function withColumnDefaults(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const defaults = COLUMN_DEFAULTS[table]
  if (!defaults) return row
  const next = { ...row }
  for (const [k, v] of Object.entries(defaults)) if (next[k] === undefined) next[k] = v
  return next
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

  async update<T extends TableName>(table: T, id: string, patch: Update<T>, orgId?: string): Promise<Row<T>> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id && (!orgId || rec(r).org_id === orgId))
    if (idx < 0) throw new Error(UPDATE_DENIED_MESSAGE)
    // invoices_void_guard: an invoice with rent payments cannot be voided
    if (table === 'invoices' && rec(patch).status === 'void' && rec(rows[idx]).status !== 'void' && this.db.payments.some((p) => p.invoice_id === id && p.kind === 'rent')) {
      throw new Error(VOID_PAID_INVOICE_MESSAGE)
    }
    const next = { ...rows[idx], ...patch } as Record<string, unknown>
    if (hasUpdatedAt(table)) next.updated_at = new Date().toISOString()
    rows[idx] = next as unknown as Row<T>
    saveDb(this.db)
    return { ...rows[idx] }
  }

  async remove<T extends TableName>(table: T, id: string, orgId?: string): Promise<void> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id && (!orgId || rec(r).org_id === orgId))
    // like SupabaseRepo: deleting nothing is an error, never a silent success
    if (idx < 0) throw new Error(DELETE_DENIED_MESSAGE)
    if (this.isReferenced(table, id)) throw new Error(IN_USE_MESSAGE)
    rows.splice(idx, 1)
    saveDb(this.db)
  }

  /** Mirror the database's ON DELETE RESTRICT rules so demo mode behaves like online mode. */
  private isReferenced(table: TableName, id: string): boolean {
    switch (table) {
      case 'properties':
        return (
          this.db.rooms.some((r) => r.property_id === id) ||
          this.db.leases.some((r) => r.property_id === id) ||
          this.db.invoices.some((r) => r.property_id === id) ||
          this.db.payments.some((r) => r.property_id === id)
        )
      case 'rooms':
      case 'tenants':
        return this.db.leases.some((l) => (table === 'rooms' ? l.room_id : l.tenant_id) === id)
      case 'leases':
        return (
          this.db.invoices.some((i) => i.lease_id === id) ||
          this.db.payments.some((p) => p.lease_id === id) ||
          this.db.expenses.some((e) => e.lease_id === id)
        )
      case 'invoices':
        return this.db.payments.some((p) => p.invoice_id === id)
      default:
        return false
    }
  }

  async ensureMembership(user: { id: string; email: string | null }): Promise<string> {
    const [org] = this.db.organizations
    if (!org) throw new Error('Data demo belum tersedia.')
    if (!this.db.organization_members.some((m) => m.org_id === org.id && m.user_id === user.id)) {
      await this.insert('organization_members', { org_id: org.id, user_id: user.id, email: user.email, role: 'owner' })
    }
    return org.id
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

  /** Demo mode has a single local user who is always a member, so any code simply returns the org. */
  async joinWithCode(): Promise<string> {
    const [org] = this.db.organizations
    if (!org) throw new Error('Data demo belum tersedia.')
    return org.id
  }

  async createInvitation(orgId: string, role: 'admin' | 'staff', label: string | null): Promise<CreatedInvitation> {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await this.insert('invitations', {
      org_id: orgId,
      label: label?.trim() || null,
      email: null,
      role,
      invited_by: null,
      expires_at: expiresAt,
      accepted_at: null,
      accepted_by: null,
    })
    return { code: formatCode(code), expiresAt }
  }

  async setMemberRole(orgId: string, userId: string, role: MemberRole): Promise<void> {
    const members = this.db.organization_members.filter((m) => m.org_id === orgId)
    const target = members.find((m) => m.user_id === userId)
    if (!target) throw new Error('Anggota tidak ditemukan.')
    if (target.role === 'owner' && role !== 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
      throw new Error('Tidak dapat mengubah peran pemilik terakhir.')
    }
    target.role = role
    saveDb(this.db)
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    this.db.organization_members = this.db.organization_members.filter(
      (m) => !(m.org_id === orgId && m.user_id === userId),
    )
    saveDb(this.db)
  }

  /**
   * Same checks and messages as public.redate_lease (SPEC 7.6), then every write at once: everything is validated
   * before the first row changes, and a failed save restores the previous rows. Demo mode has one local owner, so the
   * owner/admin check is the caller's (useLeaseActions refuses staff before any read or write).
   */
  async redateLease(input: RedateLeaseInput, orgId?: string): Promise<void> {
    const lease = this.db.leases.find((l) => l.id === input.leaseId && (!orgId || l.org_id === orgId))
    if (!lease) throw new Error(REDATE_NOT_FOUND_MESSAGE)
    if (!isISODate(input.expectedStart) || !isISODate(input.newStart) || !isISODate(input.newEnd) || !Array.isArray(input.invoices)) {
      throw new Error(REDATE_INCOMPLETE_MESSAGE)
    }
    if (lease.status !== 'active') throw new Error(REDATE_INACTIVE_MESSAGE)
    if (lease.start_date !== input.expectedStart) throw new StaleWriteError()
    if (input.invoices.some((p) => !p?.id || !isISODate(p.period_start) || !isISODate(p.period_end) || !isISODate(p.due_date))) {
      throw new Error(REDATE_INCOMPLETE_MESSAGE)
    }
    // exactly the lease's invoices (void ones too), each once
    const own = this.db.invoices.filter((i) => i.lease_id === lease.id)
    const ids = new Set(input.invoices.map((i) => i.id))
    if (ids.size !== input.invoices.length || ids.size !== own.length || own.some((i) => !ids.has(i.id))) throw new StaleWriteError()
    if (input.newStart === lease.start_date) throw new Error(REDATE_SAME_DATE_MESSAGE)
    if (input.newEnd < input.newStart) throw new Error(REDATE_END_BEFORE_START_MESSAGE)
    if (input.invoices.some((p) => p.period_end < p.period_start)) throw new Error(REDATE_BAD_PERIOD_MESSAGE)
    // only collisions the correction creates: a lease that already overlaps the stored span (the previous tenant of a
    // room this lease moved into) is room history, as in public.redate_lease
    const history = (o: Row<'leases'>) => leaseOverlaps([o], lease.room_id, lease.start_date, lease.end_date, lease.id)
    if (leaseOverlaps(this.db.leases.filter((o) => !history(o)), lease.room_id, input.newStart, input.newEnd, lease.id)) {
      throw new Error(REDATE_OVERLAP_MESSAGE)
    }

    const now = new Date().toISOString()
    const byId = new Map(input.invoices.map((p) => [p.id, p]))
    const prevInvoices = this.db.invoices
    const prevLeases = this.db.leases
    this.db.invoices = prevInvoices.map((inv) => {
      const p = inv.lease_id === lease.id ? byId.get(inv.id) : undefined
      if (!p || (p.period_start === inv.period_start && p.period_end === inv.period_end && p.due_date === inv.due_date)) return inv
      return { ...inv, period_start: p.period_start, period_end: p.period_end, due_date: p.due_date, updated_at: now }
    })
    const note = input.note?.trim()
    this.db.leases = prevLeases.map((l) =>
      l.id === lease.id
        ? {
            ...l,
            start_date: input.newStart,
            end_date: input.newEnd,
            notes: note ? (l.notes?.trim() ? `${l.notes.trim()}\n${note}` : note) : l.notes,
            updated_at: now,
          }
        : l,
    )
    try {
      saveDb(this.db)
    } catch (err) {
      this.db.invoices = prevInvoices
      this.db.leases = prevLeases
      throw err
    }
  }
}

function isISODate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

const TABLES_WITH_UPDATED_AT: ReadonlySet<TableName> = new Set<TableName>([
  'properties',
  'rooms',
  'tenants',
  'leases',
  'invoices',
  'expenses',
  'waitlist',
])

function hasUpdatedAt(table: TableName): boolean {
  return TABLES_WITH_UPDATED_AT.has(table)
}

export type { Db as LocalDb }
export { emptyDb as emptyLocalDb }
