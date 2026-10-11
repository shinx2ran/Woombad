import { Link } from 'react-router'
import { clsx } from 'clsx'
import { Card, CardBody, CardHeader, DataTable, type Column } from '../../components/ui'
import { formatRupiah } from '../../lib/format'
import type { PropertyBreakdown } from '../../domain/finance'
import { formatPct } from './reportRange'

export function PropertySummaryTable({ rows }: { rows: PropertyBreakdown[] }) {
  const totals = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, expenses: acc.expenses + r.expenses, net: acc.net + r.net }),
    { revenue: 0, expenses: 0, net: 0 },
  )
  const columns: Column<PropertyBreakdown>[] = [
    {
      key: 'name',
      header: 'Kos',
      render: (r) =>
        r.propertyId === 'shared' ? (
          <span className="italic text-slate-600">{r.name}</span>
        ) : (
          <Link to={`/kos/${r.propertyId}`} className="font-medium text-brand-800 hover:underline">
            {r.name}
          </Link>
        ),
    },
    { key: 'revenue', header: 'Pendapatan', align: 'right', render: (r) => formatRupiah(r.revenue) },
    { key: 'expenses', header: 'Pengeluaran', align: 'right', render: (r) => formatRupiah(r.expenses) },
    {
      key: 'net',
      header: 'Laba',
      align: 'right',
      render: (r) => <span className={clsx('font-medium', r.net > 0 && 'text-emerald-700', r.net < 0 && 'text-red-700')}>{formatRupiah(r.net)}</span>,
    },
    { key: 'margin', header: 'Margin', align: 'right', hideOnMobile: true, render: (r) => formatPct(r.revenue > 0 ? r.net / r.revenue : null) },
  ]
  return (
    <Card className="print-break-inside-avoid">
      <CardHeader title="Ringkasan per kos" subtitle="Pendapatan, pengeluaran, dan laba tiap kos pada periode ini." />
      <CardBody className="px-0 py-0">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.propertyId}
          emptyMessage="Belum ada kos."
          footer={
            rows.length > 1 ? (
              <tr>
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(totals.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(totals.expenses)}</td>
                <td className={clsx('px-3 py-2.5 text-right tabular-nums', totals.net > 0 && 'text-emerald-700', totals.net < 0 && 'text-red-700')}>
                  {formatRupiah(totals.net)}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatPct(totals.revenue > 0 ? totals.net / totals.revenue : null)}</td>
              </tr>
            ) : undefined
          }
        />
      </CardBody>
    </Card>
  )
}
