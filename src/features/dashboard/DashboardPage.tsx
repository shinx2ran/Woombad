import { useState } from 'react'
import { ErrorState } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { formatDate, todayISO } from '../../lib/format'
import { greetingFor } from './dashboardModel'
import { useDashboardData } from './useDashboardData'
import { DashboardSkeleton } from './DashboardSkeleton'
import { FirstRunChecklist } from './FirstRunChecklist'
import { QuickActions } from './QuickActions'
import { StatGrid } from './StatGrid'
import { AttentionList } from './AttentionList'
import { ExpiringList } from './ExpiringList'
import { VacantRoomsCard } from './VacantRoomsCard'
import { RecentPaymentsCard } from './RecentPaymentsCard'
import { CashflowChart } from './CashflowChart'
import { useIsDesktop } from './useIsDesktop'

export function DashboardPage() {
  const { properties, selectedPropertyId, role } = useOrg()
  const showReportLink = role !== 'staff'
  // Checkout is admin-only on the lease page (SPEC section 3), so staff only get "Perpanjang".
  const canCheckout = role !== 'staff'
  const { data, isPending, error } = useDashboardData()
  const isDesktop = useIsDesktop()
  // Captured once per mount: the greeting should not flip mid-session on a re-render.
  const [greeting] = useState(() => greetingFor(new Date().getHours()))

  const selected = selectedPropertyId === 'all' ? null : properties.find((p) => p.id === selectedPropertyId) ?? null
  const kosLabel = selected
    ? selected.name
    : properties.length === 0
      ? 'Belum ada kos'
      : properties.length <= 3
        ? properties.map((p) => p.name).join(' · ')
        : `Semua kos (${properties.length})`

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{formatDate(todayISO(), 'EEEE, d MMMM yyyy')}</p>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{greeting} 👋</h1>
          <p className="mt-0.5 truncate text-sm text-slate-600">{kosLabel}</p>
        </div>
        {data && data.totals.rooms > 0 && (
          <div className="hidden sm:block">
            <QuickActions />
          </div>
        )}
      </header>

      {error ? (
        <ErrorState error={error} />
      ) : isPending || !data ? (
        <DashboardSkeleton />
      ) : data.totals.rooms === 0 ? (
        <FirstRunChecklist totals={data.totals} />
      ) : (
        <>
          <div className="sm:hidden">
            <QuickActions />
          </div>
          <StatGrid data={data} singleProperty={selected !== null} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <AttentionList sections={data.attention} count={data.attentionCount} />
              <ExpiringList items={data.expiring} canCheckout={canCheckout} />
              {isDesktop && <CashflowChart series={data.cashflow} showReportLink={showReportLink} />}
            </div>
            <div className="space-y-4">
              <VacantRoomsCard groups={data.vacant} count={data.vacantCount} />
              <RecentPaymentsCard items={data.recentPayments} />
            </div>
            {!isDesktop && <CashflowChart series={data.cashflow} showReportLink={showReportLink} />}
          </div>
        </>
      )}
    </div>
  )
}
