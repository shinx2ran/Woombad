import { formatDate } from '../../../lib/format'
import { MEMBER_ROLE_LABEL, type MemberRole } from '../../../types/db'

/**
 * Link that opens the join screen with the code filled in. Built from the app's base path so it works both
 * at the site root and under a sub-path (GitHub Pages serves the app at /Woombad/).
 */
export function buildJoinUrl(code: string, baseUrl: string = import.meta.env.BASE_URL, origin: string = window.location.origin): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(`${base}gabung?kode=${encodeURIComponent(code)}`, origin).toString()
}

/** 'd MMM yyyy pukul HH.mm' in the device's time zone, e.g. '19 Okt 2026 pukul 10.20'. */
export function formatExpiry(expiresAt: string): string {
  return formatDate(expiresAt, "d MMM yyyy 'pukul' HH.mm")
}

export interface InviteMessageInput {
  orgName: string
  role: MemberRole
  code: string
  link: string
  expiresAt: string
}

/** WhatsApp text for the invitee: three short steps, with the code repeated for typing by hand. */
export function buildInviteMessage({ orgName, role, code, link, expiresAt }: InviteMessageInput): string {
  return [
    `Halo, ini undangan untuk ikut mengelola ${orgName} di aplikasi Woombad (sebagai ${MEMBER_ROLE_LABEL[role]}).`,
    '',
    `1. Buka tautan ini: ${link}`,
    '2. Buat akun dengan email dan kata sandi Anda.',
    `3. Kode terisi sendiri. Jika diminta, ketik kode: ${code}`,
    '',
    `Kode hanya untuk Anda dan berlaku sampai ${formatExpiry(expiresAt)}.`,
  ].join('\n')
}

/** wa.me without a number lets the sender pick the contact in WhatsApp. */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
