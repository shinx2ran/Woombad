import { CODE_ALPHABET, normalizeCode } from '../../lib/repo/types'

/** Codes are 8 characters; extra room only so an unusual setup code can still be typed. */
const MAX_CODE_CHARS = 16

// A whole ABCD-EFGH (or ABCDEFGH) word: not part of a longer word or of a longer dashed code.
const CODE_TOKEN = new RegExp(`(?<![A-Z0-9-])[${CODE_ALPHABET}]{4}(-?)[${CODE_ALPHABET}]{4}(?![A-Z0-9-])`, 'g')

/**
 * The code inside pasted text, e.g. the line "3. … Jika diminta, ketik kode: ABCD-EFGH" from the invitation
 * message. The last code-shaped word wins, a dashed one before an undashed one. Null when there is none.
 */
function codeInText(text: string): string | null {
  const matches = [...text.toUpperCase().matchAll(CODE_TOKEN)]
  const dashed = matches.filter((m) => m[1] === '-')
  return (dashed.at(-1) ?? matches.at(-1))?.[0] ?? null
}

/**
 * Formats what the user typed or pasted into the code field as ABCD-EFGH (groups of four). A pasted
 * invitation link (…/gabung?kode=ABCD-EFGH) or message is reduced to its code. No trailing dash, so backspace works.
 */
export function formatCodeInput(raw: string): string {
  const fromLink = /[?&]kode=([^&#\s]*)/i.exec(raw)
  const source = fromLink ? fromLink[1] : (codeInText(raw) ?? raw)
  const normalized = normalizeCode(source).slice(0, MAX_CODE_CHARS)
  return normalized.match(/.{1,4}/g)?.join('-') ?? ''
}

/** True when the code has at least the 8 characters every code has. */
export function isCompleteCode(code: string): boolean {
  return normalizeCode(code).length >= 8
}
