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
 * holds decoded logos (null = nothing to show: demo mode, missing file or a failed download, which is
 * retried after RETRY_AFTER_MS), `pending` dedupes concurrent loads of the same path.
 */
const settled = new Map<string, LogoEntry | null>()
const pending = new Map<string, Promise<void>>()
const FETCH_TIMEOUT_MS = 8_000
const RETRY_AFTER_MS = 30_000

async function fetchLogo(repo: OrgRepo, path: string): Promise<LogoEntry | null> {
  const url = await repo.getFileUrl('logos', path)
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const blob = await res.blob()
    const image = await loadLogoImage(blob)
    return { image, url: URL.createObjectURL(blob) }
  } finally {
    clearTimeout(timer)
  }
}

function ensureLoaded(repo: OrgRepo, path: string): Promise<void> {
  const inFlight = pending.get(path)
  if (inFlight) return inFlight
  const task = fetchLogo(repo, path)
    .catch(() => null)
    .then((entry) => {
      settled.set(path, entry)
      if (!entry) {
        setTimeout(() => {
          if (settled.get(path) === null) settled.delete(path)
        }, RETRY_AFTER_MS)
      }
    })
    .finally(() => pending.delete(path))
  pending.set(path, task)
  return task
}

/** Forgets a path (after the logo was replaced or removed) and frees its decoded image. */
export function clearKosLogoCache(path: string | null | undefined) {
  if (!path) return
  const entry = settled.get(path)
  settled.delete(path)
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
 * null so an invoice still renders without the logo.
 */
export function useKosLogo(property: Property | null | undefined): KosLogo {
  const { repo } = useOrg()
  const path = property?.logo_path ?? null
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!path || settled.has(path)) return
    let cancelled = false
    void ensureLoaded(repo, path).then(() => {
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [path, repo])

  const entry = path ? (settled.get(path) ?? null) : null
  return { logo: entry?.image ?? null, logoUrl: entry?.url ?? null, loading: path !== null && !settled.has(path) }
}
