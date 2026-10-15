import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '../../../types/db'
import {
  FORMER_MEMBER_ACTOR,
  SYSTEM_ACTOR,
  actorLabel,
  auditSubject,
  changedColumns,
  formatAuditValue,
  memberEmails,
  relativeTime,
  summarizeAuditEntry,
  whenLabel,
  type RefResolver,
} from './auditSummary'

function entry(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'a1',
    org_id: 'org',
    table_name: 'payments',
    row_id: 'r1',
    action: 'update',
    changed_by: 'u1',
    changed_at: '2026-10-12T03:00:00Z',
    old_data: null,
    new_data: null,
    ...partial,
  }
}

const payment = {
  id: 'p1',
  org_id: 'org',
  property_id: 'k1',
  invoice_id: 'i1',
  lease_id: 'l1',
  amount: 1_500_000,
  paid_at: '2026-10-01',
  method: 'cash',
  kind: 'rent',
  notes: null,
  created_by: 'u1',
  created_at: '2026-10-01T02:00:00Z',
}

describe('summarizeAuditEntry', () => {
  it('describes a changed payment amount in Rupiah', () => {
    const s = summarizeAuditEntry(
      entry({ old_data: payment, new_data: { ...payment, amount: 1_000_000 } }),
    )
    expect(s.tableLabel).toBe('Pembayaran')
    expect(s.actionLabel).toBe('Ubah')
    expect(s.changes).toEqual(['Jumlah: Rp 1.500.000 → Rp 1.000.000'])
    expect(s.subject).toBe('Rp 1.000.000 · Sewa · Tunai')
  })

  it('ignores updated_at and other bookkeeping columns', () => {
    const before = { id: 'r', name: 'A1', updated_at: '2026-10-01T00:00:00Z', created_by: null }
    const after = { id: 'r', name: 'A1', updated_at: '2026-10-02T00:00:00Z', created_by: 'u1' }
    const s = summarizeAuditEntry(entry({ table_name: 'rooms', old_data: before, new_data: after }))
    expect(s.changes).toEqual([])
  })

  it('lists money first, then status and other columns, with Indonesian labels', () => {
    const before = { invoice_number: 'INV-1', total_amount: 900_000, discount_amount: 0, status: 'partial', notes: null, updated_at: 'a' }
    const after = { invoice_number: 'INV-1', total_amount: 800_000, discount_amount: 100_000, status: 'paid', notes: 'kurang 100rb', updated_at: 'b' }
    const s = summarizeAuditEntry(entry({ table_name: 'invoices', old_data: before, new_data: after }))
    expect(s.subject).toBe('INV-1 · Rp 800.000')
    expect(s.changes).toEqual([
      'Total: Rp 900.000 → Rp 800.000',
      'Diskon: Rp 0 → Rp 100.000',
      'Status: DP / Sebagian → Lunas',
      'Catatan diubah',
    ])
  })

  it('labels lease terms and dates', () => {
    const before = { period_type: 'daily', price_per_period: 150_000, end_date: '2026-10-05', status: 'active' }
    const after = { period_type: 'monthly', price_per_period: 1_800_000, end_date: '2026-11-04', status: 'active' }
    const s = summarizeAuditEntry(entry({ table_name: 'leases', old_data: before, new_data: after }))
    expect(s.changes).toEqual([
      'Harga sewa: Rp 150.000 → Rp 1.800.000',
      'Jenis sewa: Harian → Bulanan',
      // end_date is the last night; the history shows the check-out day (SPEC 7.3)
      'Check-out: 6 Okt 2026 → 5 Nov 2026',
    ])
  })

  it('shows period_end and end_date as check-out days, checkout_date as is', () => {
    const inv = summarizeAuditEntry(
      entry({
        table_name: 'invoices',
        old_data: { invoice_number: 'INV-1', period_start: '2026-10-15', period_end: '2026-10-16', quantity: 2 },
        new_data: { invoice_number: 'INV-1', period_start: '2026-10-15', period_end: '2026-10-21', quantity: 7 },
      }),
    )
    // 2 nights from 15 Okt (check-out 17 Okt) -> one week (check-out 22 Okt)
    expect(inv.changes).toEqual(['Check-out periode: 17 Okt 2026 → 22 Okt 2026', 'Jumlah periode: 2 → 7'])
    // checkout 20 Okt writes end_date = 19 Okt (the last night) with checkout_date in the same entry: only the
    // Checkout line is shown, one check-out day (an older row with end_date = checkout_date reads the same)
    const old = { status: 'active', end_date: '2026-11-14', checkout_date: null }
    for (const endDate of ['2026-10-19', '2026-10-20']) {
      const checkout = summarizeAuditEntry(entry({ table_name: 'leases', old_data: old, new_data: { status: 'ended', end_date: endDate, checkout_date: '2026-10-20' } }))
      expect(checkout.changes).toEqual(['Status: Aktif → Selesai', 'Checkout: – → 20 Okt 2026'])
    }
    // a cancel has no checkout_date: end_date stays, shown as the typed cancel day (end_date 14 Okt -> 15 Okt)
    const cancel = summarizeAuditEntry(entry({ table_name: 'leases', old_data: old, new_data: { status: 'cancelled', end_date: '2026-10-14', checkout_date: null } }))
    expect(cancel.changes).toEqual(['Status: Aktif → Dibatalkan','Check-out: 15 Nov 2026 → 15 Okt 2026'])
    expect(formatAuditValue('leases', 'end_date', '2026-12-31')).toBe('1 Jan 2027')
    expect(formatAuditValue('invoices', 'period_end', null)).toBe('–')
    expect(formatAuditValue('invoices', 'period_start', '2026-10-15')).toBe('15 Okt 2026')
  })

  it('shows room prices and kos payment info', () => {
    const rooms = summarizeAuditEntry(
      entry({ table_name: 'rooms', old_data: { name: 'A1', price_monthly: 1_200_000 }, new_data: { name: 'A1', price_monthly: null } }),
    )
    expect(rooms.subject).toBe('Kamar A1')
    expect(rooms.changes).toEqual(['Harga bulanan: Rp 1.200.000 → –'])
    const kos = summarizeAuditEntry(
      entry({ table_name: 'properties', old_data: { name: 'Kos Melati', payment_info: 'BCA 123' }, new_data: { name: 'Kos Melati', payment_info: 'BRI 999' } }),
    )
    expect(kos.subject).toBe('Kos Melati')
    expect(kos.changes).toEqual(['Info rekening: BCA 123 → BRI 999'])
  })

  it('says a photo was added, replaced or removed instead of quoting paths', () => {
    const t = (before: string | null, after: string | null) =>
      summarizeAuditEntry(entry({ table_name: 'tenants', old_data: { full_name: 'Budi', ktp_image_path: before }, new_data: { full_name: 'Budi', ktp_image_path: after } })).changes
    expect(t(null, 'org/a.jpg')).toEqual(['Foto KTP ditambahkan'])
    expect(t('org/a.jpg', 'org/b.jpg')).toEqual(['Foto KTP diganti'])
    expect(t('org/a.jpg', null)).toEqual(['Foto KTP dihapus'])
  })

  it('resolves referenced ids, or just says the column changed', () => {
    const resolve: RefResolver = (column, id) => (column === 'room_id' ? ({ r1: 'A1', r2: 'B2' } as Record<string, string>)[id] ?? null : null)
    const before = { room_id: 'r1', tenant_id: 't1', period_type: 'monthly', price_per_period: 1_500_000 }
    const s = summarizeAuditEntry(entry({ table_name: 'leases', old_data: before, new_data: { ...before, room_id: 'r2' } }), resolve)
    expect(s.changes).toEqual(['Kamar: A1 → B2'])
    expect(s.subject).toBe('Kamar B2 · Bulanan Rp 1.500.000')
    const unresolved = summarizeAuditEntry(entry({ table_name: 'payments', old_data: { invoice_id: 'i1' }, new_data: { invoice_id: 'i2' } }))
    expect(unresolved.changes).toEqual(['Tagihan diubah'])
  })

  it('summarises inserts and deletes by their row, without a change list', () => {
    const ins = summarizeAuditEntry(entry({ action: 'insert', table_name: 'expenses', new_data: { description: 'Token listrik', amount: 200_000 } }))
    expect(ins.actionLabel).toBe('Tambah')
    expect(ins.subject).toBe('Token listrik · Rp 200.000')
    expect(ins.changes).toEqual([])
    const del = summarizeAuditEntry(entry({ action: 'delete', table_name: 'payments', old_data: payment, new_data: null }))
    expect(del.actionLabel).toBe('Hapus')
    expect(del.subject).toBe('Rp 1.500.000 · Sewa · Tunai')
  })

  it('describes members, invitations and add-ons', () => {
    expect(summarizeAuditEntry(entry({ action: 'insert', table_name: 'organization_members', new_data: { user_id: 'u2', email: 'istri@x.id', role: 'admin' } })).subject).toBe(
      'istri@x.id · Admin',
    )
    expect(summarizeAuditEntry(entry({ action: 'insert', table_name: 'invitations', new_data: { label: 'Pak Udin', email: null, role: 'staff' } })).subject).toBe('Pak Udin · Staf')
    const role = summarizeAuditEntry(entry({ table_name: 'organization_members', old_data: { email: 'a@x.id', role: 'staff' }, new_data: { email: 'a@x.id', role: 'admin' } }))
    expect(role.tableLabel).toBe('Anggota')
    expect(role.changes).toEqual(['Peran: Staf → Admin'])
    expect(summarizeAuditEntry(entry({ action: 'insert', table_name: 'addon_catalog', new_data: { name: 'Parkir', default_price: 50_000, billing: 'per_period' } })).subject).toBe(
      'Parkir · Rp 50.000',
    )
  })

  it('falls back to the raw table name for unknown tables', () => {
    const s = summarizeAuditEntry(entry({ action: 'insert', table_name: 'something_new', new_data: { name: 'X' } }))
    expect(s.tableLabel).toBe('something_new')
    expect(s.subject).toBe('X')
  })
})

describe('changedColumns', () => {
  it('treats null, undefined and missing as the same and compares money across number/string', () => {
    expect(changedColumns({ a: null, amount: 100 }, { amount: '100' })).toEqual([])
    expect(changedColumns({ amount: 100 }, { amount: 101 })).toEqual(['amount'])
  })
  it('returns nothing without both sides', () => {
    expect(changedColumns(null, { a: 1 })).toEqual([])
  })
})

describe('formatAuditValue', () => {
  it('formats empty, enum, date, timestamp, numbers and long text', () => {
    expect(formatAuditValue('payments', 'notes', null)).toBe('–')
    expect(formatAuditValue('payments', 'method', 'deposit')).toBe('Potong Jaminan')
    expect(formatAuditValue('expenses', 'category', 'utilities')).toBe('Listrik, Air & Internet')
    expect(formatAuditValue('leases', 'status', 'ended')).toBe('Selesai')
    expect(formatAuditValue('rooms', 'status', 'maintenance')).toBe('Perbaikan')
    expect(formatAuditValue('payments', 'paid_at', '2026-03-05')).toBe('5 Mar 2026')
    expect(formatAuditValue('invoices', 'quantity', 3)).toBe('3')
    expect(formatAuditValue('tenants', 'address', 'x'.repeat(60))).toHaveLength(40)
    expect(formatAuditValue('invitations', 'accepted_at', '2026-03-05T10:20:00Z')).toMatch(/^5 Mar 2026, \d{2}\.\d{2}$/)
    expect(formatAuditValue('leases', 'room_id', 'r1')).toBeNull()
  })
})

describe('auditSubject', () => {
  it('names tenants and returns null without data', () => {
    expect(auditSubject('tenants', { full_name: 'Siti Aminah' })).toBe('Siti Aminah')
    expect(auditSubject('tenants', null)).toBeNull()
  })
})

describe('who', () => {
  const members = [{ user_id: 'u1', email: 'pemilik@x.id' }]
  const removed = entry({ table_name: 'organization_members', action: 'delete', old_data: { user_id: 'u9', email: 'lama@x.id', role: 'staff' } })

  it('uses current member emails, then emails of removed members found in the log', () => {
    const emails = memberEmails(members, [removed])
    expect(actorLabel('u1', emails)).toBe('pemilik@x.id')
    expect(actorLabel('u9', emails)).toBe('lama@x.id')
  })
  it('falls back to Sistem/Operator without a user and Mantan anggota for an unknown user', () => {
    const emails = memberEmails(members)
    expect(actorLabel(null, emails)).toBe(SYSTEM_ACTOR)
    expect(actorLabel('u7', emails)).toBe(FORMER_MEMBER_ACTOR)
  })
})

describe('relativeTime / whenLabel', () => {
  const now = new Date(2026, 9, 12, 14, 0, 0)
  const at = (d: Date) => d.toISOString()

  it('covers seconds, minutes, hours, yesterday and days', () => {
    expect(relativeTime(at(new Date(2026, 9, 12, 13, 59, 30)), now)).toBe('baru saja')
    expect(relativeTime(at(new Date(2026, 9, 12, 13, 55, 0)), now)).toBe('5 menit lalu')
    expect(relativeTime(at(new Date(2026, 9, 12, 11, 0, 0)), now)).toBe('3 jam lalu')
    expect(relativeTime(at(new Date(2026, 9, 11, 9, 0, 0)), now)).toBe('kemarin')
    expect(relativeTime(at(new Date(2026, 9, 8, 9, 0, 0)), now)).toBe('4 hari lalu')
    expect(relativeTime(at(new Date(2026, 9, 1, 9, 0, 0)), now)).toBeNull()
  })
  it('treats a clock slightly ahead as just now and rejects garbage', () => {
    expect(relativeTime(at(new Date(2026, 9, 12, 14, 0, 30)), now)).toBe('baru saja')
    expect(relativeTime('bukan tanggal', now)).toBeNull()
  })
  it('combines the relative part with date and time, and parses Postgres timestamps', () => {
    expect(whenLabel(at(new Date(2026, 9, 12, 11, 5, 0)), now)).toBe('2 jam lalu · 12 Okt 2026, 11.05')
    expect(whenLabel(at(new Date(2026, 9, 1, 9, 30, 0)), now)).toBe('1 Okt 2026, 09.30')
    expect(relativeTime('2026-10-12T06:57:00.123456+00:00', new Date('2026-10-12T07:00:00Z'))).toBe('2 menit lalu')
  })
})
