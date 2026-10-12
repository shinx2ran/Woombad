import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronRight, Phone, Plus, Search, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { todayISO } from '../../lib/format'
import type { Lease, Property, Room, Tenant } from '../../types/db'
import { TenantFormModal } from './TenantFormModal'
import { currentStayFor, describeIdentity, describeRoom, filterTenantsByProperty, initials, matchesTenantSearch } from './tenantUtils'

export function TenantsPage() {
  const { properties, propertyFilterIds, selectedPropertyId } = useOrg()
  const tenants = useTable('tenants', { orderBy: { column: 'full_name', ascending: true } })
  const leases = useTable('leases')
  const rooms = useTable('rooms')
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const formOpen = searchParams.get('new') === '1'
  // /penyewa?new=1&scan=1 opens the form with the document scanner ready (check-in shortcut)
  const autoScan = formOpen && searchParams.get('scan') === '1'

  const openForm = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.set('new', '1')
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const closeForm = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    next.delete('scan')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const today = todayISO()
  const visible = useMemo(() => {
    const scoped = filterTenantsByProperty(tenants.data ?? [], propertyFilterIds, selectedPropertyId)
    return scoped.filter((t) => matchesTenantSearch(t, search)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
  }, [tenants.data, propertyFilterIds, selectedPropertyId, search])

  const total = useMemo(
    () => filterTenantsByProperty(tenants.data ?? [], propertyFilterIds, selectedPropertyId).length,
    [tenants.data, propertyFilterIds, selectedPropertyId],
  )

  const kosName = selectedPropertyId === 'all' ? 'semua kos' : properties.find((p) => p.id === selectedPropertyId)?.name ?? 'kos terpilih'

  return (
    <>
      <PageHeader
        title="Penyewa"
        subtitle={tenants.isPending ? 'Memuat…' : `${total} penyewa di ${kosName}`}
        actions={
          <div className="hidden sm:block">
            <Button icon={<Plus className="h-4 w-4" />} onClick={openForm}>
              Tambah Penyewa
            </Button>
          </div>
        }
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, NIK/paspor, atau nomor HP…"
          aria-label="Cari penyewa"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {tenants.isPending || leases.isPending || rooms.isPending ? (
        <LoadingState label="Memuat penyewa…" />
      ) : tenants.isError ? (
        <ErrorState error={tenants.error} />
      ) : visible.length === 0 ? (
        search.trim() ? (
          <EmptyState icon={<Search className="h-10 w-10" />} title="Tidak ditemukan" description={`Tidak ada penyewa yang cocok dengan "${search.trim()}".`} action={<Button variant="outline" onClick={() => setSearch('')}>Hapus pencarian</Button>} />
        ) : (
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title="Belum ada penyewa"
            description={selectedPropertyId === 'all' ? 'Tambahkan penyewa pertama Anda. Data KTP atau paspor bisa diisi otomatis lewat Scan KTP / Paspor.' : `Belum ada penyewa terdaftar di ${kosName}.`}
            action={
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={openForm}>
                Tambah Penyewa
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {visible.map((t) => (
              <TenantRow key={t.id} tenant={t} leases={leases.data ?? []} rooms={rooms.data ?? []} properties={properties} today={today} showKos={selectedPropertyId === 'all'} />
            ))}
          </ul>
        </Card>
      )}

      {/* FAB on phones (bottom bar is 56px + safe area) */}
      <button
        type="button"
        onClick={openForm}
        aria-label="Tambah Penyewa"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:hidden"
      >
        <Plus className="h-6 w-6" />
      </button>

      <TenantFormModal open={formOpen} onClose={closeForm} autoScan={autoScan} />
    </>
  )
}

function TenantRow({
  tenant,
  leases,
  rooms,
  properties,
  today,
  showKos,
}: {
  tenant: Tenant
  leases: Lease[]
  rooms: Room[]
  properties: Property[]
  today: string
  showKos: boolean
}) {
  const stay = currentStayFor(tenant.id, leases, today)
  const kos = tenant.property_id ? properties.find((p) => p.id === tenant.property_id)?.name : null
  const identity = describeIdentity(tenant)
  return (
    <li>
      <Link to={`/penyewa/${tenant.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-brand-50/50 sm:px-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800" aria-hidden>
          {initials(tenant.full_name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{tenant.full_name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {tenant.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" aria-hidden />
                {tenant.phone}
              </span>
            ) : (
              <span className="italic">Belum ada nomor HP</span>
            )}
            {identity.text && <span className="tabular-nums">{identity.text}</span>}
            {showKos && kos && !stay && <span>{kos}</span>}
          </span>
          <span className="mt-1.5 block">
            {stay ? (
              <Badge tone={stay.kind === 'occupied' ? 'success' : 'info'}>
                {stay.kind === 'reserved' ? 'Dipesan: ' : ''}
                {describeRoom(stay.lease, rooms, properties)}
              </Badge>
            ) : (
              <Badge tone="neutral">Tidak menyewa</Badge>
            )}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden />
      </Link>
    </li>
  )
}
