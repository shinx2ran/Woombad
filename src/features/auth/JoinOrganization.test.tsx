// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setRepoForTests, type Repo } from '../../lib/repo'
import { readPendingCode, savePendingCode } from './pendingCode'

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ auth: { signOut: vi.fn() }, session: { user: { id: 'u1', email: 'istri@contoh.id' } }, loading: false }),
}))

import { JoinOrganization } from './JoinOrganization'

const joinWithCode = vi.fn<(code: string) => Promise<string>>()

describe('JoinOrganization', () => {
  beforeEach(() => {
    setRepoForTests({ joinWithCode } as unknown as Repo)
  })
  afterEach(() => {
    cleanup()
    joinWithCode.mockReset()
    localStorage.clear()
    setRepoForTests(null)
  })

  it('shows the signed-in email and explains both kinds of code', () => {
    render(<JoinOrganization onJoined={() => undefined} />)
    expect(screen.getByText(/istri@contoh\.id/)).toBeTruthy()
    expect(screen.getByText(/pesan WhatsApp yang Anda terima/)).toBeTruthy()
    expect(screen.getAllByText(/kode pemilik/).length).toBeGreaterThan(0)
    expect(joinWithCode).not.toHaveBeenCalled()
  })

  it('submits a code saved from an invitation link automatically, exactly once', async () => {
    savePendingCode('abcd-efgh')
    joinWithCode.mockResolvedValue('org-1')
    const onJoined = vi.fn()
    render(
      <StrictMode>
        <JoinOrganization onJoined={onJoined} />
      </StrictMode>,
    )
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1))
    expect(joinWithCode).toHaveBeenCalledTimes(1)
    expect(joinWithCode).toHaveBeenCalledWith('ABCDEFGH')
    expect(readPendingCode()).toBe('')
  })

  it('after a failed automatic attempt shows the error inline and does not retry on its own', async () => {
    savePendingCode('ABCD-EFGH')
    joinWithCode.mockRejectedValue(new Error('Kode tidak valid atau sudah kedaluwarsa.'))
    const { unmount } = render(<JoinOrganization onJoined={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Kode tidak valid atau sudah kedaluwarsa.')
    expect((screen.getByLabelText('Kode') as HTMLInputElement).value).toBe('ABCD-EFGH')
    expect(readPendingCode()).toBe('')

    // coming back to the screen later does not spend another attempt
    unmount()
    render(<JoinOrganization onJoined={() => undefined} />)
    expect((screen.getByLabelText('Kode') as HTMLInputElement).value).toBe('')
    expect(joinWithCode).toHaveBeenCalledTimes(1)
  })

  it('keeps the link code for the next visit when the server could not be reached', async () => {
    savePendingCode('ABCD-EFGH', Date.now() - 1_000)
    const savedAt = JSON.parse(localStorage.getItem('woombad.pendingCode') ?? '{}').savedAt
    // what postgrest-js reports for a failed fetch in Safari / every iOS browser
    joinWithCode.mockRejectedValueOnce(new Error('TypeError: Load failed'))
    const { unmount } = render(<JoinOrganization onJoined={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Tidak dapat terhubung ke server. Periksa koneksi internet.')
    expect(readPendingCode()).toBe('ABCD-EFGH')
    // put back as it was, so the seven-day limit still counts from when the link was opened
    expect(JSON.parse(localStorage.getItem('woombad.pendingCode') ?? '{}').savedAt).toBe(savedAt)

    unmount()
    joinWithCode.mockResolvedValueOnce('org-1')
    const onJoined = vi.fn()
    render(<JoinOrganization onJoined={onJoined} />)
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1))
    expect(joinWithCode).toHaveBeenCalledTimes(2)
    expect(readPendingCode()).toBe('')
  })

  it('forgets the link code once the server has answered a manual retry', async () => {
    savePendingCode('ABCD-EFGH')
    joinWithCode.mockRejectedValueOnce(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'))
    render(<JoinOrganization onJoined={() => undefined} />)
    await screen.findByRole('alert')
    expect(readPendingCode()).toBe('ABCD-EFGH')

    joinWithCode.mockRejectedValueOnce(new Error('Kode tidak valid atau sudah kedaluwarsa.'))
    fireEvent.click(screen.getByRole('button', { name: /Gabung/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Kode tidak valid atau sudah kedaluwarsa.'))
    expect(readPendingCode()).toBe('')
  })

  it('does not auto-submit an incomplete pending code', () => {
    savePendingCode('ABC')
    render(<JoinOrganization onJoined={() => undefined} />)
    expect((screen.getByLabelText('Kode') as HTMLInputElement).value).toBe('ABC')
    expect(joinWithCode).not.toHaveBeenCalled()
  })

  it('formats the code while typing and submits it on Gabung', async () => {
    joinWithCode.mockResolvedValue('org-1')
    const onJoined = vi.fn()
    render(<JoinOrganization onJoined={onJoined} />)
    const input = screen.getByLabelText('Kode') as HTMLInputElement
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('characters')
    expect(input.getAttribute('spellcheck')).toBe('false')

    fireEvent.change(input, { target: { value: 'wxyz2' } })
    expect(input.value).toBe('WXYZ-2')
    fireEvent.click(screen.getByRole('button', { name: /Gabung/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/8 huruf\/angka/)
    expect(joinWithCode).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'WXYZ-2345' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Gabung/ }))
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1))
    expect(joinWithCode).toHaveBeenCalledWith('WXYZ2345')
  })

  it('takes the code from a pasted line of the invitation message', async () => {
    joinWithCode.mockResolvedValue('org-1')
    render(<JoinOrganization onJoined={() => undefined} />)
    const input = screen.getByLabelText('Kode') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3. Kode terisi sendiri. Jika diminta, ketik kode: ABCD-EFGH' } })
    expect(input.value).toBe('ABCD-EFGH')
    fireEvent.click(screen.getByRole('button', { name: /Gabung/ }))
    await waitFor(() => expect(joinWithCode).toHaveBeenCalledWith('ABCDEFGH'))
  })

  it('shows the rate-limit message from the server', async () => {
    joinWithCode.mockRejectedValue(new Error('Terlalu banyak percobaan. Coba lagi dalam 1 jam.'))
    render(<JoinOrganization onJoined={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Kode'), { target: { value: 'ABCDEFGH' } })
    fireEvent.click(screen.getByRole('button', { name: /Gabung/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('Terlalu banyak percobaan. Coba lagi dalam 1 jam.')
    expect((screen.getByRole('button', { name: /Gabung/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
