import { describe, expect, it } from 'vitest'
import { translateDbError } from './supabaseRepo'
import { LEASE_OVERLAP_MESSAGE } from './types'

// SPEC 7.7: what public.leases_overlap_guard raises reaches the user in Indonesian, whatever PostgREST adds.
describe('translateDbError: double booking', () => {
  it('maps SQLSTATE WB003 to the guard message', () => {
    expect(translateDbError({ code: 'WB003', message: 'Kamar sudah terisi atau dipesan pada tanggal itu.' })).toBe(LEASE_OVERLAP_MESSAGE)
    expect(translateDbError({ code: 'WB003', message: 'anything' })).toBe('Kamar sudah terisi atau dipesan pada tanggal itu.')
  })

  it('leaves other errors as they were', () => {
    expect(translateDbError({ code: '23514', message: 'new row violates check constraint' })).toBe('new row violates check constraint')
    expect(translateDbError({ code: '42501', message: 'x' })).toBe('Anda tidak memiliki izin untuk tindakan ini.')
  })
})
