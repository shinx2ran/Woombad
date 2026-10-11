/**
 * Post-login return path ("from") handling.
 *
 * `AuthGate` remembers where a signed-out visitor wanted to go and `LoginPage` navigates there after
 * sign-in. That value must never leave the app: react-router passes a leading-"//" path to
 * `history.replaceState` unchanged, the browser treats "//evil.example/x" as a protocol-relative URL,
 * throws a SecurityError, and react-router then falls back to `window.location.assign(url)` — an open
 * redirect right after the user typed their password. Only same-origin, path-absolute locations
 * ("/sewa/abc?action=bayar#top") are accepted; everything else falls back to the dashboard.
 */

export const DEFAULT_RETURN_PATH = '/dashboard'

/**
 * Returns `raw` when it is a safe in-app location: a string starting with exactly one "/" (not "//"
 * or "/\\"), without backslashes, whitespace or control characters, and not an auth page (to avoid
 * bouncing back to /login). Otherwise returns `fallback`.
 */
export function safeReturnPath(raw: unknown, fallback: string = DEFAULT_RETURN_PATH): string {
  if (typeof raw !== 'string') return fallback
  if (!/^\/(?![/\\])/.test(raw)) return fallback
  if (raw.includes('\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return fallback
  const pathname = raw.split(/[?#]/, 1)[0] ?? ''
  if (pathname === '/' || pathname === '/login' || pathname === '/daftar' || pathname === '/reset-sandi') return fallback
  return raw
}
