// Prints a temporary password for an app user who forgot theirs, and the SQL the operator runs in the Supabase
// SQL Editor. Needed because Supabase's built-in mailer only reaches the project's team, so "Lupa kata sandi?"
// emails never arrive for other users. The user signs in with it and sets a new password at /reset-sandi.
// Usage: node scripts/temp-password.mjs <email>
import { randomInt } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { CODE_ALPHABET } from './new-setup-code.mjs'

/** 12 characters as ABCD-EFGH-JKMN (about 59 bits), easy to read out over WhatsApp. */
export function tempPassword(rand = randomInt) {
  const chars = Array.from({ length: 12 }, () => CODE_ALPHABET[rand(CODE_ALPHABET.length)]).join('')
  return chars.match(/.{4}/g).join('-')
}

const sqlText = (s) => `'${s.replaceAll("'", "''")}'`

/** Supabase stores emails in lower case; pgcrypto lives in the extensions schema. */
export function resetPasswordSql(email, password) {
  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error(`Not an email address: ${email}`)
  return [
    'update auth.users',
    `set encrypted_password = extensions.crypt(${sqlText(password)}, extensions.gen_salt('bf', 10)), updated_at = now()`,
    `where email = ${sqlText(address)}`,
    'returning email;',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: node scripts/temp-password.mjs <email>')
    process.exit(1)
  }
  const password = tempPassword()
  console.log(`Kata sandi sementara: ${password}\n\n${resetPasswordSql(email, password)}`)
  console.log('\nThe SQL must return 1 row (0 rows: wrong email). Send the password privately; the user changes it in Pengaturan -> Tentang -> Ganti kata sandi.')
}
