import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { Button } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { getRepo } from '../../lib/repo'
import { normalizeCode } from '../../lib/repo/types'
import { AuthLayout } from './LoginPage'
import { formatCodeInput, isCompleteCode } from './codeInput'
import { clearPendingCode, readPendingCode } from './pendingCode'

/**
 * Shown by OrgProvider when the signed-in account is not a member of any organisation yet.
 * The owner enters the setup code once; everyone else enters the invitation code they received.
 * A code saved from an invitation link is submitted automatically, once.
 */
export function JoinOrganization({ onJoined }: { onJoined: () => void }) {
  const { auth, session } = useAuth()
  const inputId = useId()
  const [pending] = useState(() => formatCodeInput(readPendingCode()))
  const autoCode = isCompleteCode(pending) ? pending : ''
  const [code, setCode] = useState(pending)
  const [saving, setSaving] = useState(Boolean(autoCode))
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoSubmitted = useRef(false)

  // State is only set after the request settles, so this is safe to start from an effect.
  const join = useCallback(
    async (value: string) => {
      try {
        await getRepo().joinWithCode(normalizeCode(value))
        clearPendingCode()
        setJoined(true)
        onJoined()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kode tidak dapat dipakai.')
        setSaving(false)
      }
    },
    [onJoined],
  )

  useEffect(() => {
    if (!autoCode || autoSubmitted.current) return
    autoSubmitted.current = true
    // Forget it before trying: a wrong or expired code must not be retried on every visit.
    clearPendingCode()
    void join(autoCode)
  }, [autoCode, join])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (saving || joined) return
    setError(null)
    if (!isCompleteCode(code)) return setError('Kode terdiri dari 8 huruf/angka, misalnya ABCD-EFGH.')
    setSaving(true)
    void join(code)
  }

  return (
    <AuthLayout title="Masukkan kode" subtitle={`Masuk sebagai ${session?.user.email ?? '-'}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2 text-sm text-slate-700">
          <p>Akun Anda sudah ada, tetapi belum terhubung ke kos mana pun.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Diundang?</strong> Masukkan kode dari pesan WhatsApp pemilik kos.
            </li>
            <li>
              <strong>Pemilik yang baru memasang aplikasi?</strong> Masukkan <strong>kode pemilik</strong> yang Anda terima saat
              pemasangan.
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            Kode
          </label>
          <input
            id={inputId}
            value={code}
            onChange={(e) => {
              setCode(formatCodeInput(e.target.value))
              if (error) setError(null)
            }}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            disabled={joined}
            className="h-14 w-full rounded-lg border border-slate-300 bg-white px-3 text-center font-mono text-2xl font-semibold tracking-widest text-slate-900 uppercase placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none disabled:bg-slate-100"
          />
          {error && (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        {saving && !error && <p className="text-sm text-slate-600">{joined ? 'Berhasil. Membuka aplikasi…' : 'Memeriksa kode…'}</p>}
        <Button type="submit" fullWidth size="lg" loading={saving} icon={<KeyRound className="h-4 w-4" />}>
          Gabung
        </Button>
        <button
          type="button"
          onClick={() => auth.signOut()}
          className="mx-auto flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" /> Bukan akun Anda? Keluar
        </button>
      </form>
    </AuthLayout>
  )
}
