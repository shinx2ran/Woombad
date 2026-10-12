// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { AUTH_MESSAGES, authErrorMessage } from './authErrors'
import { SupabaseAuth } from './supabaseAuth'

// Texts as Supabase Auth sends them (internal/api/mail.go, errors.go, apierrors).
const NOT_AUTHORIZED = 'Email address "istri@gmail.com" cannot be used as it is not authorized'
const RESEND_TOO_SOON = 'For security purposes, you can only request this after 42 seconds.'
const NETWORK = 'Tidak dapat terhubung ke server. Periksa koneksi internet.'

describe('authErrorMessage', () => {
  it('tells the wife or staff to ask for a temporary password when the reset email is refused', () => {
    expect(authErrorMessage({ message: NOT_AUTHORIZED, code: 'email_address_not_authorized', status: 400 }, 'reset')).toBe(
      AUTH_MESSAGES.resetNotAllowed,
    )
    // without a code (older server), the real text still matches
    expect(authErrorMessage({ message: NOT_AUTHORIZED }, 'reset')).toBe(AUTH_MESSAGES.resetNotAllowed)
    expect(AUTH_MESSAGES.resetNotAllowed).toMatch(/kata sandi sementara/)
  })

  it('on sign-up, the same refusal points at the "Confirm email" setting', () => {
    expect(authErrorMessage({ message: NOT_AUTHORIZED, code: 'email_address_not_authorized' }, 'signUp')).toBe(
      AUTH_MESSAGES.signupEmailNotAllowed,
    )
    expect(authErrorMessage({ message: NOT_AUTHORIZED }, 'signUp')).toBe(AUTH_MESSAGES.signupEmailNotAllowed)
  })

  it('asks to wait when a reset email is requested again too soon', () => {
    const wait = 'Terlalu sering meminta email. Tunggu sebentar lalu coba lagi.'
    expect(authErrorMessage({ message: RESEND_TOO_SOON, code: 'over_email_send_rate_limit', status: 429 }, 'reset')).toBe(wait)
    expect(authErrorMessage({ message: RESEND_TOO_SOON }, 'reset')).toBe(wait)
    expect(authErrorMessage({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' }, 'reset')).toBe(wait)
    expect(authErrorMessage({ message: 'email rate limit exceeded' }, 'reset')).toBe(wait)
    expect(authErrorMessage({ message: 'Request rate limit reached', code: 'over_request_rate_limit' }, 'reset')).toBe(wait)
  })

  it('a request limit on sign-in is about attempts, not email', () => {
    expect(authErrorMessage({ message: 'Request rate limit reached', code: 'over_request_rate_limit', status: 429 }, 'signIn')).toBe(
      AUTH_MESSAGES.rateLimit,
    )
    expect(authErrorMessage({ message: 'Too Many Requests', status: 429 }, 'signIn')).toBe(AUTH_MESSAGES.rateLimit)
  })

  it('maps the other codes, with the texts as fallbacks', () => {
    const cases: [string, string, string][] = [
      ['invalid_credentials', 'Invalid login credentials', 'Email atau kata sandi salah.'],
      ['email_not_confirmed', 'Email not confirmed', 'Email belum dikonfirmasi. Cek kotak masuk Anda.'],
      ['user_already_exists', 'User already registered', 'Email ini sudah terdaftar. Silakan masuk.'],
      ['email_exists', 'A user with this email address has already been registered', 'Email ini sudah terdaftar. Silakan masuk.'],
      ['signup_disabled', 'Signups not allowed for this instance', AUTH_MESSAGES.signupDisabled],
      ['weak_password', 'Password should be at least 8 characters.', 'Kata sandi minimal 8 karakter.'],
      ['weak_password', 'Password should be at least 6 characters.', 'Kata sandi minimal 6 karakter.'],
      ['weak_password', 'Password is known to be weak and easy to guess, please choose a different one.', AUTH_MESSAGES.weakPassword],
      ['same_password', 'New password should be different from the old password.', AUTH_MESSAGES.samePassword],
      ['email_address_invalid', 'Email address "x@y" is invalid', AUTH_MESSAGES.invalidEmail],
    ]
    for (const [code, message, expected] of cases) {
      expect(authErrorMessage({ message, code }, 'signUp')).toBe(expected)
      expect(authErrorMessage({ message }, 'signUp')).toBe(expected)
    }
    // a weak password with no length in the text
    expect(authErrorMessage({ message: 'Password should contain at least one character of each: abc', code: 'weak_password' }, 'signUp')).toBe(
      AUTH_MESSAGES.weakPassword,
    )
  })

  it('keeps the network message for every browser', () => {
    for (const message of ['Failed to fetch', 'TypeError: Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(authErrorMessage({ message, status: 0 }, 'reset')).toBe(NETWORK)
    }
  })

  it('passes an unknown error through unchanged', () => {
    expect(authErrorMessage({ message: 'Database error saving new user', code: 'unexpected_failure', status: 500 }, 'signUp')).toBe(
      'Database error saving new user',
    )
  })
})

describe('SupabaseAuth', () => {
  function authWith(api: Record<string, unknown>) {
    return new SupabaseAuth({ auth: api } as unknown as SupabaseClient)
  }

  it('"Lupa kata sandi?" shows the Indonesian guidance for the real Supabase error', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({
      data: null,
      error: new AuthApiError(NOT_AUTHORIZED, 400, 'email_address_not_authorized'),
    }))
    await expect(authWith({ resetPasswordForEmail }).sendPasswordReset('istri@gmail.com')).rejects.toThrow(AUTH_MESSAGES.resetNotAllowed)
    expect(resetPasswordForEmail).toHaveBeenCalledWith('istri@gmail.com', { redirectTo: expect.stringMatching(/\/reset-sandi$/) })
  })

  it('maps sign-in, sign-up and password errors by code', async () => {
    const auth = authWith({
      signInWithPassword: async () => ({ data: { session: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') }),
      signUp: async () => ({ data: { session: null }, error: new AuthApiError(RESEND_TOO_SOON, 429, 'over_email_send_rate_limit') }),
      updateUser: async () => ({ data: { user: null }, error: new AuthRetryableFetchError('Load failed', 0) }),
    })
    await expect(auth.signInWithPassword('a@b.c', 'x')).rejects.toThrow('Email atau kata sandi salah.')
    await expect(auth.signUp('a@b.c', 'xxxxxxxx')).rejects.toThrow(AUTH_MESSAGES.emailRateLimit)
    await expect(auth.updatePassword('xxxxxxxx')).rejects.toThrow(NETWORK)
  })
})
