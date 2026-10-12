// Prints a fresh owner setup code (SPEC 6.1) and the SQL the operator runs once in the Supabase SQL Editor.
// Usage: node scripts/new-setup-code.mjs
import { randomInt } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// Same alphabet as CODE_ALPHABET in src/lib/repo/types.ts (no 0/O/1/I/L).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newCode(rand = randomInt) {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[rand(CODE_ALPHABET.length)]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = newCode()
  console.log(`Kode pemilik: ${code}\n\nselect public.set_setup_code('${code}');`)
}
