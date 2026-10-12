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

export interface PendingCode {
  code: string
  savedAt: number
}

/** The saved code with when it was saved, so it can be put back unchanged (savePendingCode(code, savedAt)). */
export function readPendingEntry(now: number = Date.now()): PendingCode | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  // a bare code was written by an earlier build
  if (!parsed || typeof parsed !== 'object') return { code: raw, savedAt: now }
  const { code, savedAt } = parsed as { code?: unknown; savedAt?: unknown }
  if (typeof code !== 'string' || typeof savedAt !== 'number') return null
  return now - savedAt > MAX_AGE_MS ? null : { code, savedAt }
}

export function readPendingCode(now: number = Date.now()): string {
  return readPendingEntry(now)?.code ?? ''
}

export function clearPendingCode(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
