import { BedDouble, Hourglass, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { StatCard } from '../../components/ui'
import { formatRupiah } from '../../lib/format'
import { deltaText } from './dashboardModel'
import type { DashboardData } from './useDashboardData'

/** Five headline numbers: occupancy, revenue, expenses, profit (this month) and receivables. */
export function StatGrid({ data, singleProperty }: { data: DashboardData; singleProperty: boolean }) {
  const { occupancy, month, comparison, isPartial } = data
  const rentable = occupancy.total - occupancy.maintenance
  const pct = Math.round(occupancy.rate * 100)
  const vsLabel = isPartial ? 'vs bulan lalu (s/d tanggal yang sama)' : 'vs bulan lalu'

  const occupancySub = [
    `${occupancy.available} kosong`,
    `${occupancy.maintenance} perbaikan`,
    ...(occupancy.reserved > 0 ? [`${occupancy.reserved} dipesan`] : []),
  ].join(', ')

  const sharedNote =
    singleProperty && month.sharedExpensesExcluded > 0 ? ` · Bersama ${formatRupiah(month.sharedExpensesExcluded)} tidak termasuk` : ''

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="Hunian"
        value={
          <>
            {occupancy.occupied}/{rentable} <span className="text-base font-medium text-slate-500">({pct}%)</span>
          </>
        }
        sub={occupancySub}
        icon={<BedDouble className="h-4 w-4" aria-hidden />}
      />
      <StatCard
        label="Pendapatan bulan ini"
        value={formatRupiah(month.revenue)}
        tone="positive"
        sub={
          <>
            <span className={comparison.revenueDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {deltaText(comparison.revenueDelta, comparison.revenuePct, formatRupiah)}
            </span>{' '}
            {vsLabel}
          </>
        }
        icon={<TrendingUp className="h-4 w-4" aria-hidden />}
      />
      <StatCard
        label="Pengeluaran bulan ini"
        value={formatRupiah(month.expenses)}
        tone="negative"
        sub={
          <>
            <span className={comparison.expensesDelta <= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {deltaText(comparison.expensesDelta, comparison.expensesPct, formatRupiah)}
            </span>{' '}
            {vsLabel}
            {sharedNote}
          </>
        }
        icon={<TrendingDown className="h-4 w-4" aria-hidden />}
      />
      <StatCard
        label="Laba bulan ini"
        value={formatRupiah(month.netProfit)}
        tone={month.netProfit > 0 ? 'positive' : month.netProfit < 0 ? 'negative' : 'default'}
        sub={
          <>
            <span className={comparison.netDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {deltaText(comparison.netDelta, null, formatRupiah)}
            </span>{' '}
            {vsLabel}
            {month.margin !== null ? ` · margin ${Math.round(month.margin * 100)}%` : ''}
          </>
        }
        icon={<Wallet className="h-4 w-4" aria-hidden />}
      />
      <div className="col-span-2 md:col-span-4">
        <StatCard
          label="Piutang jatuh tempo"
          value={formatRupiah(month.overdue)}
          tone={month.overdue > 0 ? 'warning' : 'default'}
          sub={`${formatRupiah(month.notYetDue)} belum jatuh tempo · total piutang ${formatRupiah(month.outstanding)}`}
          icon={<Hourglass className="h-4 w-4" aria-hidden />}
        />
      </div>
    </div>
  )
}
