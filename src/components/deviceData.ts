import { todayISO } from '../lib/format'
import { TABLE_NAMES } from '../types/db'

import { STORAGE_KEY } from '../lib/repo/localRepo'

/** localStorage key of the Mode Demo database. */
export const LOCAL_DB_KEY = STORAGE_KEY

/** Raw Mode Demo data stored on this device, or null when there is none (or storage is blocked). */
export function readDeviceData(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCAL_DB_KEY) ?? null
  } catch {
    return null
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Why the stored Mode Demo data cannot be opened, or null when it can (or nothing is stored). Without this
 * check the app would read such data as empty and replace it with sample data on start.
 */
export function deviceDataProblem(raw: string | null): string | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return 'Data di perangkat ini bukan JSON yang valid.'
  }
  if (!isPlainObject(data)) return 'Data di perangkat ini tidak berisi tabel.'
  let hasRows = false
  for (const table of TABLE_NAMES) {
    const rows = data[table]
    if (rows === undefined) continue
    if (!Array.isArray(rows) || !rows.every(isPlainObject)) return `Tabel "${table}" di perangkat ini rusak.`
    if (rows.length > 0) hasRows = true
  }
  const orgs = data.organizations
  if (hasRows && (!Array.isArray(orgs) || orgs.length === 0)) return 'Data organisasi di perangkat ini hilang.'
  return null
}

export function clearDeviceData(): void {
  try {
    globalThis.localStorage?.removeItem(LOCAL_DB_KEY)
  } catch {
    /* storage blocked: nothing to clear */
  }
}

/** 'woombad-<name>-YYYY-MM-DD.json' (local date). */
export function datedFileName(name: string, now: Date = new Date()): string {
  return `woombad-${name}-${todayISO(now)}.json`
}

/** Trigger a browser download of `text` through a temporary <a download>. */
export function downloadText(text: string, fileName: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a moment to start the download before revoking
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
