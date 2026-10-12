import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { AuthListener, AuthService, AuthSession } from './types'

function toSession(s: Session | null): AuthSession | null {
  if (!s?.user) return null
  return { user: { id: s.user.id, email: s.user.email ?? null } }
}

const ID_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Email atau kata sandi salah.',
  'Email not confirmed': 'Email belum dikonfirmasi. Cek kotak masuk Anda.',
  'User already registered': 'Email ini sudah terdaftar. Silakan masuk.',
  'Password should be at least 6 characters.': 'Kata sandi minimal 6 karakter.',
  'Password should be at least 8 characters.': 'Kata sandi minimal 8 karakter.',
}

function translate(message: string): string {
  if (ID_MESSAGES[message]) return ID_MESSAGES[message]
  if (/Failed to fetch|Load failed|NetworkError/i.test(message)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.'
  // Supabase's built-in mailer only delivers to the project's team members and is heavily rate-limited
  if (/Email address not authorized|email rate limit/i.test(message)) {
    return 'Email reset tidak bisa dikirim. Minta pemilik kos membuat kata sandi sementara untuk Anda.'
  }
  if (/Signups not allowed|signup.*disabled/i.test(message)) return 'Pendaftaran akun baru sedang ditutup. Minta pemilik kos membuatkan akun.'
  return message
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
    if (error) throw new Error(translate(error.message))
    const s = toSession(data.session)
    if (!s) throw new Error('Gagal masuk.')
    return s
  }

  async signUp(email: string, password: string): Promise<AuthSession | null> {
    const { data, error } = await this.sb.auth.signUp({ email, password })
    if (error) throw new Error(translate(error.message))
    return toSession(data.session)
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut()
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}reset-sandi`,
    })
    if (error) throw new Error(translate(error.message))
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password: newPassword })
    if (error) throw new Error(translate(error.message))
  }

  onAuthStateChange(listener: AuthListener): () => void {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => listener(toSession(session)))
    return () => data.subscription.unsubscribe()
  }
}
