import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowUpDown, CalendarSearch, Plus, Search, Share2, Users } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import type { Invoice, Lease } from '../../types/db'
import { summarizeLeaseBilling } from '../../domain/billing'
import { plateMatches } from '../../domain/plate'
import { todayISO, whatsappLink } from '../../lib/format'
import { useLeaseData } from './useLeaseData'
import { useLeaseActions } from './useLeaseActions'
import {
  DEFAULT_LEASE_SORT,
  LEASE_SORT_KEYS,
  LEASE_SORT_LABEL,
  displayBillingState,
  leaseReminderText,
  matchesLeaseSearch,
  openInvoicesSorted,
  parseLeaseSort,
  sortLeaseItems,
  type LeaseListItem,
  type LeaseSortKey,
} from './leaseUtils'
import { LeaseListHeader, LeaseRow } from './components'
import { PaymentModal } from './PaymentModal'
import { NextInvoiceModal } from './InvoiceFormModal'
import { InvoiceShareModal } from '../invoices/InvoiceShareModal'

type Tab = 'active' | 'finished'

export function LeasesPage() {
  const { propertyFilterIds, selectedPropertyId, properties } = useOrg()
  const data = useLeaseData()
  const actions = useLeaseActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const sortKey = parseLeaseSort(params.get('urut'))
  const setSortKey = (key: LeaseSortKey) => {
    const next = new URLSearchParams(params)
    if (key === DEFAULT_LEASE_SORT) next.delete('urut')
    else next.set('urut', key)
    setParams(next, { replace: true })
  }
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ kind: 'pay' | 'invoice'; lease: Lease } | null>(null)
  /** "Kirim tagihan": the invoice image modal for one lease */
  const [share, setShare] = useState<{ invoice: Invoice; lease: Lease } | null>(null)
  const today = todayISO()

  const items = useMemo<LeaseListItem[]>(() => {
    return data.leases
      .filter((l) => propertyFilterIds.includes(l.property_id))
      .map((lease) => ({
        lease,
        summary: summarizeLeaseBilling(lease, data.invoices, data.payments, today),
        room: data.roomById.get(lease.room_id),
        tenant: data.tenantById.get(lease.tenant_id),
        propertyName: data.propertyById.get(lease.property_id)?.name ?? '-',
      }))
  }, [data.leases, data.invoices, data.payments, data.roomById, data.tenantById, data.propertyById, propertyFilterIds, today])

  const active = useMemo(() => sortLeaseItems(items.filter((i) => i.lease.status === 'active'), sortKey, false, today), [items, sortKey, today])
  const finished = useMemo(() => sortLeaseItems(items.filter((i) => i.lease.status !== 'active'), sortKey, true, today), [items, sortKey, today])
  const shown = (tab === 'active' ? active : finished).filter((i) => matchesLeaseSearch(i, search))
  const attention = active.filter((i) => ['overdue', 'due_soon'].includes(displayBillingState(i.lease, i.summary, today))).length

  const showKos = selectedPropertyId === 'all'
  const kosName = showKos ? 'semua kos' : (properties.find((p) => p.id === selectedPropertyId)?.name ?? 'kos terpilih')

  const modalLease = modal?.lease
  const modalInvoices = useMemo(() => (modalLease ? data.invoices.filter((i) => i.lease_id === modalLease.id) : []), [data.invoices, modalLease])
  const modalAddons = useMemo(() => (modalLease ? data.leaseAddons.filter((a) => a.lease_id === modalLease.id) : []), [data.leaseAddons, modalLease])

  // Leases that have something to send: the menu item is disabled for the others ('Belum ada tagihan').
  const leasesWithInvoice = useMemo(() => new Set(data.invoices.filter((i) => i.status !== 'void').map((i) => i.lease_id)), [data.invoices])
  // The oldest open invoice, else the latest non-void one; picked only when the menu item is tapped.
  const openShare = (lease: Lease) => {
    const [oldestOpen] = openInvoicesSorted(lease.id, data.invoices, data.payments)
    const latest = data.invoices
      .filter((i) => i.lease_id === lease.id && i.status !== 'void')
      .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.created_at.localeCompare(a.created_at))[0]
    const invoice = oldestOpen ?? latest
    if (invoice) setShare({ invoice, lease })
  }
  // A freshly issued invoice (NextInvoiceModal.onCreated) may not be in the query cache yet: fall back to the inserted row.
  const shareInvoice = share ? (data.invoices.find((i) => i.id === share.invoice.id) ?? share.invoice) : null
  const shareAddons = useMemo(() => (share ? data.leaseAddons.filter((a) => a.lease_id === share.lease.id) : []), [data.leaseAddons, share])

  // Built only when the menu item is tapped: a reminder per row on every render would be wasted work.
  const openReminder = (item: LeaseListItem) => {
    const { lease, tenant } = item
    const text = leaseReminderText({
      lease,
      tenant,
      room: item.room,
      property: data.propertyById.get(lease.property_id),
      invoices: data.invoices.filter((i) => i.lease_id === lease.id),
      orgInvoices: data.invoices,
      payments: data.payments,
      addons: data.leaseAddons.filter((a) => a.lease_id === lease.id),
    })
    const link = text ? whatsappLink(tenant?.phone, text) : null
    if (!link) {
      toast.error('Pengingat tidak dapat dibuat untuk sewa ini.')
      return
    }
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <PageHeader
        title="Sewa & Tagihan"
        subtitle={data.isPending ? 'Memuat…' : `${active.length} sewa aktif di ${kosName}${attention > 0 ? ` · ${attention} perlu perhatian` : ''}`}
        actions={
          <>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/sewa/baru')}>
              Sewa Baru
            </Button>
            {/* Rencana check-in & daftar tunggu (SPEC 7.7) */}
            <Link to="/rencana" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <CalendarSearch className="h-4 w-4" aria-hidden /> Cek kamar
            </Link>
            <Link to="/daftar-tunggu" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <Users className="h-4 w-4" aria-hidden /> Daftar tunggu
            </Link>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm" role="tablist">
          {(
            [
              ['active', `Aktif (${active.length})`],
              ['finished', `Selesai/Batal (${finished.length})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={clsx('flex-1 whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition-colors', tab === key ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari penyewa, kamar, atau plat…"
            aria-label="Cari sewa"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <ArrowUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span className="shrink-0">Urutkan</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(parseLeaseSort(e.target.value))}
            aria-label="Urutkan sewa"
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 sm:flex-none"
          >
            {LEASE_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {LEASE_SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.isPending ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={search ? 'Tidak ada sewa yang cocok' : tab === 'active' ? 'Belum ada sewa aktif' : 'Belum ada sewa selesai'}
          description={search ? 'Coba kata kunci lain.' : tab === 'active' ? 'Mulai dengan membuat sewa untuk penyewa yang masuk.' : 'Sewa yang sudah checkout atau dibatalkan akan muncul di sini.'}
          action={
            tab === 'active' && !search ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/sewa/baru')}>
                Sewa Baru
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <LeaseListHeader />
          <ul className="divide-y divide-slate-100">
            {shown.map((item) => (
              <LeaseRow
                key={item.lease.id}
                item={item}
                today={today}
                showKos={showKos}
                onPay={() => setModal({ kind: 'pay', lease: item.lease })}
                onInvoice={() => setModal({ kind: 'invoice', lease: item.lease })}
                onReminder={() => openReminder(item)}
                // found by its plate (SPEC 7.11): show it, so the hit explains itself
                plate={search && plateMatches(item.lease.vehicle_plate, search) ? item.lease.vehicle_plate : null}
                extraItems={[
                  {
                    label: 'Kirim tagihan',
                    hint: leasesWithInvoice.has(item.lease.id) ? 'Gambar tagihan ke WhatsApp' : 'Belum ada tagihan',
                    icon: <Share2 className="h-4 w-4" />,
                    disabled: !leasesWithInvoice.has(item.lease.id),
                    onClick: () => openShare(item.lease),
                  },
                ]}
              />
            ))}
          </ul>
        </Card>
      )}

      {modalLease && (
        <>
          <PaymentModal
            open={modal?.kind === 'pay'}
            onClose={() => setModal(null)}
            lease={modalLease}
            invoices={modalInvoices}
            payments={data.payments}
            expenses={data.expenses}
            property={data.propertyById.get(modalLease.property_id)}
            room={data.roomById.get(modalLease.room_id)}
            tenant={data.tenantById.get(modalLease.tenant_id)}
            actions={actions}
          />
          <NextInvoiceModal
            open={modal?.kind === 'invoice'}
            onClose={() => setModal(null)}
            lease={modalLease}
            room={data.roomById.get(modalLease.room_id)}
            addons={modalAddons}
            leaseInvoices={modalInvoices}
            orgInvoices={data.invoices}
            payments={data.payments}
            expenses={data.expenses}
            actions={actions}
            onCreated={(invoice) => setShare({ invoice, lease: modalLease })}
          />
        </>
      )}
      {share && shareInvoice && (
        <InvoiceShareModal
          open
          onClose={() => setShare(null)}
          invoice={shareInvoice}
          lease={share.lease}
          tenant={data.tenantById.get(share.lease.tenant_id)}
          room={data.roomById.get(share.lease.room_id)}
          property={data.propertyById.get(share.lease.property_id)}
          payments={data.payments}
          leaseAddons={shareAddons}
        />
      )}
    </>
  )
}
