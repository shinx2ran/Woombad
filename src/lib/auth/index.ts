import { getSupabase, isSupabaseConfigured } from '../supabase'
import { LocalAuth } from './localAuth'
import { SupabaseAuth } from './supabaseAuth'
import type { AuthService } from './types'

export * from './types'
export { LOCAL_USER_ID } from './localAuth'

let instance: AuthService | null = null

export function getAuth(): AuthService {
  if (!instance) instance = isSupabaseConfigured ? new SupabaseAuth(getSupabase()) : new LocalAuth()
  return instance
}
