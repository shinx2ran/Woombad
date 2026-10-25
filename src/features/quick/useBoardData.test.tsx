// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const requested: string[] = []

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: 'org-1', name: 'Kos' }, properties: [], propertyFilterIds: [], financePropertyIds: [] }),
}))
vi.mock('../../hooks/useTable', () => ({
  useTable: (table: string) => {
    requested.push(table)
    return { data: [], isPending: false, isError: false, error: null }
  },
}))

import { useBoardData } from './useBoardData'
import { useDashboardData } from '../dashboard/useDashboardData'

function tablesOf(hook: () => unknown): Set<string> {
  requested.length = 0
  renderHook(hook)
  return new Set(requested)
}

afterEach(cleanup)

describe('useBoardData', () => {
  it('waits only for tables the Dashboard already loads, so the board appears with the stats and never pushes them down', () => {
    const board = tablesOf(useBoardData)
    const dashboard = tablesOf(useDashboardData)
    expect([...board].sort()).toEqual(['invoices', 'lease_addons', 'leases', 'payments', 'rooms', 'tenants'])
    for (const table of board) expect(dashboard.has(table)).toBe(true)
  })
})
