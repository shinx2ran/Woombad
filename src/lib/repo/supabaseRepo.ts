import type { SupabaseClient } from '@supabase/supabase-js'
import type { Insert, Row, TableName, Update } from '../../types/db'
import type { CreatedInvitation, ListOptions, Repo, StorageBucket } from './types'
import { NotMemberError, formatCode, normalizeCode } from './types'
import type { MemberRole } from '../../types/db'

/** Turn Postgres/PostgREST errors into messages a kos owner can act on. */
export function translateDbError(message: string): string {
  if (/row-level security|permission denied|42501/i.test(message)) return 'Anda tidak memiliki izin untuk tindakan ini.'
  if (/invoices_org_id_invoice_number_key|invoice_number/i.test(message) && /duplicate|unique/i.test(message)) {
    return 'Nomor tagihan sudah dipakai. Coba lagi.'
  }
  if (/violates foreign key constraint/i.test(message) && /restrict|still referenced/i.test(message)) {
    return 'Data ini masih dipakai oleh data lain (mis. sewa/tagihan/pembayaran) dan tidak dapat dihapus.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.'
  if (/Signups not allowed|signup.*disabled/i.test(message)) return 'Pendaftaran akun baru sedang ditutup. Minta pemilik kos membuatkan akun.'
  return message
}

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
    if (error) throw new Error(translateDbError(error.message))
    return data as unknown as Row<T>
  }

  async insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]> {
    if (rows.length === 0) return []
    const { data, error } = await this.sb.from(table).insert(rows as never).select('*')
    if (error) throw new Error(translateDbError(error.message))
    return (data ?? []) as unknown as Row<T>[]
  }

  async update<T extends TableName>(table: T, id: string, patch: Update<T>, orgId?: string): Promise<Row<T>> {
    let q = this.sb.from(table).update(patch as never).eq('id', id)
    if (orgId) q = q.eq('org_id', orgId)
    const { data, error } = await q.select('*').single()
    if (error) throw new Error(translateDbError(error.message))
    return data as unknown as Row<T>
  }

  async remove<T extends TableName>(table: T, id: string, orgId?: string): Promise<void> {
    let q = this.sb.from(table).delete().eq('id', id)
    if (orgId) q = q.eq('org_id', orgId)
    const { error } = await q
    if (error) throw new Error(translateDbError(error.message))
  }

  async ensureMembership(): Promise<string> {
    const { data, error } = await this.sb.rpc('ensure_membership')
    // SQLSTATE WB001 = signed in but not a member of any organisation (see supabase/schema.sql)
    if (error?.code === 'WB001') throw new NotMemberError(error.message)
    if (error) throw new Error(translateDbError(error.message))
    return data as string
  }

  async joinWithCode(code: string): Promise<string> {
    const { data, error } = await this.sb.rpc('join_with_code', { p_code: normalizeCode(code) })
    if (error) throw new Error(translateDbError(error.message))
    // A wrong code returns null instead of raising, so the failed attempt stays recorded for rate limiting.
    if (!data) throw new Error('Kode tidak valid atau sudah kedaluwarsa.')
    return data as string
  }

  async createInvitation(orgId: string, role: 'admin' | 'staff', label: string | null): Promise<CreatedInvitation> {
    const { data, error } = await this.sb.rpc('create_invitation', { p_org_id: orgId, p_role: role, p_label: label?.trim() || null })
    if (error) throw new Error(translateDbError(error.message))
    const row = (Array.isArray(data) ? data[0] : data) as { code: string; expires_at: string }
    return { code: formatCode(normalizeCode(row.code)), expiresAt: row.expires_at }
  }

  async setMemberRole(orgId: string, userId: string, role: MemberRole): Promise<void> {
    const { error } = await this.sb.rpc('set_member_role', { p_org_id: orgId, p_user_id: userId, p_role: role })
    if (error) throw new Error(translateDbError(error.message))
  }

  async uploadFile(bucket: StorageBucket, path: string, file: Blob, contentType?: string): Promise<string | null> {
    const { error } = await this.sb.storage.from(bucket).upload(path, file, { upsert: true, contentType })
    if (error) throw new Error(error.message)
    return path
  }

  async getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null> {
    if (!path) return null
    const { data, error } = await this.sb.storage.from(bucket).createSignedUrl(path, 300)
    if (error) return null
    return data?.signedUrl ?? null
  }

  async removeFile(bucket: StorageBucket, path: string): Promise<void> {
    const { error } = await this.sb.storage.from(bucket).remove([path])
    if (error) throw new Error(error.message)
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const { error } = await this.sb.rpc('remove_member', { p_org_id: orgId, p_user_id: userId })
    if (error) throw new Error(translateDbError(error.message))
  }
}
