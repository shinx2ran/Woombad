import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** True when the build was given Supabase credentials; otherwise the app runs in local/demo mode. */
export const isSupabaseConfigured: boolean = Boolean(url && anonKey)

let client: SupabaseClient | null = null

/** Lazily created singleton. Throws if Supabase is not configured. */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase belum dikonfigurasi (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY kosong).')
  }
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: (input, init) => watchedFetch(input, init) },
    })
  }
  return client
}

/**
 * How the last Supabase request went: 'unreachable' when it got no answer (no signal, or a paused project whose
 * reply the browser blocks), 'paused' when the project answered that it is paused. Used by screens that would
 * otherwise only spin or say "no connection" (AuthGate, ErrorScreen).
 */
export type ServerStatus = 'ok' | 'unreachable' | 'paused'

let serverStatus: ServerStatus = 'ok'
const statusListeners = new Set<() => void>()

function setServerStatus(next: ServerStatus): void {
  if (serverStatus === next) return
  serverStatus = next
  for (const listener of statusListeners) listener()
}

export function getServerStatus(): ServerStatus {
  return serverStatus
}

export function subscribeServerStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** Supabase answers 540 while a free project is paused (after 7 days without activity). */
const PROJECT_PAUSED = 540

/**
 * The Supabase client's fetch: records whether the server answers. A paused project's 540 fails like a lost
 * connection, so supabase-js keeps the stored session (its unreadable body would otherwise sign this device out)
 * and screens show the connection message instead of "Unexpected end of JSON input".
 */
export async function watchedFetch(input: RequestInfo | URL, init?: RequestInit, doFetch: typeof fetch = fetch): Promise<Response> {
  let res: Response
  try {
    res = await doFetch(input, init)
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name
    if (name !== 'AbortError' && name !== 'TimeoutError') setServerStatus('unreachable')
    throw err
  }
  if (res.status === PROJECT_PAUSED) {
    setServerStatus('paused')
    throw new TypeError('Failed to fetch: Supabase project paused (HTTP 540)')
  }
  setServerStatus('ok')
  return res
}

const SESSION_KEY_RE = /^sb-.+-auth-token$/

/** A signed-in session is stored on this device (it may still need a refresh from the server). */
export function hasStoredSession(): boolean {
  try {
    return Object.keys(globalThis.localStorage).some((key) => SESSION_KEY_RE.test(key))
  } catch {
    return false
  }
}

const SIGN_OUT_WAIT_MS = 3000

/**
 * Sign out on this device only, also when the server cannot be reached (no signal, paused project): after a short
 * wait the stored session is removed anyway. Needs no React providers (used by the error screen).
 */
export async function signOutThisDevice(sb?: Pick<SupabaseClient, 'auth'>): Promise<void> {
  if (!sb && !isSupabaseConfigured) return
  try {
    const signOut = (sb ?? getSupabase()).auth.signOut({ scope: 'local' })
    await Promise.race([signOut, new Promise((resolve) => setTimeout(resolve, SIGN_OUT_WAIT_MS))])
  } catch {
    /* removed below */
  }
  try {
    const storage = globalThis.localStorage
    for (const key of Object.keys(storage)) if (/^sb-.+-auth-token/.test(key)) storage.removeItem(key)
  } catch {
    /* storage blocked: nothing stored either */
  }
}
