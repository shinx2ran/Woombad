import { todayISO } from '../lib/format'

/** localStorage key of the Mode Demo database (same key as src/lib/repo/localRepo.ts). */
export const LOCAL_DB_KEY = 'woombad.local.db.v1'

/** Raw Mode Demo data stored on this device, or null when there is none (or storage is blocked). */
export function readDeviceData(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCAL_DB_KEY) ?? null
  } catch {
    return null
  }
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
