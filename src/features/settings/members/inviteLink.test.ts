import { describe, expect, it } from 'vitest'
import { buildInviteMessage, buildJoinUrl, whatsappShareUrl } from './inviteLink'

describe('buildJoinUrl', () => {
  it('points at /gabung under the app base path', () => {
    expect(buildJoinUrl('ABCD-EFGH', '/', 'http://localhost:5173')).toBe('http://localhost:5173/gabung?kode=ABCD-EFGH')
    expect(buildJoinUrl('ABCD-EFGH', '/Woombad/', 'https://shinx2ran.github.io')).toBe(
      'https://shinx2ran.github.io/Woombad/gabung?kode=ABCD-EFGH',
    )
  })

  it('tolerates a base path without the trailing slash', () => {
    expect(buildJoinUrl('ABCD-EFGH', '/Woombad', 'https://shinx2ran.github.io')).toBe(
      'https://shinx2ran.github.io/Woombad/gabung?kode=ABCD-EFGH',
    )
  })

  it('uses the Vite base and the current origin by default', () => {
    expect(buildJoinUrl('ABCD-EFGH', undefined, 'https://kos.example')).toBe(
      new URL(`${import.meta.env.BASE_URL}gabung?kode=ABCD-EFGH`, 'https://kos.example').toString(),
    )
  })
})

describe('buildInviteMessage', () => {
  const message = buildInviteMessage({
    orgName: 'Kos Melati',
    role: 'admin',
    code: 'ABCD-EFGH',
    link: 'https://shinx2ran.github.io/Woombad/gabung?kode=ABCD-EFGH',
    expiresAt: '2026-10-19T03:20:00.000Z',
  })

  it('explains the three steps with the link and the code', () => {
    expect(message).toContain('Kos Melati')
    expect(message).toContain('sebagai Admin')
    expect(message).toContain('1. Buka tautan ini: https://shinx2ran.github.io/Woombad/gabung?kode=ABCD-EFGH')
    expect(message).toMatch(/^2\. Buat akun/m)
    expect(message).toMatch(/^3\. Kode terisi sendiri\. Jika diminta, ketik kode: ABCD-EFGH$/m)
  })

  it('says until when the code works', () => {
    expect(message).toMatch(/berlaku sampai \d{1,2} Okt 2026 pukul \d{2}\.\d{2}\./)
  })
})

describe('whatsappShareUrl', () => {
  it('lets the sender pick the contact and encodes the whole message', () => {
    const url = whatsappShareUrl('Halo & selamat\n1. Buka https://x.example/gabung?kode=ABCD-EFGH')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(url).not.toContain('\n')
    expect(url).not.toContain(' ')
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(
      'Halo & selamat\n1. Buka https://x.example/gabung?kode=ABCD-EFGH',
    )
  })
})
