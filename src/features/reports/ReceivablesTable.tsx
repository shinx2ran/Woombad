import { Link } from 'react-router'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, DataTable, type Column } from '../../components/ui'
import { formatDate, formatRupiah, whatsappLink } from '../../lib/format'
import { reminderText } from '../../domain/messages'
import type { ReceivableRow } from './useReportData'

function waHref(row: ReceivableRow): string | null {
  if (!row.tenant?.phone) return null
  const text = reminderText({
    tenantName: row.tenant.full_name,
    roomName: row.room?.name ?? '-',
    propertyName: row.property?.name ?? 'kos',
    outstanding: row.outstanding,
    dueDate: row.invoice.due_date,
    periodStart: row.invoice.period_start,
    periodEnd: row.invoice.period_end,
    paymentInfo: row.property?.payment_info ?? null,
  })
  return whatsappLink(row.tenant.phone, text)
}

function LateBadge({ days }: { days: number }) {
  if (days > 0) return <Badge tone="danger">{days} hari</Badge>
  if (days === 0) return <Badge tone="warning">Hari ini</Badge>
  return <Badge tone="neutral">{Math.abs(days)} hari lagi</Badge>
}

export function ReceivablesTable({ rows, rangeEnd }: { rows: ReceivableRow[]; rangeEnd: string }) {
  const total = rows.reduce((s, r) => s + r.outstanding, 0)
  const columns: Column<ReceivableRow>[] = [
    {
      key: 'tenant',
      header: 'Penyewa',
      render: (r) => (
        <div className="min-w-0">
          <Link to={`/sewa/${r.invoice.lease_id}`} className="font-medium text-brand-800 hover:underline">
            {r.tenant?.full_name ?? '-'}
          </Link>
          <p className="text-xs text-slate-500 md:hidden">
            {r.room?.name ?? '-'} · {r.invoice.invoice_number}
          </p>
        </div>
      ),
    },
    { key: 'room', header: 'Kamar', hideOnMobile: true, render: (r) => `${r.room?.name ?? '-'}${r.property ? ` · ${r.property.name}` : ''}` },
    { key: 'invoice', header: 'No. Tagihan', hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.invoice.invoice_number}</span> },
    { key: 'due', header: 'Jatuh Tempo', hideOnMobile: true, render: (r) => formatDate(r.invoice.due_date) },
    { key: 'late', header: 'Terlambat', align: 'center', render: (r) => <LateBadge days={r.daysOverdue} /> },
    { key: 'outstanding', header: 'Sisa', align: 'right', render: (r) => <span className="font-medium">{formatRupiah(r.outstanding)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'print:hidden',
      render: (r) => {
        const href = waHref(r)
        return (
          <div className="flex items-center justify-end gap-1">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Kirim pengingat WhatsApp ke ${r.tenant?.full_name ?? 'penyewa'}`}
                title="Kirim pengingat WhatsApp"
                className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            ) : (
              <span className="rounded-lg p-1.5 text-slate-300" title="Nomor HP belum diisi">
                <MessageCircle className="h-4 w-4" />
              </span>
            )}
            <Link to={`/sewa/${r.invoice.lease_id}`} aria-label="Buka sewa" title="Buka sewa" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        )
      },
    },
  ]

  return (
    <Card className="print-break-inside-avoid">
      <CardHeader
        title={`Piutang (${rows.length} tagihan)`}
        subtitle={`Tagihan jatuh tempo s/d ${formatDate(rangeEnd)} yang belum lunas; sisa dihitung dari pembayaran.`}
        action={<span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">{formatRupiah(total)}</span>}
      />
      <CardBody className="px-0 py-0">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.invoice.id}
          emptyMessage="Tidak ada piutang. Semua tagihan sudah lunas."
          footer={
            rows.length > 0 ? (
              <tr>
                <td className="px-3 py-2.5" colSpan={2}>
                  Total
                </td>
                <td className="hidden md:table-cell" colSpan={3} />
                <td className="px-3 py-2.5 text-right tabular-nums">{formatRupiah(total)}</td>
                <td className="print:hidden" />
              </tr>
            ) : undefined
          }
        />
      </CardBody>
    </Card>
  )
}
