// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { KosShortcutCard } from './KosShortcutCard'

afterEach(cleanup)

const renderCard = (isAdmin: boolean) =>
  render(
    <MemoryRouter>
      <KosShortcutCard isAdmin={isAdmin} />
    </MemoryRouter>,
  )

describe('KosShortcutCard', () => {
  it('links owner/admin to Kos & Kamar, where Tambah Kos lives', () => {
    renderCard(true)
    const link = screen.getByRole('link', { name: /Kos & Kamar/ })
    expect(link.getAttribute('href')).toBe('/kos')
    expect(link.textContent).toContain('Tambah kos baru')
  })

  it('does not promise staff a Tambah kos they cannot use', () => {
    renderCard(false)
    const link = screen.getByRole('link', { name: /Kos & Kamar/ })
    expect(link.getAttribute('href')).toBe('/kos')
    expect(link.textContent).toContain('Lihat daftar kos dan kamar')
    expect(link.textContent).not.toContain('Tambah')
  })
})
