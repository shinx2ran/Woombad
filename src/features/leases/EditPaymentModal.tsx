import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import { outstandingFor } from '../../domain/billing'
import { formatRupiah } from '../../lib/format'
import { PAYMENT_KIND_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Expense, type Invoice, type Lease, type Payment, type PaymentMethod } from '../../types/db'
import { RecordHistory } from '../settings/audit/RecordHistory'
import { isSamePayment, paymentEditLocks, validatePaymentEdit, type PaymentEditPatch } from './paymentEdit'
import type { LeaseActions } from './useLeaseActions'

export interface EditPaymentModalProps {
  payment: Payment | null
  onClose: () => void
  lease: Lease
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  actions: LeaseActions
}

/** Ubah pembayaran (SPEC 7.5): amount, date, method and note of one payment, with its history underneath. */
export function EditPaymentModal({ payment, onClose, lease, invoices, payments, expenses, actions }: EditPaymentModalProps) {
  const toast = useToast()
  const [amount, setAmount] = useState(0)
  const [paidAt, setPaidAt] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!payment) return
    setAmount(payment.amount)
    setPaidAt(payment.paid_at)
    setMethod(payment.method)
    setNotes(payment.notes ?? '')
  }, [payment])

  const invoice = useMemo(() => (payment?.invoice_id ? invoices.find((i) => i.id === payment.invoice_id) ?? null : null), [payment, invoices])
  if (!payment) return null

  const locks = paymentEditLocks(payment)
  const patch: PaymentEditPatch = { amount, paid_at: paidAt, method, notes: notes.trim() || null }
  const ctx = { invoice, payments, lease, expenses }
  const error = validatePaymentEdit(payment, patch, ctx)
  const unchanged = isSamePayment(payment, patch)
  // what the invoice still owes without this payment: the most this payment may be
  const room = invoice ? outstandingFor(invoice, payments.filter((p) => p.id !== payment.id)) : null
  const methodOptions = locks.method
    ? [{ value: payment.method, label: PAYMENT_METHOD_LABEL[payment.method] }]
    : PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))

  const submit = async () => {
    if (error || unchanged) return
    setSaving(true)
    try {
      await actions.updatePayment(payment, patch, ctx)
      toast.success('Pembayaran diperbarui.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui pembayaran.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ubah pembayaran"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={Boolean(error) || unchanged}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {PAYMENT_KIND_LABEL[payment.kind]}
          {invoice ? ` · ${invoice.invoice_number} (total ${formatRupiah(invoice.total_amount)})` : ''}
        </p>
        <MoneyInput
          label="Jumlah"
          value={amount}
          onChange={setAmount}
          required
          disabled={locks.amount}
          hint={
            locks.amount
              ? 'Pembayaran dari jaminan: hapus lalu catat ulang bila jumlahnya salah.'
              : room !== null
                ? `Paling banyak ${formatRupiah(room)} (sisa tagihan tanpa pembayaran ini).`
                : undefined
          }
        />
        <Input label="Tanggal bayar" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
        <Select label="Metode" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={methodOptions} disabled={locks.method} />
        <Textarea label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <p className="text-xs text-slate-500">Salah tagihan? Hapus pembayaran ini lalu catat ulang lewat Bayar pada tagihan yang benar.</p>
        <RecordHistory table="payments" rowId={payment.id} />
      </div>
    </Modal>
  )
}
