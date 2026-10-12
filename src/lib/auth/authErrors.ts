/** Which request failed: the same Supabase error needs different advice on each screen. */
export type AuthAction = 'signIn' | 'signUp' | 'reset' | 'updatePassword'

/** The parts of supabase-js's AuthError used here; `code` is missing on network failures. */
export interface AuthErrorLike {
  message: string
  code?: string | undefined
  status?: number | undefined
}

/** Same wording as NETWORK_ERROR_MESSAGE in features/auth/networkError. */
const NETWORK = 'Tidak dapat terhubung ke server. Periksa koneksi internet.'
export const AUTH_MESSAGES = {
  invalidCredentials: 'Email atau kata sandi salah.',
  notConfirmed: 'Email belum dikonfirmasi. Cek kotak masuk Anda.',
  alreadyRegistered: 'Email ini sudah terdaftar. Silakan masuk.',
  weakPassword: 'Kata sandi terlalu lemah atau mudah ditebak. Pilih kata sandi lain.',
  samePassword: 'Kata sandi baru harus berbeda dari kata sandi lama.',
  invalidEmail: 'Alamat email tidak valid. Periksa kembali penulisannya.',
  signupDisabled: 'Pendaftaran akun baru sedang ditutup. Minta pemilik kos membuatkan akun.',
  // Supabase's built-in mailer only delivers to the project's team members (the owner)
  resetNotAllowed: 'Email reset tidak bisa dikirim. Minta pemilik kos membuat kata sandi sementara untuk Anda.',
  signupEmailNotAllowed:
    'Akun belum bisa dibuat karena email konfirmasi tidak bisa dikirim ke alamat ini. Minta pemilik kos mematikan "Confirm email" di Supabase.',
  emailRateLimit: 'Terlalu sering meminta email. Tunggu sebentar lalu coba lagi.',
  rateLimit: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
  sessionMissing: 'Sesi masuk sudah berakhir. Silakan masuk lagi.',
} as const

function minLength(message: string): string | null {
  const m = /at least (\d+) characters/i.exec(message)
  return m ? `Kata sandi minimal ${m[1]} karakter.` : null
}

function notAuthorized(action: AuthAction): string {
  return action === 'signUp' ? AUTH_MESSAGES.signupEmailNotAllowed : AUTH_MESSAGES.resetNotAllowed
}

/** Request limits on a password reset are about email; elsewhere they are about attempts. */
function requestLimit(action: AuthAction): string {
  return action === 'reset' ? AUTH_MESSAGES.emailRateLimit : AUTH_MESSAGES.rateLimit
}

function byCode(code: string, message: string, action: AuthAction): string | null {
  switch (code) {
    case 'invalid_credentials':
      return AUTH_MESSAGES.invalidCredentials
    case 'email_not_confirmed':
      return AUTH_MESSAGES.notConfirmed
    case 'user_already_exists':
    case 'email_exists':
      return AUTH_MESSAGES.alreadyRegistered
    case 'weak_password':
      return minLength(message) ?? AUTH_MESSAGES.weakPassword
    case 'same_password':
      return AUTH_MESSAGES.samePassword
    case 'email_address_invalid':
      return AUTH_MESSAGES.invalidEmail
    case 'signup_disabled':
      return AUTH_MESSAGES.signupDisabled
    case 'email_address_not_authorized':
      return notAuthorized(action)
    case 'over_email_send_rate_limit':
      return AUTH_MESSAGES.emailRateLimit
    case 'over_request_rate_limit':
      return requestLimit(action)
    case 'session_not_found':
      return AUTH_MESSAGES.sessionMissing
    default:
      return null
  }
}

// Fallbacks for errors without a code, matched on the texts Supabase Auth actually sends.
function byMessage(message: string, action: AuthAction): string | null {
  if (/Invalid login credentials/i.test(message)) return AUTH_MESSAGES.invalidCredentials
  if (/Email not confirmed/i.test(message)) return AUTH_MESSAGES.notConfirmed
  if (/User already registered|already been registered/i.test(message)) return AUTH_MESSAGES.alreadyRegistered
  const min = minLength(message)
  if (min && /password/i.test(message)) return min
  if (/Password should contain|weak and easy to guess/i.test(message)) return AUTH_MESSAGES.weakPassword
  if (/New password should be different/i.test(message)) return AUTH_MESSAGES.samePassword
  if (/Email address .* is invalid|invalid format/i.test(message)) return AUTH_MESSAGES.invalidEmail
  if (/Signups not allowed|signup.*disabled/i.test(message)) return AUTH_MESSAGES.signupDisabled
  // 'Email address "x" cannot be used as it is not authorized'
  if (/not authorized|Error sending (confirmation|recovery) email/i.test(message)) return notAuthorized(action)
  // 'For security purposes, you can only request this after 42 seconds.' / 'email rate limit exceeded'
  if (/For security purposes|email rate limit/i.test(message)) return AUTH_MESSAGES.emailRateLimit
  if (/rate limit/i.test(message)) return requestLimit(action)
  if (/Auth session missing/i.test(message)) return AUTH_MESSAGES.sessionMissing
  return null
}

/** Indonesian text for a Supabase Auth error; an unknown error keeps its own message. */
export function authErrorMessage(error: AuthErrorLike, action: AuthAction): string {
  const { message, code, status } = error
  if (/Failed to fetch|Load failed|NetworkError/i.test(message)) return NETWORK
  return (
    (code ? byCode(code, message, action) : null) ??
    byMessage(message, action) ??
    (status === 429 ? requestLimit(action) : message)
  )
}
