import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { authErrorMessage } from './authErrors'
import type { AuthListener, AuthService, AuthSession } from './types'

function toSession(s: Session | null): AuthSession | null {
  if (!s?.user) return null
  return { user: { id: s.user.id, email: s.user.email ?? null } }
}

export class SupabaseAuth implements AuthService {
  readonly mode = 'supabase' as const
  private readonly sb: SupabaseClient
  constructor(sb: SupabaseClient) {
    this.sb = sb
  }

  async getSession(): Promise<AuthSession | null> {
    const { data } = await this.sb.auth.getSession()
    return toSession(data.session)
  }

  async signInWithPassword(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password })
    if (error) throw new Error(authErrorMessage(error, 'signIn'))
    const s = toSession(data.session)
    if (!s) throw new Error('Gagal masuk.')
    return s
  }

  async signUp(email: string, password: string): Promise<AuthSession | null> {
    const { data, error } = await this.sb.auth.signUp({ email, password })
    if (error) throw new Error(authErrorMessage(error, 'signUp'))
    return toSession(data.session)
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut()
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}reset-sandi`,
    })
    if (error) throw new Error(authErrorMessage(error, 'reset'))
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password: newPassword })
    if (error) throw new Error(authErrorMessage(error, 'updatePassword'))
  }

  onAuthStateChange(listener: AuthListener): () => void {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => listener(toSession(session)))
    return () => data.subscription.unsubscribe()
  }
}
