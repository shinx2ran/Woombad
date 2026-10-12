import { Link } from 'react-router'
import { CalendarClock, MessageCircle } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate, whatsappLink } from '../../lib/format'
import { EXPIRING_WITHIN_DAYS, extensionQuestionText, type ExpiringItem } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

/**
 * "Akan berakhir": active leases ending within EXPIRING_WITHIN_DAYS that owe nothing (leases with an open
 * bill are under "Perlu perhatian", SPEC 2b.12). The decision here is perpanjang (buat tagihan berikutnya)
 * or checkout, so the actions and the WhatsApp text are about the stay ending, not about a bill.
 * `canCheckout` is false for staff: checkout is admin-only on the lease page.
 */
export function ExpiringList({ items, canCheckout = true }: { items: ExpiringItem[]; canCheckout?: boolean }) {
  return (
    <SectionCard title={`Akan berakhir ≤ ${EXPIRING_WITHIN_DAYS} hari`} count={items.length} countTone="warning" linkTo="/sewa">
      {items.length === 0 ? (
        <SectionEmpty>Tidak ada sewa yang berakhir minggu ini.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <ExpiringRow key={item.lease.id} item={item} canCheckout={canCheckout} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function ExpiringRow({ item, canCheckout }: { item: ExpiringItem; canCheckout: boolean }) {
  const { lease, tenant, room, property, daysLeft } = item
  const tenantName = tenant?.full_name ?? 'Penyewa'
  const roomName = room?.name ?? '-'
  const propertyName = property?.name ?? '-'
  const wa = whatsappLink(tenant?.phone, extensionQuestionText({ tenantName, roomName, propertyName, endDate: lease.end_date }))
  const daysLabel = daysLeft === 0 ? 'Berakhir hari ini' : daysLeft === 1 ? 'Berakhir besok' : `Berakhir ${daysLeft} hari lagi`

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <CalendarClock className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/sewa/${lease.id}`} className="block truncate text-sm font-semibold text-slate-900 hover:underline">
            {tenantName}
          </Link>
          <p className="truncate text-xs text-slate-500">
            Kamar {roomName} · {propertyName}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <Badge tone={daysLeft <= 1 ? 'danger' : 'warning'}>{daysLabel}</Badge>
            <span>{formatDate(lease.end_date, 'EEE, d MMM yyyy')}</span>
          </p>
        </div>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            aria-label={`Tanya perpanjangan lewat WhatsApp ke ${tenantName}`}
            title="Tanya perpanjangan lewat WhatsApp"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
          </a>
        ) : (
          <span
            aria-label="Nomor HP belum diisi"
            title="Nomor HP belum diisi"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-300"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
      <div className={canCheckout ? 'mt-2 grid grid-cols-2 gap-2' : 'mt-2 grid gap-2'}>
        <Link
          to={`/sewa/${lease.id}?action=tagih`}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800"
        >
          Perpanjang
        </Link>
        {canCheckout && (
          <Link
            to={`/sewa/${lease.id}?action=checkout`}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Checkout
          </Link>
        )}
      </div>
    </li>
  )
}
