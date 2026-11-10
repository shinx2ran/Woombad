import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { Button, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import type { AddonBilling, AddonCatalogItem, Expense, Invoice, Lease, LeaseAddon, Payment, PeriodType, Room } from '../../types/db'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, PERIOD_TYPES, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { depositBalance, outstandingFor, paidAmountFor } from '../../domain/billing'
import { isCancelledWithoutStay, plannedCheckoutOf } from '../../domain/occupancy'
import { formatCheckout, formatDate, formatRupiah, formatStay, todayISO } from '../../lib/format'
import {
  cancelledLeaseEndDate,
  futureInvoicesAtCheckout,
  openInvoicesSorted,
  roomAvailability,
  roomPriceFor,
  unrecordedRentRefunds,
  validateSettlement,
  ROOM_AVAILABILITY_LABEL,
  type DepositSettlement,
  type RentRefund,
} from './leaseUtils'
import { DepositSettlementForm, PriceField, Row } from './components'
import type { LeaseActions, PartialDecision } from './useLeaseActions'
import { usePriceConfirm } from './usePriceConfirm'
import { PriceConfirm } from './PriceConfirm'

const emptySettlement = (held: number): DepositSettlement => ({ refund: Math.max(0, held), rent: 0, damage: 0, damageNotes: '' })

/**
 * Per partially-paid invoice: refund the DP (invoice closed at the paid amount + expense rent_refund) or forfeit it
 * (remaining -> discount, paid). Either way the invoice is closed, never voided (it has payments). SPEC 2b.4.
 */
function PartialDecisionList({
  invoices,
  payments,
  decisions,
  onChange,
}: {
  invoices: Invoice[]
  payments: Payment[]
  decisions: Record<string, PartialDecision>
  onChange: (next: Record<string, PartialDecision>) => void
}) {
  return (
    <>
      {invoices.map((inv) => {
        const paid = paidAmountFor(inv.id, payments)
        return (
          <div key={inv.id} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">
              {inv.invoice_number} · {formatStay(inv.period_start, inv.period_end)} · dibayar {formatRupiah(paid)} dari {formatRupiah(inv.total_amount)}
            </p>
            <label className="flex items-start gap-2">
              <input type="radio" name={`dec-${inv.id}`} className="mt-0.5" checked={decisions[inv.id] === 'refund'} onChange={() => onChange({ ...decisions, [inv.id]: 'refund' })} />
              <span>
                <strong>Kembalikan {formatRupiah(paid)}</strong> ke penyewa (pengeluaran 'Pengembalian Sewa'), tagihan ditutup.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name={`dec-${inv.id}`} className="mt-0.5" checked={decisions[inv.id] === 'forfeit'} onChange={() => onChange({ ...decisions, [inv.id]: 'forfeit' })} />
              <span>
                <strong>Anggap hangus</strong>: DP tetap pendapatan, sisa {formatRupiah(inv.total_amount - paid)} jadi diskon, tagihan lunas.
              </span>
            </label>
          </div>
        )
      })}
    </>
  )
}

/** Refunds an interrupted checkout/cancel already closed the invoice for but did not record; recorded on submit. */
function UnrecordedRefundsNote({ refunds }: { refunds: RentRefund[] }) {
  if (refunds.length === 0) return null
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Pengembalian DP yang belum tercatat akan dicatat sebagai pengeluaran 'Pengembalian Sewa':{' '}
      {refunds.map((r) => `${r.invoice.invoice_number} (${formatRupiah(r.amount)})`).join(', ')}.
    </p>
  )
}

// ---------- checkout ----------

export interface CheckoutModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  actions: LeaseActions
  /**
   * SPEC 7.15: open "Catat deposit diterima" (the lease page returns to this checkout afterwards). Without it the
   * warning about an agreed deposit that was never recorded as received only says where to record it.
   */
  onRecordDeposit?: () => void
  /** SPEC 7.22 (pindah & ganti jenis sewa): the day the sheet starts on instead of the plan / today */
  initialDate?: string
  /** called after a successful checkout with its date, before onClose */
  onDone?: (checkoutDate: string) => void
}

/**
 * SPEC 2b.5: checkout date, void future unpaid invoices, decide per future partially-paid invoice (refund /
 * forfeit, so no receivable survives on an ended lease), settle the held deposit, status ended. The checkout date is
 * the day the tenant leaves: invoices starting ON that day count as future (SPEC 7.3, futureInvoicesAtCheckout). It
 * starts at the tenant's Rencana keluar when one is recorded (SPEC 7.8), else today. An agreed deposit that was never
 * recorded as received is pointed out above the settlement, which only returns what was received (SPEC 7.15).
 */
export function CheckoutModal({ open, onClose, lease, invoices, payments, expenses, actions, onRecordDeposit, initialDate, onDone }: CheckoutModalProps) {
  const toast = useToast()
  const balance = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])
  const planned = plannedCheckoutOf(lease)
  const [date, setDate] = useState(initialDate ?? planned ?? todayISO())
  const [decisions, setDecisions] = useState<Record<string, PartialDecision>>({})
  const [settlement, setSettlement] = useState<DepositSettlement>(emptySettlement(balance.held))
  const [saving, setSaving] = useState(false)
  /** SPEC 7.15: the sheet closes for "Catat deposit diterima" and comes back: keep what was typed */
  const resumeRef = useRef(false)

  useEffect(() => {
    if (!open) return
    if (resumeRef.current) {
      resumeRef.current = false
      // the deposit held may have grown: keep the deductions typed when they still fit, refund the rest
      setSettlement((s) => (s.rent + s.damage > 0 && s.rent + s.damage <= balance.held ? { ...s, refund: balance.held - s.rent - s.damage } : emptySettlement(balance.held)))
      return
    }
    setDate(initialDate ?? planned ?? todayISO())
    setDecisions({})
    setSettlement(emptySettlement(balance.held))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const future = useMemo(() => futureInvoicesAtCheckout(lease.id, invoices, payments, date), [lease.id, invoices, payments, date])
  const unrecorded = useMemo(() => unrecordedRentRefunds(lease.id, invoices, payments, expenses), [lease.id, invoices, payments, expenses])
  const paidAhead = future.paid.filter((i) => !unrecorded.some((r) => r.invoice.id === i.id))
  const open_ = useMemo(() => {
    const closedIds = new Set([...future.toVoid, ...future.partial].map((i) => i.id))
    return openInvoicesSorted(lease.id, invoices, payments).filter((i) => !closedIds.has(i.id))
  }, [lease.id, invoices, payments, future])
  const rentCapacity = open_.reduce((s, i) => s + outstandingFor(i, payments), 0)
  const settlementError = balance.held > 0 ? validateSettlement(settlement, balance.held, rentCapacity) : null
  const dateError = !date ? 'Tanggal checkout wajib diisi.' : date < lease.start_date ? 'Tanggal checkout tidak boleh sebelum tanggal mulai sewa.' : null
  const missing = future.partial.some((i) => !decisions[i.id])
  // Invoices after the checkout date must be voided or settled, which only owners/admins may do (SPEC 6.2).
  const needsAdmin = !actions.canEditInvoices && (future.toVoid.length > 0 || future.partial.length > 0)

  const submit = async () => {
    if (dateError || settlementError || missing || needsAdmin) return
    setSaving(true)
    try {
      await actions.checkout({
        lease,
        checkoutDate: date,
        invoices,
        payments,
        settlement: balance.held > 0 ? settlement : emptySettlement(0),
        partialDecisions: decisions,
      })
      toast.success('Checkout dicatat. Sewa selesai.')
      onDone?.(date)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencatat checkout.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Checkout penyewa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={Boolean(dateError || settlementError) || missing || needsAdmin}>
            Selesaikan checkout
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Tanggal checkout"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          error={dateError ?? undefined}
          hint={
            planned && date === planned
              ? 'Sesuai rencana keluar penyewa. Hari penyewa keluar kamar; malam itu tidak ditagih lagi.'
              : 'Hari penyewa keluar kamar; malam itu tidak ditagih lagi.'
          }
        />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Check-out menjadi" value={formatDate(date)} />
          <Row label="Tagihan dibatalkan (mulai hari checkout atau sesudahnya)" value={future.toVoid.length} />
          {future.partial.length > 0 && <Row label="Tagihan DP sejak hari checkout → perlu keputusan" value={future.partial.length} />}
          <Row label="Sisa tagihan sebelum checkout tetap piutang" value={formatRupiah(rentCapacity)} strong />
        </div>
        {needsAdmin && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="checkout-needs-admin">
            Ada tagihan untuk periode mulai hari checkout atau sesudahnya yang harus dibatalkan. Hanya pemilik/admin yang dapat membatalkan tagihan:
            minta mereka melakukan checkout ini.
          </p>
        )}
        {future.toVoid.length > 0 && (
          <p className="text-xs text-slate-500">
            Dibatalkan: {future.toVoid.map((i) => `${i.invoice_number} (${formatDate(i.period_start)})`).join(', ')}.
          </p>
        )}
        {future.partial.length > 0 && (
          <p className="text-xs text-amber-800">
            Tagihan berikut sudah dibayar sebagian untuk periode yang mulai <strong>pada atau setelah</strong> tanggal checkout. Pilih penyelesaiannya agar tidak ada piutang yang tersisa pada sewa yang sudah selesai.
          </p>
        )}
        {!needsAdmin && <PartialDecisionList invoices={future.partial} payments={payments} decisions={decisions} onChange={setDecisions} />}
        {paidAhead.length > 0 && (
          <p className="text-xs text-slate-500">
            Sudah lunas untuk periode sejak hari checkout: {paidAhead.map((i) => `${i.invoice_number} (${formatStay(i.period_start, i.period_end)})`).join(', ')}. Bila uangnya
            dikembalikan, catat sebagai pengeluaran 'Pengembalian Sewa' pada sewa ini.
          </p>
        )}
        <UnrecordedRefundsNote refunds={unrecorded} />
        {balance.shortfall > 0 && (
          <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="checkout-deposit-shortfall">
            <p>
              <strong>
                Deposit disepakati {formatRupiah(balance.agreed)}, tercatat diterima {formatRupiah(balance.received)}.
              </strong>{' '}
              Pengembalian di bawah hanya menghitung deposit yang tercatat diterima. Bila uang jaminannya memang sudah dipegang, catat dulu
              {onRecordDeposit ? '.' : ' lewat Lainnya → Catat deposit diterima.'}
            </p>
            {onRecordDeposit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resumeRef.current = true
                  onRecordDeposit()
                }}
              >
                Catat deposit diterima
              </Button>
            )}
          </div>
        )}
        <DepositSettlementForm balance={balance} value={settlement} onChange={setSettlement} rentCapacity={rentCapacity} error={settlementError} />
      </div>
    </Modal>
  )
}

// ---------- cancel ----------

export type CancelLeaseModalProps = CheckoutModalProps

/** SPEC 2b.4: void unpaid invoices, decide per partial invoice (refund / forfeit), settle deposit, status cancelled. */
export function CancelLeaseModal({ open, onClose, lease, invoices, payments, expenses, actions }: CancelLeaseModalProps) {
  const toast = useToast()
  const balance = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])
  const [date, setDate] = useState(todayISO())
  const [decisions, setDecisions] = useState<Record<string, PartialDecision>>({})
  const [settlement, setSettlement] = useState<DepositSettlement>(emptySettlement(balance.held))
  const [saving, setSaving] = useState(false)

  const leaseInvoices = useMemo(() => invoices.filter((i) => i.lease_id === lease.id && i.status !== 'void'), [invoices, lease.id])
  const unpaid = leaseInvoices.filter((i) => paidAmountFor(i.id, payments) === 0)
  const partial = leaseInvoices.filter((i) => {
    const p = paidAmountFor(i.id, payments)
    return p > 0 && p < i.total_amount
  })
  const unrecorded = useMemo(() => unrecordedRentRefunds(lease.id, invoices, payments, expenses), [lease.id, invoices, payments, expenses])

  useEffect(() => {
    if (!open) return
    setDate(todayISO())
    setDecisions({})
    setSettlement(emptySettlement(balance.held))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const missing = partial.some((i) => !decisions[i.id])
  const settlementError = balance.held > 0 ? validateSettlement(settlement, balance.held, 0) : null
  const dateError = !date ? 'Tanggal pembatalan wajib diisi.' : null
  const notStarted = Boolean(date) && date < lease.start_date
  // the typed date is a check-out day: end_date = the night before, never before start_date (cancelledLeaseEndDate)
  const cancelEnd = date ? cancelledLeaseEndDate(lease, date) : null
  // the rule every screen uses after saving (isCancelledWithoutStay): end_date clamped to start_date = no night stayed
  const noStay = cancelEnd !== null && isCancelledWithoutStay({ status: 'cancelled', start_date: lease.start_date, end_date: cancelEnd })

  const submit = async () => {
    if (missing || settlementError || dateError) return
    setSaving(true)
    try {
      await actions.cancelLease({ lease, invoices, payments, partialDecisions: decisions, settlement: balance.held > 0 ? settlement : emptySettlement(0), dateISO: date })
      toast.success('Sewa dibatalkan.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan sewa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Batalkan sewa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Kembali
          </Button>
          <Button variant="danger" onClick={submit} loading={saving} disabled={missing || Boolean(settlementError || dateError)}>
            Batalkan sewa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sewa dibatalkan seolah tidak pernah berjalan: kamar dianggap tidak pernah dihuni. Gunakan <strong>Checkout</strong> bila penyewa memang pernah tinggal.
        </p>
        <Input
          label="Tanggal pembatalan"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          error={dateError ?? undefined}
          hint={notStarted ? `Sewa belum mulai (${formatDate(lease.start_date)}); tanggal ini dipakai untuk pencatatan pengembalian.` : undefined}
        />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Tagihan belum bayar → dibatalkan" value={unpaid.length} />
          <Row label="Tagihan DP / sebagian → perlu keputusan" value={partial.length} />
          {/* end_date shown back as its check-out day (= the typed date) like the list and the detail page; a cancel up to
              the day after the start stores end_date = start_date, which every screen shows as no night stayed (the
              list says 'Berakhir <start>'), so no check-out day is claimed here either */}
          {cancelEnd && <Row label="Sewa berakhir menjadi" value={noStay ? 'Belum ada malam menginap' : formatCheckout(cancelEnd)} />}
        </div>
        <PartialDecisionList invoices={partial} payments={payments} decisions={decisions} onChange={setDecisions} />
        <UnrecordedRefundsNote refunds={unrecorded} />
        <DepositSettlementForm balance={balance} value={settlement} onChange={setSettlement} rentCapacity={0} error={settlementError} />
      </div>
    </Modal>
  )
}

// ---------- move room ----------

export interface MoveRoomModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  rooms: Room[]
  leases: Lease[]
  currentRoom: Room | undefined
  actions: LeaseActions
  /**
   * SPEC 7.22: the tenant moves AND changes the kind of stay (harian in B3 -> mingguan in A10). A lease keeps its
   * period type, so this is a check-out of this lease on the move day followed by a new lease in the target room; the
   * lease page runs both with its existing dialogs.
   */
  onChangeType?: (move: { room: Room; periodType: PeriodType; date: string }) => void
}

/**
 * SPEC 2b.9: same kos, same kind of stay -> change room (and price) on this lease, note appended. SPEC 7.22: another
 * kind of stay in the new room -> check-out + new lease (onChangeType).
 */
export function MoveRoomModal({ open, onClose, lease, rooms, leases, currentRoom, actions, onChangeType }: MoveRoomModalProps) {
  const toast = useToast()
  const [roomId, setRoomId] = useState('')
  /** the kind of stay in the new room; the lease's own = an ordinary move */
  const [newType, setNewType] = useState<PeriodType>(lease.period_type)
  const changesType = newType !== lease.period_type
  const [date, setDate] = useState(todayISO())
  const [price, setPrice] = useState(lease.price_per_period)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setRoomId('')
    setNewType(lease.period_type)
    setDate(todayISO())
    setPrice(lease.price_per_period)
    priceCheck.reset()
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const stayEnd = lease.end_date >= date ? lease.end_date : date
  const candidates = useMemo(
    () =>
      rooms
        .filter((r) => r.property_id === lease.property_id && r.id !== lease.room_id)
        // a new lease (another kind of stay) has its own length, checked by the Sewa baru form: here the room only has to
        // be free on the move day (SPEC 7.20: a later booking does not block it)
        .map((r) => ({ room: r, availability: changesType ? roomAvailability(r, leases, date, date, lease.id, todayISO()) : roomAvailability(r, leases, date, stayEnd, lease.id) }))
        .sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true })),
    [rooms, leases, lease, date, stayEnd, changesType],
  )
  const target = candidates.find((c) => c.room.id === roomId)
  const unit = PERIOD_UNIT_LABEL[lease.period_type]
  // SPEC 7.14: only a NEW price is questioned (the price the lease already has is not this dialog's business)
  const newPrice = Boolean(target) && !changesType && actions.canEditLeaseTerms && price !== lease.price_per_period
  const priceCheck = usePriceConfirm(price, roomPriceFor(target?.room, lease.period_type), unit, newPrice)
  // a cleared price field is 0: never written as the lease's new price (a lease already at 0 still moves)
  const priceZero = newPrice && price <= 0

  const pickRoom = (id: string) => {
    setRoomId(id)
    // Staff keep the agreed price; changing it is admin-only (SPEC 6.2).
    if (!actions.canEditLeaseTerms) return
    const r = rooms.find((x) => x.id === id)
    const p = roomPriceFor(r, lease.period_type)
    if (p != null) setPrice(p)
  }

  const submit = async () => {
    if (!target || target.availability !== 'kosong') return
    if (changesType) {
      onChangeType?.({ room: target.room, periodType: newType, date })
      return
    }
    setTouched(true)
    if (priceZero) return
    if (!priceCheck.ok) {
      priceCheck.focus()
      return
    }
    setSaving(true)
    try {
      await actions.moveRoom(lease, currentRoom, target.room, price !== lease.price_per_period ? price : null, date)
      toast.success(`Pindah ke kamar ${target.room.name} dicatat.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memindahkan kamar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pindah kamar"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={!target || target.availability !== 'kosong'}>
            {changesType ? 'Lanjut: check-out' : 'Pindahkan'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Pindah dalam kos yang sama mengubah kamar pada sewa ini; tagihan yang sudah ada tidak berubah. Pindah ke kos lain: lakukan <strong>Checkout</strong> lalu buat{' '}
          <Link to={`/sewa/baru?tenant=${lease.tenant_id}`} className="font-medium text-brand-700 hover:underline">
            sewa baru
          </Link>{' '}
          di kos tujuan.
        </p>
        <Input label="Tanggal pindah" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {onChangeType && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Jenis sewa di kamar baru</span>
            <div role="radiogroup" aria-label="Jenis sewa di kamar baru" className="grid grid-cols-3 rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {PERIOD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === newType}
                  onClick={() => setNewType(t)}
                  className={clsx('min-h-11 rounded-md px-1 py-2 font-medium transition-colors sm:min-h-0 sm:py-1.5', t === newType ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
                >
                  {PERIOD_TYPE_LABEL[t]}
                  {t === lease.period_type && ' (tetap)'}
                </button>
              ))}
            </div>
          </div>
        )}
        {changesType && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="move-change-type-note">
            Ganti dari {PERIOD_TYPE_LABEL[lease.period_type].toLowerCase()} ke {PERIOD_TYPE_LABEL[newType].toLowerCase()}: sewa ini di-<strong>check-out</strong> pada tanggal pindah, lalu{' '}
            <strong>sewa {PERIOD_TYPE_LABEL[newType].toLowerCase()} baru</strong> dibuat di kamar tujuan untuk penyewa yang sama. Dua langkah, dipandu berurutan.
          </p>
        )}
        <Select
          label="Kamar tujuan"
          value={roomId}
          onChange={(e) => pickRoom(e.target.value)}
          placeholder="Pilih kamar"
          required
          options={candidates.map((c) => ({
            value: c.room.id,
            label: `${c.room.name}${c.room.floor ? ` (Lt. ${c.room.floor})` : ''} · ${ROOM_AVAILABILITY_LABEL[c.availability]}`,
            disabled: c.availability !== 'kosong',
          }))}
          hint={candidates.length === 0 ? 'Tidak ada kamar lain di kos ini.' : 'Hanya kamar kosong tanpa jadwal bentrok yang bisa dipilih.'}
        />
        {target && !changesType && !actions.canEditLeaseTerms && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Harga sewa tetap {formatRupiah(lease.price_per_period)} / {PERIOD_UNIT_LABEL[lease.period_type]}. Hanya pemilik/admin yang dapat mengubah harga sewa.
          </p>
        )}
        {target && !changesType && actions.canEditLeaseTerms && (
          <PriceField
            label={`Harga baru per ${PERIOD_UNIT_LABEL[lease.period_type]} (${PERIOD_TYPE_LABEL[lease.period_type]})`}
            value={price}
            onChange={setPrice}
            standard={roomPriceFor(target.room, lease.period_type)}
            unit={PERIOD_UNIT_LABEL[lease.period_type]}
            error={touched && priceZero ? `Harga per ${PERIOD_UNIT_LABEL[lease.period_type]} harus lebih dari 0.` : undefined}
            extraHint={`Harga sekarang ${formatRupiah(lease.price_per_period)}; berlaku untuk tagihan berikutnya.`}
          />
        )}
        <PriceConfirm state={priceCheck} showError={touched} />
      </div>
    </Modal>
  )
}

// ---------- add-on ----------

export interface AddonModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  catalog: AddonCatalogItem[]
  actions: LeaseActions
}

export function AddonModal({ open, onClose, lease, catalog, actions }: AddonModalProps) {
  const toast = useToast()
  const [catalogId, setCatalogId] = useState('custom')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [billing, setBilling] = useState<AddonBilling>('per_period')
  const [saving, setSaving] = useState(false)

  const items = useMemo(() => catalog.filter((c) => c.property_id === null || c.property_id === lease.property_id), [catalog, lease.property_id])

  useEffect(() => {
    if (!open) return
    setCatalogId('custom')
    setName('')
    setAmount(0)
    setBilling('per_period')
  }, [open])

  const pick = (id: string) => {
    setCatalogId(id)
    const item = items.find((c) => c.id === id)
    if (item) {
      setName(item.name)
      setAmount(item.default_price)
      setBilling(item.billing)
    }
  }

  const submit = async () => {
    setSaving(true)
    try {
      await actions.addAddon(lease, name, amount, billing)
      toast.success('Add-on ditambahkan. Berlaku untuk tagihan berikutnya.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah add-on.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah add-on"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={!name.trim()}>
            Tambah
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Dari katalog"
          value={catalogId}
          onChange={(e) => pick(e.target.value)}
          options={[{ value: 'custom', label: 'Add-on lain (isi manual)' }, ...items.map((c) => ({ value: c.id, label: `${c.name} · ${formatRupiah(c.default_price)} · ${ADDON_BILLING_LABEL[c.billing]}` }))]}
        />
        <Input label="Nama" value={name} onChange={(e) => setName(e.target.value)} required error={!name.trim() ? 'Nama wajib diisi.' : undefined} />
        <MoneyInput label="Jumlah" value={amount} onChange={setAmount} />
        <Select label="Penagihan" value={billing} onChange={(e) => setBilling(e.target.value as AddonBilling)} options={ADDON_BILLINGS.map((b) => ({ value: b, label: ADDON_BILLING_LABEL[b] }))} />
        <p className="text-xs text-slate-500">Add-on hanya memengaruhi tagihan yang dibuat setelah ini; tagihan yang sudah ada tidak berubah.</p>
      </div>
    </Modal>
  )
}

/** Shown in the add-on list on the detail page. */
export function describeAddon(a: LeaseAddon): string {
  return `${formatRupiah(a.amount)} · ${ADDON_BILLING_LABEL[a.billing]}`
}
