// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FirstRunChecklist } from './FirstRunChecklist'

const empty = { properties: 0, rooms: 0, leases: 0 }

function renderChecklist(props: Parameters<typeof FirstRunChecklist>[0]) {
  render(
    <MemoryRouter>
      <FirstRunChecklist {...props} />
    </MemoryRouter>,
  )
}

describe('FirstRunChecklist', () => {
  afterEach(cleanup)

  it('online, an owner/admin without any kos is first sent to the Mode Demo import', () => {
    renderChecklist({ totals: empty, isAdmin: true, isOnline: true })
    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('Punya data dari Mode Demo? Pindahkan dulu')
    expect(screen.getByRole('link', { name: 'Impor dari Mode Demo' }).getAttribute('href')).toBe('/pengaturan?impor=demo')
    expect(items[1].textContent).toContain('Tambah kos')
    expect(screen.queryByText(/Tiga langkah/)).toBeNull()
  })

  it('leaves the import out in Mode Demo, for staff and once a kos exists', () => {
    renderChecklist({ totals: empty, isAdmin: true, isOnline: false })
    expect(screen.queryByText(/Mode Demo/)).toBeNull()
    expect(screen.getByText(/Tiga langkah/)).toBeTruthy()
    cleanup()
    renderChecklist({ totals: empty, isAdmin: false, isOnline: true })
    expect(screen.queryByText(/Mode Demo/)).toBeNull()
    cleanup()
    renderChecklist({ totals: { properties: 1, rooms: 0, leases: 0 }, isAdmin: true, isOnline: true })
    expect(screen.queryByText(/Mode Demo/)).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
