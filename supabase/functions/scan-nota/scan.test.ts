import { describe, expect, it } from 'vitest'
import {
  SCAN_CATEGORIES,
  SCAN_SCHEMA,
  ScanOutputError,
  describeScanFailure,
  parseScanCostReply,
  parseScanOutput,
  scanCost,
  scanUsageRow,
  type CostInput,
} from './scan'

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

// SPEC 7.17: what a scan cost. Prices per million tokens: Opus 5.5 $4 in / $20 out; Opus 5 and Opus 4.8 $5 / $25.
describe('scanCost', () => {
  const text = { type: 'text' }
  const reply = (over: Partial<CostInput> = {}): CostInput => ({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [text],
    usage: { input_tokens: 3000, output_tokens: 4000 },
    ...over,
  })
  const fallbackBlock = (category: string | null) => ({ type: 'fallback', trigger: { type: 'refusal', category } })

  it('one attempt on Opus 5.5: 3,000 in × $4 + 4,000 out × $20 per million = US$0.092', () => {
    const cost = scanCost(reply(), 'claude-opus-5-5')
    expect(cost).toMatchObject({ cost_usd: 0.092, input_tokens: 3000, output_tokens: 4000, model: 'claude-opus-5-5', fell_back: false })
    expect(cost.attempts).toEqual([
      { kind: 'message', model: 'claude-opus-5-5', input_tokens: 3000, output_tokens: 4000, cache_write_tokens: 0, cache_read_tokens: 0, billed: true, priced: true, cost_usd: 0.092 },
    ])
  })

  it('a dated model id is priced as its base model', () => {
    expect(scanCost(reply({ model: 'claude-opus-5-5-20261101' }), 'claude-opus-5-5')).toMatchObject({ cost_usd: 0.092, model: 'claude-opus-5-5' })
  })

  it('a fallback adds up every attempt at its own price; the top-level usage is not added on top', () => {
    const res = reply({
      model: 'claude-opus-5',
      content: [fallbackBlock('bio'), text],
      usage: {
        input_tokens: 2500,
        output_tokens: 3000,
        iterations: [
          { type: 'message', model: null, input_tokens: 2500, output_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2500, output_tokens: 3000 },
        ],
      },
    })
    // bio declines before output are billed: 2,500 × $4 = $0.01; Opus 5 serves: 2,500 × $5 + 3,000 × $25 = $0.0875
    const cost = scanCost(res, 'claude-opus-5-5')
    expect(cost).toMatchObject({ cost_usd: 0.0975, input_tokens: 5000, output_tokens: 3000, model: 'claude-opus-5', fell_back: true })
    expect(cost.attempts.map((a) => [a.model, a.declined, a.billed, a.cost_usd])).toEqual([
      ['claude-opus-5-5', 'bio', true, 0.01],
      ['claude-opus-5', undefined, true, 0.0875],
    ])
  })

  it('a decline before any output in an unbilled category costs nothing', () => {
    const res = reply({
      model: 'claude-opus-5',
      content: [fallbackBlock('cyber'), text],
      usage: {
        input_tokens: 2500,
        output_tokens: 3000,
        iterations: [
          { type: 'message', model: null, input_tokens: 2500, output_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2500, output_tokens: 3000 },
        ],
      },
    })
    expect(scanCost(res, 'claude-opus-5-5')).toMatchObject({ cost_usd: 0.0875, input_tokens: 2500, output_tokens: 3000 })
  })

  it('a decline after some output is billed whatever its category', () => {
    const res = reply({
      model: 'claude-opus-5',
      content: [fallbackBlock('cyber'), text],
      usage: {
        input_tokens: 2500,
        output_tokens: 3000,
        iterations: [
          { type: 'message', model: null, input_tokens: 2000, output_tokens: 500 },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2500, output_tokens: 3000 },
        ],
      },
    })
    // 2,000 × $4 + 500 × $20 = $0.018, plus $0.0875
    expect(scanCost(res, 'claude-opus-5-5').cost_usd).toBe(0.1055)
  })

  it('a refusal with no fallback: free in an unbilled category, billed in a billed one or without a known reason', () => {
    const refused = (category: string | null | undefined) =>
      scanCost(reply({ stop_reason: 'refusal', stop_details: category === undefined ? null : { category }, content: [], usage: { input_tokens: 2500, output_tokens: 0 } }), 'claude-opus-5-5')
    expect(refused('cyber').cost_usd).toBe(0)
    expect(refused('bio').cost_usd).toBe(0.01)
    expect(refused('cyber').attempts[0]).toMatchObject({ declined: 'cyber', billed: false })
  })

  it('a model missing from the price table is priced at the dearest entry and marked', () => {
    const cost = scanCost(reply({ model: 'claude-future-9', usage: { input_tokens: 1000, output_tokens: 1000 } }), 'claude-opus-5-5')
    // 1,000 × $5 + 1,000 × $25 = $0.03
    expect(cost.cost_usd).toBe(0.03)
    expect(cost.attempts[0].priced).toBe(false)
  })

  it('cache writes and reads are priced at their own rates', () => {
    const cost = scanCost(
      reply({ usage: { input_tokens: 1000, output_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 } }),
      'claude-opus-5-5',
    )
    // 1,000 × $4 + 1,000 × $5 (5-minute write) + 10,000 × $0.20 = $0.011
    expect(cost).toMatchObject({ cost_usd: 0.011, input_tokens: 12000 })
  })
})

describe('scanUsageRow and parseScanCostReply', () => {
  const cost = scanCost(
    { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text' }], usage: { input_tokens: 3000, output_tokens: 4000 } },
    'claude-opus-5-5',
  )
  it('a scan that was read records what it read; a failed one records only its cost', () => {
    expect(scanUsageRow('o1', 'u1', cost, 'ok', { kind: 'expense_list', items: [line(), line()] as never })).toMatchObject({
      org_id: 'o1',
      user_id: 'u1',
      model: 'claude-opus-5-5',
      cost_usd: 0.092,
      outcome: 'ok',
      kind: 'expense_list',
      lines: 2,
    })
    expect(scanUsageRow('o1', 'u1', cost, 'refused', null)).toMatchObject({ outcome: 'refused', kind: null, lines: null, cost_usd: 0.092 })
  })
  it('the app trusts only a well-formed cost', () => {
    expect(parseScanCostReply({ cost_usd: 0.092, fell_back: false })).toEqual({ cost_usd: 0.092, fell_back: false })
    expect(parseScanCostReply({ cost_usd: 0 })).toEqual({ cost_usd: 0, fell_back: false })
    for (const bad of [undefined, null, 'x', { cost_usd: -1 }, { cost_usd: Number.NaN }, { cost_usd: '0.09' }]) expect(parseScanCostReply(bad)).toBeNull()
  })
})
