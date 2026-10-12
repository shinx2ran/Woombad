import { useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Upload } from 'lucide-react'
import { Button, ConfirmDialog, useToast } from '../../../components/ui'
import { useOrg } from '../../../hooks/useOrg'
import { LocalRepo } from '../../../lib/repo/localRepo'
import { formatDateTime } from '../../../lib/format'
import { BackupFileError, backupToLocalDb, describeBackup, parseBackupText, type ParsedBackup } from './backupFormat'
import { BackupStatus } from './BackupStatus'
import { downloadBackup, localBackupFile } from './backupFile'

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** Mode Demo: download, restore (with an automatic copy of the current data first) and reset. */
export function LocalDataSection({ isAdmin }: { isAdmin: boolean }) {
  const { repo, org, resetDemoData } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ParsedBackup | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const downloadCurrent = (name: string) => downloadBackup(localBackupFile(repo, org.name), name)

  const exportJson = () => {
    try {
      downloadCurrent('cadangan')
      toast.success('Cadangan diunduh.')
    } catch (err) {
      toast.error(errorText(err, 'Gagal mengunduh cadangan.'))
    }
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = parseBackupText(await file.text())
      backupToLocalDb(parsed) // refuses files the app could not open afterwards
      setPending(parsed)
    } catch (err) {
      toast.error(err instanceof BackupFileError ? err.message : 'File tidak bisa dibaca.')
    }
  }

  const confirmRestore = async () => {
    if (!pending || !(repo.raw instanceof LocalRepo)) return
    const local = repo.raw
    setRestoring(true)
    const before = local.snapshot()
    try {
      downloadCurrent('sebelum-pulih')
      local.replaceAll(backupToLocalDb(pending))
      // reload through LocalRepo's loader so rows from older backups get the columns added since
      const reloaded = new LocalRepo()
      if (!reloaded.isEmpty()) local.replaceAll(reloaded.snapshot())
      await qc.invalidateQueries()
      setPending(null)
      toast.success('Cadangan dipulihkan. Data sebelumnya sudah diunduh.')
    } catch (err) {
      try {
        local.replaceAll(before)
      } catch {
        /* keep the error below */
      }
      toast.error(errorText(err, 'Gagal memulihkan cadangan.'))
    } finally {
      setRestoring(false)
    }
  }

  const confirmReset = async () => {
    setResetting(true)
    try {
      downloadCurrent('sebelum-reset')
      await resetDemoData()
      toast.success('Data demo di-reset. Data sebelumnya sudah diunduh.')
      setResetOpen(false)
    } catch (err) {
      toast.error(errorText(err, 'Gagal mereset data demo.'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      <p className="text-sm text-slate-600">
        Dalam Mode Demo semua data disimpan di browser ini. Menghapus data situs atau ganti perangkat akan menghilangkannya. Unduh
        cadangan seminggu sekali.
      </p>
      <BackupStatus />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportJson}>
          Unduh cadangan JSON
        </Button>
        <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
          Pulihkan dari JSON
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
        {isAdmin && (
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setResetOpen(true)}>
            Reset data demo
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={confirmReset}
        title="Reset data demo?"
        message="Semua data di perangkat ini akan diganti dengan data contoh. Data saat ini diunduh dulu sebagai cadangan."
        confirmLabel="Reset"
        loading={resetting}
      />
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmRestore}
        title="Pulihkan cadangan?"
        message={
          pending && (
            <div className="space-y-2">
              <p>
                Isi file: <strong>{pending.orgName ?? 'Tanpa nama'}</strong>
                {pending.exportedAt && <>, dicadangkan {formatDateTime(pending.exportedAt)}</>} ({describeBackup(pending)}).
              </p>
              <p>Data saat ini akan diganti seluruhnya. Sebelum itu, data saat ini otomatis diunduh sebagai cadangan.</p>
            </div>
          )
        }
        confirmLabel="Pulihkan"
        danger={false}
        loading={restoring}
      />
    </>
  )
}
