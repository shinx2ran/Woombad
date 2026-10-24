import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Users } from 'lucide-react'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { todayISO } from '../../lib/format'
import { waitlistCounts } from './waitlist'

/**
 * Dashboard: "Daftar tunggu: 3 orang · 1 ada kamar cocok" (SPEC 7.7), only while somebody is waiting. Renders nothing
 * otherwise (also while loading, or before the server has the table), so the dashboard is unchanged without a list.
 */
export function WaitlistCard() {
  const { propertyFilterIds } = useOrg()
  const waitlist = useTable('waitlist')
  const rooms = useTable('rooms')
  const leases = useTable('leases')
  const today = todayISO()
  const counts = useMemo(
    () => waitlistCounts(waitlist.data ?? [], { rooms: rooms.data ?? [], leases: leases.data ?? [], today, propertyIds: propertyFilterIds }),
    [waitlist.data, rooms.data, leases.data, today, propertyFilterIds],
  )
  if (!waitlist.data || !rooms.data || !leases.data || counts.waiting === 0) return null
  return (
    <Link
      to="/daftar-tunggu"
      data-testid="waitlist-card"
      className="flex min-h-12 items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900 shadow-sm hover:bg-brand-100"
    >
      <Users className="h-5 w-5 shrink-0 text-brand-700" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong>Daftar tunggu: {counts.waiting} orang</strong>
        <span className={counts.withRoom > 0 ? 'font-medium text-emerald-700' : 'text-brand-800'}> · {counts.withRoom > 0 ? `${counts.withRoom} ada kamar cocok` : 'belum ada kamar cocok'}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
    </Link>
  )
}
