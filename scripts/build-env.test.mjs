import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { describe, expect, it } from 'vitest'

// deploy.yml exports a GitHub secret only when it is non-empty, and a Mode Demo build (CI e2e, README) blanks both
// variables. Both rely on Vite letting any process env var, even an empty one, win over the committed .env.production.
const KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const FILE = 'VITE_SUPABASE_URL=https://fromfile.supabase.co\nVITE_SUPABASE_ANON_KEY=sb_publishable_fromfile\n'

function loadProductionEnv(processEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'woombad-env-'))
  const saved = KEYS.map((k) => [k, process.env[k]])
  try {
    writeFileSync(join(dir, '.env.production'), FILE)
    for (const k of KEYS) {
      if (k in processEnv) process.env[k] = processEnv[k]
      else delete process.env[k]
    }
    const env = loadEnv('production', dir)
    return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY }
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('build env priority (vite loadEnv)', () => {
  it('uses .env.production when the variables are not set', () => {
    expect(loadProductionEnv({})).toEqual({ url: 'https://fromfile.supabase.co', key: 'sb_publishable_fromfile' })
  })

  it('lets empty variables override the file, giving a Mode Demo build', () => {
    expect(loadProductionEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toEqual({ url: '', key: '' })
  })

  it('lets a non-empty variable (GitHub secret) override the file', () => {
    expect(loadProductionEnv({ VITE_SUPABASE_URL: 'https://fromsecret.supabase.co' })).toEqual({
      url: 'https://fromsecret.supabase.co',
      key: 'sb_publishable_fromfile',
    })
  })
})
