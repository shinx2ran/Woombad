import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseRepo } from './supabaseRepo'
import { StaleWriteError, type RedateLeaseInput } from './types'

type RpcError = { message: string; code?: string; details?: string } | null

/** Stand-in for supabase.rpc: records the call, answers with `error`. */
function fakeRpc(error: RpcError) {
  const calls: unknown[][] = []
  const sb = { rpc: (name: string, args: unknown) => (calls.push([name, args]), Promise.resolve({ data: null, error })) }
  return { repo: new SupabaseRepo(sb as unknown as SupabaseClient), calls }
}

const input: RedateLeaseInput = {
  leaseId: 'L1',
  expectedStart: '2026-09-01',
  newStart: '2026-08-18',
  newEnd: '2026-11-17',
  invoices: [{ id: 'SEP', period_start: '2026-08-18', period_end: '2026-09-17', due_date: '2026-08-18' }],
  note: 'Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026)',
}

describe('SupabaseRepo.redateLease', () => {
  it('is one redate_lease call with every invoice and the note', async () => {
    const { repo, calls } = fakeRpc(null)
    await expect(repo.redateLease(input)).resolves.toBeUndefined()
    expect(calls).toEqual([
      [
        'redate_lease',
        {
          p_lease_id: 'L1',
          p_expected_start: '2026-09-01',
          p_new_start: '2026-08-18',
          p_new_end: '2026-11-17',
          p_invoices: [{ id: 'SEP', period_start: '2026-08-18', period_end: '2026-09-17', due_date: '2026-08-18' }],
          p_note: input.note,
        },
      ],
    ])
  })

  it('WB002 (changed since the screen read it) is a StaleWriteError; other refusals keep their Indonesian text', async () => {
    await expect(fakeRpc({ code: 'WB002', message: 'Tagihan atau pembayaran sewa ini baru saja diubah dari perangkat lain.' }).repo.redateLease(input)).rejects.toBeInstanceOf(StaleWriteError)
    await expect(fakeRpc({ code: 'P0001', message: 'Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.' }).repo.redateLease(input)).rejects.toThrow(
      'Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.',
    )
    await expect(fakeRpc({ code: '42501', message: 'permission denied for function redate_lease' }).repo.redateLease(input)).rejects.toThrow('Anda tidak memiliki izin untuk tindakan ini.')
    await expect(fakeRpc({ message: 'TypeError: Failed to fetch' }).repo.redateLease(input)).rejects.toThrow('Tidak dapat terhubung ke server. Periksa koneksi internet.')
  })
})
