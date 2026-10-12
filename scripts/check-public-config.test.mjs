import { describe, expect, it } from 'vitest'
import { checkEnvText, checkEnvVars, keyProblems, secretProblems } from './check-public-config.mjs'
import { CODE_ALPHABET, newCode } from './new-setup-code.mjs'

// Fixtures are built at runtime so no key-shaped literal lands in the repository.
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`
const anonJwt = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' })
const serviceJwt = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role' })
const secretKey = ['sb', 'secret', 'x'.repeat(32)].join('_')
const publishableKey = ['sb', 'publishable', 'x'.repeat(32)].join('_')
const notPublishable = 'VITE_SUPABASE_ANON_KEY must be the publishable key (sb_publishable_...), not a legacy anon key'

describe('checkEnvText', () => {
  it('accepts the public URL with a publishable key, quoted or not', () => {
    const url = 'VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co'
    expect(checkEnvText(`# public\n${url}\nVITE_SUPABASE_ANON_KEY=${publishableKey}\n`)).toEqual([])
    expect(checkEnvText(`${url}\r\nVITE_SUPABASE_ANON_KEY="${publishableKey}"\r\n`)).toEqual([])
    expect(checkEnvText('VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n')).toEqual([])
  })

  it('rejects a legacy anon key, which breaks once the legacy keys are disabled', () => {
    expect(checkEnvText(`VITE_SUPABASE_ANON_KEY="${anonJwt}"`)).toEqual([`line 1: ${notPublishable}`])
  })

  it('rejects secret keys, also in comments', () => {
    expect(checkEnvText(`VITE_SUPABASE_ANON_KEY=${secretKey}`)).toEqual([
      'line 1: contains a Supabase secret key (sb_secret_...)',
      `line 1: ${notPublishable}`,
    ])
    expect(checkEnvText(`VITE_SUPABASE_ANON_KEY=${serviceJwt}`)).toEqual(['line 1: contains a service_role JWT', `line 1: ${notPublishable}`])
    expect(checkEnvText(`\n# old: ${serviceJwt}`)).toEqual(['line 2: contains a service_role JWT'])
    expect(checkEnvText('VITE_DB=postgresql://postgres:pw@db.example.supabase.co:5432/postgres')).toHaveLength(1)
  })

  it('rejects variables without the VITE_ prefix and stray lines', () => {
    expect(checkEnvText('SUPABASE_URL=https://x.supabase.co')).toEqual(['line 1: SUPABASE_URL does not start with VITE_'])
    expect(checkEnvText('export DB_PASSWORD=hunter2')).toEqual(['line 1: DB_PASSWORD does not start with VITE_'])
    expect(checkEnvText('hunter2')).toEqual(['line 1: not a KEY=value line'])
  })

  it('never echoes the secret value', () => {
    expect(checkEnvText(`SERVICE_KEY=${serviceJwt}`).join('\n')).not.toContain(serviceJwt)
    expect(checkEnvText(`VITE_SUPABASE_ANON_KEY=${anonJwt}`).join('\n')).not.toContain(anonJwt)
  })
})

describe('checkEnvVars', () => {
  it('checks only non-empty VITE_ variables', () => {
    expect(checkEnvVars({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: publishableKey, OTHER: secretKey })).toEqual([])
    expect(checkEnvVars({ VITE_SUPABASE_ANON_KEY: secretKey })).toEqual([
      'VITE_SUPABASE_ANON_KEY: contains a Supabase secret key (sb_secret_...)',
      `VITE_SUPABASE_ANON_KEY: ${notPublishable}`,
    ])
    expect(checkEnvVars({ VITE_SUPABASE_ANON_KEY: anonJwt })).toEqual([`VITE_SUPABASE_ANON_KEY: ${notPublishable}`])
  })
})

describe('keyProblems', () => {
  it('applies only to the app key', () => {
    expect(keyProblems('VITE_SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co')).toEqual([])
    expect(keyProblems('VITE_SUPABASE_ANON_KEY', '')).toEqual([])
    expect(keyProblems('VITE_SUPABASE_ANON_KEY', publishableKey)).toEqual([])
  })
})

describe('secretProblems', () => {
  it('ignores tokens that only look like JWTs', () => {
    expect(secretProblems(`${b64({ alg: 'HS256' })}.${Buffer.from('role: service_role').toString('base64url')}.x`)).toEqual([])
  })
})

describe('newCode', () => {
  it('formats 8 characters from the code alphabet as ABCD-EFGH', () => {
    const code = newCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect([...code.replace('-', '')].every((c) => CODE_ALPHABET.includes(c))).toBe(true)
    expect(newCode(() => 0)).toBe('AAAA-AAAA')
  })
})
