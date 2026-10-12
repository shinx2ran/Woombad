import { describe, expect, it } from 'vitest'
import type { Expense } from '../../types/db'
import {
  DELETE_DENIED_MESSAGE,
  ORDERED_CATEGORIES,
  SHARED_VALUE,
  UPDATE_DENIED_MESSAGE,
  canEditExpenses,
  categoryOptionLabel,
  expenseDeltaText,
  filterExpenses,
  groupByDate,
  isExpenseVisible,
  operatingExpenseRows,
  rangeLabel,
  sameDayInMonth,
  saveErrorMessage,
  shortRupiah,
  splitEvenly,
  splitExpenseRows,
  validateExpenseForm,
} from './expenseUtils'

function mkExpense(partial: Partial<Expense> & { id: string }): Expense {
  return {
    org_id: 'org',
    property_id: 'A',
    lease_id: null,
    category: 'utilities',
    amount: 100_000,
    expense_date: '2026-10-05',
    description: 'Listrik',
    vendor: null,
    receipt_path: null,
    created_by: null,
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
    ...partial,
  }
}

describe('categories', () => {
  it('puts refund categories last', () => {
    expect(ORDERED_CATEGORIES.slice(-2)).toEqual(['deposit_refund', 'rent_refund'])
    expect(ORDERED_CATEGORIES).toHaveLength(9)
  })
  it('labels refunds with the hint', () => {
    expect(categoryOptionLabel('rent_refund')).toBe('Pengembalian Sewa — bukan biaya operasional')
    expect(categoryOptionLabel('wages')).toBe('Gaji & Upah')
  })
})

describe('isExpenseVisible / filterExpenses', () => {
  const rows = [
    mkExpense({ id: '1', property_id: 'A', expense_date: '2026-10-03', created_at: '2026-10-03T01:00:00Z' }),
    mkExpense({ id: '2', property_id: 'B', expense_date: '2026-10-05' }),
    mkExpense({ id: '3', property_id: null, expense_date: '2026-10-05', category: 'wages', created_at: '2026-10-05T09:00:00Z' }),
    mkExpense({ id: '4', property_id: 'A', expense_date: '2026-09-30' }),
  ]
  const range = { start: '2026-10-01', end: '2026-10-31' }

  it('shows shared rows only for "Semua kos"', () => {
    expect(isExpenseVisible(rows[2], ['A', 'B'], true)).toBe(true)
    expect(isExpenseVisible(rows[2], ['A'], false)).toBe(false)
    expect(isExpenseVisible(rows[0], ['A'], false)).toBe(true)
    expect(isExpenseVisible(rows[0], ['B'], false)).toBe(false)
  })

  it('filters by range, property and category and sorts newest first', () => {
    const out = filterExpenses(rows, { range, propertyFilterIds: ['A', 'B'], showShared: true, categories: [] })
    expect(out.map((r) => r.id)).toEqual(['3', '2', '1'])
    const onlyA = filterExpenses(rows, { range, propertyFilterIds: ['A'], showShared: false, categories: [] })
    expect(onlyA.map((r) => r.id)).toEqual(['1'])
    const wages = filterExpenses(rows, { range, propertyFilterIds: ['A', 'B'], showShared: true, categories: ['wages'] })
    expect(wages.map((r) => r.id)).toEqual(['3'])
  })

  it('groups by date with totals', () => {
    const out = filterExpenses(rows, { range, propertyFilterIds: ['A', 'B'], showShared: true, categories: [] })
    const groups = groupByDate(out)
    expect(groups.map((g) => g.date)).toEqual(['2026-10-05', '2026-10-03'])
    expect(groups[0].total).toBe(200_000)
    expect(groups[0].rows).toHaveLength(2)
  })
})

describe('labels', () => {
  it('formats a month and a custom range', () => {
    expect(rangeLabel({ start: '2026-03-01', end: '2026-03-31' }, true)).toBe('Maret 2026')
    expect(rangeLabel({ start: '2026-03-01', end: '2026-03-15' }, false)).toBe('1 Mar 2026 – 15 Mar 2026')
  })
  it('abbreviates rupiah', () => {
    expect(shortRupiah(1_250_000)).toBe('1,3 jt')
    expect(shortRupiah(1_200_000)).toBe('1,2 jt')
    expect(shortRupiah(2_000_000)).toBe('2 jt')
    expect(shortRupiah(850_000)).toBe('850 rb')
    expect(shortRupiah(2_500_000_000)).toBe('2,5 M')
    expect(shortRupiah(500)).toBe('500')
    expect(shortRupiah(-1_500_000)).toBe('-1,5 jt')
  })
  it('builds delta sentences', () => {
    expect(expenseDeltaText(1_200_000, 1_000_000, 'bulan lalu', false)).toEqual({
      text: '▲ Rp 200.000 (+20%) vs bulan lalu',
      tone: 'negative',
    })
    expect(expenseDeltaText(800_000, 1_000_000, 'bulan lalu', true)).toEqual({
      text: '▼ Rp 200.000 (-20%) vs bulan lalu (s/d tanggal yang sama)',
      tone: 'positive',
    })
    expect(expenseDeltaText(0, 0, 'bulan lalu', false).tone).toBe('neutral')
    expect(expenseDeltaText(50_000, 0, 'bulan lalu', false).tone).toBe('neutral')
    expect(expenseDeltaText(50_000, 50_000, 'periode sebelumnya', false).text).toBe('Sama vs periode sebelumnya')
  })
})

describe('duplicate & split', () => {
  it('keeps the day of month and clamps at month end', () => {
    expect(sameDayInMonth('2026-09-15', '2026-10-11')).toBe('2026-10-15')
    expect(sameDayInMonth('2026-01-31', '2026-02-10')).toBe('2026-02-28')
    expect(sameDayInMonth('2024-01-31', '2024-02-10')).toBe('2024-02-29')
    expect(sameDayInMonth('2026-03-31', '2026-04-02')).toBe('2026-04-30')
  })
  it('splits evenly with remainder to the first part', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33])
    expect(splitEvenly(1_500_000, 2)).toEqual([750_000, 750_000])
    expect(splitEvenly(1_000_001, 4)).toEqual([250_001, 250_000, 250_000, 250_000])
    expect(() => splitEvenly(10, 0)).toThrow()
  })
  it('builds one row per kos with suffixed descriptions', () => {
    const rows = splitExpenseRows(
      {
        expense_date: '2026-10-01',
        property_id: null,
        lease_id: null,
        category: 'wages',
        amount: 1_500_001,
        description: 'Gaji penjaga kos',
        vendor: 'Pak Udin',
        receipt_path: null,
      },
      ['A', 'B'],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ property_id: 'A', amount: 750_001, description: 'Gaji penjaga kos (1/2)', vendor: 'Pak Udin' })
    expect(rows[1]).toMatchObject({ property_id: 'B', amount: 750_000, description: 'Gaji penjaga kos (2/2)' })
    expect(rows[0].amount + rows[1].amount).toBe(1_500_001)
  })
})

describe('validateExpenseForm', () => {
  const ok = {
    expense_date: '2026-10-11',
    property: SHARED_VALUE,
    category: 'utilities' as const,
    lease_id: '',
    amount: 50_000,
    description: 'Listrik',
  }
  it('accepts a valid form', () => {
    expect(validateExpenseForm(ok)).toEqual({})
  })
  it('reports Indonesian messages per field', () => {
    const errors = validateExpenseForm({ ...ok, expense_date: '', property: '', amount: 0, description: '  ' })
    expect(errors.expense_date).toBe('Tanggal wajib diisi.')
    expect(errors.property).toMatch(/Pilih kos/)
    expect(errors.amount).toBe('Jumlah harus lebih dari 0.')
    expect(errors.description).toBe('Deskripsi wajib diisi.')
    expect(validateExpenseForm({ ...ok, expense_date: '2026-02-30' }).expense_date).toBe('Tanggal tidak valid.')
  })
  it('requires a lease for refund categories', () => {
    expect(validateExpenseForm({ ...ok, category: 'deposit_refund' }).lease_id).toBe('Pilih sewa yang menerima pengembalian.')
    expect(validateExpenseForm({ ...ok, category: 'deposit_refund', lease_id: 'L1' })).toEqual({})
  })
  it('lets a chosen lease stand in for the kos on refunds (kos follows the lease)', () => {
    expect(validateExpenseForm({ ...ok, property: '', category: 'rent_refund', lease_id: 'L1' })).toEqual({})
    expect(validateExpenseForm({ ...ok, property: '', category: 'rent_refund' }).property).toMatch(/Pilih kos/)
    expect(validateExpenseForm({ ...ok, property: '', category: 'utilities', lease_id: 'L1' }).property).toMatch(/Pilih kos/)
  })
})

describe('operatingExpenseRows', () => {
  it('drops both refund categories, keeps everything else', () => {
    const rows = [
      mkExpense({ id: '1', category: 'wages', amount: 1_500_000 }),
      mkExpense({ id: '2', category: 'deposit_refund', amount: 500_000 }),
      mkExpense({ id: '3', category: 'rent_refund', amount: 300_000 }),
      mkExpense({ id: '4', category: 'supplies', amount: 50_000 }),
    ]
    expect(operatingExpenseRows(rows).map((e) => e.id)).toEqual(['1', '4'])
  })
})

describe('canEditExpenses (mirror of the admin-only expenses_update / expenses_delete policies)', () => {
  it('lets owners and admins edit and delete', () => {
    expect(canEditExpenses('owner')).toBe(true)
    expect(canEditExpenses('admin')).toBe(true)
  })
  it('never lets staff edit or delete, not even rows they recorded', () => {
    expect(canEditExpenses('staff')).toBe(false)
  })
})

describe('saveErrorMessage', () => {
  it('translates the PostgREST 0-row update failure', () => {
    expect(saveErrorMessage(new Error('JSON object requested, multiple (or no) rows returned'), 'x')).toBe(UPDATE_DENIED_MESSAGE)
    expect(saveErrorMessage(new Error('PGRST116'), 'x')).toBe(UPDATE_DENIED_MESSAGE)
    expect(saveErrorMessage(new Error('The result contains 0 rows'), 'x')).toBe(UPDATE_DENIED_MESSAGE)
  })
  it('keeps other messages and falls back for non-errors', () => {
    expect(saveErrorMessage(new Error('Anda tidak memiliki izin untuk tindakan ini.'), 'x')).toBe('Anda tidak memiliki izin untuk tindakan ini.')
    expect(saveErrorMessage('boom', 'Gagal menyimpan pengeluaran.')).toBe('Gagal menyimpan pengeluaran.')
    expect(saveErrorMessage(new Error(''), 'Gagal')).toBe('Gagal')
  })
  it('delete message is distinct from the update one', () => {
    expect(DELETE_DENIED_MESSAGE).not.toBe(UPDATE_DENIED_MESSAGE)
    expect(DELETE_DENIED_MESSAGE).toMatch(/menghapus/)
  })
})
