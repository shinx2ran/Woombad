// Pre-build safety check: .env.production (committed) and the VITE_* build variables end up public, in the repository
// and in the JS bundle, so they may hold only the Supabase URL and the publishable key. Fails on secret keys.
// Usage: node scripts/check-public-config.mjs [file ...]   (default: .env.production, when present)
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// header.payload.signature; a JWT header always starts with '{"' (base64url 'eyJ')
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g

/** Problems found in one value (or raw line); never includes the value itself, so logs stay clean. */
export function secretProblems(value) {
  const problems = []
  if (value.includes('sb_secret_')) problems.push('contains a Supabase secret key (sb_secret_...)')
  for (const [token] of value.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') problems.push('contains a service_role JWT')
    } catch {
      // not a decodable JWT; ignore
    }
  }
  if (/postgres(ql)?:\/\//i.test(value)) problems.push('contains a database connection string')
  return problems
}

/**
 * The app key must be the publishable key: a legacy anon key stops working once the legacy keys are disabled,
 * which is the only way to revoke a leaked legacy service_role key.
 */
export function keyProblems(key, value) {
  if (key !== 'VITE_SUPABASE_ANON_KEY' || !value || value.startsWith('sb_publishable_')) return []
  return [`${key} must be the publishable key (sb_publishable_...), not a legacy anon key`]
}

/** Checks the text of a dotenv file. Comments are checked too: a commented-out key is still committed. */
export function checkEnvText(text) {
  const problems = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const at = `line ${i + 1}`
    const line = raw.trim()
    for (const p of secretProblems(line)) problems.push(`${at}: ${p}`)
    if (!line || line.startsWith('#')) return
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=/.exec(line)
    if (!m) problems.push(`${at}: not a KEY=value line`)
    else if (!m[1].startsWith('VITE_')) problems.push(`${at}: ${m[1]} does not start with VITE_`)
    else {
      const value = line.slice(m[0].length).trim().replace(/^(['"])(.*)\1$/, '$2')
      for (const p of keyProblems(m[1], value)) problems.push(`${at}: ${p}`)
    }
  })
  return problems
}

/** Checks VITE_* variables passed to the build through the process environment (e.g. GitHub secrets). */
export function checkEnvVars(env) {
  return Object.entries(env)
    .filter(([key, value]) => key.startsWith('VITE_') && value)
    .flatMap(([key, value]) => [...secretProblems(value), ...keyProblems(key, value.trim())].map((p) => `${key}: ${p}`))
}

function main(args) {
  const files = args.length ? args : ['.env.production'].filter((f) => existsSync(f))
  const problems = [
    ...files.flatMap((f) => checkEnvText(readFileSync(f, 'utf8')).map((p) => `${f} ${p}`)),
    ...checkEnvVars(process.env).map((p) => `env ${p}`),
  ]
  if (problems.length) {
    console.error('Public config check FAILED. Only the Supabase URL and the publishable key may be public:')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('Remove any secret key. If one was pushed or shared, also revoke it in Supabase (Project Settings -> API Keys):')
    console.error('  - sb_secret_ key: create a new secret key, then delete the leaked one.')
    console.error('  - legacy service_role key: disable the legacy API keys (new keys do not revoke them).')
    process.exit(1)
  }
  console.log(`Public config check passed (${files.length ? files.join(', ') : 'no env files'}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
