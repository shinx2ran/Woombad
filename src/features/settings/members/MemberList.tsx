import { useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Badge, Button, Modal } from '../../../components/ui'
import { formatDate } from '../../../lib/format'
import { MEMBER_ROLE_LABEL, MEMBER_ROLES, type MemberRole, type OrganizationMember } from '../../../types/db'
import { errorMessage } from '../../auth/networkError'
import { RoleOptions } from './RoleOptions'
import { canChangeRole, canRemoveMember } from './permissions'

const ROLE_TONE = { owner: 'brand', admin: 'info', staff: 'neutral' } as const

function memberName(m: OrganizationMember): string {
  return m.email ?? 'Anggota tanpa email'
}

export function MemberList({
  members,
  myRole,
  currentUserId,
  onChangeRole,
  onRemove,
}: {
  members: OrganizationMember[]
  myRole: MemberRole
  currentUserId: string
  onChangeRole: (member: OrganizationMember, role: MemberRole) => Promise<void>
  onRemove: (member: OrganizationMember) => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = members.find((m) => m.id === selectedId) ?? null

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {members.map((m) => {
          const isSelf = m.user_id === currentUserId
          const manageable = canChangeRole(myRole, m, currentUserId, members) || canRemoveMember(myRole, m, currentUserId)
          const body = (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {memberName(m)}
                  {isSelf && <span className="ml-1 text-xs font-normal text-slate-500">(Anda)</span>}
                </p>
                <p className="text-xs text-slate-500">Bergabung {formatDate(m.created_at)}</p>
              </div>
              <Badge tone={ROLE_TONE[m.role]}>{MEMBER_ROLE_LABEL[m.role]}</Badge>
            </>
          )
          return (
            <li key={m.id}>
              {manageable ? (
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50"
                  aria-label={`Atur ${memberName(m)}`}
                >
                  {body}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                </button>
              ) : (
                <div className="flex items-center gap-3 py-2.5">{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      {selected && (
        <ManageMemberModal
          key={selected.id}
          member={selected}
          isSelf={selected.user_id === currentUserId}
          allowRole={canChangeRole(myRole, selected, currentUserId, members)}
          allowRemove={canRemoveMember(myRole, selected, currentUserId)}
          onChangeRole={(role) => onChangeRole(selected, role)}
          onRemove={() => onRemove(selected)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}

function ManageMemberModal({
  member,
  isSelf,
  allowRole,
  allowRemove,
  onChangeRole,
  onRemove,
  onClose,
}: {
  member: OrganizationMember
  isSelf: boolean
  allowRole: boolean
  allowRemove: boolean
  onChangeRole: (role: MemberRole) => Promise<void>
  onRemove: () => Promise<void>
  onClose: () => void
}) {
  const [role, setRole] = useState<MemberRole>(member.role)
  const [step, setStep] = useState<'main' | 'remove'>('main')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Gagal menyimpan.'))
      setBusy(false)
    }
  }

  const footer =
    step === 'remove' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('main')} disabled={busy}>
          Kembali
        </Button>
        <Button variant="danger" loading={busy} onClick={() => run(onRemove)}>
          Hapus
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
        {allowRole && (
          <Button loading={busy} disabled={role === member.role} onClick={() => run(() => onChangeRole(role))}>
            Simpan peran
          </Button>
        )}
      </>
    )

  return (
    <Modal open onClose={onClose} title={step === 'remove' ? 'Hapus anggota?' : 'Atur anggota'} size="sm" footer={footer}>
      <div className="space-y-4">
        <div>
          <p className="truncate text-sm font-medium text-slate-900">
            {memberName(member)}
            {isSelf && <span className="ml-1 text-xs font-normal text-slate-500">(Anda)</span>}
          </p>
          <p className="text-xs text-slate-500">
            {MEMBER_ROLE_LABEL[member.role]} · bergabung {formatDate(member.created_at)}
          </p>
        </div>

        {step === 'remove' ? (
          <p className="text-sm text-slate-700">
            <strong>{memberName(member)}</strong> tidak akan bisa membuka data kos ini lagi. Data yang pernah ia catat tetap tersimpan.
          </p>
        ) : (
          <>
            {allowRole && (
              <>
                <RoleOptions label="Peran" roles={MEMBER_ROLES} value={role} onChange={setRole} />
                {isSelf && role !== 'owner' && (
                  <p className="text-xs text-amber-700">Anda tidak akan bisa mengubah peran anggota lagi setelah ini.</p>
                )}
              </>
            )}
            {allowRemove && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setStep('remove')}
                  disabled={busy}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Hapus dari organisasi
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
