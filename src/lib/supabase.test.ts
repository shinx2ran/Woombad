// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getServerStatus, hasStoredSession, signOutThisDevice, subscribeServerStatus, watchedFetch } from './supabase'
import { SupabaseAuth } from './auth/supabaseAuth'
import { isNetworkError, NETWORK_ERROR_MESSAGE } from '../features/auth/networkError'

const SESSION_KEY = 'sb-abcdefgh-auth-token'

function fakeClient(signOut: () => Promise<unknown>) {
  return { auth: { signOut: vi.fn(signOut) } } as unknown as Parameters<typeof signOutThisDevice>[0]
}

describe('signOutThisDevice', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(SESSION_KEY, '{"access_token":"x"}')
    localStorage.setItem(`${SESSION_KEY}-code-verifier`, 'v')
    localStorage.setItem('woombad.selectedProperty', 'p1')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs out of this device only', async () => {
    const sb = fakeClient(async () => ({ error: null }))
    await signOutThisDevice(sb)
    expect(sb!.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(localStorage.getItem('woombad.selectedProperty')).toBe('p1')
  })

  it('removes the stored session when the server cannot be reached', async () => {
    await signOutThisDevice(fakeClient(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(`${SESSION_KEY}-code-verifier`)).toBeNull()
  })

  it('stops waiting for a server that does not answer', async () => {
    vi.useFakeTimers()
    const done = signOutThisDevice(fakeClient(() => new Promise(() => {})))
    await vi.advanceTimersByTimeAsync(3000)
    await done
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('watchedFetch (the Supabase client fetch)', () => {
  const ok = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  const paused = async () => new Response('', { status: 540 })

  beforeEach(async () => {
    await watchedFetch('https://x.supabase.co/rest/v1/kos', undefined, ok)
  })

  it('records whether the server answered and notifies listeners', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeServerStatus(listener)
    await expect(watchedFetch('https://x.supabase.co/rest/v1/kos', undefined, offline)).rejects.toThrow('Failed to fetch')
    expect(getServerStatus()).toBe('unreachable')
    expect(listener).toHaveBeenCalledTimes(1)
    const res = await watchedFetch('https://x.supabase.co/rest/v1/kos', undefined, async () => new Response('[]', { status: 401 }))
    expect(res.status).toBe(401)
    expect(getServerStatus()).toBe('ok')
    unsubscribe()
  })

  it('does not count a request the app cancelled itself', async () => {
    const aborted = () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
    await expect(watchedFetch('https://x.supabase.co/rest/v1/kos', undefined, aborted)).rejects.toThrow()
    expect(getServerStatus()).toBe('ok')
  })

  it('turns a paused project (HTTP 540) into a failed connection', async () => {
    const err = await watchedFetch('https://x.supabase.co/auth/v1/token', undefined, paused).catch((e: unknown) => e)
    expect(getServerStatus()).toBe('paused')
    expect(isNetworkError(err)).toBe(true)
  })

  it('a paused project shows the connection message at sign-in, not "Unexpected end of JSON input"', async () => {
    const storage = new Map<string, string>()
    const sb = createClient('https://abcdefgh.supabase.co', 'anon-key', {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v), removeItem: (k) => void storage.delete(k) },
      },
      global: { fetch: (input, init) => watchedFetch(input, init, paused) },
    })
    await expect(new SupabaseAuth(sb).signInWithPassword('pemilik@contoh.id', 'rahasia123')).rejects.toThrow(NETWORK_ERROR_MESSAGE)
    expect(getServerStatus()).toBe('paused')
  })
})

describe('hasStoredSession', () => {
  beforeEach(() => localStorage.clear())

  it('sees a stored Supabase session, not other keys', () => {
    localStorage.setItem('woombad.selectedProperty', 'p1')
    localStorage.setItem(`${SESSION_KEY}-code-verifier`, 'v')
    expect(hasStoredSession()).toBe(false)
    localStorage.setItem(SESSION_KEY, '{"access_token":"x"}')
    expect(hasStoredSession()).toBe(true)
  })
})
