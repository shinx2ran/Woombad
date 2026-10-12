import { useState, type FormEvent } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, LoadingState, Modal, Select, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useRemove, useTable } from '../../hooks/useTable'
import { MEMBER_ROLE_LABEL } from '../../types/db'
import { formatDate } from '../../lib/format'

// ---------------------------------------------------------------- Members

export function MembersCard({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const { repo } = useOrg()
  const toast = useToast()
  const invalidate = useInvalidate()
  const members = useTable('organization_members', { orderBy: { column: 'created_at', ascending: true } })
  const invitations = useTable('invitations', { where: { accepted_at: null }, orderBy: { column: 'created_at', ascending: true } })
  const removeInvitation = useRemove('invitations')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'staff'>('admin')
  const [inviting, setInviting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string } | null>(null)
  const [removing, setRemoving] = useState(false)

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    // Interim: the label field reuses the old email input; the members UI is reworked for invitation codes.
    setInviting(true)
    try {
      const result = await repo.createInvitation(inviteRole, email.trim() || null)
      toast.success(`Kode undangan: ${result.code}`)
      await invalidate('organization_members', 'invitations')
      setInviteOpen(false)
      setEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengundang.')
    } finally {
      setInviting(false)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await repo.removeMember(removeTarget.userId)
      toast.success('Anggota dihapus.')
      await invalidate('organization_members')
      setRemoveTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus anggota.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Anggota"
        subtitle="Siapa saja yang bisa masuk ke organisasi ini"
        action={
          isAdmin ? (
            <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Undang
            </Button>
          ) : (
            <Users className="h-5 w-5 text-slate-400" />
          )
        }
      />
      <CardBody className="space-y-3">
        {members.isPending ? (
          <LoadingState />
        ) : (
          <ul className="divide-y divide-slate-100">
            {(members.data ?? []).map((m) => {
              const isSelf = m.user_id === currentUserId
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {m.email ?? m.user_id}
                      {isSelf && <span className="ml-1 text-xs text-slate-500">(Anda)</span>}
                    </p>
                    <p className="text-xs text-slate-500">Bergabung {formatDate(m.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={m.role === 'owner' ? 'brand' : m.role === 'admin' ? 'info' : 'neutral'}>{MEMBER_ROLE_LABEL[m.role]}</Badge>
                    {isAdmin && !isSelf && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget({ userId: m.user_id, label: m.email ?? m.user_id })}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Hapus ${m.email ?? 'anggota'}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {(invitations.data?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Undangan menunggu</p>
            <ul className="divide-y divide-slate-100">
              {invitations.data!.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-800">{inv.email}</p>
                    <p className="text-xs text-slate-500">Belum mendaftar · {MEMBER_ROLE_LABEL[inv.role]}</p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        removeInvitation.mutate(inv.id, {
                          onSuccess: () => toast.success('Undangan dibatalkan.'),
                          onError: (err) => toast.error(err instanceof Error ? err.message : 'Gagal membatalkan undangan.'),
                        })
                      }
                      className="text-xs text-slate-500 hover:text-red-600"
                    >
                      Batalkan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Orang yang diundang cukup <strong>Buat akun</strong> dengan email yang sama, lalu otomatis masuk ke organisasi ini.
          Peran <strong>Admin</strong> dapat mengelola semua data; <strong>Staf</strong> dapat mencatat sewa, pembayaran dan pengeluaran
          tetapi tidak melihat Laporan dan tidak dapat menghapus data keuangan.
        </p>
      </CardBody>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Undang anggota"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="invite-form" loading={inviting}>
              Kirim undangan
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={invite} className="space-y-3">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nama@email.com" autoFocus />
          <Select
            label="Peran"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'staff')}
            options={[
              { value: 'admin', label: 'Admin – akses penuh (cocok untuk pasangan)' },
              { value: 'staff', label: 'Staf – catat transaksi, tanpa laporan & hapus' },
            ]}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        title="Hapus anggota?"
        message={
          <>
            <strong>{removeTarget?.label}</strong> tidak akan bisa mengakses organisasi ini lagi.
          </>
        }
        loading={removing}
      />
    </Card>
  )
}
