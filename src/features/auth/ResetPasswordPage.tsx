import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Input } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from './LoginPage'
import { errorMessage } from './networkError'

/**
 * Landing page for the Supabase recovery link (redirectTo). The link signs the user in with a
 * recovery session; here they choose a new password. Also reachable from Pengaturan when signed in.
 */
export function ResetPasswordPage() {
  const { auth, session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter.')
    if (password !== confirm) return setError('Konfirmasi kata sandi tidak sama.')
    setSaving(true)
    try {
      await auth.updatePassword(password)
      setDone(true)
      window.setTimeout(() => navigate('/dashboard', { replace: true }), 1200)
    } catch (err) {
      setError(errorMessage(err, 'Gagal mengubah kata sandi.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  if (!session) {
    return (
      <AuthLayout title="Tautan tidak valid">
        <p className="text-sm text-slate-700">
          Tautan reset sudah kedaluwarsa atau sudah dipakai. Minta tautan baru dari halaman masuk.
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Ke halaman masuk
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Kata sandi baru" subtitle={`Untuk akun ${session.user.email ?? ''}`}>
      {done ? (
        <p className="text-sm text-emerald-700">Kata sandi diperbarui. Mengalihkan ke dashboard…</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="Kata sandi baru" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required hint="Minimal 8 karakter" />
          <Input label="Ulangi kata sandi" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" fullWidth size="lg" loading={saving}>
            Simpan kata sandi
          </Button>
          <p className="text-center text-sm">
            <Link to="/dashboard" className="text-slate-600 hover:underline">
              Batal
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
