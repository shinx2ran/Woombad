// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signOutThisDevice } from './supabase'

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
