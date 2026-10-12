import { useState } from 'react'
import { Badge, ConfirmDialog, useToast } from '../../../components/ui'
import { formatDate } from '../../../lib/format'
import { MEMBER_ROLE_LABEL, type Invitation } from '../../../types/db'
import { isInvitationExpired } from './permissions'

/** Invitations not used yet. The codes themselves cannot be shown again (only a hash is stored). */
export function PendingInvitations({
  invitations,
  onCancel,
}: {
  invitations: Invitation[]
  onCancel: (invitation: Invitation) => Promise<void>
}) {
  const toast = useToast()
  const [target, setTarget] = useState<Invitation | null>(null)
  const [busy, setBusy] = useState(false)
  // fixed per visit; expiry is shown by date, so minutes do not matter
  const [now] = useState(() => new Date())

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    try {
      await onCancel(target)
      toast.success('Undangan dibatalkan.')
      setTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan undangan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Undangan menunggu</p>
      <ul className="divide-y divide-slate-100">
        {invitations.map((inv) => {
          const expired = isInvitationExpired(inv, now)
          return (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{inv.label || 'Tanpa nama'}</p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                  <span>{MEMBER_ROLE_LABEL[inv.role]}</span>
                  <span aria-hidden>·</span>
                  {expired ? <Badge tone="danger">Kedaluwarsa</Badge> : <span>berlaku s/d {formatDate(inv.expires_at)}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTarget(inv)}
                className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700"
              >
                Batalkan
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-1 text-xs text-slate-500">Kode tidak bisa dilihat lagi. Jika kode hilang, batalkan lalu buat kode baru.</p>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={confirm}
        title="Batalkan undangan?"
        message={
          <>
            Kode untuk <strong>{target?.label || 'Tanpa nama'}</strong> tidak bisa dipakai lagi.
          </>
        }
        confirmLabel="Batalkan undangan"
        cancelLabel="Kembali"
        loading={busy}
      />
    </div>
  )
}
