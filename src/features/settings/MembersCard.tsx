import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, LoadingState, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useTable } from '../../hooks/useTable'
import { MEMBER_ROLE_LABEL } from '../../types/db'
import { InviteModal } from './members/InviteModal'
import { MemberList } from './members/MemberList'
import { PendingInvitations } from './members/PendingInvitations'

// ---------------------------------------------------------------- Members

export function MembersCard({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const { repo, role: myRole, org, isLocalMode } = useOrg()
  const toast = useToast()
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const members = useTable('organization_members', { orderBy: { column: 'created_at', ascending: true } })
  // Only admins can read invitations (RLS); staff would just get an empty list.
  const invitations = useTable(
    'invitations',
    { where: { accepted_at: null }, orderBy: { column: 'created_at', ascending: true } },
    { enabled: isAdmin },
  )
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <Card>
      <CardHeader
        title="Anggota"
        subtitle="Siapa saja yang bisa membuka data kos ini"
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
      <CardBody className="space-y-4">
        {isLocalMode && <p className="text-xs text-amber-700">Mode Demo: undangan baru berfungsi di Mode Online.</p>}

        {members.isPending ? (
          <LoadingState />
        ) : members.isError ? (
          <p className="text-sm text-red-600">Gagal memuat anggota: {members.error.message}</p>
        ) : (
          <MemberList
            members={members.data}
            myRole={myRole}
            currentUserId={currentUserId}
            onChangeRole={async (member, role) => {
              await repo.setMemberRole(member.user_id, role)
              toast.success(`Peran ${member.email ?? 'anggota'} sekarang ${MEMBER_ROLE_LABEL[role]}.`)
              await invalidate('organization_members')
              // our own role is cached with the organisation
              if (member.user_id === currentUserId) await qc.invalidateQueries({ queryKey: ['membership'] })
            }}
            onRemove={async (member) => {
              await repo.removeMember(member.user_id)
              toast.success('Anggota dihapus.')
              await invalidate('organization_members')
            }}
          />
        )}

        {isAdmin && (invitations.data?.length ?? 0) > 0 && (
          <PendingInvitations
            invitations={invitations.data ?? []}
            onCancel={async (inv) => {
              await repo.remove('invitations', inv.id)
              await invalidate('invitations')
            }}
          />
        )}

        <RolesHelp isAdmin={isAdmin} />
      </CardBody>

      {inviteOpen && (
        <InviteModal
          orgName={org.name}
          isLocalMode={isLocalMode}
          onCreate={async (role, label) => {
            const created = await repo.createInvitation(role, label)
            void invalidate('invitations')
            return created
          }}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </Card>
  )
}

function RolesHelp({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      <p>
        <strong className="text-slate-800">Pemilik &amp; Admin</strong>: akses penuh, termasuk harga kamar, rekening, ubah/hapus
        pembayaran, laporan, dan riwayat perubahan. Hanya Pemilik yang dapat mengubah peran anggota.
      </p>
      <p>
        <strong className="text-slate-800">Staf</strong>: mencatat check-in, pembayaran, dan pengeluaran. Tidak dapat mengubah harga
        atau rekening, mengubah/menghapus pembayaran, atau melihat laporan dan riwayat.
      </p>
      {isAdmin && (
        <p>
          <strong className="text-slate-800">Cara mengundang</strong>: tekan Undang, kirim kodenya lewat WhatsApp. Penerima membuat
          akun, lalu kodenya terisi sendiri.
        </p>
      )}
    </div>
  )
}
