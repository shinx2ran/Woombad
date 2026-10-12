import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_BACKUP_KEY,
  daysSince,
  isBackupDue,
  isReminderSnoozed,
  markBackupDone,
  readLastBackupAt,
  requestPersistentStorage,
  resetPersistRequestForTests,
  snoozeReminder,
} from './backupReminder'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const now = new Date('2026-10-12T10:00:00.000Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('isBackupDue / daysSince', () => {
  it('is due when there was never a backup or it is unreadable', () => {
    expect(isBackupDue(null, now)).toBe(true)
    expect(isBackupDue('kemarin', now)).toBe(true)
    expect(daysSince(null, now)).toBeNull()
  })

  it('is due only after more than 7 days', () => {
    expect(isBackupDue(daysAgo(0), now)).toBe(false)
    expect(isBackupDue(daysAgo(7), now)).toBe(false)
    expect(isBackupDue(daysAgo(7.01), now)).toBe(true)
    expect(isBackupDue(daysAgo(30), now)).toBe(true)
    expect(daysSince(daysAgo(7.5), now)).toBe(7)
    expect(daysSince(daysAgo(0.2), now)).toBe(0)
  })

  it('never reports negative days for a clock that went backwards', () => {
    expect(daysSince(daysAgo(-2), now)).toBe(0)
  })
})

describe('stored reminder state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('remembers the last backup and notifies listeners', () => {
    const listener = vi.fn()
    const target = new EventTarget()
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
    vi.stubGlobal('dispatchEvent', target.dispatchEvent.bind(target))
    globalThis.addEventListener('woombad:backup-changed', listener)
    expect(readLastBackupAt()).toBeNull()
    markBackupDone(now)
    expect(readLastBackupAt()).toBe(now.toISOString())
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores a corrupt stored value', () => {
    localStorage.setItem(LAST_BACKUP_KEY, 'rusak')
    expect(readLastBackupAt()).toBeNull()
  })

  it('snoozes the banner for three days', () => {
    expect(isReminderSnoozed(now)).toBe(false)
    snoozeReminder(new Date(daysAgo(2)))
    expect(isReminderSnoozed(now)).toBe(true)
    snoozeReminder(new Date(daysAgo(3)))
    expect(isReminderSnoozed(now)).toBe(false)
  })

  it('survives blocked storage (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => markBackupDone(now)).not.toThrow()
    expect(readLastBackupAt()).toBeNull()
    expect(isReminderSnoozed(now)).toBe(false)
    expect(() => snoozeReminder(now)).not.toThrow()
  })
})

describe('requestPersistentStorage', () => {
  beforeEach(() => resetPersistRequestForTests())
  afterEach(() => {
    vi.unstubAllGlobals()
    resetPersistRequestForTests()
  })

  it('asks once per app start and skips the request when storage is already persistent', async () => {
    const persist = vi.fn(async () => true)
    const persisted = vi.fn(async () => false)
    vi.stubGlobal('navigator', { storage: { persist, persisted } })
    await expect(requestPersistentStorage()).resolves.toBe(true)
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)

    resetPersistRequestForTests()
    persisted.mockResolvedValue(true)
    await requestPersistentStorage()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('ignores unsupported browsers and failures', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestPersistentStorage()).resolves.toBe(false)
    resetPersistRequestForTests()
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('denied')) } })
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})
