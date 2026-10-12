import { getSupabase, isSupabaseConfigured } from '../supabase'
import { LocalRepo } from './localRepo'
import { SupabaseRepo } from './supabaseRepo'
import type { Repo, RepoMode } from './types'

export * from './types'
export { LocalRepo } from './localRepo'
export { SupabaseRepo } from './supabaseRepo'

let instance: Repo | null = null

export const repoMode: RepoMode = isSupabaseConfigured ? 'supabase' : 'local'

/** Process-wide repository singleton; adapter chosen by presence of Supabase env vars. */
export function getRepo(): Repo {
  if (!instance) {
    instance = isSupabaseConfigured ? new SupabaseRepo(getSupabase()) : new LocalRepo()
  }
  return instance
}

/** Test helper: inject a repo (e.g. a fresh LocalRepo with in-memory data). */
export function setRepoForTests(repo: Repo | null) {
  instance = repo
}
