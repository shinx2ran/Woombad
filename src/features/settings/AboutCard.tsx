import { useState } from 'react'
import { useNavigate } from 'react-router'
import { LogOut, Info } from 'lucide-react'
import { Button, Card, CardBody, CardHeader } from '../../components/ui'

export const APP_VERSION = 'v0.3'

// ---------------------------------------------------------------- About

export function AboutCard({ onSignOut, email, repoMode }: { onSignOut: () => Promise<void>; email: string | null; repoMode: 'supabase' | 'local' }) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    await onSignOut()
    navigate('/login', { replace: true })
  }
  return (
    <Card>
      <CardHeader title="Tentang" action={<Info className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3 text-sm text-slate-700">
        <p>
          <strong>Woombad {APP_VERSION}</strong> — aplikasi manajemen kos gratis: penyewa, sewa, tagihan, pembayaran, pengeluaran, dan
          laporan keuangan. Backend {repoMode === 'supabase' ? 'Supabase' : 'lokal (demo)'}.
        </p>
        <p className="text-slate-500">Masuk sebagai {email ?? '-'}</p>
        <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={signOut} loading={signingOut}>
          Keluar
        </Button>
      </CardBody>
    </Card>
  )
}
