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
    })
  }
  return client
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
