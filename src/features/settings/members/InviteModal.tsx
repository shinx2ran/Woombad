import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBlocker } from 'react-router'
import { Copy, KeyRound, Link2, MessageCircle, TriangleAlert } from 'lucide-react'
import { Button, Input, Modal, useToast } from '../../../components/ui'
import { MEMBER_ROLE_LABEL } from '../../../types/db'
import type { CreatedInvitation } from '../../../lib/repo'
import { errorMessage } from '../../auth/networkError'
import { RoleOptions } from './RoleOptions'
import { COPY_FAILED_HINT, COPY_SELECTED_HINT, copyText } from './clipboard'
import { buildInviteMessage, buildJoinUrl, formatExpiry, whatsappShareUrl } from './inviteLink'

export type InviteRole = 'admin' | 'staff'
const INVITE_ROLES: readonly InviteRole[] = ['admin', 'staff']

interface Created extends CreatedInvitation {
  label: string | null
  role: InviteRole
}

/**
 * Two steps: who/role form, then the code. The plain code exists only in this dialog (the database keeps
 * a hash), so closing it before the code was sent or copied asks first, also on the Android Back button.
 * While the code is being created the dialog cannot be closed: the invitation would exist without its code.
 */
export function InviteModal({
  orgName,
  isLocalMode,
  onCreate,
  onClose,
}: {
  orgName: string
  isLocalMode: boolean
  onCreate: (role: InviteRole, label: string | null) => Promise<CreatedInvitation>
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<InviteRole>('staff')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [sent, setSent] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const unsent = created !== null && !sent

  // Back leaves the page and would drop the code: block it and ask, like the close button does.
  // While the code is being created Back is simply ignored.
  const blocker = useBlocker(creating || unsent)
  useEffect(() => {
    if (blocker.state === 'blocked' && !unsent) blocker.reset()
  }, [blocker, unsent])
  const asking = unsent && (confirmClose || blocker.state === 'blocked')

  // Reload or leaving the site (e.g. Back on the first page) cannot be blocked in-app; let the browser ask.
  useEffect(() => {
    if (!unsent) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsent])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (creating) return
    setError(null)
    setCreating(true)
    const trimmed = label.trim() || null
    try {
      const result = await onCreate(role, trimmed)
      setCreated({ ...result, label: trimmed, role })
    } catch (err) {
      setError(errorMessage(err, 'Gagal membuat kode.'))
    } finally {
      setCreating(false)
    }
  }

  const requestClose = () => {
    if (creating) return
    if (unsent) setConfirmClose(true)
    else onClose()
  }
  const keepOpen = () => {
    if (blocker.state === 'blocked') blocker.reset()
    setConfirmClose(false)
  }
  const closeWithoutSending = () => {
    if (blocker.state === 'blocked') blocker.proceed()
    onClose()
  }

  let footer
  if (!created) {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose} disabled={creating}>
          Batal
        </Button>
        <Button type="submit" form="invite-form" loading={creating} icon={<KeyRound className="h-4 w-4" />}>
          Buat kode
        </Button>
      </>
    )
  } else if (asking) {
    footer = (
      <>
        <Button variant="ghost" onClick={keepOpen}>
          Kembali
        </Button>
        <Button variant="danger" onClick={closeWithoutSending}>
          Tutup
        </Button>
      </>
    )
  } else {
    footer = <Button onClick={requestClose}>Selesai</Button>
  }

  return (
    <Modal open onClose={requestClose} title={created ? 'Kode undangan' : 'Undang anggota'} size="sm" footer={footer}>
      {created ? (
        asking ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Tutup tanpa mengirim kode?</p>
            <p>
              Kode ini tidak bisa dilihat lagi setelah ditutup. Jika belum terkirim, batalkan undangannya di daftar{' '}
              <strong>Undangan menunggu</strong>, lalu buat kode baru.
            </p>
          </div>
        ) : (
          <InviteResult created={created} orgName={orgName} onSent={() => setSent(true)} />
        )
      ) : (
        <form id="invite-form" onSubmit={create} className="space-y-4">
          <Input
            label="Untuk siapa?"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="Misalnya: Istri, Pak Udin"
            hint="Supaya Anda ingat kode ini untuk siapa."
            autoFocus
          />
          <RoleOptions label="Peran" roles={INVITE_ROLES} value={role} onChange={setRole} />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {isLocalMode && <p className="text-xs text-amber-700">Mode Demo: kode bisa dibuat, tetapi undangan baru berfungsi di Mode Online.</p>}
        </form>
      )}
    </Modal>
  )
}

function InviteResult({ created, orgName, onSent }: { created: Created; orgName: string; onSent: () => void }) {
  const toast = useToast()
  const codeRef = useRef<HTMLInputElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const link = buildJoinUrl(created.code)
  const message = buildInviteMessage({ orgName, role: created.role, code: created.code, link, expiresAt: created.expiresAt })

  const copy = async (text: string, field: HTMLInputElement | null, done: string) => {
    const result = await copyText(text, field)
    if (result === 'copied') {
      toast.success(done)
      onSent()
    } else {
      toast.toast(result === 'selected' ? COPY_SELECTED_HINT : COPY_FAILED_HINT)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Untuk <strong className="text-slate-900">{created.label ?? 'Tanpa nama'}</strong> · {MEMBER_ROLE_LABEL[created.role]}
      </p>
      <div>
        <input
          ref={codeRef}
          readOnly
          value={created.code}
          aria-label="Kode undangan"
          className="h-16 w-full rounded-xl border border-slate-200 bg-slate-50 text-center font-mono text-3xl font-bold tracking-widest text-slate-900 focus:border-brand-500 focus:outline-none"
        />
        <p className="mt-1 text-center text-xs text-slate-500">Berlaku sampai {formatExpiry(created.expiresAt)}</p>
      </div>

      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Kode ini <strong>hanya ditampilkan sekali</strong>. Kirim sekarang. Jika hilang, batalkan undangan ini lalu buat kode baru.
        </p>
      </div>

      <a
        href={whatsappShareUrl(message)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onSent}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-base font-medium text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <MessageCircle className="h-5 w-5" aria-hidden /> Kirim lewat WhatsApp
      </a>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" icon={<Link2 className="h-4 w-4" />} onClick={() => copy(link, linkRef.current, 'Tautan disalin.')}>
          Salin tautan
        </Button>
        <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copy(created.code, codeRef.current, 'Kode disalin.')}>
          Salin kode
        </Button>
      </div>
      <input
        ref={linkRef}
        readOnly
        value={link}
        aria-label="Tautan undangan"
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-600 focus:border-brand-500 focus:outline-none"
      />
    </div>
  )
}
