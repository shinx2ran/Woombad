import { describe, expect, it } from 'vitest'
import { SCAN_CATEGORIES, SCAN_SCHEMA, ScanOutputError, parseScanOutput } from './scan'

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
