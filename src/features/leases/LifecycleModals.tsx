import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import type { AddonBilling, AddonCatalogItem, Expense, Invoice, Lease, LeaseAddon, Payment, Room } from '../../types/db'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, PERIOD_TYPE_LABEL } from '../../types/db'
import { depositBalance, outstandingFor, paidAmountFor } from '../../domain/billing'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'
import { openInvoicesSorted, roomAvailability, roomPriceFor, validateSettlement, ROOM_AVAILABILITY_LABEL, type DepositSettlement } from './leaseUtils'
import { DepositSettlementForm, Row } from './components'
import type { LeaseActions, PartialDecision } from './useLeaseActions'

const emptySettlement = (held: number): DepositSettlement => ({ refund: Math.max(0, held), rent: 0, damage: 0, damageNotes: '' })

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

/** SPEC 2b.5: checkout date, void future unpaid invoices, settle the held deposit, status ended. */
export function CheckoutModal({ open, onClose, lease, invoices, payments, expenses, actions }: CheckoutModalProps) {
  const toast = useToast()
  const balance = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])
  const [date, setDate] = useState(todayISO())
  const [settlement, setSettlement] = useState<DepositSettlement>(emptySettlement(balance.held))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate(todayISO())
    setSettlement(emptySettlement(balance.held))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toVoid = useMemo(() => actions.invoicesToVoidAtCheckout(lease, invoices, payments, date), [actions, lease, invoices, payments, date])
  const open_ = useMemo(() => {
    const voidIds = new Set(toVoid.map((i) => i.id))
    return openInvoicesSorted(lease.id, invoices, payments).filter((i) => !voidIds.has(i.id))
  }, [lease.id, invoices, payments, toVoid])
  const rentCapacity = open_.reduce((s, i) => s + outstandingFor(i, payments), 0)
  const settlementError = balance.held > 0 ? validateSettlement(settlement, balance.held, rentCapacity) : null
  const dateError = !date ? 'Tanggal checkout wajib diisi.' : date < lease.start_date ? 'Tanggal checkout tidak boleh sebelum tanggal mulai sewa.' : null

  const submit = async () => {
    if (dateError || settlementError) return
    setSaving(true)
    try {
      await actions.checkout({ lease, checkoutDate: date, invoices, payments, settlement: balance.held > 0 ? settlement : emptySettlement(0) })
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
          <Button onClick={submit} loading={saving} disabled={Boolean(dateError || settlementError)}>
            Selesaikan checkout
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Tanggal checkout" type="date" value={date} onChange={(e) => setDate(e.target.value)} required error={dateError ?? undefined} />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Sewa berakhir menjadi" value={formatDate(date && date < lease.end_date ? date : lease.end_date)} />
          <Row label="Tagihan dibatalkan (mulai setelah checkout)" value={toVoid.length} />
          <Row label="Sisa tagihan tetap piutang" value={formatRupiah(rentCapacity)} strong />
        </div>
        {toVoid.length > 0 && (
          <p className="text-xs text-slate-500">
            Dibatalkan: {toVoid.map((i) => `${i.invoice_number} (${formatDate(i.period_start)})`).join(', ')}.
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

  const submit = async () => {
    if (missing || settlementError) return
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
          <Button variant="danger" onClick={submit} loading={saving} disabled={missing || Boolean(settlementError)}>
            Batalkan sewa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sewa dibatalkan seolah tidak pernah berjalan: kamar dianggap tidak pernah dihuni. Gunakan <strong>Checkout</strong> bila penyewa memang pernah tinggal.
        </p>
        <Input label="Tanggal pembatalan" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Tagihan belum bayar → dibatalkan" value={unpaid.length} />
          <Row label="Tagihan DP / sebagian → perlu keputusan" value={partial.length} />
        </div>
        {partial.map((inv) => {
          const paid = paidAmountFor(inv.id, payments)
          return (
            <div key={inv.id} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">
                {inv.invoice_number} · dibayar {formatRupiah(paid)} dari {formatRupiah(inv.total_amount)}
              </p>
              <label className="flex items-start gap-2">
                <input type="radio" name={`dec-${inv.id}`} className="mt-0.5" checked={decisions[inv.id] === 'refund'} onChange={() => setDecisions({ ...decisions, [inv.id]: 'refund' })} />
                <span>
                  <strong>Kembalikan {formatRupiah(paid)}</strong> ke penyewa (pengeluaran 'Pengembalian Sewa'), tagihan dibatalkan.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name={`dec-${inv.id}`} className="mt-0.5" checked={decisions[inv.id] === 'forfeit'} onChange={() => setDecisions({ ...decisions, [inv.id]: 'forfeit' })} />
                <span>
                  <strong>Anggap hangus</strong>: DP tetap pendapatan, sisa {formatRupiah(inv.total_amount - paid)} jadi diskon, tagihan lunas.
                </span>
              </label>
            </div>
          )
        })}
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
        {target && (
          <MoneyInput
            label={`Harga baru per periode (${PERIOD_TYPE_LABEL[lease.period_type]})`}
            value={price}
            onChange={setPrice}
            hint={`Harga sekarang ${formatRupiah(lease.price_per_period)}; berlaku untuk tagihan berikutnya.`}
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
