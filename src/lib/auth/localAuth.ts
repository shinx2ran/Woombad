import type { AuthListener, AuthService, AuthSession } from './types'

const KEY = 'woombad.local.session.v1'
export const LOCAL_USER_ID = 'local-user'

/**
 * Demo-mode auth: any email/password signs in; the session is a flag in localStorage.
 * There is intentionally no security here: local mode stores data only on this device.
 */
export class LocalAuth implements AuthService {
  readonly mode = 'local' as const
  private listeners = new Set<AuthListener>()

  async getSession(): Promise<AuthSession | null> {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as AuthSession) : null
    } catch {
      return null
    }
  }

  private set(session: AuthSession | null) {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
    for (const l of this.listeners) l(session)
  }

  async signInWithPassword(email: string, _password?: string): Promise<AuthSession> {
    const session: AuthSession = { user: { id: LOCAL_USER_ID, email: email || 'demo@woombad.local' } }
    this.set(session)
    return session
  }

  async signUp(email: string, password: string): Promise<AuthSession | null> {
    return this.signInWithPassword(email, password)
  }

  async signOut(): Promise<void> {
    this.set(null)
  }

  async sendPasswordReset(): Promise<void> {
    /* no-op in demo mode */
  }

  onAuthStateChange(listener: AuthListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
