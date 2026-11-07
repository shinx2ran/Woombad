// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const requested: string[] = []

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, properties: [], propertyFilterIds: [], financePropertyIds: [] }),
}))
/** per-table query state for a test; the default is a loaded, empty table */
const states: Record<string, { data?: unknown[]; isPending?: boolean; isError?: boolean; error?: unknown }> = {}
vi.mock('../../hooks/useTable', () => ({
  useTable: (table: string) => {
    requested.push(table)
    return { data: [], isPending: false, isError: false, error: null, ...states[table] }
  },
}))

import { useBoardData } from './useBoardData'
import { useDashboardData } from '../dashboard/useDashboardData'

function tablesOf(hook: () => unknown): Set<string> {
  requested.length = 0
  renderHook(hook)
  return new Set(requested)
}

afterEach(() => {
  cleanup()
  for (const k of Object.keys(states)) delete states[k]
})

describe('useBoardData', () => {
  it('waits only for tables the Dashboard already loads, so the board appears with the stats and never pushes them down', () => {
    const board = tablesOf(useBoardData)
    const dashboard = tablesOf(useDashboardData)
    expect([...board].sort()).toEqual(['invoices', 'lease_addons', 'leases', 'payments', 'rooms', 'tenants'])
    for (const table of board) expect(dashboard.has(table)).toBe(true)
  })
})

// SPEC 7.18: a failed background refresh (phone back from WhatsApp, offline for a moment) must not unmount the board and
// the summary sheet with the owner's edits; TanStack Query keeps the cached rows and sets isError on a failed refetch.
describe('useBoardData and useDashboardData: when a query error is fatal', () => {
  it('an error with cached rows is not fatal: the board and the page keep what they show', () => {
    states.payments = { isError: true, error: new Error('Failed to fetch'), data: [] }
    expect(renderHook(useBoardData).result.current.error).toBeUndefined()
    expect(renderHook(useDashboardData).result.current.error).toBeNull()
  })

  it('an error without any data is fatal, as before', () => {
    states.payments = { isError: true, error: new Error('Failed to fetch'), data: undefined }
    expect(renderHook(useBoardData).result.current.error).toBeInstanceOf(Error)
    expect(renderHook(useDashboardData).result.current.error).toBeInstanceOf(Error)
  })
})
