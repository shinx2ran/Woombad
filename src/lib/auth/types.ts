export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthSession {
  user: AuthUser
}

export type AuthListener = (session: AuthSession | null) => void

export interface AuthService {
  readonly mode: 'supabase' | 'local'
  getSession(): Promise<AuthSession | null>
  signInWithPassword(email: string, password: string): Promise<AuthSession>
  /** Returns a session when email confirmation is disabled; null when the user must confirm email first. */
  signUp(email: string, password: string): Promise<AuthSession | null>
  signOut(): Promise<void>
  sendPasswordReset(email: string): Promise<void>
  onAuthStateChange(listener: AuthListener): () => void
}
