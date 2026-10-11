// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ExportSheet } from '../../domain/export'
import { buildCsvBlob, buildXlsxBlob, safeSheetName, toXlsxCell, toXlsxSheet } from './exportFiles'

const sheet: ExportSheet = {
  name: 'Pembayaran',
  columns: [
    { key: 'paid_at', header: 'Tanggal', type: 'date' },
    { key: 'tenant', header: 'Penyewa', type: 'string' },
    { key: 'amount', header: 'Jumlah', type: 'money' },
    { key: 'qty', header: 'Qty', type: 'number' },
  ],
  rows: [
    { paid_at: '2026-03-05', tenant: 'Budi Santoso', amount: 1_250_000, qty: 1 },
    { paid_at: '2026-03-06', tenant: '-', amount: null, qty: 2 },
  ],
}

describe('toXlsxCell', () => {
  it('maps money to a formatted Number and dates to Date cells', () => {
    expect(toXlsxCell(1_250_000, 'money')).toEqual({ value: 1_250_000, type: Number, format: '#,##0' })
    expect(toXlsxCell(3, 'number')).toEqual({ value: 3, type: Number })
    const date = toXlsxCell('2026-03-05', 'date')
    expect(date?.type).toBe(Date)
    expect(date?.format).toBe('dd/mm/yyyy')
    expect(date?.value).toBeInstanceOf(Date)
    expect((date?.value as Date).getDate()).toBe(5)
    expect((date?.value as Date).getMonth()).toBe(2)
  })
  it('falls back to text for an unparsable date and null for empty cells', () => {
    expect(toXlsxCell('-', 'date')).toEqual({ value: '-', type: String })
    expect(toXlsxCell(null, 'money')).toBeNull()
    expect(toXlsxCell(undefined, 'string')).toBeNull()
  })
})

describe('toXlsxSheet', () => {
  it('writes a bold header row, one row per data row and column widths', () => {
    const out = toXlsxSheet(sheet)
    expect(out.sheet).toBe('Pembayaran')
    expect(out.data).toHaveLength(3)
    expect(out.data[0]).toEqual([
      { value: 'Tanggal', type: String, fontWeight: 'bold' },
      { value: 'Penyewa', type: String, fontWeight: 'bold' },
      { value: 'Jumlah', type: String, fontWeight: 'bold' },
      { value: 'Qty', type: String, fontWeight: 'bold' },
    ])
    expect(out.data[2]?.[2]).toBeNull()
    expect(out.columns).toHaveLength(4)
    expect(out.columns?.[1]?.width).toBe('Budi Santoso'.length + 2)
  })
})

describe('safeSheetName', () => {
  it('strips forbidden characters and truncates to 31', () => {
    expect(safeSheetName('A/B:C*D?E[F]G\\H')).toBe('A B C D E F G H')
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31)
    expect(safeSheetName('   ')).toBe('Lembar')
  })
})

describe('blobs', () => {
  it('buildCsvBlob produces UTF-8 CSV with the chosen delimiter', async () => {
    const blob = buildCsvBlob(sheet, ',')
    const bom = new Uint8Array(await blob.slice(0, 3).arrayBuffer())
    expect(Array.from(bom)).toEqual([0xef, 0xbb, 0xbf])
    const text = await blob.text()
    expect(text).toContain('Tanggal,Penyewa,Jumlah,Qty')
    expect(text).toContain('2026-03-05,Budi Santoso,1250000,1')
  })
  it('buildXlsxBlob returns a non-empty zip blob', async () => {
    const blob = await buildXlsxBlob([sheet, { ...sheet, name: 'Lagi' }])
    expect(blob.size).toBeGreaterThan(500)
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    // 'PK' zip signature
    expect(Array.from(head)).toEqual([0x50, 0x4b])
  })
})
