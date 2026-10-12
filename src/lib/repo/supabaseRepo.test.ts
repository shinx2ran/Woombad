import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseRepo, translateDbError } from './supabaseRepo'
import { DELETE_DENIED_MESSAGE, IN_USE_MESSAGE, UPDATE_DENIED_MESSAGE } from './types'

type Result = { data: unknown; error: { message: string; code?: string; details?: string } | null }

/** Minimal stand-in for the PostgREST query builder: records the calls, answers with `result`. */
function fakeClient(result: Result) {
  const calls: unknown[][] = []
  const answer = () => Object.assign(Promise.resolve(result), { single: () => Promise.resolve(result) })
  const builder = {
    delete: (...args: unknown[]) => (calls.push(['delete', ...args]), builder),
    update: (...args: unknown[]) => (calls.push(['update', ...args]), builder),
    eq: (...args: unknown[]) => (calls.push(['eq', ...args]), builder),
    select: (...args: unknown[]) => (calls.push(['select', ...args]), answer()),
  }
  const sb = { from: (table: string) => (calls.push(['from', table]), builder) }
  return { repo: new SupabaseRepo(sb as unknown as SupabaseClient), calls }
}

// What PostgreSQL returns when a delete hits ON DELETE RESTRICT (replayed against the real schema).
const fk = (table: string, constraint: string, child: string) => ({
  code: '23503',
  message: `update or delete on table "${table}" violates foreign key constraint "${constraint}" on table "${child}"`,
  details: `Key (org_id, id)=(00000000-0000-0000-0000-000000000001, 00000000-0000-0000-0000-000000000002) is still referenced from table "${child}".`,
})

describe('translateDbError', () => {
  it('a delete refused because the row is still in use is Indonesian', () => {
    for (const e of [
      fk('rooms', 'leases_org_id_room_id_fkey', 'leases'),
      fk('tenants', 'leases_org_id_tenant_id_fkey', 'leases'),
      fk('properties', 'rooms_org_id_property_id_fkey', 'rooms'),
      fk('invoices', 'payments_org_id_invoice_id_fkey', 'payments'),
    ]) {
      expect(translateDbError(e)).toBe(IN_USE_MESSAGE)
      // callers that only kept the message text
      expect(translateDbError(e.message)).toBe(IN_USE_MESSAGE)
    }
  })

  it('leaves other errors as they were', () => {
    // a missing parent on insert is a different problem, not "still in use"
    const insertFk = { code: '23503', message: 'insert or update on table "leases" violates foreign key constraint "leases_org_id_room_id_fkey"', details: 'Key (...) is not present in table "rooms".' }
    expect(translateDbError(insertFk)).toBe(insertFk.message)
    expect(translateDbError({ code: '42501', message: 'new row violates row-level security policy for table "payments"' })).toBe('Anda tidak memiliki izin untuk tindakan ini.')
    expect(translateDbError({ code: '23505', message: 'duplicate key value violates unique constraint "invoices_org_id_invoice_number_key"' })).toBe('Nomor tagihan sudah dipakai. Coba lagi.')
    expect(translateDbError('TypeError: Failed to fetch')).toBe('Tidak dapat terhubung ke server. Periksa koneksi internet.')
    expect(translateDbError({ code: 'P0001', message: 'Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan.' })).toBe('Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan.')
  })
})

describe('SupabaseRepo.remove', () => {
  it('asks for the deleted ids, scoped to the organisation', async () => {
    const { repo, calls } = fakeClient({ data: [{ id: 'x' }], error: null })
    await expect(repo.remove('payments', 'x', 'org-1')).resolves.toBeUndefined()
    expect(calls).toEqual([['from', 'payments'], ['delete'], ['eq', 'id', 'x'], ['eq', 'org_id', 'org-1'], ['select', 'id']])
  })

  it('0 rows deleted (RLS, e.g. a demoted admin, or already gone) is an error, not a success', async () => {
    const { repo } = fakeClient({ data: [], error: null })
    await expect(repo.remove('payments', 'x', 'org-1')).rejects.toThrow(DELETE_DENIED_MESSAGE)
  })

  it('a row still in use gives the Indonesian message', async () => {
    const { repo } = fakeClient({ data: null, error: fk('rooms', 'leases_org_id_room_id_fkey', 'leases') })
    await expect(repo.remove('rooms', 'x', 'org-1')).rejects.toThrow(IN_USE_MESSAGE)
  })
})

describe('SupabaseRepo.update', () => {
  it('PGRST116 (no row came back: RLS or gone) is Indonesian', async () => {
    const { repo } = fakeClient({ data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' } })
    await expect(repo.update('invoices', 'x', { status: 'void' }, 'org-1')).rejects.toThrow(UPDATE_DENIED_MESSAGE)
  })

  it('a trigger message passes through', async () => {
    const { repo } = fakeClient({ data: null, error: { code: 'P0001', message: 'Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan.' } })
    await expect(repo.update('invoices', 'x', { status: 'void' }, 'org-1')).rejects.toThrow('Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan.')
  })
})
