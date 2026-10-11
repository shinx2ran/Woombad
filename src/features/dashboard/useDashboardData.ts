import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { todayISO } from '../../lib/format'
import { cashflowSeries, comparePeriods, summarizeFinance, type CashflowPoint, type FinanceSummary, type PeriodComparison } from '../../domain/finance'
import { roomOccupancy, type OccupancySnapshot } from '../../domain/occupancy'
import { comparableRanges, rangeForPreset } from '../../domain/period'
import {
  buildAttentionSections,
  buildExpiringItems,
  buildLookups,
  buildRecentPayments,
  buildVacantGroups,
  lastSixMonthsRange,
  type AttentionSection,
  type ExpiringItem,
  type RecentPaymentItem,
  type VacantRoomGroup,
} from './dashboardModel'

export interface DashboardData {
  today: string
  occupancy: OccupancySnapshot
  month: FinanceSummary
  comparison: PeriodComparison
  isPartial: boolean
  attention: AttentionSection[]
  attentionCount: number
  expiring: ExpiringItem[]
  vacant: VacantRoomGroup[]
  vacantCount: number
  recentPayments: RecentPaymentItem[]
  cashflow: CashflowPoint[]
  /** org-wide counts for the first-run checklist (ignore the kos filter) */
  totals: { properties: number; rooms: number; leases: number }
}

/** One query per table (lease_addons included so next-period amounts match buildInvoiceDraft); everything else is derived in a single useMemo. */
export function useDashboardData() {
  const { properties, propertyFilterIds, financePropertyIds } = useOrg()
  const rooms = useTable('rooms')
  const leases = useTable('leases')
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  const tenants = useTable('tenants')
  const addons = useTable('lease_addons')

  const queries = [rooms, leases, invoices, payments, expenses, tenants, addons]
  const isPending = queries.some((q) => q.isPending)
  const error = queries.find((q) => q.isError)?.error ?? null

  const today = todayISO()

  const data = useMemo<DashboardData | null>(() => {
    if (!rooms.data || !leases.data || !invoices.data || !payments.data || !expenses.data || !tenants.data || !addons.data) return null
    const filter = new Set(propertyFilterIds)
    const inFilter = (propertyId: string | null) => propertyId !== null && filter.has(propertyId)

    const filteredRooms = rooms.data.filter((r) => inFilter(r.property_id))
    const filteredLeases = leases.data.filter((l) => inFilter(l.property_id))
    const filteredPayments = payments.data.filter((p) => inFilter(p.property_id))
    const lookups = buildLookups(tenants.data, rooms.data, properties)

    const occupancy = roomOccupancy(filteredRooms, leases.data, today)

    const monthRange = rangeForPreset('monthly', today)
    const month = summarizeFinance(payments.data, expenses.data, invoices.data, monthRange, financePropertyIds, today)
    const cmp = comparableRanges(monthRange, today, 'monthly')
    const current = summarizeFinance(payments.data, expenses.data, invoices.data, cmp.current, financePropertyIds, today)
    const previous = summarizeFinance(payments.data, expenses.data, invoices.data, cmp.previous, financePropertyIds, today)
    const comparison = comparePeriods(current, previous)

    const attention = buildAttentionSections(filteredLeases, invoices.data, payments.data, addons.data, lookups, today)
    const attentionIds = new Set(attention.flatMap((s) => s.items.map((i) => i.lease.id)))
    const expiring = buildExpiringItems(filteredLeases, attentionIds, lookups, today)
    const vacant = buildVacantGroups(filteredRooms, leases.data, lookups, properties, today)
    const recentPayments = buildRecentPayments(filteredPayments, leases.data, lookups, 5)
    const cashflow = cashflowSeries(payments.data, expenses.data, lastSixMonthsRange(today), 'month', financePropertyIds)

    return {
      today,
      occupancy,
      month,
      comparison,
      isPartial: cmp.isPartial,
      attention,
      attentionCount: attentionIds.size,
      expiring,
      vacant,
      vacantCount: vacant.reduce((n, g) => n + g.rooms.length, 0),
      recentPayments,
      cashflow,
      totals: { properties: properties.length, rooms: rooms.data.length, leases: leases.data.length },
    }
  }, [rooms.data, leases.data, invoices.data, payments.data, expenses.data, tenants.data, addons.data, properties, propertyFilterIds, financePropertyIds, today])

  return { data, isPending, error }
}
