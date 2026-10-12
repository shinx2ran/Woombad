import { newId } from '../../lib/ids'
import type { OrgRepo } from '../../lib/repo'
import { splitExpenseRows, type ExpenseDraft } from './expenseUtils'
import { removeReceiptIfUnused } from './receiptFiles'

export type ExpenseSaveRepo = Pick<OrgRepo, 'list' | 'insert' | 'insertMany' | 'update' | 'uploadFile' | 'removeFile'>

export interface SaveExpenseInput {
  /** row values; `receipt_path` is what the row keeps when no new photo is uploaded */
  draft: ExpenseDraft
  /** update this row (owner/admin only) instead of inserting */
  editingId?: string
  /** insert one row per kos with the amount split evenly ("Bagi rata ke semua kos") */
  splitPropertyIds?: string[]
  /** new receipt photo picked in the form */
  file?: File | null
  /** receipt the edited row pointed at before; removed from storage once no row uses it */
  previousReceiptPath?: string | null
  /** owner/admin: can add a missing photo later via "Ubah" */
  canEdit: boolean
}

export interface SaveExpenseResult {
  /** number of rows written */
  count: number
  receiptWarning: string | null
}

export const RECEIPT_UPLOAD_FAILED_ADMIN = 'Pengeluaran tersimpan, tetapi foto struk gagal diunggah. Coba unggah lagi lewat "Ubah".'
export const RECEIPT_UPLOAD_FAILED_STAFF = 'Pengeluaran tersimpan, tetapi foto struk gagal diunggah. Minta pemilik/admin menambahkan fotonya.'
export const OLD_RECEIPT_NOT_REMOVED = 'Pengeluaran tersimpan, tetapi foto struk lama gagal dihapus dari penyimpanan.'

/**
 * Write an expense row (or one per kos) together with its receipt photo. The photo is uploaded first under a fresh
 * name and each row is written once with `receipt_path` already set: staff may insert expenses but not update them
 * (`expenses_update` is admin-only, SPEC 6.2), so a separate "attach the photo" update would always be refused.
 * A failed upload still saves the row, without the photo; a refused row write removes the uploaded file again.
 * The previous photo of an edited row is deleted only after the row points elsewhere (SPEC 6.4).
 */
export async function saveExpense(repo: ExpenseSaveRepo, input: SaveExpenseInput): Promise<SaveExpenseResult> {
  const { file, editingId, splitPropertyIds, previousReceiptPath } = input
  let receiptWarning: string | null = null
  let uploaded: string | null = null
  if (file) {
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      uploaded = await repo.uploadFile('receipts', `${newId()}.${ext}`, file, file.type || undefined)
    } catch {
      receiptWarning = input.canEdit ? RECEIPT_UPLOAD_FAILED_ADMIN : RECEIPT_UPLOAD_FAILED_STAFF
    }
  }
  const draft: ExpenseDraft = uploaded ? { ...input.draft, receipt_path: uploaded } : input.draft

  let count: number
  try {
    if (editingId) {
      await repo.update('expenses', editingId, draft)
      count = 1
    } else if (splitPropertyIds && splitPropertyIds.length > 0) {
      count = (await repo.insertMany('expenses', splitExpenseRows(draft, splitPropertyIds))).length
    } else {
      await repo.insert('expenses', draft)
      count = 1
    }
  } catch (err) {
    // No row points at the new file: do not leave it behind.
    if (uploaded) await repo.removeFile('receipts', uploaded).catch(() => undefined)
    throw err
  }

  if (editingId && previousReceiptPath && previousReceiptPath !== draft.receipt_path) {
    try {
      await removeReceiptIfUnused(repo, previousReceiptPath)
    } catch {
      receiptWarning ??= OLD_RECEIPT_NOT_REMOVED
    }
  }
  return { count, receiptWarning }
}
