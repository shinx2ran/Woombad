// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthApiError, type SupabaseClient } from '@supabase/supabase-js'
import { ToastProvider } from '../../components/ui'
import { SupabaseAuth } from '../../lib/auth/supabaseAuth'

const resetPasswordForEmail = vi.fn()
const auth = new SupabaseAuth({ auth: { resetPasswordForEmail } } as unknown as SupabaseClient)

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ auth, session: null, loading: false }) }))

import { LoginPage } from './LoginPage'

function setup() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'istri@gmail.com' } })
}

describe('LoginPage: Lupa kata sandi?', () => {
  afterEach(() => {
    cleanup()
    resetPasswordForEmail.mockReset()
  })

  it('tells the wife to ask for a temporary password instead of showing Supabase English', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthApiError('Email address "istri@gmail.com" cannot be used as it is not authorized', 400, 'email_address_not_authorized'),
    })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Lupa kata sandi?' }))
    expect(await screen.findByText(/Minta pemilik kos membuat kata sandi sementara/)).toBeTruthy()
    expect(screen.queryByText(/not authorized/)).toBeNull()
  })

  it('asks to wait when the email was requested again too soon', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthApiError('For security purposes, you can only request this after 37 seconds.', 429, 'over_email_send_rate_limit'),
    })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Lupa kata sandi?' }))
    expect(await screen.findByText('Terlalu sering meminta email. Tunggu sebentar lalu coba lagi.')).toBeTruthy()
  })

  it('sends one request for a double tap', async () => {
    let finish: (v: unknown) => void = () => undefined
    resetPasswordForEmail.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    setup()
    const button = screen.getByRole('button', { name: 'Lupa kata sandi?' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    finish({ data: {}, error: null })
    expect(await screen.findByText('Tautan reset kata sandi dikirim ke email Anda.')).toBeTruthy()
  })
})
