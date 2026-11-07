import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import type { ScanResult } from '../../../supabase/functions/scan-nota/scan.ts'

const invoke = vi.fn()
vi.mock('../../lib/supabase', () => ({ getSupabase: () => ({ functions: { invoke } }) }))

import {
  DEMO_SCAN_RESULT,
  ScanRequestError,
  buildScanRows,
  monthForUndatedLines,
  requestScan,
  resolveScanDate,
  scanRowError,
  scanTotalCheck,
  scannedExpenseDrafts,
  toScanError,
  totalToCheck,
} from './scanNota'

afterEach(() => invoke.mockReset())

// SPEC 7.16 Scan nota, the app side: dates, rows for checking, total check, and what is saved.
describe('resolveScanDate', () => {
  const today = '2026-11-07'
  it('a monthly page without a year: October read in November is this year', () => {
    expect(resolveScanDate({ day: 17, month: 10, year: null }, today)).toEqual({ date: '2026-10-17', monthGuessed: false })
    expect(resolveScanDate({ day: 28, month: 10, year: null }, today).date).toBe('2026-10-28')
  })

  it('December read in January belongs to last year', () => {
    expect(resolveScanDate({ day: 20, month: 12, year: null }, '2027-01-05').date).toBe('2026-12-20')
  })

  it('a line written a few days ahead keeps this year; further ahead it is last year', () => {
    expect(resolveScanDate({ day: 12, month: 11, year: null }, today).date).toBe('2026-11-12')
    expect(resolveScanDate({ day: 30, month: 11, year: null }, today).date).toBe('2025-11-30')
  })

  it('a line just after New Year read in late December is next year', () => {
    expect(resolveScanDate({ day: 2, month: 1, year: null }, '2026-12-28').date).toBe('2027-01-02')
    expect(resolveScanDate({ day: 20, month: 12, year: null }, '2026-12-28').date).toBe('2026-12-20')
  })

  it('a written year is kept', () => {
    expect(resolveScanDate({ day: 3, month: 1, year: 2027 }, today).date).toBe('2027-01-03')
  })

  it('no month: this month, or last month when the day is still ahead (also across a new year)', () => {
    expect(resolveScanDate({ day: 5, month: null, year: null }, today)).toEqual({ date: '2026-11-05', monthGuessed: true })
    expect(resolveScanDate({ day: 25, month: null, year: null }, today)).toEqual({ date: '2026-10-25', monthGuessed: true })
    expect(resolveScanDate({ day: 28, month: null, year: null }, '2027-01-03')).toEqual({ date: '2026-12-28', monthGuessed: true })
  })

  it('no day, or a day the month does not have: no date', () => {
    expect(resolveScanDate({ day: null, month: 10, year: null }, today).date).toBe('')
    expect(resolveScanDate({ day: 31, month: 9, year: null }, today).date).toBe('')
    expect(resolveScanDate({ day: 29, month: 2, year: 2026 }, today).date).toBe('')
  })
})

describe('one month for the lines without a month (a page is never split)', () => {
  const today = '2026-11-07'
  const noMonth = (day: number) => ({ day, month: null, year: null })
  it('a page with no month at all: last month for every line when any day is still ahead', () => {
    const items = [noMonth(2), noMonth(5), noMonth(12), noMonth(29)]
    expect(monthForUndatedLines(items, today)).toBe(10)
    const result = { kind: 'expense_list' as const, items: items.map((d) => ({ ...DEMO_SCAN_RESULT.items[0], ...d })), written_total: null, notes: '' }
    expect(buildScanRows(result, today, []).map((r) => r.date)).toEqual(['2026-10-02', '2026-10-05', '2026-10-12', '2026-10-29'])
  })
  it('the month the other lines name; null when every line has one', () => {
    expect(monthForUndatedLines([{ day: 3, month: 10 }, { day: 9, month: 10 }, noMonth(4)], today)).toBe(10)
    expect(monthForUndatedLines([{ day: 3, month: 10 }], today)).toBeNull()
    // only days up to today: this month (a receipt from earlier this month)
    expect(monthForUndatedLines([noMonth(4)], today)).toBe(11)
  })
})

describe('buildScanRows', () => {
  const today = '2026-11-07'
  it('one row per line, ticked; the unclear line is marked', () => {
    const rows = buildScanRows(DEMO_SCAN_RESULT, today, [])
    expect(rows).toHaveLength(8)
    expect(rows.every((r) => r.include)).toBe(true)
    expect(rows[0]).toMatchObject({ date: '2026-10-02', description: 'Token listrik bawah tangga', amount: 500000, category: 'utilities', vendor: '' })
    expect(rows.filter((r) => r.unclear).map((r) => r.date)).toEqual(['2026-10-18'])
  })

  it('a line already recorded (same date and amount) is shown but not ticked', () => {
    const rows = buildScanRows(DEMO_SCAN_RESULT, today, [{ id: 'x1', expense_date: '2026-10-12', amount: 650000 }])
    const internet = rows.find((r) => r.date === '2026-10-12')!
    expect(internet).toMatchObject({ include: false, duplicateOf: 'x1' })
    expect(rows.filter((r) => r.include)).toHaveLength(7)
  })

  it('one recorded expense answers for one line only; a refund to a tenant is never taken for a scanned cost', () => {
    const twice = { ...DEMO_SCAN_RESULT, items: [DEMO_SCAN_RESULT.items[3], DEMO_SCAN_RESULT.items[3]] }
    const rows = buildScanRows(twice, today, [{ id: 'x1', expense_date: '2026-10-14', amount: 20000 }])
    expect(rows.map((r) => [r.include, r.duplicateOf])).toEqual([
      [false, 'x1'],
      [true, null],
    ])
    const refund = buildScanRows(DEMO_SCAN_RESULT, today, [{ id: 'r1', expense_date: '2026-10-12', amount: 650000, category: 'deposit_refund' }])
    expect(refund.every((r) => r.include)).toBe(true)
  })

  it('the same amount on another day is not a duplicate', () => {
    const rows = buildScanRows(DEMO_SCAN_RESULT, today, [{ id: 'x1', expense_date: '2026-10-13', amount: 650000 }])
    expect(rows.every((r) => r.include)).toBe(true)
  })
})

describe('checks before saving', () => {
  it('scanRowError names what is missing', () => {
    expect(scanRowError({ date: '', amount: 1000, description: 'a' })).toBe('Isi tanggalnya.')
    expect(scanRowError({ date: '2026-10-01', amount: 0, description: 'a' })).toBe('Isi jumlahnya.')
    expect(scanRowError({ date: '2026-10-01', amount: 1000, description: '  ' })).toBe('Isi keterangannya.')
    expect(scanRowError({ date: '2026-10-01', amount: 1000, description: 'a' })).toBeNull()
  })

  it('scanTotalCheck counts every line read against the total on the paper', () => {
    const rows = buildScanRows(DEMO_SCAN_RESULT, '2026-11-07', [])
    expect(scanTotalCheck(rows, DEMO_SCAN_RESULT.written_total)).toEqual({ sum: 2098500, writtenTotal: 2098500, difference: 0 })
    rows[4].amount = 175900 // a misread
    expect(scanTotalCheck(rows, 2098500).difference).toBe(-900)
    expect(scanTotalCheck(rows, null).difference).toBe(0)
  })

  it('only a handwritten list is checked against its written total (a receipt total is the line itself)', () => {
    expect(totalToCheck({ kind: 'expense_list', written_total: 2098500 })).toBe(2098500)
    expect(totalToCheck({ kind: 'receipt', written_total: 130000 })).toBeNull()
    expect(totalToCheck({ kind: 'unreadable', written_total: null })).toBeNull()
  })

  it('scannedExpenseDrafts: only ticked lines, one kos for all, operating costs without a lease', () => {
    const rows = buildScanRows(DEMO_SCAN_RESULT, '2026-11-07', [])
    rows[1].include = false
    rows[0].vendor = ' PLN '
    const drafts = scannedExpenseDrafts(rows, 'P1')
    expect(drafts).toHaveLength(7)
    expect(drafts[0]).toEqual({
      expense_date: '2026-10-02',
      property_id: 'P1',
      lease_id: null,
      category: 'utilities',
      amount: 500000,
      description: 'Token listrik bawah tangga',
      vendor: 'PLN',
      receipt_path: null,
    })
    expect(scannedExpenseDrafts(rows, null).every((d) => d.property_id === null)).toBe(true)
  })
})

describe('requestScan (Edge Function "scan-nota")', () => {
  const image = { file: new File(['x'], 'nota.jpg', { type: 'image/jpeg' }), base64: 'eA==', mediaType: 'image/jpeg' as const }
  const okResult: ScanResult = { kind: 'receipt', items: [{ day: 3, month: 11, year: 2026, description: 'Semen', written_text: 'Semen 2 sak', amount: 130000, category: 'maintenance', vendor: 'TB Jaya', unclear: false }], written_total: 130000, notes: '' }

  it('sends the organisation and the photo; returns the checked result and what the scan cost (SPEC 7.17)', async () => {
    invoke.mockResolvedValue({ data: { result: okResult, model: 'claude-opus-5-5', cost: { cost_usd: 0.092, fell_back: false } }, error: null })
    await expect(requestScan('org-1', image)).resolves.toEqual({ result: okResult, cost: { cost_usd: 0.092, fell_back: false } })
    expect(invoke).toHaveBeenCalledWith('scan-nota', { body: { orgId: 'org-1', image: 'eA==', mediaType: 'image/jpeg' } })
  })

  it('an older function without a cost, or a malformed cost, still gives the result', async () => {
    invoke.mockResolvedValue({ data: { result: okResult, model: 'claude-opus-5-5' }, error: null })
    await expect(requestScan('org-1', image)).resolves.toEqual({ result: okResult, cost: null })
    invoke.mockResolvedValue({ data: { result: okResult, cost: { cost_usd: 'lots' } }, error: null })
    await expect(requestScan('org-1', image)).resolves.toEqual({ result: okResult, cost: null })
  })

  it("shows the function's own message (e.g. no key installed yet)", async () => {
    const response = new Response(JSON.stringify({ error: 'not_configured', message: 'Scan nota belum aktif: …' }), { status: 503 })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) })
    await expect(requestScan('org-1', image)).rejects.toMatchObject({ code: 'not_configured', message: 'Scan nota belum aktif: …' })
  })

  it('a function that is not deployed, no connection, or a broken answer each get a plain message', async () => {
    expect(await toScanError(new FunctionsHttpError(new Response('Not found', { status: 404 })))).toMatchObject({ code: 'not_deployed' })
    // the gateway's own JSON (English) is never shown as it is
    const gateway404 = new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), { status: 404 })
    expect(await toScanError(new FunctionsHttpError(gateway404))).toMatchObject({ code: 'not_deployed' })
    const gateway546 = new Response(JSON.stringify({ code: 'WORKER_LIMIT', message: 'Function failed due to not having enough compute resources' }), { status: 546 })
    expect(await toScanError(new FunctionsHttpError(gateway546))).toMatchObject({ code: 'upstream', message: 'Server tidak dapat membaca foto saat ini. Coba lagi.' })
    expect(await toScanError(new FunctionsFetchError(new TypeError('Failed to fetch')))).toMatchObject({ code: 'offline' })
    invoke.mockResolvedValue({ data: { result: { kind: 'receipt', items: [{ amount: 'lots' }] } }, error: null })
    const err = await requestScan('org-1', image).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ScanRequestError)
    expect((err as ScanRequestError).code).toBe('upstream')
  })
})
