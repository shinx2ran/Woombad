import { afterEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_ERROR_MESSAGE, errorMessage, isNetworkError } from './networkError'

describe('networkError', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognises fetch failures from every browser and the translated message', () => {
    for (const message of [
      'TypeError: Load failed',
      'TypeError: Failed to fetch',
      'TypeError: NetworkError when attempting to fetch resource.',
      NETWORK_ERROR_MESSAGE,
    ]) {
      expect(isNetworkError(new Error(message))).toBe(true)
      expect(errorMessage(new Error(message), 'x')).toBe(NETWORK_ERROR_MESSAGE)
    }
  })

  it('passes server messages through and falls back for non-errors', () => {
    expect(isNetworkError(new Error('Kode tidak valid atau sudah kedaluwarsa.'))).toBe(false)
    expect(errorMessage(new Error('Kode tidak valid atau sudah kedaluwarsa.'), 'x')).toBe('Kode tidak valid atau sudah kedaluwarsa.')
    expect(errorMessage('oops', 'Gagal.')).toBe('Gagal.')
  })

  it('treats any failure while offline as a network error', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isNetworkError(new Error('anything'))).toBe(true)
  })
})
