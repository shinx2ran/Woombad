/**
 * File writing for the export panel: turns `ExportSheet`s (src/domain/export.ts) into XLSX cell rows for
 * write-excel-file, or CSV text, and triggers browser downloads. Pure except `downloadBlob`.
 */
import type { CellObject, Row, Sheet, SheetData } from 'write-excel-file/browser'
import type { ExportCell, ExportSheet } from '../../domain/export'
import { toCsv } from '../../domain/export'
import { parseISODate } from '../../domain/period'

export type CsvDelimiter = ';' | ','

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_MIME = 'text/csv;charset=utf-8'

export const MONEY_FORMAT = '#,##0'
export const DATE_FORMAT = 'dd/mm/yyyy'

/** Excel sheet names: max 31 characters, none of []:*?/\ . */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim()
  return (cleaned === '' ? 'Lembar' : cleaned).slice(0, 31)
}

/**
 * One cell for write-excel-file: money -> Number '#,##0'; date -> Date 'dd/mm/yyyy' (invalid or empty
 * date strings fall back to text); number -> Number; string -> String. null -> empty cell.
 */
export function toXlsxCell(cell: ExportCell | undefined, type: ExportSheet['columns'][number]['type']): CellObject | null {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'number') {
    return type === 'money' ? { value: cell, type: Number, format: MONEY_FORMAT } : { value: cell, type: Number }
  }
  if (type === 'date') {
    try {
      return { value: parseISODate(cell), type: Date, format: DATE_FORMAT }
    } catch {
      return { value: cell, type: String }
    }
  }
  return { value: cell, type: String }
}

/** Header row (bold) + one row per data row, columns in sheet order; widths derived from the header text. */
export function toXlsxSheet(sheet: ExportSheet): Sheet<Blob> {
  const header: Row = sheet.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' }))
  const data: SheetData = [header]
  for (const row of sheet.rows) {
    data.push(sheet.columns.map((c) => toXlsxCell(row[c.key], c.type)))
  }
  const widths = sheet.columns.map((c) => {
    let max = c.header.length
    for (const row of sheet.rows) {
      const v = row[c.key]
      const len = v === null || v === undefined ? 0 : String(v).length
      if (len > max) max = len
    }
    return { width: Math.min(48, Math.max(10, max + 2)) }
  })
  return { data, sheet: safeSheetName(sheet.name), columns: widths }
}

/** Blob of an XLSX workbook with one sheet per `ExportSheet` (lazy-loads the writer). */
export async function buildXlsxBlob(sheets: ExportSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  return writeXlsxFile(sheets.map(toXlsxSheet)).toBlob()
}

export function buildCsvBlob(sheet: ExportSheet, delimiter: CsvDelimiter): Blob {
  return new Blob([toCsv(sheet, delimiter)], { type: CSV_MIME })
}

/** Trigger a browser download through a temporary <a download> and object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a tick to start the download before revoking
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
