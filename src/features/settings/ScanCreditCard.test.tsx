// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../components/ui'
import type { Organization, ScanUsage } from '../../types/db'

// SPEC 7.17 Kredit Claude card: the estimate never shows the whole credit as left when the costs did not load; credit 0
// means prepaid credit only; a save sends only what changed.
const state: { org: Organization; repo: ReturnType<typeof fakeRepo> | null } = {
  org: { id: 'org-1', name: 'Kos', created_by: 'me', created_at: '2026-01-01T00:00:00Z' },
  repo: null,
}
vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: state.org, role: 'owner', isLocalMode: false, repo: state.repo }),
}))

import { ScanCreditCard } from './ScanCreditCard'

const scan = (id: string, cost: number | string): ScanUsage => ({
  id,
  org_id: 'org-1',
  user_id: 'me',
  created_at: new Date().toISOString(),
  model: 'claude-opus-5-5',
  input_tokens: 3000,
  output_tokens: 4000,
  cost_usd: cost,
  outcome: 'ok',
  kind: 'receipt',
  lines: 1,
  attempts: [],
})

function fakeRepo(scans: ScanUsage[] | Error) {
  return {
    mode: 'supabase' as const,
    orgId: 'org-1',
    list: vi.fn(async (table: string) => {
      if (table === 'scan_usage') {
        if (scans instanceof Error) throw scans
        return scans
      }
      return table === 'organization_members' ? [{ id: 'm1', org_id: 'org-1', user_id: 'me', email: 'pemilik@contoh.id', role: 'owner', created_at: '' }] : []
    }),
    raw: { update: vi.fn(async () => ({})) },
  }
}

function setup(scans: ScanUsage[] | Error, org: Partial<Organization> = {}) {
  state.org = { id: 'org-1', name: 'Kos', created_by: 'me', created_at: '2026-01-01T00:00:00Z', ...org }
  state.repo = fakeRepo(scans)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (ui: ReactNode) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  )
  render(wrap(<ScanCreditCard isLocalMode={false} />))
  return state.repo
}

describe('ScanCreditCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 7, 10))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('the credit left this cycle, from costs that may arrive as strings', async () => {
    setup([scan('a', 0.092), scan('b', '0.0875')])
    await waitFor(() => expect(screen.getByTestId('credit-cycle').textContent).toContain('2 scan · US$0,1795'))
    expect(screen.getByTestId('credit-remaining').textContent).toContain('US$99,82')
  })

  it('costs that fail to load never show as the whole credit left, nor as "no scans"', async () => {
    setup(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'))
    await waitFor(() => expect(screen.getByTestId('credit-load-error')).toBeTruthy())
    // the headline is a dash, not the monthly credit (which still shows as "dari US$100,00")
    expect(screen.getByTestId('credit-remaining').textContent).toContain('Sisa kredit (perkiraan)–dari US$100,00')
    expect(screen.queryByText(/Belum ada scan/)).toBeNull()
    expect(screen.queryByTestId('credit-empty')).toBeNull()
  })

  it('credit 0 = prepaid only: what the scans cost, no estimate and no "habis" warning', async () => {
    setup([scan('a', 0.092)], { claude_credit_monthly_usd: 0 })
    await waitFor(() => expect(screen.getByTestId('credit-remaining').textContent).toContain('Biaya scan siklus iniUS$0,092'))
    expect(screen.getByTestId('credit-remaining').textContent).toContain('Kredit prabayar')
    expect(screen.queryByTestId('credit-empty')).toBeNull()
  })

  it('a save sends only what changed: a credit with cents set elsewhere is not rounded', async () => {
    const repo = setup([], { claude_credit_monthly_usd: 100.4, claude_credit_renewal_day: 1 })
    await waitFor(() => expect(screen.getByTestId('credit-remaining').textContent).toContain('US$100,40'))
    fireEvent.change(screen.getByLabelText('Tanggal pembaruan'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(repo.raw.update).toHaveBeenCalledTimes(1))
    expect(repo.raw.update).toHaveBeenCalledWith('organizations', 'org-1', { claude_credit_renewal_day: 15 })
  })
})
