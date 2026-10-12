import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { BedDouble, HandCoins, Percent, PiggyBank, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { StatCard } from '../../components/ui'
import { formatRupiah } from '../../lib/format'
import { describeDelta, describeRatioDelta, formatPct, type DeltaInfo } from './reportRange'
import type { ReportData } from './useReportData'

function Delta({ info, invert = false }: { info: DeltaInfo; invert?: boolean }) {
  const good = invert ? info.direction === 'down' : info.direction === 'up'
  const bad = invert ? info.direction === 'up' : info.direction === 'down'
  return (
    <span className={clsx('tabular-nums', good && 'text-emerald-700', bad && 'text-red-700', info.direction === 'flat' && 'text-slate-500')}>
      {info.text}
    </span>
  )
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="flex flex-col gap-0.5">{children}</span>
}

export function KpiGrid({ data }: { data: ReportData }) {
  // `s` is the full-range figure shown as the value; `cur` is the elapsed-to-date part (same span as `p`)
  // so every delta compares like with like, including ratio/balance KPIs.
  const { summary: s, currentSummary: cur, previousSummary: p, comparison: c, isPartial, occupancyNow, occupancyPrevious } = data
  const compareLabel = isPartial ? 'vs periode lalu (s/d tanggal yang sama)' : 'vs periode lalu'

  return (
    <section aria-label="Ringkasan angka">
      <p className="mb-2 text-xs text-slate-500">
        Perbandingan: <span className="font-medium text-slate-700">{compareLabel}</span>
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Pendapatan"
          value={formatRupiah(s.revenue)}
          icon={<TrendingUp className="h-4 w-4" />}
          sub={
            <Sub>
              <span>
                Sewa {formatRupiah(s.rentRevenue)} · Lain {formatRupiah(s.otherRevenue)}
                {s.rentRefunds > 0 && <> · Pengembalian sewa −{formatRupiah(s.rentRefunds)}</>}
              </span>
              <Delta info={describeDelta(c.revenueDelta, p.revenue, formatRupiah)} />
            </Sub>
          }
        />
        <StatCard
          label="Pengeluaran"
          value={formatRupiah(s.expenses)}
          icon={<TrendingDown className="h-4 w-4" />}
          sub={
            <Sub>
              {s.sharedExpensesExcluded > 0 ? (
                <span>{formatRupiah(s.sharedExpensesExcluded)} bersama tidak termasuk</span>
              ) : (
                <span>{s.expenseCount} transaksi</span>
              )}
              <Delta info={describeDelta(c.expensesDelta, p.expenses, formatRupiah)} invert />
            </Sub>
          }
        />
        <StatCard
          label="Laba Bersih"
          value={formatRupiah(s.netProfit)}
          tone={s.netProfit > 0 ? 'positive' : s.netProfit < 0 ? 'negative' : 'default'}
          icon={<Wallet className="h-4 w-4" />}
          sub={
            <Sub>
              <span>Pendapatan − pengeluaran operasional</span>
              <Delta info={describeDelta(c.netDelta, p.netProfit, formatRupiah)} />
            </Sub>
          }
        />
        <StatCard
          label="Margin"
          value={formatPct(s.margin)}
          tone={s.margin === null ? 'default' : s.margin >= 0 ? 'positive' : 'negative'}
          icon={<Percent className="h-4 w-4" />}
          sub={
            <Sub>
              <span>Laba bersih / pendapatan</span>
              <Delta info={describeRatioDelta(cur.margin, p.margin)} />
            </Sub>
          }
        />
        <StatCard
          label="Piutang"
          value={formatRupiah(s.outstanding)}
          tone={s.overdue > 0 ? 'warning' : 'default'}
          icon={<Receipt className="h-4 w-4" />}
          sub={
            <Sub>
              <span>
                Terlambat {formatRupiah(s.overdue)} · Belum jatuh tempo {formatRupiah(s.notYetDue)}
              </span>
              <Delta info={describeDelta(cur.outstanding - p.outstanding, p.outstanding, formatRupiah)} invert />
            </Sub>
          }
        />
        <StatCard
          label="Tingkat Penagihan"
          value={formatPct(s.collectionRate)}
          icon={<HandCoins className="h-4 w-4" />}
          sub={
            <Sub>
              <span>
                Terkumpul {formatRupiah(s.collected)} dari {formatRupiah(s.billed)}
              </span>
              <Delta info={describeRatioDelta(cur.collectionRate, p.collectionRate)} />
            </Sub>
          }
        />
        <StatCard
          label="Uang Jaminan Dipegang"
          value={formatRupiah(s.depositsHeld)}
          icon={<PiggyBank className="h-4 w-4" />}
          sub={
            <Sub>
              <span>
                Diterima {formatRupiah(s.depositsReceived)} · Dikembalikan {formatRupiah(s.depositRefunds)}
              </span>
              <Delta info={describeDelta(cur.depositsHeld - p.depositsHeld, p.depositsHeld, formatRupiah)} />
            </Sub>
          }
        />
        <StatCard
          label="Hunian Saat Ini"
          value={formatPct(occupancyNow.rate)}
          icon={<BedDouble className="h-4 w-4" />}
          sub={
            <Sub>
              <span>
                {occupancyNow.occupied} terisi · {occupancyNow.available} kosong
                {occupancyNow.reserved > 0 && <> · {occupancyNow.reserved} dipesan</>}
                {occupancyNow.maintenance > 0 && <> · {occupancyNow.maintenance} perbaikan</>}
              </span>
              <Delta info={describeRatioDelta(occupancyNow.rate, occupancyPrevious.rate)} />
            </Sub>
          }
        />
      </div>
    </section>
  )
}
