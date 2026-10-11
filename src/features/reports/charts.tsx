import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '../../components/ui'
import { formatRupiah } from '../../lib/format'
import type { CashflowPoint, CategoryBreakdown, MethodBreakdown, PropertyBreakdown } from '../../domain/finance'
import type { OccupancyPoint } from '../../domain/occupancy'
import { formatCompactRupiah, formatPct } from './reportRange'

export const COLOR_REVENUE = '#0f766e'
export const COLOR_EXPENSE = '#e11d48'
export const COLOR_NEUTRAL = '#64748b'
export const COLOR_PROFIT = '#0ea5e9'
export const CATEGORICAL = ['#0f766e', '#0ea5e9', '#f59e0b', '#8b5cf6', '#e11d48', '#10b981', '#64748b', '#f97316']

const CHART_HEIGHT = 220
const AXIS_TICK = { fontSize: 11, fill: '#64748b' }
const GRID_STROKE = '#e2e8f0'

/** Card wrapper with title + one-line explanation; renders `empty` text when there is nothing to plot. */
export function ChartCard({
  title,
  description,
  isEmpty,
  emptyText = 'Belum ada data pada periode ini.',
  children,
  className,
}: {
  title: string
  description: string
  isEmpty: boolean
  emptyText?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={description} />
      <CardBody>
        {isEmpty ? (
          <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
            <BarChart3 className="h-8 w-8 text-slate-300" />
            {emptyText}
          </div>
        ) : (
          children
        )}
      </CardBody>
    </Card>
  )
}

function tooltipValue(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/** Shared tooltip: label on top, one line per series, values in Rupiah (or custom). */
function ChartTooltip({
  active,
  payload,
  label,
  format = formatRupiah,
}: Pick<TooltipContentProps, 'active' | 'payload' | 'label'> & { format?: (n: number) => string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== '' && <p className="mb-1 font-semibold text-slate-900">{String(label)}</p>}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={`${String(entry.name)}-${i}`} className="flex items-center gap-2 text-slate-700">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: entry.color ?? entry.fill ?? COLOR_NEUTRAL }} />
            <span className="flex-1">{String(entry.name ?? '')}</span>
            <span className="font-medium tabular-nums text-slate-900">{format(tooltipValue(entry.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const rupiahTick = (v: number) => formatCompactRupiah(v)
const pctTick = (v: number) => `${Math.round(v)}%`

// ---------- 1. cashflow ----------

export function CashflowChart({ data }: { data: CashflowPoint[] }) {
  const isEmpty = data.every((d) => d.revenue === 0 && d.expenses === 0)
  return (
    <ChartCard
      title="Arus kas per periode"
      description="Pendapatan (sewa + lain − pengembalian sewa) vs pengeluaran operasional; garis = laba."
      isEmpty={isEmpty}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={rupiahTick} width={52} />
          <Tooltip content={(props) => <ChartTooltip {...props} />} cursor={{ fill: '#f1f5f9' }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} name="Pendapatan" dataKey="revenue" fill={COLOR_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar isAnimationActive={false} name="Pengeluaran" dataKey="expenses" fill={COLOR_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line isAnimationActive={false} name="Laba" type="monotone" dataKey="net" stroke={COLOR_PROFIT} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------- 2. expenses by category ----------

export function ExpenseCategoryChart({ data }: { data: CategoryBreakdown[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0)
  return (
    <ChartCard
      title="Pengeluaran per kategori"
      description="Komposisi pengeluaran operasional (pengembalian uang tidak dihitung)."
      isEmpty={data.length === 0}
      emptyText="Tidak ada pengeluaran pada periode ini."
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <div className="relative h-[180px] w-full shrink-0 sm:w-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="label" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                {data.map((entry, i) => (
                  <Cell key={entry.category} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                ))}
              </Pie>
              <Tooltip content={(props) => <ChartTooltip {...props} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Total</span>
            <span className="text-xs font-semibold tabular-nums text-slate-900">{formatCompactRupiah(total)}</span>
          </div>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
          {data.map((entry, i) => (
            <li key={entry.category} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
              <span className="min-w-0 flex-1 truncate text-slate-700">{entry.label}</span>
              <span className="tabular-nums text-slate-900">{formatRupiah(entry.amount)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-slate-500">{formatPct(entry.share)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  )
}

// ---------- 3. profit by property ----------

export function ProfitByPropertyChart({ data }: { data: PropertyBreakdown[] }) {
  const isEmpty = data.every((d) => d.revenue === 0 && d.expenses === 0)
  const height = Math.max(CHART_HEIGHT, 40 + data.length * 48)
  return (
    <ChartCard title="Laba per kos" description="Pendapatan dan pengeluaran yang tercatat pada tiap kos; baris 'Bersama' = pengeluaran tanpa kos." isEmpty={isEmpty}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={rupiahTick} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={88} />
          <Tooltip content={(props) => <ChartTooltip {...props} />} cursor={{ fill: '#f1f5f9' }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} name="Pendapatan" dataKey="revenue" fill={COLOR_REVENUE} radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar isAnimationActive={false} name="Pengeluaran" dataKey="expenses" fill={COLOR_EXPENSE} radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar isAnimationActive={false} name="Laba" dataKey="net" fill={COLOR_PROFIT} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------- 4. occupancy trend ----------

export function OccupancyChart({ data }: { data: OccupancyPoint[] }) {
  const points = data.map((d) => ({ ...d, pct: Math.round(d.rate * 1000) / 10 }))
  return (
    <ChartCard
      title="Tren hunian"
      description="Persentase kamar terisi (dari kamar yang bisa disewa) pada akhir tiap periode."
      isEmpty={data.length === 0 || data.every((d) => d.rentable === 0)}
      emptyText="Belum ada kamar yang bisa dihitung."
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={pctTick} width={40} />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                {...props}
                format={(n) => {
                  const point = props.payload?.[0]?.payload as OccupancyPoint | undefined
                  return point ? `${n}% (${point.occupied}/${point.rentable} kamar)` : `${n}%`
                }}
              />
            )}
          />
          <Line isAnimationActive={false} name="Hunian" type="monotone" dataKey="pct" stroke={COLOR_REVENUE} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------- 5. payment methods ----------

export function PaymentMethodChart({ data }: { data: MethodBreakdown[] }) {
  return (
    <ChartCard
      title="Metode pembayaran"
      description="Pembayaran sewa & pemasukan lain menurut cara bayar (termasuk potong jaminan)."
      isEmpty={data.length === 0}
      emptyText="Tidak ada pembayaran pada periode ini."
    >
      <ResponsiveContainer width="100%" height={Math.max(140, 30 + data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={rupiahTick} />
          <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                {...props}
                format={(n) => {
                  const row = props.payload?.[0]?.payload as MethodBreakdown | undefined
                  return row ? `${formatRupiah(n)} · ${row.count}x` : formatRupiah(n)
                }}
              />
            )}
            cursor={{ fill: '#f1f5f9' }}
          />
          <Bar isAnimationActive={false} name="Jumlah" dataKey="amount" fill={COLOR_REVENUE} radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((entry, i) => (
              <Cell key={entry.method} fill={CATEGORICAL[i % CATEGORICAL.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
