import { useEffect, useState } from 'react'
import { useOrg } from '../../hooks/useOrg'
import type { OrgRepo } from '../../lib/repo/types'
import type { Property } from '../../types/db'
import { loadLogoImage, type LogoImage } from './renderInvoiceImage'

interface LogoEntry {
  image: LogoImage
  /** object URL of the downloaded blob, for <img> previews */
  url: string
}

/**
 * Logos per storage path, module-level so the invoice modal and the kos page reopen instantly: `settled`
 * holds decoded logos (null = nothing to show: demo mode, missing file or a failed download), `failedAt`
 * marks the nulls that came from a failure (loaded again on a later render after RETRY_AFTER_MS, while the
 * invoice keeps rendering without the logo), `pending` dedupes concurrent loads of the same path.
 */
const settled = new Map<string, LogoEntry | null>()
const failedAt = new Map<string, number>()
const pending = new Map<string, Promise<void>>()
/** the signed URL request and the download together; a logo is small, and the invoice must not wait longer */
const LOAD_TIMEOUT_MS = 8_000
const RETRY_AFTER_MS = 30_000

async function fetchLogo(repo: OrgRepo, path: string, signal: AbortSignal): Promise<LogoEntry | null> {
  const url = await repo.getFileUrl('logos', path)
  if (!url || signal.aborted) return null
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const image = await loadLogoImage(blob)
  return { image, url: URL.createObjectURL(blob) }
}

function ensureLoaded(repo: OrgRepo, path: string): Promise<void> {
  const inFlight = pending.get(path)
  if (inFlight) return inFlight
  const controller = new AbortController()
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout'))))
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)
  const task = Promise.race([fetchLogo(repo, path, controller.signal), timedOut])
    .then((entry) => {
      settled.set(path, entry)
      // demo mode has no file storage: nothing to retry there
      if (entry || repo.mode === 'local') failedAt.delete(path)
      else failedAt.set(path, Date.now())
    })
    .catch(() => {
      settled.set(path, null)
      failedAt.set(path, Date.now())
    })
    .finally(() => {
      clearTimeout(timer)
      pending.delete(path)
    })
  pending.set(path, task)
  return task
}

/** Forgets a path (after the logo was replaced or removed) and frees its decoded image. */
export function clearKosLogoCache(path: string | null | undefined) {
  if (!path) return
  const entry = settled.get(path)
  settled.delete(path)
  failedAt.delete(path)
  if (!entry) return
  URL.revokeObjectURL(entry.url)
  if ('close' in entry.image) entry.image.close()
}

export interface KosLogo {
  /** decoded logo for canvas drawImage, null when the kos has none (or it could not be loaded) */
  logo: LogoImage | null
  /** object URL of the same logo for an <img> */
  logoUrl: string | null
  /** true while the logo is being downloaded for the first time */
  loading: boolean
}

/**
 * The kos logo (bucket `logos`, Property.logo_path) decoded for the invoice renderer and as an object URL
 * for previews. Demo mode has no file storage, so the result is null there; download errors also yield
 * null so an invoice still renders without the logo, and the download is tried again on a later render.
 */
export function useKosLogo(property: Property | null | undefined): KosLogo {
  const { repo } = useOrg()
  const path = property?.logo_path ?? null
  // bumped after every load so the effect runs again: a failed load then schedules the next try
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      ensureLoaded(repo, path).then(() => {
        if (!cancelled) setVersion((v) => v + 1)
      })
    const failed = failedAt.get(path)
    if (!settled.has(path)) void load()
    else if (failed !== undefined) timer = setTimeout(() => void load(), Math.max(0, RETRY_AFTER_MS - (Date.now() - failed)))
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [path, repo, version])

  const entry = path ? (settled.get(path) ?? null) : null
  return { logo: entry?.image ?? null, logoUrl: entry?.url ?? null, loading: path !== null && !settled.has(path) }
}
