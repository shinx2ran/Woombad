import { AlertTriangle } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import { daysSince, isBackupDue, useLastBackupAt } from './backupReminder'

/** "Cadangan terakhir …" for this device; an amber reminder when it is older than 7 days or never happened. */
export function BackupStatus() {
  const last = useLastBackupAt()
  const days = daysSince(last)

  if (isBackupDue(last)) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {days === null ? 'Belum pernah mengunduh cadangan di perangkat ini.' : `Cadangan terakhir ${days} hari lalu.`} Unduh cadangan
          sekarang supaya data aman.
        </span>
      </p>
    )
  }
  return (
    <p className="text-xs text-slate-500">
      Cadangan terakhir di perangkat ini: {formatDate(last)} ({days === 0 ? 'hari ini' : `${days} hari lalu`})
    </p>
  )
}
