// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DataCard } from './DataCard'

describe('DataCard (online)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('keeps the Supabase address out of the main text, under "Detail"', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijkl.supabase.co')
    render(<DataCard isLocalMode={false} isAdmin={false} />)
    const main = screen.getByText(/Data tersimpan online/)
    expect(main.textContent).not.toContain('supabase.co')
    const host = screen.getByText('abcdefghijkl.supabase.co')
    expect(host.closest('details')?.querySelector('summary')?.textContent).toBe('Detail')
  })
})
