/**
 * An invitation link (/gabung?kode=ABCD-EFGH) may be opened before the invitee has an account. The code is
 * kept here until they are signed in, then used once by the join screen.
 */
const KEY = 'woombad.pendingCode'
/** Invitation codes expire after 7 days; an older pending code would only waste a join attempt. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function savePendingCode(code: string, now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, savedAt: now }))
  } catch {
    /* storage unavailable: the user can still type the code */
  }
}

export function readPendingCode(now: number = Date.now()): string {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return ''
  }
  if (!raw) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  // a bare code was written by an earlier build
  if (!parsed || typeof parsed !== 'object') return raw
  const { code, savedAt } = parsed as { code?: unknown; savedAt?: unknown }
  if (typeof code !== 'string' || typeof savedAt !== 'number') return ''
  return now - savedAt > MAX_AGE_MS ? '' : code
}

export function clearPendingCode(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
