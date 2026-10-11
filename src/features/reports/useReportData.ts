import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import type { DateRange, Granularity, RangePreset } from '../../domain/period'
import { comparableRanges } from '../../domain/period'
import {
  cashflowSeries,
  comparePeriods,
  expensesByCategory,
  outstandingInvoices,
  profitByProperty,
  revenueByMethod,
  summarizeFinance,
  type FinanceSummary,
  type OutstandingItem,
} from '../../domain/finance'
import { occupancySeries, roomOccupancy, type OccupancySnapshot } from '../../domain/occupancy'
import type { Expense, Invoice, Lease, Payment, Property, Room, Tenant } from '../../types/db'
import type { ReportPreset } from './reportRange'

export interface ReceivableRow extends OutstandingItem {
  lease: Lease | undefined
  tenant: Tenant | undefined
  room: Room | undefined
  property: Property | undefined
}

export interface ReportData {
  payments: Payment[]
  expenses: Expense[]
  invoices: Invoice[]
  leases: Lease[]
  rooms: Room[]
  tenants: Tenant[]
  /** properties visible under the global kos filter */
  visibleProperties: Property[]
  summary: FinanceSummary
  previousSummary: FinanceSummary
  comparison: ReturnType<typeof comparePeriods>
  isPartial: boolean
  previousRange: DateRange
  cashflow: ReturnType<typeof cashflowSeries>
  byCategory: ReturnType<typeof expensesByCategory>
  byProperty: ReturnType<typeof profitByProperty>
  byMethod: ReturnType<typeof revenueByMethod>
  occupancy: ReturnType<typeof occupancySeries>
  occupancyNow: OccupancySnapshot
  occupancyPrevious: OccupancySnapshot
  receivables: ReceivableRow[]
}

/**
 * Loads every table the report needs and derives all figures with the pure functions in src/domain.
 * Finance/export/occupancy functions receive `financePropertyIds` (never `propertyFilterIds`).
 */
export function useReportData(range: DateRange, preset: ReportPreset, granularity: Granularity, today: string) {
  const { properties, propertyFilterIds, financePropertyIds, selectedPropertyId } = useOrg()
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  const invoices = useTable('invoices')
  const leases = useTable('leases')
  const rooms = useTable('rooms')
  const tenants = useTable('tenants')

  const queries = [payments, expenses, invoices, leases, rooms, tenants]
  const isPending = queries.some((q) => q.isPending)
  const error = queries.find((q) => q.isError)?.error

  const data = useMemo<ReportData | null>(() => {
    if (!payments.data || !expenses.data || !invoices.data || !leases.data || !rooms.data || !tenants.data) return null
    const pay = payments.data
    const exp = expenses.data
    const inv = invoices.data
    const lea = leases.data
    const visibleProperties = properties.filter((p) => propertyFilterIds.includes(p.id))
    const visibleRooms = rooms.data.filter((r) => propertyFilterIds.includes(r.property_id))

    const summary = summarizeFinance(pay, exp, inv, range, financePropertyIds, today)
    const rangePreset: RangePreset | undefined = preset === 'custom' ? undefined : preset
    const cmp = comparableRanges(range, today, rangePreset)
    const currentCmp = cmp.isPartial ? summarizeFinance(pay, exp, inv, cmp.current, financePropertyIds, today) : summary
    const previousSummary = summarizeFinance(pay, exp, inv, cmp.previous, financePropertyIds, today)
    const comparison = comparePeriods(currentCmp, previousSummary)

    const byProperty = profitByProperty(pay, exp, visibleProperties, range).filter(
      (row) => row.propertyId !== 'shared' || selectedPropertyId === 'all',
    )

    const propertyById = new Map(properties.map((p) => [p.id, p]))
    const roomById = new Map(rooms.data.map((r) => [r.id, r]))
    const tenantById = new Map(tenants.data.map((t) => [t.id, t]))
    const leaseById = new Map(lea.map((l) => [l.id, l]))
    const receivables: ReceivableRow[] = outstandingInvoices(inv, pay, today, financePropertyIds, lea)
      .filter((item) => item.invoice.due_date <= range.end)
      .map((item) => {
        const lease = leaseById.get(item.invoice.lease_id)
        const room = lease ? roomById.get(lease.room_id) : undefined
        return {
          ...item,
          lease,
          room,
          tenant: lease ? tenantById.get(lease.tenant_id) : undefined,
          property: propertyById.get(room?.property_id ?? item.invoice.property_id),
        }
      })

    return {
      payments: pay,
      expenses: exp,
      invoices: inv,
      leases: lea,
      rooms: rooms.data,
      tenants: tenants.data,
      visibleProperties,
      summary,
      previousSummary,
      comparison,
      isPartial: cmp.isPartial,
      previousRange: cmp.previous,
      cashflow: cashflowSeries(pay, exp, range, granularity, financePropertyIds),
      byCategory: expensesByCategory(exp, range, financePropertyIds),
      byProperty,
      byMethod: revenueByMethod(pay, range, financePropertyIds),
      occupancy: occupancySeries(visibleRooms, lea, range, granularity),
      occupancyNow: roomOccupancy(visibleRooms, lea, today),
      occupancyPrevious: roomOccupancy(visibleRooms, lea, cmp.previous.end),
      receivables,
    }
  }, [
    payments.data,
    expenses.data,
    invoices.data,
    leases.data,
    rooms.data,
    tenants.data,
    properties,
    propertyFilterIds,
    financePropertyIds,
    selectedPropertyId,
    range,
    preset,
    granularity,
    today,
  ])

  return { data, isPending, error }
}
