import { useEffect } from 'react'
import { Link } from 'react-router'
import { Landmark, ShieldOff } from 'lucide-react'
import { Card, CardBody, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { formatDate, formatRupiah } from '../../lib/format'
import { ReportControls } from './ReportControls'
import { KpiGrid } from './KpiGrid'
import { CashflowChart, ExpenseCategoryChart, OccupancyChart, PaymentMethodChart, ProfitByPropertyChart } from './charts'
import { ReceivablesTable } from './ReceivablesTable'
import { PropertySummaryTable } from './PropertySummaryTable'
import { ExportPanel } from './ExportPanel'
import { useReportRange } from './useReportRange'
import { useReportData } from './useReportData'
import './reports.css'

export function ReportsPage() {
  const { role, org, selectedPropertyId, properties } = useOrg()
  const report = useReportRange()
  const { data, isPending, error } = useReportData(report.range, report.preset, report.granularity, report.today)

  // scope the print stylesheet to this page
  useEffect(() => {
    document.body.classList.add('woombad-print-report')
    return () => document.body.classList.remove('woombad-print-report')
  }, [])

  if (role === 'staff') {
    return (
      <>
        <PageHeader title="Laporan" />
        <EmptyState
          icon={<ShieldOff className="h-10 w-10" />}
          title="Tidak memiliki akses"
          description="Laporan keuangan hanya dapat dilihat oleh pemilik dan admin."
          action={
            <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
              Kembali ke dashboard
            </Link>
          }
        />
      </>
    )
  }

  const kosLabel = selectedPropertyId === 'all' ? 'Semua kos' : (properties.find((p) => p.id === selectedPropertyId)?.name ?? 'Satu kos')

  return (
    <>
      <PageHeader title="Laporan" subtitle="Keuangan basis kas, piutang, hunian, dan ekspor data." />
      <ReportControls report={report} />

      {/* print-only title */}
      <div className="print-title mb-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {org.name} — Laporan {report.label}
        </h2>
        <p className="text-sm text-slate-600">
          {kosLabel} · {formatDate(report.range.start)} s/d {formatDate(report.range.end)} · dicetak {formatDate(report.today)}
        </p>
      </div>

      {isPending && <LoadingState label="Menghitung laporan…" />}
      {error !== undefined && <ErrorState error={error} />}

      {data && (
        <div className="space-y-6">
          <KpiGrid data={data} />

          <section aria-label="Grafik" className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <CashflowChart data={data.cashflow} />
            </div>
            <ExpenseCategoryChart data={data.byCategory} />
            <OccupancyChart data={data.occupancy} />
            {data.visibleProperties.length > 1 && <ProfitByPropertyChart data={data.byProperty} />}
            <PaymentMethodChart data={data.byMethod} />
          </section>

          <section aria-label="Tabel" className="space-y-4">
            <ReceivablesTable rows={data.receivables} rangeEnd={report.range.end} />
            <PropertySummaryTable rows={data.byProperty} />
            <Card className="print-break-inside-avoid">
              <CardBody className="flex items-start gap-3">
                <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                <div className="text-sm">
                  <p className="font-medium text-slate-900">Dasar pajak</p>
                  <p className="text-slate-700">
                    Pendapatan sewa bruto periode ini: <span className="font-semibold tabular-nums">{formatRupiah(data.summary.rentRevenue)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Pembayaran sewa (termasuk potong jaminan) sebelum pengembalian; angka acuan untuk pajak final sewa.
                  </p>
                </div>
              </CardBody>
            </Card>
          </section>

          <ExportPanel data={data} range={report.range} rangeLabel={report.label} today={report.today} />
        </div>
      )}
    </>
  )
}
