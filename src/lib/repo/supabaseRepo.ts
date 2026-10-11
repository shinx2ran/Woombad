import type { SupabaseClient } from '@supabase/supabase-js'
import type { Insert, Row, TableName, Update } from '../../types/db'
import type { ListOptions, MemberAddResult, Repo, StorageBucket } from './types'

export class SupabaseRepo implements Repo {
  readonly mode = 'supabase' as const
  private readonly sb: SupabaseClient
  constructor(sb: SupabaseClient) {
    this.sb = sb
  }

  async list<T extends TableName>(table: T, opts: ListOptions<Row<T>> = {}): Promise<Row<T>[]> {
    // PostgREST caps responses (default 1000 rows); page through so yearly reports never silently truncate.
    const PAGE = 1000
    const all: Row<T>[] = []
    for (let from = 0; ; from += PAGE) {
      let q = this.sb.from(table).select('*')
      for (const [col, val] of Object.entries(opts.where ?? {})) {
        if (val === undefined) continue
        if (Array.isArray(val)) q = q.in(col, val as unknown[])
        else if (val === null) q = q.is(col, null)
        else q = q.eq(col, val as never)
      }
      for (const [col, val] of Object.entries(opts.gte ?? {})) if (val != null) q = q.gte(col, val as never)
      for (const [col, val] of Object.entries(opts.lte ?? {})) if (val != null) q = q.lte(col, val as never)
      if (opts.orderBy) q = q.order(opts.orderBy.column, { ascending: opts.orderBy.ascending ?? true })
      else q = q.order('created_at', { ascending: false })
      // stable secondary order so paging never skips/duplicates rows with equal sort keys
      q = q.order('id', { ascending: true })
      const remaining = opts.limit != null ? opts.limit - all.length : PAGE
      const size = Math.min(PAGE, remaining)
      if (size <= 0) break
      const { data, error } = await q.range(from, from + size - 1)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as Row<T>[]
      all.push(...rows)
      if (rows.length < size) break
    }
    return all
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const { data, error } = await this.sb.from(table).select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as unknown as Row<T>) ?? null
  }

  async insert<T extends TableName>(table: T, row: Insert<T>): Promise<Row<T>> {
    const { data, error } = await this.sb.from(table).insert(row as never).select('*').single()
    if (error) throw new Error(error.message)
    return data as unknown as Row<T>
  }

  async insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]> {
    if (rows.length === 0) return []
    const { data, error } = await this.sb.from(table).insert(rows as never).select('*')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Row<T>[]
  }

  async update<T extends TableName>(table: T, id: string, patch: Update<T>): Promise<Row<T>> {
    const { data, error } = await this.sb.from(table).update(patch as never).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    return data as unknown as Row<T>
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const { error } = await this.sb.from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)
  }

  async uploadFile(bucket: StorageBucket, path: string, file: Blob, contentType?: string): Promise<string | null> {
    const { error } = await this.sb.storage.from(bucket).upload(path, file, { upsert: true, contentType })
    if (error) throw new Error(error.message)
    return path
  }

  async getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null> {
    if (!path) return null
    const { data, error } = await this.sb.storage.from(bucket).createSignedUrl(path, 60 * 60)
    if (error) return null
    return data?.signedUrl ?? null
  }

  async removeFile(bucket: StorageBucket, path: string): Promise<void> {
    const { error } = await this.sb.storage.from(bucket).remove([path])
    if (error) throw new Error(error.message)
  }

  async addMemberByEmail(orgId: string, email: string, role: 'admin' | 'staff'): Promise<MemberAddResult> {
    const { data, error } = await this.sb.rpc('add_member_by_email', {
      p_org_id: orgId,
      p_email: email.trim().toLowerCase(),
      p_role: role,
    })
    if (error) throw new Error(error.message)
    const status = (data as string) as MemberAddResult['status']
    const message =
      status === 'added'
        ? 'Anggota berhasil ditambahkan.'
        : status === 'invited'
          ? 'Undangan dibuat. Minta mereka mendaftar dengan email tersebut.'
          : 'Email ini sudah menjadi anggota.'
    return { status, message }
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const { error } = await this.sb.rpc('remove_member', { p_org_id: orgId, p_user_id: userId })
    if (error) throw new Error(error.message)
  }
}
