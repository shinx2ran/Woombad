/** Backup reminder state (per device, localStorage) and the Mode Demo persistent-storage request. */
import { useSyncExternalStore } from 'react'
import { isSupabaseConfigured } from '../../../lib/supabase'

// Per mode: a phone that ran Mode Demo keeps its localStorage when the same address switches to online mode.
export const LAST_BACKUP_KEY = `woombad.lastBackupAt.${isSupabaseConfigured ? 'online' : 'demo'}`
export const REMINDER_SNOOZE_KEY = 'woombad.backupReminderSnoozedAt'
export const BACKUP_REMINDER_DAYS = 7
/** a dismissed banner comes back after this many days if there is still no backup */
export const REMINDER_SNOOZE_DAYS = 3

const CHANGE_EVENT = 'woombad:backup-changed'
const DAY_MS = 24 * 60 * 60 * 1000

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* storage full or blocked: the reminder simply shows again */
  }
}

function validTime(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

export function readLastBackupAt(): string | null {
  const value = read(LAST_BACKUP_KEY)
  return validTime(value) === null ? null : value
}

/** Call after every successful backup download on this device. */
export function markBackupDone(now: Date = new Date()): void {
  write(LAST_BACKUP_KEY, now.toISOString())
  globalThis.dispatchEvent?.(new Event(CHANGE_EVENT))
}

/** Whole days since `iso` (0 = less than a day), or null when unknown. */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  const t = validTime(iso)
  if (t === null) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

/** True when there was never a backup on this device or the last one is older than `days`. */
export function isBackupDue(lastBackupAt: string | null, now: Date = new Date(), days = BACKUP_REMINDER_DAYS): boolean {
  const t = validTime(lastBackupAt)
  return t === null || now.getTime() - t > days * DAY_MS
}

export function isReminderSnoozed(now: Date = new Date()): boolean {
  const t = validTime(read(REMINDER_SNOOZE_KEY))
  return t !== null && now.getTime() - t < REMINDER_SNOOZE_DAYS * DAY_MS
}

export function snoozeReminder(now: Date = new Date()): void {
  write(REMINDER_SNOOZE_KEY, now.toISOString())
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener?.(CHANGE_EVENT, onChange)
  globalThis.addEventListener?.('storage', onChange)
  return () => {
    globalThis.removeEventListener?.(CHANGE_EVENT, onChange)
    globalThis.removeEventListener?.('storage', onChange)
  }
}

/** Last backup time on this device; re-renders when a backup is downloaded (also from another tab). */
export function useLastBackupAt(): string | null {
  return useSyncExternalStore(subscribe, readLastBackupAt, () => null)
}

let persistRequest: Promise<boolean> | null = null

/**
 * Ask the browser not to evict Mode Demo data under storage pressure (Safari/Chrome may otherwise clear it).
 * Runs once per app start; failures and unsupported browsers are ignored.
 */
export function requestPersistentStorage(): Promise<boolean> {
  persistRequest ??= (async () => {
    try {
      const storage = globalThis.navigator?.storage
      if (!storage || typeof storage.persist !== 'function') return false
      if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
      return await storage.persist()
    } catch {
      return false
    }
  })()
  return persistRequest
}

/** Test helper. */
export function resetPersistRequestForTests(): void {
  persistRequest = null
}
