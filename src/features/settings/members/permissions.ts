import type { MemberRole } from '../../../types/db'

/**
 * Which member actions to offer. These mirror the database functions (set_member_role, remove_member),
 * which enforce the same rules; the UI only hides what would be refused anyway.
 */
export interface MemberLike {
  user_id: string
  role: MemberRole
}

export function ownerCount(members: readonly MemberLike[]): number {
  return members.filter((m) => m.role === 'owner').length
}

/** Owners change roles. The last owner cannot change their own role (the organisation would have no owner). */
export function canChangeRole(myRole: MemberRole, target: MemberLike, selfId: string, members: readonly MemberLike[]): boolean {
  if (myRole !== 'owner') return false
  if (target.user_id === selfId) return ownerCount(members) > 1
  return true
}

/** Never yourself; owners remove anyone else, admins remove staff only. */
export function canRemoveMember(myRole: MemberRole, target: MemberLike, selfId: string): boolean {
  if (target.user_id === selfId) return false
  if (myRole === 'owner') return true
  return myRole === 'admin' && target.role === 'staff'
}

export function isInvitationExpired(inv: { expires_at: string }, now: Date = new Date()): boolean {
  return new Date(inv.expires_at).getTime() <= now.getTime()
}

/** Short role names and what each role can do (SPEC 6.2), for pickers and the help text. */
export const ROLE_OPTION: Record<MemberRole, { title: string; description: string }> = {
  owner: {
    title: 'Pemilik – akses penuh + atur peran',
    description: 'Seperti Admin, plus mengatur peran semua anggota (termasuk peran Anda).',
  },
  admin: {
    title: 'Admin – akses penuh',
    description: 'Ubah harga & rekening, ubah/hapus pembayaran, lihat laporan & riwayat. Cocok untuk pasangan.',
  },
  staff: {
    title: 'Staf – catat transaksi',
    description: 'Catat check-in, pembayaran, dan pengeluaran. Tidak bisa ubah harga, rekening, atau lihat laporan.',
  },
}
