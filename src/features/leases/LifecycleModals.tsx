import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import type { AddonBilling, AddonCatalogItem, Expense, Invoice, Lease, LeaseAddon, Payment, Room } from '../../types/db'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { depositBalance, outstandingFor, paidAmountFor } from '../../domain/billing'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'
import {
  cancelledLeaseEndDate,
  futureInvoicesAtCheckout,
  openInvoicesSorted,
  roomAvailability,
  roomPriceFor,
  validateSettlement,
  ROOM_AVAILABILITY_LABEL,
  type DepositSettlement,
} from './leaseUtils'
import { DepositSettlementForm, PriceField, Row } from './components'
import type { LeaseActions, PartialDecision } from './useLeaseActions'

const emptySettlement = (held: number): DepositSettlement => ({ refund: Math.max(0, held), rent: 0, damage: 0, damageNotes: '' })

/** Per partially-paid invoice: refund the DP (expense rent_refund + void) or forfeit it (remaining -> discount, paid). SPEC 2b.4. */
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
              {inv.invoice_number} · {formatDate(inv.period_start)} – {formatDate(inv.period_end)} · dibayar {formatRupiah(paid)} dari {formatRupiah(inv.total_amount)}
            </p>
            <label className="flex items-start gap-2">
              <input type="radio" name={`dec-${inv.id}`} className="mt-0.5" checked={decisions[inv.id] === 'refund'} onChange={() => onChange({ ...decisions, [inv.id]: 'refund' })} />
              <span>
                <strong>Kembalikan {formatRupiah(paid)}</strong> ke penyewa (pengeluaran 'Pengembalian Sewa'), tagihan dibatalkan.
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

// ---------- checkout ----------

export interface CheckoutModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  actions: LeaseActions
}

/**
 * SPEC 2b.5: checkout date, void future unpaid invoices, decide per future partially-paid invoice (refund /
 * forfeit, so no receivable survives on an ended lease), settle the held deposit, status ended.
 */
export function CheckoutModal({ open, onClose, lease, invoices, payments, expenses, actions }: CheckoutModalProps) {
  const toast = useToast()
  const balance = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])
  const [date, setDate] = useState(todayISO())
  const [decisions, setDecisions] = useState<Record<string, PartialDecision>>({})
  const [settlement, setSettlement] = useState<DepositSettlement>(emptySettlement(balance.held))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate(todayISO())
    setDecisions({})
    setSettlement(emptySettlement(balance.held))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const future = useMemo(() => futureInvoicesAtCheckout(lease.id, invoices, payments, date), [lease.id, invoices, payments, date])
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
        <Input label="Tanggal checkout" type="date" value={date} onChange={(e) => setDate(e.target.value)} required error={dateError ?? undefined} />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Sewa berakhir menjadi" value={formatDate(date && date < lease.end_date ? date : lease.end_date)} />
          <Row label="Tagihan dibatalkan (mulai setelah checkout)" value={future.toVoid.length} />
          {future.partial.length > 0 && <Row label="Tagihan DP setelah checkout → perlu keputusan" value={future.partial.length} />}
          <Row label="Sisa tagihan s/d checkout tetap piutang" value={formatRupiah(rentCapacity)} strong />
        </div>
        {needsAdmin && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="checkout-needs-admin">
            Ada tagihan untuk periode setelah tanggal checkout yang harus dibatalkan. Hanya pemilik/admin yang dapat membatalkan tagihan: minta
            mereka melakukan checkout ini.
          </p>
        )}
        {future.toVoid.length > 0 && (
          <p className="text-xs text-slate-500">
            Dibatalkan: {future.toVoid.map((i) => `${i.invoice_number} (${formatDate(i.period_start)})`).join(', ')}.
          </p>
        )}
        {future.partial.length > 0 && (
          <p className="text-xs text-amber-800">
            Tagihan berikut sudah dibayar sebagian untuk periode <strong>setelah</strong> tanggal checkout. Pilih penyelesaiannya agar tidak ada piutang yang tersisa pada sewa yang sudah selesai.
          </p>
        )}
        {!needsAdmin && <PartialDecisionList invoices={future.partial} payments={payments} decisions={decisions} onChange={setDecisions} />}
        {future.paid.length > 0 && (
          <p className="text-xs text-slate-500">
            Sudah lunas untuk periode setelah checkout: {future.paid.map((i) => `${i.invoice_number} (${formatDate(i.period_start)} – ${formatDate(i.period_end)})`).join(', ')}. Bila uangnya
            dikembalikan, catat sebagai pengeluaran 'Pengembalian Sewa' pada sewa ini.
          </p>
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
          {date && <Row label="Sewa berakhir menjadi" value={formatDate(cancelledLeaseEndDate(lease, date))} />}
        </div>
        <PartialDecisionList invoices={partial} payments={payments} decisions={decisions} onChange={setDecisions} />
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
}

/** SPEC 2b.9: same kos -> change room (and price), note appended; other kos -> checkout + new lease. */
export function MoveRoomModal({ open, onClose, lease, rooms, leases, currentRoom, actions }: MoveRoomModalProps) {
  const toast = useToast()
  const [roomId, setRoomId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [price, setPrice] = useState(lease.price_per_period)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setRoomId('')
    setDate(todayISO())
    setPrice(lease.price_per_period)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const stayEnd = lease.end_date >= date ? lease.end_date : date
  const candidates = useMemo(
    () =>
      rooms
        .filter((r) => r.property_id === lease.property_id && r.id !== lease.room_id)
        .map((r) => ({ room: r, availability: roomAvailability(r, leases, date, stayEnd, lease.id) }))
        .sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true })),
    [rooms, leases, lease, date, stayEnd],
  )
  const target = candidates.find((c) => c.room.id === roomId)

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
            Pindahkan
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
        {target && !actions.canEditLeaseTerms && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Harga sewa tetap {formatRupiah(lease.price_per_period)} / {PERIOD_UNIT_LABEL[lease.period_type]}. Hanya pemilik/admin yang dapat mengubah harga sewa.
          </p>
        )}
        {target && actions.canEditLeaseTerms && (
          <PriceField
            label={`Harga baru per ${PERIOD_UNIT_LABEL[lease.period_type]} (${PERIOD_TYPE_LABEL[lease.period_type]})`}
            value={price}
            onChange={setPrice}
            standard={roomPriceFor(target.room, lease.period_type)}
            unit={PERIOD_UNIT_LABEL[lease.period_type]}
            extraHint={`Harga sekarang ${formatRupiah(lease.price_per_period)}; berlaku untuk tagihan berikutnya.`}
          />
        )}
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
