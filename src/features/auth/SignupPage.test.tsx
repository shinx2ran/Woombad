// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { savePendingCode } from './pendingCode'

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ auth: { signUp: vi.fn() }, session: null, loading: false }) }))

import { SignupPage } from './SignupPage'

function setup() {
  render(
    <MemoryRouter initialEntries={['/daftar']}>
      <SignupPage />
    </MemoryRouter>,
  )
}

describe('SignupPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('without a link code, names both the invitation code and the owner setup code', () => {
    setup()
    const notice = screen.getByText(/Akun saja belum cukup/)
    expect(notice.textContent).toMatch(/kode undangan/)
    expect(notice.textContent).toMatch(/kode pemilik bila Anda pemilik/)
    expect(notice.textContent).not.toMatch(/kode dari pemilik kos/)
  })

  it('with a link code, says it will be used after sign-up', () => {
    savePendingCode('ABCD-EFGH')
    setup()
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.queryByText(/Akun saja belum cukup/)).toBeNull()
  })
})
