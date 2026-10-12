// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { ToastProvider } from '../../components/ui'
import type { Invitation, MemberRole, OrganizationMember } from '../../types/db'

const org = { id: 'org-1', name: 'Kos Melati', created_by: 'me', created_at: '2026-01-01T00:00:00Z' }
const orgState: { role: MemberRole; isLocalMode: boolean; repo: ReturnType<typeof fakeRepo> | null } = {
  role: 'owner',
  isLocalMode: false,
  repo: null,
}

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org, role: orgState.role, isLocalMode: orgState.isLocalMode, repo: orgState.repo }),
}))

import { MembersCard } from './MembersCard'

const base = { org_id: 'org-1', created_by: null }
const member = (id: string, email: string, role: MemberRole): OrganizationMember => ({
  ...base,
  id: `m-${id}`,
  user_id: id,
  email,
  role,
  created_at: '2026-01-02T00:00:00Z',
})
const invitation = (id: string, label: string | null, expires_at: string): Invitation => ({
  ...base,
  id,
  label,
  email: null,
  role: 'staff',
  invited_by: 'me',
  expires_at,
  accepted_at: null,
  accepted_by: null,
  created_at: '2026-01-03T00:00:00Z',
})

function fakeRepo(members: OrganizationMember[], invitations: Invitation[] = []) {
  return {
    mode: 'supabase' as const,
    orgId: 'org-1',
    list: vi.fn(async (table: string) => (table === 'organization_members' ? members : table === 'invitations' ? invitations : [])),
    remove: vi.fn(async () => undefined),
    createInvitation: vi.fn(async () => ({ code: 'ABCD-EFGH', expiresAt: '2099-10-19T12:00:00Z' })),
    setMemberRole: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
  }
}

let router: ReturnType<typeof createMemoryRouter>
const goBack = () => act(() => router.navigate(-1))

function setup(opts: { role: MemberRole; members: OrganizationMember[]; invitations?: Invitation[]; isLocalMode?: boolean }) {
  orgState.role = opts.role
  orgState.isLocalMode = opts.isLocalMode ?? false
  orgState.repo = fakeRepo(opts.members, opts.invitations)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // a data router, as in the app: the invite dialog blocks Back while an unsent code is shown
  router = createMemoryRouter(
    [
      { path: '/dashboard', element: <p>Beranda</p> },
      { path: '/pengaturan', element: <MembersCard isAdmin={opts.role !== 'staff'} currentUserId="me" /> },
    ],
    { initialEntries: ['/dashboard', '/pengaturan'], initialIndex: 1 },
  )
  const wrap = (ui: ReactNode) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  )
  render(wrap(<RouterProvider router={router} />))
  return orgState.repo
}

const OWNER = member('me', 'pemilik@contoh.id', 'owner')
const ADMIN = member('a', 'istri@contoh.id', 'admin')
const STAFF = member('s', 'penjaga@contoh.id', 'staff')
const OTHER_OWNER = member('o', 'pemilik@contoh.id', 'owner')

describe('MembersCard', () => {
  afterEach(() => cleanup())

  it('lets the only owner manage others but not change their own role', async () => {
    setup({ role: 'owner', members: [OWNER, ADMIN, STAFF] })
    await screen.findByText('istri@contoh.id')
    expect(screen.queryByRole('button', { name: 'Atur pemilik@contoh.id' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Atur istri@contoh.id' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Pemilik/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Hapus dari daftar anggota/ })).toBeTruthy()
  })

  it('changes a role through the server and shows its refusal inline', async () => {
    const repo = setup({ role: 'owner', members: [OWNER, ADMIN] })
    repo.setMemberRole.mockRejectedValueOnce(new Error('Tidak dapat mengubah peran pemilik terakhir.'))
    fireEvent.click(await screen.findByRole('button', { name: 'Atur istri@contoh.id' }))
    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan peran' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tidak dapat mengubah peran pemilik terakhir.')
    expect(repo.setMemberRole).toHaveBeenCalledWith('a', 'staff')
  })

  it('lets an admin remove staff only, without role changes', async () => {
    const repo = setup({ role: 'admin', members: [OTHER_OWNER, member('me', 'saya@contoh.id', 'admin'), ADMIN, STAFF] })
    await screen.findByText('penjaga@contoh.id')
    expect(screen.queryByRole('button', { name: 'Atur istri@contoh.id' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Atur pemilik@contoh.id' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Atur penjaga@contoh.id' }))
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Hapus dari daftar anggota/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    await waitFor(() => expect(repo.removeMember).toHaveBeenCalledWith('s'))
  })

  it('creates a code and offers WhatsApp, link and code copy', async () => {
    const repo = setup({ role: 'owner', members: [OWNER] })
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    fireEvent.change(screen.getByLabelText('Untuk siapa?'), { target: { value: '  Istri ' } })
    fireEvent.click(screen.getByRole('radio', { name: /Admin – akses penuh/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buat kode/ }))

    expect(((await screen.findByLabelText('Kode undangan')) as HTMLInputElement).value).toBe('ABCD-EFGH')
    expect(repo.createInvitation).toHaveBeenCalledWith('admin', 'Istri')
    expect(screen.getByText(/hanya ditampilkan sekali/)).toBeTruthy()
    expect(screen.getByText(/Berlaku sampai 19 Okt 2099/)).toBeTruthy()

    const link = (screen.getByLabelText('Tautan undangan') as HTMLInputElement).value
    expect(link).toBe(`${window.location.origin}/gabung?kode=ABCD-EFGH`)
    const wa = screen.getByRole('link', { name: /Kirim lewat WhatsApp/ }).getAttribute('href') ?? ''
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(wa.slice('https://wa.me/?text='.length))
    expect(text).toContain(link)
    expect(text).toContain('Kos Melati')
    expect(screen.getByRole('button', { name: /Salin tautan/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Salin kode/ })).toBeTruthy()
  })

  it('makes the owner pick a role before a code can be made', async () => {
    const repo = setup({ role: 'owner', members: [OWNER] })
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, false])
    const create = screen.getByRole('button', { name: /Buat kode/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(screen.getByText(/Pilih peran dulu/)).toBeTruthy()
    fireEvent.submit(document.getElementById('invite-form')!)
    expect(repo.createInvitation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    await screen.findByLabelText('Kode undangan')
    expect(repo.createInvitation).toHaveBeenCalledWith('staff', null)
    expect(screen.getByText(/Untuk: \(tanpa keterangan\)/)).toBeTruthy()
  })

  it('asks before closing a code that was not sent yet', async () => {
    setup({ role: 'owner', members: [OWNER] })
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buat kode/ }))
    await screen.findByLabelText('Kode undangan')

    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    expect(screen.getByText('Tutup tanpa mengirim kode?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
    fireEvent.click(screen.getByRole('link', { name: /Kirim lewat WhatsApp/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cannot be closed while the code is being created', async () => {
    const repo = setup({ role: 'owner', members: [OWNER] })
    let finish: (v: { code: string; expiresAt: string }) => void = () => undefined
    repo.createInvitation.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buat kode/ }))

    expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
    // header X, Escape, Back
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await goBack()
    expect(router.state.location.pathname).toBe('/pengaturan')
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => finish({ code: 'WXYZ-2345', expiresAt: '2099-10-19T12:00:00Z' }))
    expect(((await screen.findByLabelText('Kode undangan')) as HTMLInputElement).value).toBe('WXYZ-2345')
  })

  it('asks before Back leaves the page with an unsent code', async () => {
    setup({ role: 'owner', members: [OWNER] })
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buat kode/ }))
    await screen.findByLabelText('Kode undangan')

    await goBack()
    expect(router.state.location.pathname).toBe('/pengaturan')
    expect(screen.getByText('Tutup tanpa mengirim kode?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByLabelText('Kode undangan')).toBeTruthy()

    await goBack()
    expect(screen.getByText('Tutup tanpa mengirim kode?')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Tutup', { selector: 'button' })))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(screen.getByText('Beranda')).toBeTruthy()
  })

  it('lets Back through once the code was sent', async () => {
    setup({ role: 'owner', members: [OWNER] })
    fireEvent.click(screen.getByRole('button', { name: /Undang/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Staf/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buat kode/ }))
    await screen.findByLabelText('Kode undangan')
    fireEvent.click(screen.getByRole('link', { name: /Kirim lewat WhatsApp/ }))

    await goBack()
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(screen.queryByText('Tutup tanpa mengirim kode?')).toBeNull()
  })

  it('lists pending invitations with expiry and cancels them', async () => {
    const repo = setup({
      role: 'owner',
      members: [OWNER],
      invitations: [invitation('i1', null, '2020-01-01T00:00:00Z'), invitation('i2', 'Pak Udin', '2099-10-19T12:00:00Z')],
    })
    expect(await screen.findByText('(tanpa keterangan)')).toBeTruthy()
    expect(screen.getByText('Kedaluwarsa')).toBeTruthy()
    expect(screen.getByText(/berlaku s\/d 19 Okt 2099/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Batalkan' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan undangan' }))
    await waitFor(() => expect(repo.remove).toHaveBeenCalledWith('invitations', 'i2'))
  })

  it('in Mode Demo says invitations only work online', async () => {
    setup({ role: 'owner', members: [OWNER], isLocalMode: true })
    expect(screen.getByText(/undangan baru berfungsi di Mode Online/)).toBeTruthy()
  })

  it('hides invitations and actions from staff', async () => {
    const repo = setup({ role: 'staff', members: [OTHER_OWNER, member('me', 'penjaga@contoh.id', 'staff')] })
    await screen.findByText('penjaga@contoh.id')
    expect(screen.queryByRole('button', { name: /Undang/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Atur/ })).toBeNull()
    expect(repo.list).not.toHaveBeenCalledWith('invitations', expect.anything())
  })
})
