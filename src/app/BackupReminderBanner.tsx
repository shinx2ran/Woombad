import { useState } from 'react'
import { useLocation } from 'react-router'
import { ShieldAlert, X } from 'lucide-react'
import { useToast } from '../components/ui'
import { useOrg } from '../hooks/useOrg'
import { daysSince, isBackupDue, isReminderSnoozed, snoozeReminder, useLastBackupAt } from '../features/settings/data/backupReminder'
import { downloadBackup, localBackupFile } from '../features/settings/data/backupFile'

/** Mode Demo: gentle reminder when this device has no backup from the last 7 days. Dismissed for 3 days. */
export function BackupReminderBanner() {
  const { isLocalMode, repo, org } = useOrg()
  const toast = useToast()
  const { pathname } = useLocation()
  const last = useLastBackupAt()
  const [snoozed, setSnoozed] = useState(() => isReminderSnoozed())

  // Pengaturan shows the same reminder inside the Data card.
  if (!isLocalMode || snoozed || pathname.startsWith('/pengaturan') || !isBackupDue(last)) return null
  const days = daysSince(last)

  const download = () => {
    try {
      downloadBackup(localBackupFile(repo, org.name))
      toast.success('Cadangan diunduh.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunduh cadangan.')
    }
  }

  const dismiss = () => {
    snoozeReminder()
    setSnoozed(true)
  }

  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{days === null ? 'Data di perangkat ini belum pernah dicadangkan.' : `Cadangan terakhir ${days} hari lalu.`}</p>
        <button type="button" onClick={download} className="mt-1 font-semibold text-amber-900 underline underline-offset-2">
          Unduh cadangan sekarang
        </button>
      </div>
      <button type="button" onClick={dismiss} className="-m-1 rounded-lg p-2 text-amber-700 hover:bg-amber-100" aria-label="Tutup pengingat">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
