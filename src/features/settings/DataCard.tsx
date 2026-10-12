import { useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, ConfirmDialog, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { LocalRepo, type LocalDb } from '../../lib/repo/localRepo'
import { TABLE_NAMES } from '../../types/db'

// ---------------------------------------------------------------- Data (demo backup / reset)

function isLocalDb(value: unknown): value is LocalDb {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return TABLE_NAMES.every((t) => Array.isArray(obj[t]))
}

export function DataCard({ isLocalMode, isAdmin }: { isLocalMode: boolean; isAdmin: boolean }) {
  const { repo, resetDemoData } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<LocalDb | null>(null)

  const exportJson = () => {
    if (!(repo.raw instanceof LocalRepo)) return
    const snapshot = repo.raw.snapshot()
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `woombad-cadangan-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Cadangan diunduh.')
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isLocalDb(parsed)) throw new Error('Format file tidak dikenali.')
      setPendingImport(parsed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File tidak valid.')
    }
  }

  const confirmImport = async () => {
    if (!pendingImport || !(repo.raw instanceof LocalRepo)) return
    repo.raw.replaceAll(pendingImport)
    await qc.invalidateQueries()
    setPendingImport(null)
    toast.success('Cadangan dipulihkan.')
  }

  const confirmReset = async () => {
    setResetting(true)
    try {
      await resetDemoData()
      toast.success('Data demo di-reset.')
      setResetOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mereset data demo.')
    } finally {
      setResetting(false)
    }
  }

  const supabaseHost = (() => {
    try {
      const url = import.meta.env.VITE_SUPABASE_URL
      return url ? new URL(url).host : null
    } catch {
      return null
    }
  })()

  return (
    <Card>
      <CardHeader title="Data" subtitle={isLocalMode ? 'Cadangkan atau reset data demo' : 'Penyimpanan online'} action={<RefreshCw className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3">
        {isLocalMode ? (
          <>
            <p className="text-sm text-slate-600">
              Dalam Mode Demo semua data disimpan di browser ini. Menghapus data situs atau mengganti perangkat akan
              menghilangkannya. Unduh cadangan secara berkala, atau aktifkan mode online (lihat <code>README.md</code>).
            </p>
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
          </>
        ) : (
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              Data tersimpan di proyek Supabase{supabaseHost ? <> <code className="rounded bg-slate-100 px-1">{supabaseHost}</code></> : null}. Semua
              anggota melihat data yang sama secara langsung.
            </p>
            <p>Cadangan: Supabase menyediakan ekspor database di Dashboard → Database → Backups. Ekspor laporan ke Excel ada di menu Laporan.</p>
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={confirmReset}
        title="Reset data demo?"
        message="Semua data di perangkat ini akan diganti dengan data contoh. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Reset"
        loading={resetting}
      />
      <ConfirmDialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        onConfirm={confirmImport}
        title="Pulihkan cadangan?"
        message="Data saat ini akan diganti seluruhnya dengan isi file cadangan."
        confirmLabel="Pulihkan"
        danger={false}
      />
    </Card>
  )
}
