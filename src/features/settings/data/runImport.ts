/**
 * Executes an ImportPlan with an injected bulk insert (OrgRepo.insertMany in the app, a fake in tests).
 * Rows go in chunks; when a chunk is rejected the rows are retried one by one so a single bad row only skips
 * itself and the rows that depend on it. Connection/permission errors stop the import: everything already
 * inserted stays, and running the import again skips it ("sudah ada online").
 */
import { IMPORT_ORDER, plannedCount, type ImportPlan, type ImportTable, type SkipReason } from './demoImport'

export type InsertRows = (table: ImportTable, rows: Record<string, unknown>[]) => Promise<unknown>

export interface ImportProgress {
  table: ImportTable
  done: number
  total: number
}

export interface TableResult {
  imported: number
  skipped: Record<SkipReason, number>
  /** rejected by the server */
  failed: number
  firstError: string | null
}

export interface ImportResult {
  tables: Record<ImportTable, TableResult>
  renumberedInvoices: number
  /** set when the import stopped early */
  error: string | null
}

export interface RunOptions {
  chunkSize?: number
  /** stop after this many rejected rows (a systematic problem, e.g. an outdated database schema) */
  maxFailures?: number
  onProgress?: (progress: ImportProgress) => void
}

const FATAL_RE = /izin|permission|row-level|terhubung|network|failed to fetch|jwt|session/i

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function runImportPlan(plan: ImportPlan, insert: InsertRows, options: RunOptions = {}): Promise<ImportResult> {
  const { chunkSize = 200, maxFailures = 20, onProgress } = options
  const tables = {} as Record<ImportTable, TableResult>
  for (const t of IMPORT_ORDER) tables[t] = { imported: 0, skipped: { ...plan.tables[t].skipped }, failed: 0, firstError: null }
  const result: ImportResult = { tables, renumberedInvoices: plan.renumberedInvoices, error: null }

  const total = plannedCount(plan)
  const failedIds = new Set<string>()
  let failures = 0
  let done = 0

  const stop = (message: string) => {
    result.error = message
    return result
  }

  for (const table of IMPORT_ORDER) {
    const res = tables[table]
    const rows = plan.tables[table].rows
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const ready = chunk.filter((r) => !r.deps.some((d) => failedIds.has(d)))
      for (const r of chunk) {
        if (ready.includes(r)) continue
        failedIds.add(r.id)
        res.skipped.broken_ref++
      }
      onProgress?.({ table, done, total })
      if (ready.length > 0) {
        try {
          await insert(table, ready.map((r) => r.row))
          res.imported += ready.length
        } catch (err) {
          if (FATAL_RE.test(messageOf(err))) return stop(messageOf(err))
          for (const r of ready) {
            try {
              await insert(table, [r.row])
              res.imported++
            } catch (rowErr) {
              const message = messageOf(rowErr)
              if (FATAL_RE.test(message)) return stop(message)
              failedIds.add(r.id)
              res.failed++
              res.firstError ??= message
              if (++failures >= maxFailures) return stop(`Terlalu banyak data ditolak server: ${message}`)
            }
          }
        }
      }
      done += chunk.length
    }
  }
  onProgress?.({ table: IMPORT_ORDER[IMPORT_ORDER.length - 1], done, total })
  return result
}

export function importedCount(result: ImportResult): number {
  return IMPORT_ORDER.reduce((sum, t) => sum + result.tables[t].imported, 0)
}
