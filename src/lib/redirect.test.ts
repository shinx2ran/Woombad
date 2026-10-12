import { describe, expect, it } from 'vitest'
import { DEFAULT_RETURN_PATH, safeReturnPath } from './redirect'

describe('safeReturnPath', () => {
  it('keeps same-origin, path-absolute locations including query and hash', () => {
    expect(safeReturnPath('/sewa/abc')).toBe('/sewa/abc')
    expect(safeReturnPath('/sewa/abc?action=bayar#top')).toBe('/sewa/abc?action=bayar#top')
    expect(safeReturnPath('/laporan?preset=monthly&from=2026-01-01')).toBe('/laporan?preset=monthly&from=2026-01-01')
  })

  it('rejects protocol-relative and backslash paths (open redirect)', () => {
    expect(safeReturnPath('//evil.example/x')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/\\evil.example/x')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/sewa\\..//evil.example')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('https://evil.example/x')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('javascript:alert(1)')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('evil.example')).toBe(DEFAULT_RETURN_PATH)
  })

  it('rejects whitespace and control characters', () => {
    expect(safeReturnPath('/sewa abc')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/sewa\n//evil.example')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/sewa\u0000')).toBe(DEFAULT_RETURN_PATH)
  })

  it('falls back for non-strings and auth pages', () => {
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath(42)).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath({ from: '/sewa' })).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/login')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/login?x=1')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/daftar')).toBe(DEFAULT_RETURN_PATH)
    expect(safeReturnPath('/reset-sandi')).toBe(DEFAULT_RETURN_PATH)
  })

  it('honours a custom fallback', () => {
    expect(safeReturnPath('//evil.example', '/kos')).toBe('/kos')
  })
})
