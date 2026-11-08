import { describe, expect, it } from 'vitest'
import { effectiveEngine, orgScanEngine } from './engine'

// SPEC 7.19: the organisation's default reader, read tolerantly; Claude needs the network
describe('orgScanEngine', () => {
  it('reads the saved value, and Claude for anything else (an older server or backup has no column)', () => {
    expect(orgScanEngine('tesseract')).toBe('tesseract')
    expect(orgScanEngine('claude')).toBe('claude')
    expect(orgScanEngine(undefined)).toBe('claude')
    expect(orgScanEngine(null)).toBe('claude')
    expect(orgScanEngine('gemini')).toBe('claude')
  })
})

describe('effectiveEngine', () => {
  it('runs the chosen reader when online', () => {
    expect(effectiveEngine('claude', true)).toEqual({ engine: 'claude', fallback: null })
    expect(effectiveEngine('tesseract', true)).toEqual({ engine: 'tesseract', fallback: null })
  })

  it('offline, Claude falls back to the device and says why; the device reader is unaffected', () => {
    expect(effectiveEngine('claude', false)).toEqual({ engine: 'tesseract', fallback: 'offline' })
    expect(effectiveEngine('tesseract', false)).toEqual({ engine: 'tesseract', fallback: null })
  })
})
