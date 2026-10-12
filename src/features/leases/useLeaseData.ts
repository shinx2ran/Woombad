import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import type { AddonCatalogItem, Expense, Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'

export interface LeaseData {
  leases: Lease[]
  rooms: Room[]
  tenants: Tenant[]
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  leaseAddons: LeaseAddon[]
  addonCatalog: AddonCatalogItem[]
  properties: Property[]
  roomById: Map<string, Room>
  tenantById: Map<string, Tenant>
  propertyById: Map<string, Property>
  isPending: boolean
  error: unknown
}

/**
 * Loads every table the leases module needs in one go (the data set of a kos is tiny) and exposes lookup
 * maps. Pages filter/aggregate in useMemo with src/domain functions.
 */
export function useLeaseData(): LeaseData {
  const { properties } = useOrg()
  const leases = useTable('leases')
  const rooms = useTable('rooms')
  const tenants = useTable('tenants')
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  const leaseAddons = useTable('lease_addons')
  const addonCatalog = useTable('addon_catalog')

  const queries = [leases, rooms, tenants, invoices, payments, expenses, leaseAddons, addonCatalog]
  const isPending = queries.some((q) => q.isPending)
  const error = queries.find((q) => q.isError)?.error

  const roomById = useMemo(() => new Map((rooms.data ?? []).map((r) => [r.id, r])), [rooms.data])
  const tenantById = useMemo(() => new Map((tenants.data ?? []).map((t) => [t.id, t])), [tenants.data])
  const propertyById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties])

  return {
    leases: leases.data ?? [],
    rooms: rooms.data ?? [],
    tenants: tenants.data ?? [],
    invoices: invoices.data ?? [],
    payments: payments.data ?? [],
    expenses: expenses.data ?? [],
    leaseAddons: leaseAddons.data ?? [],
    addonCatalog: addonCatalog.data ?? [],
    properties,
    roomById,
    tenantById,
    propertyById,
    isPending,
    error,
  }
}
