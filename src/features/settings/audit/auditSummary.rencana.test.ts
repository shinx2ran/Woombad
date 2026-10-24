import { describe, expect, it } from 'vitest'
import { summarizeAuditEntry } from './auditSummary'

// SPEC 7.7: changes to the daftar tunggu read like the other tables in Riwayat perubahan.
describe('daftar tunggu in the change history', () => {
  const row = { name: 'Rina Kartika', period_type: 'daily', quantity: 2, status: 'waiting', max_price: 150000, wanted_from: '2026-11-05', room_note: 'lantai bawah', lease_id: null }

  it('names the entry and what it asks for', () => {
    expect(summarizeAuditEntry({ table_name: 'waitlist', action: 'insert', old_data: null, new_data: row })).toEqual({
      tableLabel: 'Daftar tunggu',
      action: 'insert',
      actionLabel: 'Tambah',
      subject: 'Rina Kartika · 2 malam',
      changes: [],
    })
  })

  it('lists the changed columns in Indonesian', () => {
    const s = summarizeAuditEntry(
      { table_name: 'waitlist', action: 'update', old_data: row, new_data: { ...row, status: 'booked', max_price: 120000, wanted_from: '2026-11-06', room_note: 'kamar mandi dalam', lease_id: 'L1' } },
      (column, id) => (column === 'lease_id' && id === 'L1' ? 'Rina Kartika · Kamar A3' : null),
    )
    expect(s.changes).toEqual([
      'Harga maks.: Rp 150.000 → Rp 120.000',
      'Status: Menunggu → Sudah dipesan',
      'Mulai: 5 Nov 2026 → 6 Nov 2026',
      'Sewa: – → Rina Kartika · Kamar A3',
      'Preferensi kamar: lantai bawah → kamar mandi dalam',
    ])
  })
})
