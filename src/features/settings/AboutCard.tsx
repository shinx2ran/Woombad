import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { LogOut, Info, KeyRound } from 'lucide-react'
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
        <div className="flex flex-wrap gap-2">
          {repoMode === 'supabase' && (
            <Link
              to="/reset-sandi"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <KeyRound className="h-4 w-4" />
              Ganti kata sandi
            </Link>
          )}
          <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={signOut} loading={signingOut}>
            Keluar
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
