import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatRupiah } from '../../lib/format'
import type { CashflowPoint } from '../../domain/finance'
import { formatCompactRupiah } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

const REVENUE = '#0f766e'
const EXPENSES = '#e11d48'
const NEUTRAL = '#64748b'

const SERIES_LABEL: Record<string, string> = { revenue: 'Pendapatan', expenses: 'Pengeluaran' }
/** Keep legend and tooltip in bar order (revenue first); recharts sorts alphabetically by default. */
const SERIES_ORDER: Record<string, number> = { revenue: 0, expenses: 1 }
const byBarOrder = (item: { dataKey?: unknown }) => SERIES_ORDER[String(item.dataKey)] ?? 9

/** Compact six-month cashflow: revenue vs operating expenses per month (SPEC 2a "Arus kas"). */
export function CashflowChart({ series }: { series: CashflowPoint[] }) {
  const hasData = series.some((p) => p.revenue !== 0 || p.expenses !== 0)
  return (
    <SectionCard title="Arus kas 6 bulan" linkTo="/laporan" linkLabel="Laporan">
      {!hasData ? (
        <SectionEmpty>Belum ada pembayaran atau pengeluaran dalam 6 bulan terakhir.</SectionEmpty>
      ) : (
        <div className="px-2 pb-2 pt-3" style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: NEUTRAL }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tickFormatter={(v: string) => v.replace(/ \d{4}$/, '')} />
              <YAxis tick={{ fontSize: 11, fill: NEUTRAL }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatCompactRupiah(v)} />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                formatter={(value, name) => [formatRupiah(Number(value)), SERIES_LABEL[String(name)] ?? String(name)]}
                itemSorter={byBarOrder}
                labelStyle={{ color: '#0f172a', fontWeight: 600 }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} itemSorter={byBarOrder} formatter={(value: string) => SERIES_LABEL[value] ?? value} />
              <Bar dataKey="revenue" fill={REVENUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="expenses" fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}
