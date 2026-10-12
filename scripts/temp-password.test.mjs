import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET } from './new-setup-code.mjs'
import { resetPasswordSql, tempPassword } from './temp-password.mjs'

describe('tempPassword', () => {
  it('formats 12 characters from the code alphabet as ABCD-EFGH-JKMN', () => {
    const password = tempPassword()
    expect(password).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect([...password.replaceAll('-', '')].every((c) => CODE_ALPHABET.includes(c))).toBe(true)
    expect(tempPassword(() => 0)).toBe('AAAA-AAAA-AAAA')
  })
})

describe('resetPasswordSql', () => {
  it('hashes the password with bcrypt and matches the lower-cased email', () => {
    expect(resetPasswordSql('  Istri@Example.com ', 'ABCD-EFGH-JKMN')).toBe(
      [
        'update auth.users',
        "set encrypted_password = extensions.crypt('ABCD-EFGH-JKMN', extensions.gen_salt('bf', 10)), updated_at = now()",
        "where email = 'istri@example.com'",
        'returning email;',
      ].join('\n'),
    )
  })

  it('escapes quotes and rejects input that is not an email address', () => {
    expect(resetPasswordSql("o'brien@example.com", 'x')).toContain("where email = 'o''brien@example.com'")
    expect(() => resetPasswordSql("x' or true --", 'x')).toThrow('Not an email address')
    expect(() => resetPasswordSql('a b@example.com', 'x')).toThrow('Not an email address')
  })
})
