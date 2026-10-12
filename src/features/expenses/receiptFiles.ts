import type { OrgRepo } from '../../lib/repo'

/**
 * Delete a receipt file once no expense row points at it any more (SPEC 6.4: rows first, files after). The rows of
 * a split expense ("Bagi rata ke semua kos") share one file, so deleting or re-photographing one of them must keep it.
 * Throws when the check or the removal fails; callers treat that as a warning, never as a failed save.
 */
export async function removeReceiptIfUnused(repo: Pick<OrgRepo, 'list' | 'removeFile'>, path: string): Promise<void> {
  const stillUsed = await repo.list('expenses', { where: { receipt_path: path }, limit: 1 })
  if (stillUsed.length > 0) return
  await repo.removeFile('receipts', path)
}
