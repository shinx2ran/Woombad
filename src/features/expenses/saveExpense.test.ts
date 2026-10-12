import { describe, expect, it } from 'vitest'
import type { Expense } from '../../types/db'
import type { ExpenseDraft } from './expenseUtils'
import {
  OLD_RECEIPT_NOT_REMOVED,
  RECEIPT_UPLOAD_FAILED_ADMIN,
  RECEIPT_UPLOAD_FAILED_STAFF,
  saveExpense,
  type ExpenseSaveRepo,
} from './saveExpense'

interface FakeOptions {
  /** staff: `expenses_update` is admin-only, so PostgREST filters the update to 0 rows and `.single()` fails */
  staff?: boolean
  failUpload?: boolean
  failInsert?: boolean
  failRemove?: boolean
  rows?: Expense[]
}

function fakeRepo(opts: FakeOptions = {}) {
  const rows: Expense[] = [...(opts.rows ?? [])]
  const files = new Set<string>(rows.flatMap((r) => (r.receipt_path ? [r.receipt_path] : [])))
  const calls: string[] = []
  let seq = 0
  const toRow = (r: Partial<Expense>): Expense => ({
    id: `e${++seq}`,
    org_id: 'org',
    property_id: null,
    lease_id: null,
    category: 'other',
    amount: 0,
    expense_date: '2026-10-12',
    description: '',
    vendor: null,
    receipt_path: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...r,
  })
  const repo = {
    async list(_table: string, o?: { where?: { receipt_path?: string } }) {
      calls.push('list')
      return rows.filter((r) => r.receipt_path === o?.where?.receipt_path)
    },
    async insert(_table: string, row: Partial<Expense>) {
      calls.push('insert')
      if (opts.failInsert) throw new Error('new row violates row-level security policy')
      const created = toRow(row)
      rows.push(created)
      return created
    },
    async insertMany(_table: string, many: Partial<Expense>[]) {
      calls.push('insertMany')
      if (opts.failInsert) throw new Error('new row violates row-level security policy')
      const created = many.map(toRow)
      rows.push(...created)
      return created
    },
    async update(_table: string, id: string, patch: Partial<Expense>) {
      calls.push('update')
      const row = rows.find((r) => r.id === id)
      if (opts.staff || !row) throw new Error('JSON object requested, multiple (or no) rows returned (PGRST116)')
      Object.assign(row, patch)
      return row
    },
    async uploadFile(_bucket: string, fileName: string) {
      calls.push('upload')
      if (opts.failUpload) throw new Error('Payload too large')
      const path = `org/${fileName}`
      files.add(path)
      return path
    },
    async removeFile(_bucket: string, path: string) {
      calls.push('remove')
      if (opts.failRemove) throw new Error('network')
      files.delete(path)
    },
  }
  return { repo: repo as unknown as ExpenseSaveRepo, rows, files, calls }
}

const draft: ExpenseDraft = {
  expense_date: '2026-10-12',
  property_id: 'A',
  lease_id: null,
  category: 'maintenance',
  amount: 150_000,
  description: 'Ganti kran',
  vendor: null,
  receipt_path: null,
}

const photo = () => new File(['jpeg-bytes'], 'Struk.JPG', { type: 'image/jpeg' })

describe('saveExpense', () => {
  it('lets staff keep a receipt on a new expense: the insert carries receipt_path, no update follows', async () => {
    const { repo, rows, files, calls } = fakeRepo({ staff: true })
    const result = await saveExpense(repo, { draft, file: photo(), canEdit: false })
    expect(result).toEqual({ count: 1, receiptWarning: null })
    expect(calls).toEqual(['upload', 'insert'])
    expect(rows).toHaveLength(1)
    expect(rows[0].receipt_path).toMatch(/^org\/[0-9a-f-]{36}\.jpg$/)
    expect(files.has(rows[0].receipt_path!)).toBe(true)
  })

  it('gives every row of a split expense the same receipt in one insert', async () => {
    const { repo, rows, calls } = fakeRepo({ staff: true })
    const result = await saveExpense(repo, { draft: { ...draft, property_id: null }, splitPropertyIds: ['A', 'B', 'C'], file: photo(), canEdit: false })
    expect(result.count).toBe(3)
    expect(calls).toEqual(['upload', 'insertMany'])
    expect(new Set(rows.map((r) => r.receipt_path)).size).toBe(1)
    expect(rows[0].receipt_path).not.toBeNull()
  })

  it('removes the uploaded file again when the database refuses the row', async () => {
    const { repo, files, calls } = fakeRepo({ failInsert: true })
    await expect(saveExpense(repo, { draft, file: photo(), canEdit: false })).rejects.toThrow(/row-level security/)
    expect(calls).toEqual(['upload', 'insert', 'remove'])
    expect(files.size).toBe(0)
  })

  it('still saves the row when the upload fails, with a hint that fits the role', async () => {
    const staff = fakeRepo({ failUpload: true })
    const staffResult = await saveExpense(staff.repo, { draft, file: photo(), canEdit: false })
    expect(staffResult.receiptWarning).toBe(RECEIPT_UPLOAD_FAILED_STAFF)
    expect(staffResult.receiptWarning).not.toMatch(/Ubah/)
    expect(staff.rows[0].receipt_path).toBeNull()

    const admin = fakeRepo({ failUpload: true })
    const adminResult = await saveExpense(admin.repo, { draft, file: photo(), canEdit: true })
    expect(adminResult.receiptWarning).toBe(RECEIPT_UPLOAD_FAILED_ADMIN)
  })

  it('saves without touching storage when no photo is picked', async () => {
    const { repo, calls } = fakeRepo()
    await saveExpense(repo, { draft, canEdit: true })
    expect(calls).toEqual(['insert'])
  })

  describe('edit (owner/admin)', () => {
    const existing = (receipt: string | null): Expense => ({
      id: 'x1',
      org_id: 'org',
      ...draft,
      receipt_path: receipt,
      created_by: null,
      created_at: '',
      updated_at: '',
    })

    it('replaces the receipt in the same update and removes the old file afterwards', async () => {
      const { repo, rows, files, calls } = fakeRepo({ rows: [existing('org/old.jpg')] })
      const result = await saveExpense(repo, {
        draft: { ...draft, receipt_path: 'org/old.jpg' },
        editingId: 'x1',
        file: photo(),
        previousReceiptPath: 'org/old.jpg',
        canEdit: true,
      })
      expect(result.receiptWarning).toBeNull()
      expect(calls).toEqual(['upload', 'update', 'list', 'remove'])
      expect(rows[0].receipt_path).not.toBe('org/old.jpg')
      expect(files.has('org/old.jpg')).toBe(false)
      expect(files.has(rows[0].receipt_path!)).toBe(true)
    })

    it('keeps the old file when the update is refused, and drops the new upload', async () => {
      const { repo, rows, files } = fakeRepo({ staff: true, rows: [existing('org/old.jpg')] })
      await expect(
        saveExpense(repo, { draft: { ...draft, receipt_path: 'org/old.jpg' }, editingId: 'x1', file: photo(), previousReceiptPath: 'org/old.jpg', canEdit: true }),
      ).rejects.toThrow(/PGRST116/)
      expect(rows[0].receipt_path).toBe('org/old.jpg')
      expect([...files]).toEqual(['org/old.jpg'])
    })

    it('keeps the old receipt when the new upload fails', async () => {
      const { repo, rows, files } = fakeRepo({ failUpload: true, rows: [existing('org/old.jpg')] })
      const result = await saveExpense(repo, {
        draft: { ...draft, receipt_path: 'org/old.jpg' },
        editingId: 'x1',
        file: photo(),
        previousReceiptPath: 'org/old.jpg',
        canEdit: true,
      })
      expect(result.receiptWarning).toBe(RECEIPT_UPLOAD_FAILED_ADMIN)
      expect(rows[0].receipt_path).toBe('org/old.jpg')
      expect(files.has('org/old.jpg')).toBe(true)
    })

    it('removing the photo deletes the file after the update; a failed removal only warns', async () => {
      const ok = fakeRepo({ rows: [existing('org/old.jpg')] })
      await saveExpense(ok.repo, { draft, editingId: 'x1', previousReceiptPath: 'org/old.jpg', canEdit: true })
      expect(ok.calls).toEqual(['update', 'list', 'remove'])
      expect(ok.files.size).toBe(0)

      const failing = fakeRepo({ failRemove: true, rows: [existing('org/old.jpg')] })
      const result = await saveExpense(failing.repo, { draft, editingId: 'x1', previousReceiptPath: 'org/old.jpg', canEdit: true })
      expect(result.receiptWarning).toBe(OLD_RECEIPT_NOT_REMOVED)
      expect(failing.rows[0].receipt_path).toBeNull()
    })

    it('keeps a receipt still shared with another row of a split expense', async () => {
      const sibling = { ...existing('org/shared.jpg'), id: 'x2' }
      const { repo, files, calls } = fakeRepo({ rows: [existing('org/shared.jpg'), sibling] })
      await saveExpense(repo, { draft, editingId: 'x1', previousReceiptPath: 'org/shared.jpg', canEdit: true })
      expect(calls).toEqual(['update', 'list'])
      expect(files.has('org/shared.jpg')).toBe(true)
    })
  })
})
