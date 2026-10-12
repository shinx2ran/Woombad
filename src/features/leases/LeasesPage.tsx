import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowUpDown, ChevronRight, FilePlus2, Plus, Search, Wallet } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, LeaseStatusBadge, LoadingState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import type { Lease } from '../../types/db'
import { summarizeLeaseBilling } from '../../domain/billing'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'
import { useLeaseData } from './useLeaseData'
import { useLeaseActions } from './useLeaseActions'
import {
  DEFAULT_LEASE_SORT,
  LEASE_SORT_KEYS,
  LEASE_SORT_LABEL,
  displayBillingState,
  dueLabel,
  matchesLeaseSearch,
  parseLeaseSort,
  sortLeaseItems,
  type LeaseListItem,
  type LeaseSortKey,
} from './leaseUtils'
import { BillingStateBadge, DueLine } from './components'
import { PaymentModal } from './PaymentModal'
import { NextInvoiceModal } from './InvoiceFormModal'

type Tab = 'active' | 'finished'

export function LeasesPage() {
  const { propertyFilterIds, selectedPropertyId, properties } = useOrg()
  const data = useLeaseData()
  const actions = useLeaseActions()
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

  const active = useMemo(() => sortLeaseItems(items.filter((i) => i.lease.status === 'active'), sortKey), [items, sortKey])
  const finished = useMemo(() => sortLeaseItems(items.filter((i) => i.lease.status !== 'active'), sortKey, true), [items, sortKey])
  const shown = (tab === 'active' ? active : finished).filter((i) => matchesLeaseSearch(i, search))
  const attention = active.filter((i) => ['overdue', 'due_soon'].includes(displayBillingState(i.lease, i.summary, today))).length

  const kosName = selectedPropertyId === 'all' ? 'semua kos' : (properties.find((p) => p.id === selectedPropertyId)?.name ?? 'kos terpilih')

  const modalLease = modal?.lease
  const modalInvoices = useMemo(() => (modalLease ? data.invoices.filter((i) => i.lease_id === modalLease.id) : []), [data.invoices, modalLease])
  const modalAddons = useMemo(() => (modalLease ? data.leaseAddons.filter((a) => a.lease_id === modalLease.id) : []), [data.leaseAddons, modalLease])

  return (
    <>
      <PageHeader
        title="Sewa & Tagihan"
        subtitle={data.isPending ? 'Memuat…' : `${active.length} sewa aktif di ${kosName}${attention > 0 ? ` · ${attention} perlu perhatian` : ''}`}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/sewa/baru')}>
            Sewa Baru
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
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
            placeholder="Cari penyewa atau kamar…"
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
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((item) => (
            <li key={item.lease.id}>
              <LeaseCard item={item} today={today} onPay={() => setModal({ kind: 'pay', lease: item.lease })} onInvoice={() => setModal({ kind: 'invoice', lease: item.lease })} />
            </li>
          ))}
        </ul>
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
            actions={actions}
          />
        </>
      )}
    </>
  )
}

function LeaseCard({ item, today, onPay, onInvoice }: { item: LeaseListItem; today: string; onPay: () => void; onInvoice: () => void }) {
  const { lease, summary, room, tenant, propertyName } = item
  const isActive = lease.status === 'active'
  const due = dueLabel(lease, summary, today)
  return (
    <Card className="flex h-full flex-col">
      <Link to={`/sewa/${lease.id}`} className="block rounded-t-xl px-4 pt-3 pb-2 hover:bg-slate-50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">
              Kamar {room?.name ?? '?'} <span className="font-normal text-slate-500">· {propertyName}</span>
            </p>
            <p className="truncate text-sm text-slate-700">{tenant?.full_name ?? 'Penyewa tidak ditemukan'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isActive ? <BillingStateBadge state={displayBillingState(lease, summary, today)} /> : <LeaseStatusBadge status={lease.status} />}
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </div>
        {due && (
          <div className="mt-2">
            <DueLine due={due} />
          </div>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Periode</dt>
            <dd className="text-slate-800">
              {PERIOD_TYPE_LABEL[lease.period_type]} · <span className="whitespace-nowrap">{formatRupiah(lease.price_per_period)}/{PERIOD_UNIT_LABEL[lease.period_type]}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Dibayar s/d</dt>
            <dd className="text-slate-800">{summary.paidThrough ? formatDate(summary.paidThrough) : '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Sisa tagihan</dt>
            <dd className={clsx('tabular-nums font-medium', summary.outstanding > 0 ? 'text-red-700' : 'text-slate-800')}>{formatRupiah(summary.outstanding)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{isActive ? 'Sewa s/d' : 'Berakhir'}</dt>
            <dd className="text-slate-800">{formatDate(isActive ? lease.end_date : (lease.checkout_date ?? lease.end_date))}</dd>
          </div>
        </dl>
      </Link>
      {isActive && (
        <div className="mt-auto flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
          <Button size="sm" variant="secondary" icon={<Wallet className="h-4 w-4" />} onClick={onPay} disabled={summary.outstanding <= 0}>
            Bayar
          </Button>
          <Button size="sm" variant="outline" icon={<FilePlus2 className="h-4 w-4" />} onClick={onInvoice}>
            Tagihan berikutnya
          </Button>
          {tenant && (
            <Link to={`/penyewa/${tenant.id}`} className="ml-auto hidden text-xs font-medium text-brand-700 hover:underline sm:inline">
              Profil penyewa
            </Link>
          )}
        </div>
      )}
      {lease.status === 'ended' && lease.checkout_date && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Checkout {formatDate(lease.checkout_date)}</div>
      )}
    </Card>
  )
}
