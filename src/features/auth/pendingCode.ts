/**
 * An invitation link (/gabung?kode=ABCD-EFGH) may be opened before the invitee has an account. The code is
 * kept here until they are signed in, then prefilled on the join screen.
 */
const KEY = 'woombad.pendingCode'

export function savePendingCode(code: string): void {
  try {
    localStorage.setItem(KEY, code)
  } catch {
    /* storage unavailable: the user can still type the code */
  }
}

export function readPendingCode(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearPendingCode(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
