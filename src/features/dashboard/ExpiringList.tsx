import { Link } from 'react-router'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate } from '../../lib/format'
import type { ExpiringItem } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

export function ExpiringList({ items }: { items: ExpiringItem[] }) {
  return (
    <SectionCard title="Akan berakhir ≤ 7 hari" count={items.length} countTone="warning" linkTo="/sewa">
      {items.length === 0 ? (
        <SectionEmpty>Tidak ada sewa yang berakhir minggu ini.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(({ lease, tenant, room, property, daysLeft }) => (
            <li key={lease.id}>
              <Link to={`/sewa/${lease.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                  <CalendarClock className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{tenant?.full_name ?? 'Penyewa'}</p>
                  <p className="truncate text-xs text-slate-500">
                    Kamar {room?.name ?? '-'} · {property?.name ?? '-'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={daysLeft <= 1 ? 'danger' : 'warning'}>{daysLeft === 0 ? 'Hari ini' : daysLeft === 1 ? 'Besok' : `${daysLeft} hari lagi`}</Badge>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(lease.end_date)}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
