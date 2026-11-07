import { describe, expect, it } from 'vitest'
import { SCAN_CATEGORIES, SCAN_SCHEMA, ScanOutputError, describeScanFailure, parseScanOutput } from './scan'

// SPEC 7.16: what Claude must return for a scanned expense record, and the strict check of what came back.
const line = (over: Record<string, unknown> = {}) => ({
  day: 17,
  month: 10,
  year: null,
  description: 'Kantong sampah 3 bungkus',
  written_text: '17/10 Kantong sampah 3bks = 30.000',
  amount: 30000,
  category: 'supplies',
  vendor: null,
  unclear: false,
  ...over,
})

describe('SCAN_SCHEMA (structured outputs)', () => {
  it('closes every object and requires every property, as structured outputs need', () => {
    const objects: Record<string, unknown>[] = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk)
      else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>
        if (o.type === 'object') objects.push(o)
        Object.values(o).forEach(walk)
      }
    }
    walk(SCAN_SCHEMA)
    expect(objects).toHaveLength(2)
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false)
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort())
    }
  })

  it('uses no numeric or string constraints (not supported) and only operating categories', () => {
    const json = JSON.stringify(SCAN_SCHEMA)
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf']) expect(json).not.toContain(`"${key}"`)
    expect(SCAN_CATEGORIES).not.toContain('deposit_refund')
    expect(SCAN_CATEGORIES).not.toContain('rent_refund')
  })
})

describe('parseScanOutput', () => {
  it('keeps a well-formed handwritten list as is (whitespace tidied)', () => {
    const out = parseScanOutput({ kind: 'expense_list', items: [line({ description: '  Kantong   sampah 3 bungkus ' })], written_total: 30000, notes: ' ' })
    expect(out).toEqual({ kind: 'expense_list', items: [line()], written_total: 30000, notes: '' })
  })

  it('a receipt: one item with the vendor', () => {
    const out = parseScanOutput({
      kind: 'receipt',
      items: [line({ day: 3, month: 11, year: 2026, description: 'Semen 2 sak', amount: 130000, category: 'maintenance', vendor: ' TB Sinar Jaya ' })],
      written_total: 130000,
      notes: '',
    })
    expect(out.items[0]).toMatchObject({ year: 2026, vendor: 'TB Sinar Jaya', category: 'maintenance' })
  })

  it('a date part outside the calendar becomes null (the app then asks for it); an unknown category becomes other', () => {
    const out = parseScanOutput({ kind: 'expense_list', items: [line({ day: 41, month: 13, year: 26, category: 'snacks' })], written_total: null, notes: '' })
    expect(out.items[0]).toMatchObject({ day: null, month: null, year: null, category: 'other' })
  })

  it('a zero or missing total is no total; an empty vendor is null', () => {
    const out = parseScanOutput({ kind: 'expense_list', items: [line({ vendor: '  ' })], written_total: 0, notes: '' })
    expect(out.written_total).toBeNull()
    expect(out.items[0].vendor).toBeNull()
  })

  it('an unreadable photo: no items, the reason in notes', () => {
    expect(parseScanOutput({ kind: 'unreadable', items: [], written_total: null, notes: 'Foto buram.' })).toEqual({ kind: 'unreadable', items: [], written_total: null, notes: 'Foto buram.' })
  })

  it('refuses what would put a wrong number in the books', () => {
    const bad = (items: unknown, kind: unknown = 'expense_list') => () => parseScanOutput({ kind, items, written_total: null, notes: '' })
    expect(bad([line({ amount: '30.000' })])).toThrow(ScanOutputError)
    expect(bad([line({ amount: 30000.5 })])).toThrow(ScanOutputError)
    expect(bad([line({ amount: -5 })])).toThrow(ScanOutputError)
    expect(bad([line({ day: '17' })])).toThrow(ScanOutputError)
    expect(bad([line({ description: 7 })])).toThrow(ScanOutputError)
    expect(bad('nope')).toThrow(ScanOutputError)
    expect(bad([], 'menu')).toThrow(ScanOutputError)
    expect(() => parseScanOutput(null)).toThrow(ScanOutputError)
  })
})

describe('describeScanFailure (what the person scanning is told)', () => {
  const api = (status: number, type: string | null = null, message: string | null = null) => describeScanFailure({ kind: 'api', status, type, message })
  it('credit used up says so, in both forms Anthropic sends it, so nobody keeps retaking photos', () => {
    expect(api(402, 'billing_error')).toMatchObject({ status: 503, error: 'not_configured', message: expect.stringContaining('Kredit API Claude habis') })
    expect(api(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')).toMatchObject({ error: 'not_configured', message: expect.stringContaining('Kredit') })
  })
  it('a wrong key or a model the key cannot use points the owner to the console', () => {
    expect(api(401, 'authentication_error')).toMatchObject({ status: 503, error: 'not_configured', message: expect.stringContaining('tidak valid') })
    expect(api(403, 'permission_error').error).toBe('not_configured')
    expect(api(404, 'not_found_error').message).toContain('Model Claude tidak tersedia')
    for (const reply of [api(401), api(402), api(404)]) expect(reply.message).toContain('platform.claude.com')
  })
  it('a personal key (not scoped to a workspace) asks the owner for a workspace key, never for a new photo', () => {
    // the 400 Anthropic sent on 7 Nov 2026 for a key created as a personal key in the new Console
    const personalKey =
      'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.'
    expect(api(400, 'invalid_request_error', personalKey)).toMatchObject({ status: 503, error: 'not_configured', message: expect.stringContaining('workspace') })
    expect(api(400, 'invalid_request_error', 'Invalid API key format')).toMatchObject({ error: 'not_configured', message: expect.stringContaining('Kunci API Claude') })
  })
  it('only a 400 about the image asks for a new photo', () => {
    expect(api(400, 'invalid_request_error', 'Could not process image')).toMatchObject({ status: 400, error: 'unreadable' })
    expect(api(400, 'invalid_request_error', 'messages.0.content.0.image.source.base64: image exceeds 5 MB maximum')).toMatchObject({ error: 'unreadable' })
    for (const other of [api(400, 'invalid_request_error', 'output_config.format: schema is too complex'), api(400)]) {
      expect(other).toMatchObject({ status: 502, error: 'upstream' })
      expect(other.message).not.toContain('Ambil ulang')
    }
  })
  it('busy, too large, other failures', () => {
    expect(api(429, 'rate_limit_error')).toMatchObject({ status: 429, error: 'busy' })
    expect(api(529, 'overloaded_error').error).toBe('busy')
    expect(api(413, 'request_too_large').error).toBe('too_large')
    expect(api(500, 'api_error')).toMatchObject({ status: 502, error: 'upstream' })
    expect(describeScanFailure({ kind: 'timeout' })).toMatchObject({ status: 504, error: 'timeout' })
    expect(describeScanFailure({ kind: 'connection' })).toMatchObject({ status: 502, error: 'upstream' })
    expect(describeScanFailure({ kind: 'other' })).toMatchObject({ status: 500, error: 'internal' })
  })
})
