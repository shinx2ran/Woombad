import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Input } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from './LoginPage'
import { formatCodeInput } from './codeInput'
import { errorMessage } from './networkError'
import { readPendingCode } from './pendingCode'

export function SignupPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [pendingCode] = useState(() => formatCodeInput(readPendingCode()))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter.')
    if (password !== confirm) return setError('Konfirmasi kata sandi tidak sama.')
    setLoading(true)
    try {
      const session = await auth.signUp(email.trim(), password)
      if (session) navigate('/dashboard', { replace: true })
      else setNeedsConfirm(true)
    } catch (err) {
      setError(errorMessage(err, 'Gagal mendaftar.'))
    } finally {
      setLoading(false)
    }
  }

  if (needsConfirm) {
    return (
      <AuthLayout title="Cek email Anda">
        <p className="text-sm text-slate-700">
          Kami mengirim tautan konfirmasi ke <strong>{email}</strong>. Klik tautan tersebut, lalu masuk.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          {pendingCode ? (
            <>
              Setelah masuk, kode <strong className="font-mono">{pendingCode}</strong> dipakai otomatis. Jika diminta, ketik kode
              itu.
            </>
          ) : (
            'Setelah masuk, masukkan kode dari pemilik kos.'
          )}
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Ke halaman masuk
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Buat akun">
      <form onSubmit={submit} className="space-y-4">
        {pendingCode ? (
          <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
            Kode <strong className="font-mono">{pendingCode}</strong> akan dipakai setelah akun dibuat.
          </p>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Akun saja belum cukup: Anda perlu <strong>kode dari pemilik kos</strong> untuk melihat data kos. Kode diminta setelah
            akun dibuat.
          </p>
        )}
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          label="Kata sandi"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          hint="Minimal 8 karakter"
        />
        <Input
          label="Ulangi kata sandi"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={loading}>
          Daftar
        </Button>
        <p className="text-center text-sm text-slate-600">
          Sudah punya akun?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Masuk
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
