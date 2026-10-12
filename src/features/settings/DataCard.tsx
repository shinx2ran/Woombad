import { HardDrive } from 'lucide-react'
import { Card, CardBody, CardHeader } from '../../components/ui'
import { LocalDataSection } from './data/LocalDataSection'
import { OnlineBackupSection } from './data/OnlineBackupSection'

// ---------------------------------------------------------------- Data (backup / restore / import)

function supabaseHost(): string | null {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL
    return url ? new URL(url).host : null
  } catch {
    return null
  }
}

export function DataCard({ isLocalMode, isAdmin }: { isLocalMode: boolean; isAdmin: boolean }) {
  const host = supabaseHost()
  return (
    <Card>
      <CardHeader
        title="Data"
        subtitle={isLocalMode ? 'Cadangkan, pulihkan, atau reset data demo' : 'Penyimpanan online & cadangan'}
        action={<HardDrive className="h-5 w-5 text-slate-400" />}
      />
      <CardBody className="space-y-3">
        {isLocalMode ? (
          <LocalDataSection isAdmin={isAdmin} />
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Data tersimpan online. Semua anggota melihat data yang sama secara langsung.
              {isAdmin && ' Ekspor laporan ke Excel ada di menu Laporan.'}
            </p>
            {isAdmin && <OnlineBackupSection />}
            {host && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">Detail</summary>
                <p className="mt-1">
                  Proyek Supabase: <code className="break-all rounded bg-slate-100 px-1">{host}</code>
                </p>
              </details>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
