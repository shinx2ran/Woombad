import { Link } from 'react-router'
import { CalendarClock, MessageCircle } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate, todayISO, whatsappLink } from '../../lib/format'
import { plannedCheckoutOf } from '../../domain/occupancy'
import { plannedCheckoutBadge } from '../leases/leaseUtils'
import { EXPIRING_WITHIN_DAYS, checkoutDaysLabel, extensionQuestionText, type ExpiringItem } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'
import { MissingPhoneLink } from '../tenants/MissingPhoneLink'

/**
 * "Akan berakhir": active leases whose check-out day (end_date + 1, SPEC 7.3) is within EXPIRING_WITHIN_DAYS and that
 * owe nothing (leases with an open bill are under "Perlu perhatian", SPEC 2b.12). The decision here is perpanjang
 * (buat tagihan berikutnya) or checkout, so the actions and the WhatsApp text are about the stay ending, not a bill.
 */
export function ExpiringList({ items }: { items: ExpiringItem[] }) {
  return (
    <SectionCard title={`Akan berakhir ≤ ${EXPIRING_WITHIN_DAYS} hari`} count={items.length} countTone="warning" linkTo="/sewa">
      {items.length === 0 ? (
        <SectionEmpty>Tidak ada sewa yang berakhir minggu ini.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <ExpiringRow key={item.lease.id} item={item} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function ExpiringRow({ item }: { item: ExpiringItem }) {
  const { lease, tenant, room, property, checkoutDate, daysLeft } = item
  const tenantName = tenant?.full_name ?? 'Penyewa'
  const roomName = room?.name ?? '-'
  const propertyName = property?.name ?? '-'
  const wa = whatsappLink(tenant?.phone, extensionQuestionText({ tenantName, roomName, propertyName, endDate: lease.end_date }))
  // SPEC 7.8: the tenant already said when he leaves
  const planned = plannedCheckoutOf(lease)
  const leaving = planned ? plannedCheckoutBadge(planned, todayISO()) : null

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
            <Badge tone={daysLeft <= 1 ? 'danger' : 'warning'}>{checkoutDaysLabel(daysLeft)}</Badge>
            <span>{formatDate(checkoutDate, 'EEE, d MMM yyyy')}</span>
            {leaving && (
              <span data-testid="expiring-planned-checkout">
                <Badge tone={leaving.overdue ? 'danger' : 'info'}>{leaving.text}</Badge>
              </span>
            )}
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
          <MissingPhoneLink tenant={tenant} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full" />
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link
          to={`/sewa/${lease.id}?action=tagih`}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800"
        >
          Perpanjang
        </Link>
        <Link
          to={`/sewa/${lease.id}?action=checkout`}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Checkout
        </Link>
      </div>
    </li>
  )
}
