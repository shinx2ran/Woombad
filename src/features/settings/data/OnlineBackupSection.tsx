import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Download, Upload } from 'lucide-react'
import { Button, useToast } from '../../../components/ui'
import { useOrg } from '../../../hooks/useOrg'
import { translateDbError } from '../../../lib/repo/supabaseRepo'
import { BackupStatus } from './BackupStatus'
import { DemoImportModal } from './DemoImportModal'
import { downloadBackup } from './backupFile'
import { fetchOrgBackup } from './orgData'

/** Online mode, owner/admin: full JSON backup and the move from Mode Demo (?impor=demo, from the dashboard, opens it). */
export function OnlineBackupSection() {
  const { repo } = useOrg()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [downloading, setDownloading] = useState(false)
  const [importOpen, setImportOpen] = useState(() => params.get('impor') === 'demo')

  const closeImport = () => {
    setImportOpen(false)
    if (params.has('impor')) {
      setParams(
        (p) => {
          p.delete('impor')
          return p
        },
        { replace: true },
      )
    }
  }

  const download = async () => {
    setDownloading(true)
    try {
      downloadBackup(await fetchOrgBackup(repo), 'cadangan-online')
      toast.success('Cadangan diunduh.')
    } catch (err) {
      toast.error(err instanceof Error ? translateDbError(err.message) : 'Gagal membuat cadangan.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-sm font-medium text-slate-900">Cadangan</p>
        <p className="text-sm text-slate-600">
          Paket gratis Supabase tidak membuat cadangan otomatis. Unduh cadangan seminggu sekali dan simpan di tempat aman (mis.
          Google Drive). Foto KTP dan struk tidak ikut. File ini berisi data pribadi penyewa, jangan dibagikan.
        </p>
        <BackupStatus />
        <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={download} loading={downloading}>
          Unduh cadangan lengkap (JSON)
        </Button>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-sm font-medium text-slate-900">Pindah dari Mode Demo</p>
        <p className="text-sm text-slate-600">Punya data di Mode Demo? Pindahkan ke sini. Data yang sudah ada online tidak diubah.</p>
        <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
          Impor dari Mode Demo
        </Button>
      </div>

      {importOpen && <DemoImportModal onClose={closeImport} />}
    </>
  )
}
