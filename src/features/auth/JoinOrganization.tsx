import { useState, type FormEvent } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { Button, Input } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { getRepo } from '../../lib/repo'
import { formatCode, normalizeCode } from '../../lib/repo/types'
import { AuthLayout } from './LoginPage'
import { clearPendingCode, readPendingCode } from './pendingCode'

/**
 * Shown by OrgProvider when the signed-in account is not a member of any organisation yet.
 * The owner enters the setup code once; everyone else enters the invitation code they received.
 */
export function JoinOrganization({ onJoined }: { onJoined: () => void }) {
  const { auth, session } = useAuth()
  const [code, setCode] = useState(() => formatCode(normalizeCode(readPendingCode())))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const normalized = normalizeCode(code)
    if (normalized.length < 8) return setError('Kode terdiri dari 8 huruf/angka, misalnya ABCD-EFGH.')
    setSaving(true)
    try {
      await getRepo().joinWithCode(normalized)
      clearPendingCode()
      onJoined()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kode tidak dapat dipakai.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthLayout title="Masukkan kode" subtitle={`Masuk sebagai ${session?.user.email ?? '-'}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Akun ini belum terhubung ke kos mana pun. Masukkan <strong>kode undangan</strong> dari pemilik kos. Pemilik yang
          baru memasang aplikasi memakai <strong>kode pemilik</strong>.
        </p>
        <Input
          label="Kode"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={12}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={saving} icon={<KeyRound className="h-4 w-4" />}>
          Gabung
        </Button>
        <button
          type="button"
          onClick={() => auth.signOut()}
          className="mx-auto flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" /> Keluar
        </button>
      </form>
    </AuthLayout>
  )
}
