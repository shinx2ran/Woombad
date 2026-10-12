import { useState } from 'react'
import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { clsx } from 'clsx'
import { Button, Card, CardBody, CardHeader, Select, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import type { DateRange } from '../../domain/period'
import {
  buildExpensesSheet,
  buildInvoicesSheet,
  buildPaymentsSheet,
  buildSummarySheet,
  buildTenantsSheet,
  exportFileName,
  type ExportContext,
  type ExportSheet,
} from '../../domain/export'
import { buildCsvBlob, buildXlsxBlob, downloadBlob, type CsvDelimiter } from './exportFiles'
import type { ReportData } from './useReportData'

type SheetKey = 'summary' | 'payments' | 'invoices' | 'expenses' | 'tenants'
type Format = 'xlsx' | 'csv'

const SHEETS: { key: SheetKey; label: string; hint: string }[] = [
  { key: 'summary', label: 'Ringkasan', hint: 'KPI, rekonsiliasi kas, arus kas, kategori, per kos' },
  { key: 'payments', label: 'Pembayaran', hint: 'Semua pembayaran pada periode' },
  { key: 'invoices', label: 'Tagihan', hint: 'Tagihan jatuh tempo pada periode' },
  { key: 'expenses', label: 'Pengeluaran', hint: 'Pengeluaran pada periode' },
  { key: 'tenants', label: 'Penyewa', hint: 'Daftar penyewa & kamar saat ini' },
]

export function ExportPanel({ data, range, rangeLabel, today }: { data: ReportData; range: DateRange; rangeLabel: string; today: string }) {
  const { financePropertyIds } = useOrg()
  const toast = useToast()
  const [selected, setSelected] = useState<Record<SheetKey, boolean>>({ summary: true, payments: true, invoices: true, expenses: true, tenants: true })
  const [format, setFormat] = useState<Format>('xlsx')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(';')
  const [busy, setBusy] = useState(false)

  const chosen = SHEETS.filter((s) => selected[s.key])

  const buildSheets = (): ExportSheet[] => {
    const ctx: ExportContext = { properties: data.visibleProperties, rooms: data.rooms, tenants: data.tenants, leases: data.leases }
    const sheets: ExportSheet[] = []
    for (const s of chosen) {
      switch (s.key) {
        case 'summary':
          sheets.push(buildSummarySheet(data.summary, data.cashflow, data.byCategory, data.byProperty, range, `Laporan ${rangeLabel}`))
          break
        case 'payments':
          sheets.push(buildPaymentsSheet(data.payments, data.invoices, ctx, range, financePropertyIds))
          break
        case 'invoices':
          sheets.push(buildInvoicesSheet(data.invoices, data.payments, ctx, range, financePropertyIds))
          break
        case 'expenses':
          sheets.push(buildExpensesSheet(data.expenses, ctx, range, financePropertyIds))
          break
        case 'tenants':
          sheets.push(buildTenantsSheet(ctx, financePropertyIds, today))
          break
      }
    }
    return sheets
  }

  const download = async () => {
    if (chosen.length === 0) {
      toast.error('Pilih minimal satu lembar untuk diekspor.')
      return
    }
    setBusy(true)
    try {
      const sheets = buildSheets()
      if (format === 'xlsx') {
        const blob = await buildXlsxBlob(sheets)
        downloadBlob(blob, exportFileName('laporan', range, 'xlsx'))
        toast.success(`File XLSX dengan ${sheets.length} lembar berhasil dibuat.`)
      } else {
        for (const sheet of sheets) {
          downloadBlob(buildCsvBlob(sheet, delimiter), exportFileName(sheet.name, range, 'csv'))
        }
        toast.success(`${sheets.length} file CSV berhasil dibuat.`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? `Gagal mengekspor: ${err.message}` : 'Gagal mengekspor data.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader
        title="Ekspor data"
        subtitle={`Periode ${rangeLabel}; mengikuti filter kos yang aktif.`}
        action={
          <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Cetak / PDF
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Lembar</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SHEETS.map((s) => (
              <label
                key={s.key}
                className={clsx(
                  'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                  selected[s.key] ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 bg-white',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-brand-700"
                  checked={selected[s.key]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{s.label}</span>
                  <span className="block text-xs text-slate-500">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Format</legend>
            <div role="radiogroup" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(['xlsx', 'csv'] as Format[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => setFormat(f)}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium',
                    format === f ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>
          {format === 'csv' && (
            <Select
              label="Pemisah CSV"
              options={[
                { value: ';', label: 'Titik koma (;) — Excel Indonesia' },
                { value: ',', label: 'Koma (,) — Google Sheets' },
              ]}
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as CsvDelimiter)}
              className="w-auto"
            />
          )}
          <div className="ml-auto flex w-full sm:w-auto">
            <Button
              fullWidth
              onClick={download}
              loading={busy}
              disabled={chosen.length === 0}
              icon={format === 'xlsx' ? <FileSpreadsheet className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            >
              Unduh {format === 'xlsx' ? 'XLSX' : `${chosen.length} CSV`}
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {format === 'xlsx'
            ? 'Satu file .xlsx, satu lembar per pilihan. Tanggal dalam format dd/mm/yyyy, uang sebagai angka.'
            : 'Satu file .csv per lembar yang dipilih (UTF-8 dengan BOM agar terbaca Excel).'}
        </p>
      </CardBody>
    </Card>
  )
}
