import { useEffect, useMemo, useState } from 'react'
import { MessageCircle, Check } from 'lucide-react'
import { Button, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import type { Expense, Invoice, Lease, PaymentMethod, Payment, Property, Room, Tenant } from '../../types/db'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '../../types/db'
import { depositBalance, outstandingFor, validateRentPayment } from '../../domain/billing'
import { receiptText } from '../../domain/messages'
import { formatDate, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import { openInvoicesSorted } from './leaseUtils'
import { Row } from './components'
import type { LeaseActions } from './useLeaseActions'

export interface PaymentModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  /** invoices of this lease */
  invoices: Invoice[]
  /** all payments (superset is fine) */
  payments: Payment[]
  expenses: Expense[]
  property: Property | undefined
  room: Room | undefined
  tenant: Tenant | undefined
  actions: LeaseActions
  defaultInvoiceId?: string
}

interface Receipt {
  text: string
  remaining: number
}

const METHOD_OPTIONS = (held: number, amount: number) =>
  PAYMENT_METHODS.map((m) => ({
    value: m,
    label: m === 'deposit' ? `${PAYMENT_METHOD_LABEL[m]} (dipegang ${formatRupiah(held)})` : PAYMENT_METHOD_LABEL[m],
    disabled: m === 'deposit' && (held <= 0 || held < amount),
  }))

/** Record a rent payment against one invoice (SPEC 2b.6/2b.7), then offer a WhatsApp receipt. */
export function PaymentModal(props: PaymentModalProps) {
  const { open, onClose, lease, invoices, payments, expenses, property, room, tenant, actions, defaultInvoiceId } = props
  const toast = useToast()
  const selectable = useMemo(
    () => invoices.filter((i) => i.status !== 'void').sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [invoices],
  )
  const openInvoices = useMemo(() => openInvoicesSorted(lease.id, invoices, payments), [lease.id, invoices, payments])
  const deposit = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])

  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidAt, setPaidAt] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [settleWithDiscount, setSettleWithDiscount] = useState(false)
  const [excessAsOther, setExcessAsOther] = useState(false)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const invoice = selectable.find((i) => i.id === invoiceId)
  const outstanding = invoice ? outstandingFor(invoice, payments) : 0

  // Reset on open: default to the requested invoice, else the oldest open one.
  useEffect(() => {
    if (!open) return
    const initial = (defaultInvoiceId && selectable.find((i) => i.id === defaultInvoiceId)) || openInvoices[0] || selectable[0]
    setInvoiceId(initial?.id ?? '')
    setAmount(initial ? outstandingFor(initial, payments) : 0)
    setMethod('cash')
    setPaidAt(todayISO())
    setNotes('')
    setSettleWithDiscount(false)
    setExcessAsOther(false)
    setReceipt(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onPickInvoice = (id: string) => {
    setInvoiceId(id)
    const inv = selectable.find((i) => i.id === id)
    setAmount(inv ? outstandingFor(inv, payments) : 0)
    setSettleWithDiscount(false)
    setExcessAsOther(false)
  }

  const baseError = invoice ? validateRentPayment(invoice, payments, amount, { method, depositHeld: deposit.held }) : 'Pilih tagihan.'
  const isExcess = Boolean(invoice) && amount > outstanding && outstanding > 0
  // 'Anggap lunas' writes discount/total to the invoice; staff cannot update invoices (SPEC section 3).
  const isShort = Boolean(invoice) && amount > 0 && amount < outstanding && actions.canEditInvoices
  let error = baseError
  if (isExcess && excessAsOther) {
    error = method === 'deposit' && amount > deposit.held ? `Jaminan yang dipegang hanya ${formatRupiah(deposit.held)}.` : null
  }

  const submit = async () => {
    if (!invoice || error) return
    setSaving(true)
    try {
      const result = await actions.recordRentPayment({
        invoice,
        lease,
        payments,
        amount,
        method,
        paidAt,
        notes: notes.trim() || null,
        settleWithDiscount: isShort && settleWithDiscount,
        excessAsOther: isExcess && excessAsOther,
      })
      toast.success(result.remaining <= 0 ? 'Pembayaran dicatat (Lunas)' : 'Pembayaran dicatat (DP / Sebagian)')
      if (result.excessRecorded > 0) toast.toast(`Kelebihan ${formatRupiah(result.excessRecorded)} dicatat sebagai Pemasukan Lain.`)
      setReceipt({
        remaining: result.remaining,
        text: receiptText({
          tenantName: tenant?.full_name ?? 'Penyewa',
          roomName: room?.name ?? '-',
          propertyName: property?.name ?? 'Kos',
          amount,
          paidAt,
          methodLabel: PAYMENT_METHOD_LABEL[method],
          invoiceNumber: invoice.invoice_number,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
          remaining: result.remaining,
        }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencatat pembayaran.')
    } finally {
      setSaving(false)
    }
  }

  const waLink = receipt ? whatsappLink(tenant?.phone, receipt.text) : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={receipt ? 'Pembayaran tercatat' : 'Catat pembayaran'}
      footer={
        receipt ? (
          <Button onClick={onClose}>Selesai</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={submit} loading={saving} disabled={Boolean(error) || !invoice}>
              Simpan pembayaran
            </Button>
          </>
        )
      }
    >
      {receipt ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{formatRupiah(amount)} diterima via {PAYMENT_METHOD_LABEL[method]}.</p>
              <p>{receipt.remaining > 0 ? `Sisa tagihan ${formatRupiah(receipt.remaining)}.` : 'Tagihan lunas.'}</p>
            </div>
          </div>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{receipt.text}</pre>
          {waLink ? (
            <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">
              <MessageCircle className="h-4 w-4" /> Kirim kwitansi via WhatsApp
            </a>
          ) : (
            <p className="text-xs text-slate-500">Nomor HP penyewa belum ada, kwitansi tidak bisa dikirim via WhatsApp.</p>
          )}
        </div>
      ) : selectable.length === 0 ? (
        <p className="text-sm text-slate-600">Belum ada tagihan untuk sewa ini. Buat tagihan dahulu.</p>
      ) : (
        <div className="space-y-4">
          <Select
            label="Tagihan"
            value={invoiceId}
            onChange={(e) => onPickInvoice(e.target.value)}
            options={selectable.map((i) => ({
              value: i.id,
              label: `${i.invoice_number} · ${formatDate(i.period_start)} – ${formatDate(i.period_end)} · sisa ${formatRupiah(outstandingFor(i, payments))}`,
            }))}
          />
          {invoice && (
            <div className="rounded-lg bg-slate-50 p-3">
              <Row label="Total tagihan" value={formatRupiah(invoice.total_amount)} />
              <Row label="Sudah dibayar" value={formatRupiah(invoice.total_amount - outstanding)} />
              <Row label="Sisa tagihan" value={formatRupiah(outstanding)} strong />
            </div>
          )}
          <MoneyInput label="Jumlah dibayar" value={amount} onChange={setAmount} required error={amount > 0 && error && !isExcess ? error : undefined} />
          {isExcess && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" className="mt-0.5" checked={excessAsOther} onChange={(e) => setExcessAsOther(e.target.checked)} />
              <span>
                Jumlah melebihi sisa tagihan. <strong>Catat kelebihan {formatRupiah(amount - outstanding)} sebagai Pemasukan Lain</strong> (sisanya melunasi tagihan).
              </span>
            </label>
          )}
          {isShort && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={settleWithDiscount} onChange={(e) => setSettleWithDiscount(e.target.checked)} />
              <span>
                <strong>Anggap lunas</strong> (selisih {formatRupiah(outstanding - amount)} jadi diskon tagihan). Tanpa ini pembayaran dicatat sebagai DP / sebagian.
              </span>
            </label>
          )}
          <Select
            label="Metode"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            options={METHOD_OPTIONS(deposit.held, amount)}
            hint={method === 'deposit' ? 'Memotong uang jaminan yang dipegang; dihitung sebagai pendapatan.' : undefined}
          />
          <Input label="Tanggal bayar" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          <Textarea label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />
        </div>
      )}
    </Modal>
  )
}

export interface DepositModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  payments: Payment[]
  expenses: Expense[]
  actions: LeaseActions
}

/** Record deposit money received (payment kind='deposit', invoice_id null). */
export function DepositModal({ open, onClose, lease, payments, expenses, actions }: DepositModalProps) {
  const toast = useToast()
  const balance = useMemo(() => depositBalance(lease, payments, expenses), [lease, payments, expenses])
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidAt, setPaidAt] = useState(todayISO())
  const [notes, setNotes] = useState('Uang jaminan')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAmount(balance.shortfall > 0 ? balance.shortfall : lease.deposit_amount)
    setMethod('cash')
    setPaidAt(todayISO())
    setNotes('Uang jaminan')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    setSaving(true)
    try {
      await actions.recordDeposit(lease, amount, method, paidAt, notes.trim() || null)
      toast.success('Deposit dicatat.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencatat deposit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat deposit diterima"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={amount <= 0}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <Row label="Deposit disepakati" value={formatRupiah(balance.agreed)} />
          <Row label="Sudah diterima" value={formatRupiah(balance.received)} />
          <Row label="Belum diterima" value={formatRupiah(balance.shortfall)} strong />
        </div>
        <MoneyInput label="Jumlah diterima" value={amount} onChange={setAmount} required error={amount <= 0 ? 'Jumlah harus lebih dari 0.' : undefined} />
        <Select
          label="Metode"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          options={PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
        />
        <Input label="Tanggal" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
        <Input label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  )
}
