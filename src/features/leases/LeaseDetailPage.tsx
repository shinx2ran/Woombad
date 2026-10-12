import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, ArrowLeftRight, Ban, CalendarPlus, DoorOpen, FilePlus2, MessageCircle, PiggyBank, Plus, Trash2, Wallet } from 'lucide-react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  InvoiceStatusBadge,
  LeaseStatusBadge,
  LoadingState,
  PageHeader,
  StatCard,
  useToast,
  type Column,
} from '../../components/ui'
import type { Invoice, LeaseAddon, Payment } from '../../types/db'
import { PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { buildInvoiceDraft, depositBalance, invoiceUnitLabel, outstandingFor, paidAmountFor, summarizeLeaseBilling } from '../../domain/billing'
import { reminderText } from '../../domain/messages'
import { formatDate, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import { useLeaseData } from './useLeaseData'
import { useLeaseActions } from './useLeaseActions'
import { agreedPriceText, invoiceTimeline, openInvoicesSorted, displayBillingState, priceDelta, priceDeltaText, roomPriceFor } from './leaseUtils'
import { ActionMenu, BillingStateBadge, InvoiceTimeline, Row, type MenuItem } from './components'
import { DepositModal, PaymentModal } from './PaymentModal'
import { EditInvoiceModal, NextInvoiceModal } from './InvoiceFormModal'
import { AddonModal, CancelLeaseModal, CheckoutModal, MoveRoomModal, describeAddon } from './LifecycleModals'

type ModalKind = 'pay' | 'deposit' | 'invoice' | 'edit' | 'checkout' | 'cancel' | 'move' | 'addon'
type Confirm =
  | { kind: 'void-invoice'; invoice: Invoice }
  | { kind: 'delete-invoice'; invoice: Invoice }
  | { kind: 'delete-payment'; payment: Payment }
  | { kind: 'remove-addon'; addon: LeaseAddon }

export function LeaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const data = useLeaseData()
  const actions = useLeaseActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const isAdmin = actions.isAdmin
  const today = todayISO()

  const [modal, setModal] = useState<ModalKind | null>(null)
  const [payInvoiceId, setPayInvoiceId] = useState<string | undefined>(undefined)
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [paymentsFilter, setPaymentsFilter] = useState<string | null>(null)

  const lease = useMemo(() => data.leases.find((l) => l.id === id), [data.leases, id])
  const leaseInvoices = useMemo(
    () => data.invoices.filter((i) => i.lease_id === id).sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [data.invoices, id],
  )
  const leasePayments = useMemo(
    () => data.payments.filter((p) => p.lease_id === id).sort((a, b) => (a.paid_at === b.paid_at ? b.created_at.localeCompare(a.created_at) : b.paid_at.localeCompare(a.paid_at))),
    [data.payments, id],
  )
  const addons = useMemo(() => data.leaseAddons.filter((a) => a.lease_id === id), [data.leaseAddons, id])
  const summary = useMemo(() => (lease ? summarizeLeaseBilling(lease, data.invoices, data.payments, today) : null), [lease, data.invoices, data.payments, today])
  const deposit = useMemo(() => (lease ? depositBalance(lease, data.payments, data.expenses) : null), [lease, data.payments, data.expenses])
  const timeline = useMemo(() => (lease ? invoiceTimeline(lease, data.invoices, data.payments, today) : []), [lease, data.invoices, data.payments, today])

  // Deep links from other modules: /sewa/:id?action=bayar|tagih|checkout
  useEffect(() => {
    const action = params.get('action')
    if (!action || !lease) return
    if (action === 'bayar') setModal('pay')
    else if (action === 'tagih') setModal('invoice')
    else if (action === 'checkout' && lease.status === 'active') setModal('checkout')
    const next = new URLSearchParams(params)
    next.delete('action')
    setParams(next, { replace: true })
  }, [params, lease, setParams])

  if (data.isPending) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />
  if (!lease || !summary || !deposit) {
    return (
      <EmptyState
        title="Sewa tidak ditemukan"
        description="Sewa mungkin sudah dihapus atau tautan salah."
        action={
          <Button variant="outline" onClick={() => navigate('/sewa')}>
            Kembali ke daftar sewa
          </Button>
        }
      />
    )
  }

  const room = data.roomById.get(lease.room_id)
  const tenant = data.tenantById.get(lease.tenant_id)
  const property = data.propertyById.get(lease.property_id)
  const isActive = lease.status === 'active'
  // SPEC 5.4: the room's current rate for the lease's type is the 'harga standar'.
  const standardPrice = roomPriceFor(room, lease.period_type)
  const openInvoices = openInvoicesSorted(lease.id, leaseInvoices, data.payments)

  // WhatsApp reminder: the oldest open invoice, or the next period when nothing is open.
  let reminder: string | null = null
  if (tenant?.phone) {
    const oldest = openInvoices[0]
    if (oldest) {
      reminder = reminderText({
        tenantName: tenant.full_name,
        roomName: room?.name ?? '-',
        propertyName: property?.name ?? 'Kos',
        outstanding: outstandingFor(oldest, data.payments),
        dueDate: oldest.due_date,
        periodStart: oldest.period_start,
        periodEnd: oldest.period_end,
        paymentInfo: property?.payment_info,
      })
    } else if (isActive) {
      try {
        const draft = buildInvoiceDraft({ lease, addons, quantity: 1, existingInvoices: leaseInvoices, orgInvoices: data.invoices })
        reminder = reminderText({
          tenantName: tenant.full_name,
          roomName: room?.name ?? '-',
          propertyName: property?.name ?? 'Kos',
          outstanding: draft.total_amount,
          dueDate: draft.due_date,
          periodStart: draft.period_start,
          periodEnd: draft.period_end,
          paymentInfo: property?.payment_info,
        })
      } catch {
        reminder = null
      }
    }
  }
  const waLink = reminder ? whatsappLink(tenant?.phone, reminder) : null

  const openPay = (invoiceId?: string) => {
    setPayInvoiceId(invoiceId)
    setModal('pay')
  }

  const runConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      switch (confirm.kind) {
        case 'void-invoice':
          await actions.voidInvoice(confirm.invoice, lease, leaseInvoices, data.payments)
          toast.success(`Tagihan ${confirm.invoice.invoice_number} dibatalkan.`)
          break
        case 'delete-invoice':
          await actions.deleteInvoice(confirm.invoice, lease, leaseInvoices, data.payments)
          toast.success('Tagihan dihapus.')
          break
        case 'delete-payment':
          await actions.deletePayment(confirm.payment)
          toast.success('Pembayaran dihapus; status tagihan diperbarui.')
          break
        case 'remove-addon':
          await actions.removeAddon(confirm.addon)
          toast.success('Add-on dihapus. Tagihan yang sudah ada tidak berubah.')
          break
      }
      setConfirm(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memproses.')
    } finally {
      setBusy(false)
    }
  }

  const menuItems: MenuItem[] = []
  if (isActive) {
    menuItems.push({ label: 'Perpanjang', hint: 'Buat tagihan periode berikutnya', icon: <CalendarPlus className="h-4 w-4" />, onClick: () => setModal('invoice') })
    menuItems.push({ label: 'Pindah kamar', hint: 'Dalam kos yang sama', icon: <ArrowLeftRight className="h-4 w-4" />, onClick: () => setModal('move') })
    if (deposit.shortfall > 0 || deposit.agreed > 0) {
      menuItems.push({ label: 'Catat deposit diterima', icon: <PiggyBank className="h-4 w-4" />, onClick: () => setModal('deposit') })
    }
    // Staff may check out (SPEC 6.2; the modal explains when future invoices need an admin). 'Batalkan sewa'
    // voids invoices: admin only.
    menuItems.push({ label: 'Checkout', hint: 'Penyewa keluar; selesaikan jaminan', icon: <DoorOpen className="h-4 w-4" />, onClick: () => setModal('checkout') })
    if (isAdmin) menuItems.push({ label: 'Batalkan sewa', hint: 'Sewa tidak pernah berjalan', icon: <Ban className="h-4 w-4" />, danger: true, onClick: () => setModal('cancel') })
  }

  const invoiceMenu = (inv: Invoice): MenuItem[] => {
    const paid = paidAmountFor(inv.id, data.payments)
    const payable = inv.status !== 'void' && outstandingFor(inv, data.payments) > 0
    const items: MenuItem[] = [
      { label: 'Bayar', icon: <Wallet className="h-4 w-4" />, disabled: !payable, onClick: () => openPay(inv.id) },
      { label: 'Lihat pembayaran', onClick: () => setPaymentsFilter(inv.id) },
    ]
    if (isAdmin && inv.status !== 'void') {
      items.push({
        label: 'Ubah',
        hint: 'Listrik, denda, diskon, catatan',
        onClick: () => {
          setEditInvoice(inv)
          setModal('edit')
        },
      })
    }
    if (isAdmin && inv.status !== 'void') {
      items.push({ label: 'Batalkan tagihan', hint: paid > 0 ? 'Sudah ada pembayaran' : 'Nomor tetap tercatat', danger: true, disabled: paid > 0, onClick: () => setConfirm({ kind: 'void-invoice', invoice: inv }) })
      items.push({ label: 'Hapus', hint: paid > 0 ? 'Sudah ada pembayaran' : 'Lebih disarankan: batalkan', danger: true, disabled: paid > 0, onClick: () => setConfirm({ kind: 'delete-invoice', invoice: inv }) })
    }
    return items
  }

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Nomor',
      render: (inv) => <span className="font-mono text-xs text-slate-900">{inv.invoice_number}</span>,
    },
    {
      key: 'period',
      header: 'Periode',
      hideOnMobile: true,
      render: (inv) => (
        <span>
          {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
          <span className="block text-xs text-slate-500">{`${inv.quantity} ${invoiceUnitLabel(inv, lease)}`}</span>
        </span>
      ),
    },
    { key: 'due', header: 'Jatuh tempo', hideOnMobile: true, render: (inv) => formatDate(inv.due_date) },
    { key: 'total', header: 'Total', align: 'right', render: (inv) => formatRupiah(inv.total_amount) },
    { key: 'paid', header: 'Dibayar', align: 'right', hideOnMobile: true, render: (inv) => formatRupiah(paidAmountFor(inv.id, data.payments)) },
    {
      key: 'rest',
      header: 'Sisa',
      align: 'right',
      render: (inv) => {
        const rest = outstandingFor(inv, data.payments)
        return <span className={clsx(rest > 0 && 'font-medium text-red-700')}>{formatRupiah(rest)}</span>
      },
    },
    { key: 'status', header: 'Status', render: (inv) => <InvoiceStatusBadge status={inv.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (inv) => <ActionMenu items={invoiceMenu(inv)} label={`Aksi tagihan ${inv.invoice_number}`} />,
    },
  ]

  const shownPayments = paymentsFilter ? leasePayments.filter((p) => p.invoice_id === paymentsFilter) : leasePayments
  const invoiceNumber = (invId: string | null) => leaseInvoices.find((i) => i.id === invId)?.invoice_number

  return (
    <>
      <div className="mb-2">
        <Link to="/sewa" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Semua sewa
        </Link>
      </div>
      <PageHeader
        title={`Kamar ${room?.name ?? '?'}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{property?.name ?? '-'}</span>
            <span aria-hidden>·</span>
            {tenant ? (
              <Link to={`/penyewa/${tenant.id}`} className="font-medium text-brand-700 hover:underline">
                {tenant.full_name}
              </Link>
            ) : (
              <span>Penyewa tidak ditemukan</span>
            )}
            <LeaseStatusBadge status={lease.status} />
            {isActive && <BillingStateBadge state={displayBillingState(lease, summary, today)} />}
          </span>
        }
        actions={
          <>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100" title="Kirim pengingat via WhatsApp">
                <MessageCircle className="h-4 w-4" /> <span className="hidden sm:inline">Pengingat WA</span>
              </a>
            )}
            {(isActive || summary.outstanding > 0) && (
              <Button variant="secondary" icon={<Wallet className="h-4 w-4" />} onClick={() => openPay()} disabled={openInvoices.length === 0}>
                Catat pembayaran
              </Button>
            )}
            {isActive && (
              <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setModal('invoice')}>
                Buat tagihan berikutnya
              </Button>
            )}
            <ActionMenu items={menuItems} label="Aksi sewa" trigger={<span className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">Lainnya ▾</span>} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Dibayar s/d" value={summary.paidThrough ? formatDate(summary.paidThrough) : '-'} sub={summary.coveredThrough ? `Ditagih s/d ${formatDate(summary.coveredThrough)}` : 'Belum ada tagihan'} />
        <StatCard
          label="Sisa tagihan"
          value={formatRupiah(summary.outstanding)}
          tone={summary.outstanding > 0 ? 'negative' : 'positive'}
          sub={isActive && summary.nextDueDate ? `Jatuh tempo ${formatDate(summary.nextDueDate)}` : undefined}
        />
        <StatCard
          label="Deposit dipegang"
          value={formatRupiah(deposit.held)}
          tone={deposit.shortfall > 0 ? 'warning' : 'default'}
          sub={`Diterima ${formatRupiah(deposit.received)} · dipotong ${formatRupiah(deposit.applied)} · dikembalikan ${formatRupiah(deposit.returned)}${deposit.shortfall > 0 ? ` · belum diterima ${formatRupiah(deposit.shortfall)}` : ''}`}
        />
        <StatCard label={lease.status === 'ended' ? 'Checkout' : 'Berakhir'} value={formatDate(lease.checkout_date ?? lease.end_date)} sub={`Mulai ${formatDate(lease.start_date)}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Info sewa" />
          <CardBody className="space-y-1.5">
            <Row label="Periode" value={`${PERIOD_TYPE_LABEL[lease.period_type]} · ${formatRupiah(lease.price_per_period)}/${PERIOD_UNIT_LABEL[lease.period_type]}`} />
            <p className="text-right text-xs text-slate-500" data-testid="agreed-price">
              {agreedPriceText(lease.price_per_period, standardPrice)}
              {priceDeltaText(priceDelta(lease.price_per_period, standardPrice)) && (
                <span className="ml-1 font-medium text-slate-700">({priceDeltaText(priceDelta(lease.price_per_period, standardPrice))})</span>
              )}
            </p>
            <Row label="Mulai" value={formatDate(lease.start_date)} />
            <Row label="Berakhir" value={formatDate(lease.end_date)} />
            {lease.checkout_date && <Row label="Checkout" value={formatDate(lease.checkout_date)} />}
            <Row label="Deposit disepakati" value={formatRupiah(lease.deposit_amount)} />
            <Row label="Penyewa" value={tenant?.phone ?? '-'} />
            {lease.notes && <p className="whitespace-pre-wrap border-t border-slate-100 pt-2 text-xs text-slate-600">{lease.notes}</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Linimasa tagihan" subtitle="Periode yang sudah ditagih; celah berarti ada hari yang belum ditagih." />
          <CardBody>
            <InvoiceTimeline segments={timeline} today={today} />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`Tagihan (${leaseInvoices.length})`}
          action={
            isActive ? (
              <Button size="sm" variant="outline" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setModal('invoice')}>
                Buat tagihan
              </Button>
            ) : undefined
          }
        />
        <CardBody className="px-0 py-0">
          <div className="hidden md:block [&>div]:rounded-none [&>div]:border-0">
            <DataTable columns={invoiceColumns} rows={leaseInvoices} rowKey={(i) => i.id} emptyMessage="Belum ada tagihan untuk sewa ini." />
          </div>
          <ul className="divide-y divide-slate-100 md:hidden">
            {leaseInvoices.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Belum ada tagihan untuk sewa ini.</li>}
            {leaseInvoices.map((inv) => {
              const rest = outstandingFor(inv, data.payments)
              return (
                <li key={inv.id} className="flex items-start gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-slate-900">{inv.invoice_number}</span>
                      <InvoiceStatusBadge status={inv.status} />
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(inv.period_start)} – {formatDate(inv.period_end)} · {inv.quantity} {invoiceUnitLabel(inv, lease)} · jatuh tempo {formatDate(inv.due_date)}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums">
                      <span className="text-slate-800">{formatRupiah(inv.total_amount)}</span>
                      {inv.status !== 'void' && (
                        <span className={clsx('ml-2', rest > 0 ? 'font-medium text-red-700' : 'text-emerald-700')}>{rest > 0 ? `sisa ${formatRupiah(rest)}` : 'lunas'}</span>
                      )}
                    </p>
                  </div>
                  <ActionMenu items={invoiceMenu(inv)} label={`Aksi tagihan ${inv.invoice_number}`} />
                </li>
              )
            })}
          </ul>
        </CardBody>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Pembayaran (${leasePayments.length})`}
            subtitle={
              paymentsFilter ? (
                <span>
                  Menampilkan pembayaran {invoiceNumber(paymentsFilter) ?? ''} ·{' '}
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setPaymentsFilter(null)}>
                    tampilkan semua
                  </button>
                </span>
              ) : (
                'Termasuk deposit dan pemasukan lain untuk sewa ini.'
              )
            }
            action={
              (isActive || summary.outstanding > 0) && openInvoices.length > 0 ? (
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => openPay()}>
                  Catat
                </Button>
              ) : undefined
            }
          />
          <CardBody className="px-0 py-0">
            {shownPayments.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Belum ada pembayaran.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shownPayments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-slate-900">
                        <span className="font-medium">{formatDate(p.paid_at)}</span>
                        <span className="text-slate-500">{PAYMENT_KIND_LABEL[p.kind]}</span>
                        <span className={clsx('rounded-full px-1.5 py-0.5 text-xs', p.method === 'deposit' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700')}>{PAYMENT_METHOD_LABEL[p.method]}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[invoiceNumber(p.invoice_id), p.notes].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <span className={clsx('shrink-0 tabular-nums font-semibold', p.kind === 'deposit' ? 'text-slate-700' : 'text-emerald-700')}>{formatRupiah(p.amount)}</span>
                    {isAdmin && (
                      <button type="button" aria-label="Hapus pembayaran" onClick={() => setConfirm({ kind: 'delete-payment', payment: p })} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`Add-on (${addons.length})`}
            subtitle="Berlaku untuk tagihan berikutnya."
            action={
              isActive ? (
                <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('addon')}>
                  Tambah
                </Button>
              ) : undefined
            }
          />
          <CardBody className="px-0 py-0">
            {addons.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada add-on.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {addons.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{a.name}</p>
                      <p className="text-xs text-slate-500">{describeAddon(a)}</p>
                    </div>
                    {isActive && (
                      <button type="button" aria-label={`Hapus add-on ${a.name}`} onClick={() => setConfirm({ kind: 'remove-addon', addon: a })} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Modals */}
      <PaymentModal
        open={modal === 'pay'}
        onClose={() => setModal(null)}
        lease={lease}
        invoices={leaseInvoices}
        payments={data.payments}
        expenses={data.expenses}
        property={property}
        room={room}
        tenant={tenant}
        actions={actions}
        defaultInvoiceId={payInvoiceId}
      />
      <DepositModal open={modal === 'deposit'} onClose={() => setModal(null)} lease={lease} payments={data.payments} expenses={data.expenses} actions={actions} />
      <NextInvoiceModal open={modal === 'invoice'} onClose={() => setModal(null)} lease={lease} room={room} addons={addons} leaseInvoices={leaseInvoices} orgInvoices={data.invoices} actions={actions} />
      <EditInvoiceModal open={modal === 'edit'} onClose={() => setModal(null)} invoice={editInvoice} payments={data.payments} actions={actions} />
      <CheckoutModal open={modal === 'checkout'} onClose={() => setModal(null)} lease={lease} invoices={leaseInvoices} payments={data.payments} expenses={data.expenses} actions={actions} />
      <CancelLeaseModal open={modal === 'cancel'} onClose={() => setModal(null)} lease={lease} invoices={leaseInvoices} payments={data.payments} expenses={data.expenses} actions={actions} />
      <MoveRoomModal open={modal === 'move'} onClose={() => setModal(null)} lease={lease} rooms={data.rooms} leases={data.leases} currentRoom={room} actions={actions} />
      <AddonModal open={modal === 'addon'} onClose={() => setModal(null)} lease={lease} catalog={data.addonCatalog} actions={actions} />

      <ConfirmDialog
        open={confirm?.kind === 'void-invoice'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title="Batalkan tagihan?"
        confirmLabel="Batalkan tagihan"
        message={confirm?.kind === 'void-invoice' ? `Tagihan ${confirm.invoice.invoice_number} akan ditandai Dibatalkan. Nomor tagihan tetap tercatat dan tidak dipakai ulang.` : ''}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete-invoice'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title="Hapus tagihan?"
        message={confirm?.kind === 'delete-invoice' ? `Tagihan ${confirm.invoice.invoice_number} akan dihapus permanen. Lebih disarankan membatalkan tagihan agar nomor tidak dipakai ulang.` : ''}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete-payment'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title="Hapus pembayaran?"
        message={confirm?.kind === 'delete-payment' ? `Pembayaran ${formatRupiah(confirm.payment.amount)} tanggal ${formatDate(confirm.payment.paid_at)} akan dihapus dan status tagihan dihitung ulang.` : ''}
      />
      <ConfirmDialog
        open={confirm?.kind === 'remove-addon'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title="Hapus add-on?"
        message={confirm?.kind === 'remove-addon' ? `Add-on ${confirm.addon.name} tidak akan ditagihkan lagi mulai tagihan berikutnya. Tagihan yang sudah ada tidak berubah.` : ''}
      />
    </>
  )
}
