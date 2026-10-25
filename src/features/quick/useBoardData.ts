import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'

export interface BoardData {
  leases: Lease[]
  rooms: Room[]
  invoices: Invoice[]
  payments: Payment[]
  leaseAddons: LeaseAddon[]
  tenantById: Map<string, Tenant>
  propertyById: Map<string, Property>
  isPending: boolean
  error: unknown
}

/**
 * Only the tables the Papan kamar reads, all of which useDashboardData already loads: on the Dashboard the board then
 * renders in the same pass as the stats instead of popping in later and pushing them down (useLeaseData would also
 * wait for addon_catalog, which the Dashboard never loads).
 */
export function useBoardData(): BoardData {
  const { properties } = useOrg()
  const leases = useTable('leases')
  const rooms = useTable('rooms')
  const tenants = useTable('tenants')
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const leaseAddons = useTable('lease_addons')

  const queries = [leases, rooms, tenants, invoices, payments, leaseAddons]
  const isPending = queries.some((q) => q.isPending)
  const error = queries.find((q) => q.isError)?.error

  const tenantById = useMemo(() => new Map((tenants.data ?? []).map((t) => [t.id, t])), [tenants.data])
  const propertyById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties])

  return {
    leases: leases.data ?? [],
    rooms: rooms.data ?? [],
    invoices: invoices.data ?? [],
    payments: payments.data ?? [],
    leaseAddons: leaseAddons.data ?? [],
    tenantById,
    propertyById,
    isPending,
    error,
  }
}
