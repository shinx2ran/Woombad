// Pre-build safety check: .env.production (committed) and the VITE_* build variables end up public, in the repository
// and in the JS bundle, so they may hold only the Supabase URL and the publishable/anon key. Fails on secret keys.
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
  })
  return problems
}

/** Checks VITE_* variables passed to the build through the process environment (e.g. GitHub secrets). */
export function checkEnvVars(env) {
  return Object.entries(env)
    .filter(([key, value]) => key.startsWith('VITE_') && value)
    .flatMap(([key, value]) => secretProblems(value).map((p) => `${key}: ${p}`))
}

function main(args) {
  const files = args.length ? args : ['.env.production'].filter((f) => existsSync(f))
  const problems = [
    ...files.flatMap((f) => checkEnvText(readFileSync(f, 'utf8')).map((p) => `${f} ${p}`)),
    ...checkEnvVars(process.env).map((p) => `env ${p}`),
  ]
  if (problems.length) {
    console.error('Public config check FAILED. Only the Supabase URL and publishable/anon key may be public:')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('Remove the secret, and rotate it in Supabase (Project Settings -> API Keys) if it was pushed.')
    process.exit(1)
  }
  console.log(`Public config check passed (${files.length ? files.join(', ') : 'no env files'}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
