import { useCallback, useMemo } from 'react'
import { useToast } from '../../../components/ui'
import { useOrg } from '../../../hooks/useOrg'
import { useInvalidate } from '../../../hooks/useTable'
import { ALREADY_RESTORED_MESSAGE, RESTORE_INVALIDATES, restoreErrorMessage, restorePayload, type RestorableTable } from './restore'

export interface RestoreResult {
  /** the row's file (KTP photo, receipt, logo) was removed with it and does not come back */
  fileDropped: boolean
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
      const { payload, fileDropped } = restorePayload(table, row)
      try {
        await repo.insert(table, payload as never)
      } catch (err) {
        throw new Error(restoreErrorMessage(err))
      } finally {
        await invalidate(...RESTORE_INVALIDATES[table])
      }
      return { fileDropped }
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
              const { fileDropped } = await restore(table, row)
              await onRestored?.()
              toast.success(`${label} dipulihkan.${fileDropped ? ' Fotonya tidak ikut kembali.' : ''}`)
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
