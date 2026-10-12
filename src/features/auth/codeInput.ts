import { normalizeCode } from '../../lib/repo/types'

/** Codes are 8 characters; extra room only so an unusual setup code can still be typed. */
const MAX_CODE_CHARS = 16

/**
 * Formats what the user typed or pasted into the code field as ABCD-EFGH (groups of four). A pasted
 * invitation link (…/gabung?kode=ABCD-EFGH) is reduced to its code. No trailing dash, so backspace works.
 */
export function formatCodeInput(raw: string): string {
  const fromLink = /[?&]kode=([^&#\s]*)/i.exec(raw)
  const normalized = normalizeCode(fromLink ? fromLink[1] : raw).slice(0, MAX_CODE_CHARS)
  return normalized.match(/.{1,4}/g)?.join('-') ?? ''
}

/** True when the code has at least the 8 characters every code has. */
export function isCompleteCode(code: string): boolean {
  return normalizeCode(code).length >= 8
}
