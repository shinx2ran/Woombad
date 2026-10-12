import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button, Input, useToast } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { safeReturnPath } from '../../lib/redirect'
import { formatCodeInput } from './codeInput'
import { errorMessage } from './networkError'
import { readPendingCode } from './pendingCode'

export function LoginPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [pendingCode] = useState(() => formatCodeInput(readPendingCode()))
  const isLocal = auth.mode === 'local'
  // Only same-origin in-app paths are accepted; a crafted '//evil.example/x' falls back to the dashboard.
  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await auth.signInWithPassword(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Gagal masuk.'))
    } finally {
      setLoading(false)
    }
  }

  const demo = async () => {
    setLoading(true)
    try {
      await auth.signInWithPassword('demo@woombad.local', 'demo')
      navigate(from, { replace: true })
    } finally {
      setLoading(false)
    }
  }

  const reset = async () => {
    if (resetting) return
    setError(null)
    if (!email.trim()) {
      setError('Masukkan email terlebih dahulu.')
      return
    }
    // a second tap while the first request runs would only hit Supabase's resend limit
    setResetting(true)
    try {
      await auth.sendPasswordReset(email.trim())
      toast.success('Tautan reset kata sandi dikirim ke email Anda.')
    } catch (err) {
      setError(errorMessage(err, 'Gagal mengirim reset.'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <AuthLayout title="Masuk" subtitle="Kelola kos Anda dari HP atau laptop.">
      {isLocal ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Mode Demo.</strong> Supabase belum dikonfigurasi, jadi data hanya disimpan di browser ini. Cocok untuk mencoba
            aplikasi. Lihat <code>README.md</code> untuk mengaktifkan akses online bersama.
          </div>
          <Button fullWidth size="lg" onClick={demo} loading={loading}>
            Masuk ke Mode Demo
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            label="Kata sandi"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" fullWidth size="lg" loading={loading}>
            Masuk
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={reset} disabled={resetting} className="text-slate-600 hover:underline disabled:opacity-60">
              {resetting ? 'Mengirim…' : 'Lupa kata sandi?'}
            </button>
            <Link to="/daftar" className="font-medium text-brand-700 hover:underline">
              Buat akun
            </Link>
          </div>
          {pendingCode ? (
            <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
              Kode <strong className="font-mono">{pendingCode}</strong> akan dipakai setelah Anda masuk.
            </p>
          ) : (
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              Diundang? Buka tautan dari pesan WhatsApp, atau{' '}
              <Link to="/daftar" className="font-medium text-brand-700 hover:underline">
                buat akun
              </Link>{' '}
              lalu masukkan kodenya.
            </p>
          )}
        </form>
      )}
    </AuthLayout>
  )
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-xl font-bold text-white">W</div>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Woombad</h1>
          <p className="text-sm text-slate-500">Manajemen kos yang sederhana</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mb-4 text-sm text-slate-500">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}
