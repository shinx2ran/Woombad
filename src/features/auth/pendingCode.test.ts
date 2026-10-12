// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { clearPendingCode, readPendingCode, readPendingEntry, savePendingCode } from './pendingCode'

const DAY = 24 * 60 * 60 * 1000

describe('pendingCode', () => {
  afterEach(() => localStorage.clear())

  it('keeps the code until it is cleared', () => {
    expect(readPendingCode()).toBe('')
    savePendingCode('ABCD-EFGH', 1_000)
    expect(readPendingCode(1_000 + DAY)).toBe('ABCD-EFGH')
    clearPendingCode()
    expect(readPendingCode()).toBe('')
  })

  it('forgets a code older than seven days (the invitation has expired by then)', () => {
    savePendingCode('ABCD-EFGH', 0)
    expect(readPendingCode(7 * DAY)).toBe('ABCD-EFGH')
    expect(readPendingCode(7 * DAY + 1)).toBe('')
  })

  it('returns when the code was saved, so it can be put back unchanged', () => {
    expect(readPendingEntry()).toBeNull()
    savePendingCode('ABCD-EFGH', 5_000)
    expect(readPendingEntry(6_000)).toEqual({ code: 'ABCD-EFGH', savedAt: 5_000 })
    expect(readPendingEntry(5_000 + 7 * DAY + 1)).toBeNull()
  })

  it('reads a bare code written by an earlier build', () => {
    localStorage.setItem('woombad.pendingCode', 'WXYZ-2345')
    expect(readPendingCode()).toBe('WXYZ-2345')
  })
})
