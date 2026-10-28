import { useCallback, useMemo } from 'react'
import { useToast } from '../../../components/ui'
import { useOrg } from '../../../hooks/useOrg'
import { useInvalidate } from '../../../hooks/useTable'
import { ALREADY_RESTORED_MESSAGE, INVOICE_VOID_MESSAGE, PROPERTY_PARTIAL_NOTE, REFERENCE_GONE_MESSAGE, RESTORE_INVALIDATES, restoreErrorMessage, restorePayload, type RestorableTable } from './restore'

export interface RestoreResult {
  /** the row's file (KTP photo, receipt, logo) was removed with it and does not come back */
  fileDropped: boolean
  /** what the restore could not bring back (a kos's add-ons and links), for the toast */
  note: string | null
}

/**
 * Put a deleted row back (SPEC 6.3): `restore` from a history entry's old_data or from the row a page still holds;
 * `offerUndo` is the "… dihapus. Urungkan" toast every delete shows for 10 seconds.
 */
export function useRestoreDeleted() {
  const { repo } = useOrg()
  const invalidate = useInvalidate()
  const toast = useToast()

  const restore = useCallback(
    async (table: RestorableTable, row: object): Promise<RestoreResult> => {
      const id = typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : ''
      if (!id) throw new Error('Data ini tidak bisa dipulihkan.')
      // already back (restored from another phone, or Urungkan tapped twice): say so instead of a duplicate
      if (await repo.get(table, id).catch(() => null)) throw new Error(ALREADY_RESTORED_MESSAGE)
      const r = row as Record<string, unknown>
      // a rent payment goes back onto its invoice: not onto one voided meanwhile (the payment flow refuses that too)
      if (table === 'payments' && r.kind === 'rent' && typeof r.invoice_id === 'string') {
        const invoice = await repo.get('invoices', r.invoice_id).catch(() => null)
        if (!invoice) throw new Error(REFERENCE_GONE_MESSAGE)
        if (invoice.status === 'void') throw new Error(INVOICE_VOID_MESSAGE)
      }
      // a split expense shares one receipt: the file stays while another row still points at it (removeReceiptIfUnused)
      const keepFile = table === 'expenses' && typeof r.receipt_path === 'string' && (await repo.list('expenses', { where: { receipt_path: r.receipt_path }, limit: 1 })).length > 0
      const { payload, fileDropped } = restorePayload(table, row, { keepFile })
      try {
        await repo.insert(table, payload as never)
      } catch (err) {
        throw new Error(restoreErrorMessage(err))
      } finally {
        await invalidate(...RESTORE_INVALIDATES[table])
      }
      return { fileDropped, note: table === 'properties' ? PROPERTY_PARTIAL_NOTE : null }
    },
    [repo, invalidate],
  )

  const offerUndo = useCallback(
    (table: RestorableTable, row: object, label: string, onRestored?: () => void | Promise<void>) => {
      toast.success(`${label} dihapus.`, {
        action: {
          label: 'Urungkan',
          onClick: async () => {
            try {
              const { fileDropped, note } = await restore(table, row)
              await onRestored?.()
              toast.success(`${label} dipulihkan.${fileDropped ? ' Fotonya tidak ikut kembali.' : ''}${note ? ` ${note}` : ''}`)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Gagal memulihkan.')
            }
          },
        },
      })
    },
    [restore, toast],
  )

  return useMemo(() => ({ restore, offerUndo }), [restore, offerUndo])
}
