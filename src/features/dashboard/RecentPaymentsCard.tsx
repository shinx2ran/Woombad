import { Link } from 'react-router'
import { Banknote } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate, formatRupiah } from '../../lib/format'
import { PAYMENT_METHOD_LABEL } from '../../types/db'
import type { RecentPaymentItem } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

export function RecentPaymentsCard({ items }: { items: RecentPaymentItem[] }) {
  return (
    <SectionCard title="Pembayaran terakhir" linkTo="/sewa">
      {items.length === 0 ? (
        <SectionEmpty>Belum ada pembayaran tercatat.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(({ payment, tenant, room }) => {
            const inner = (
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <Banknote className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{tenant?.full_name ?? 'Pemasukan lain'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(payment.paid_at, 'd MMM')}
                    {room ? ` · Kamar ${room.name}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{formatRupiah(payment.amount)}</p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-slate-500">
                    {payment.kind === 'deposit' && <Badge tone="brand">Jaminan</Badge>}
                    {payment.kind === 'other' && <Badge tone="neutral">Lain</Badge>}
                    {PAYMENT_METHOD_LABEL[payment.method]}
                  </p>
                </div>
              </>
            )
            return (
              <li key={payment.id}>
                {payment.lease_id ? (
                  <Link to={`/sewa/${payment.lease_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
