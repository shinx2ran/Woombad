import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Input, Modal, MoneyInput, Textarea, useToast } from '../../components/ui'
import type { Invoice, Lease, LeaseAddon, Payment } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { buildInvoiceDraft, nextPeriodBounds, paidAmountFor, type ExtraBreakdown, type InvoiceDraft } from '../../domain/billing'
import { periodsToCover } from '../../domain/period'
import { formatDate, formatRupiah } from '../../lib/format'
import { composeInvoiceNotes, proRataSuggestion, splitInvoiceNotes, sumExtraBreakdown } from './leaseUtils'
import { Row } from './components'
import type { LeaseActions } from './useLeaseActions'

interface ExtraFieldsProps {
  parts: ExtraBreakdown
  onChange: (parts: ExtraBreakdown) => void
  discount: number
  onDiscount: (v: number) => void
  text: string
  onText: (v: string) => void
}

/** Listrik / Denda / Lainnya inputs that sum into extra_amount (notes convention, SPEC billing.parseExtraBreakdown). */
function ExtraFields({ parts, onChange, discount, onDiscount, text, onText }: ExtraFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MoneyInput label="Listrik / token" value={parts.listrik ?? 0} onChange={(v) => onChange({ ...parts, listrik: v })} />
        <MoneyInput label="Denda" value={parts.denda ?? 0} onChange={(v) => onChange({ ...parts, denda: v })} />
        <MoneyInput label="Lainnya" value={parts.lainnya ?? 0} onChange={(v) => onChange({ ...parts, lainnya: v })} />
      </div>
      <MoneyInput label="Diskon" value={discount} onChange={onDiscount} />
      <Textarea label="Catatan" value={text} onChange={(e) => onText(e.target.value)} rows={2} placeholder="opsional" />
    </>
  )
}

function DraftSummary({ draft }: { draft: InvoiceDraft }) {
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3">
      <Row label="Nomor" value={<span className="font-mono text-xs">{draft.invoice_number}</span>} />
      <Row label="Periode" value={`${formatDate(draft.period_start)} – ${formatDate(draft.period_end)}`} />
      <Row label="Jatuh tempo" value={formatDate(draft.due_date)} />
      <Row label="Sewa dasar" value={formatRupiah(draft.base_amount)} />
      {draft.addons_amount > 0 && <Row label="Add-on" value={formatRupiah(draft.addons_amount)} />}
      {draft.extra_amount > 0 && <Row label="Tambahan" value={formatRupiah(draft.extra_amount)} />}
      {draft.discount_amount > 0 && <Row label="Diskon" value={`- ${formatRupiah(draft.discount_amount)}`} />}
      <div className="border-t border-slate-200 pt-1">
        <Row label="Total tagihan" value={formatRupiah(draft.total_amount)} strong />
      </div>
      <Row label="Sewa berakhir menjadi" value={formatDate(draft.new_lease_end_date)} />
      {draft.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 pt-1 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
        </p>
      ))}
    </div>
  )
}

export interface NextInvoiceModalProps {
  open: boolean
  onClose: () => void
  lease: Lease
  addons: LeaseAddon[]
  /** invoices of this lease */
  leaseInvoices: Invoice[]
  /** every invoice of the org (numbering) */
  orgInvoices: Invoice[]
  actions: LeaseActions
  onCreated?: (invoice: Invoice) => void
}

/**
 * "Buat tagihan berikutnya": quantity-driven (SPEC 2b.10) with a pro-rata 'Periode khusus' override. The custom
 * price is prefilled with a pro-rata suggestion that follows the chosen end date until the user edits the price.
 */
export function NextInvoiceModal({ open, onClose, lease, addons, leaseInvoices, orgInvoices, actions, onCreated }: NextInvoiceModalProps) {
  const toast = useToast()
  const [quantity, setQuantity] = useState(1)
  const [untilDate, setUntilDate] = useState('')
  const [custom, setCustom] = useState(false)
  const [customEnd, setCustomEnd] = useState('')
  const [baseAmount, setBaseAmount] = useState(0)
  const [baseTouched, setBaseTouched] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const [parts, setParts] = useState<ExtraBreakdown>({})
  const [discount, setDiscount] = useState(0)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const nextBounds = useMemo(() => {
    try {
      return nextPeriodBounds(lease, leaseInvoices, 1)
    } catch {
      return null
    }
  }, [lease, leaseInvoices])

  useEffect(() => {
    if (!open) return
    setQuantity(1)
    setUntilDate('')
    setCustom(false)
    setCustomEnd(nextBounds?.period_end ?? '')
    setBaseAmount(lease.price_per_period)
    setBaseTouched(false)
    setShowExtras(false)
    setParts({})
    setDiscount(0)
    setText('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Pro-rata suggestion for the custom period against the full next period (SPEC 2b.10 'tambah 2 minggu saja').
  const proRata = useMemo(
    () => (custom && nextBounds ? proRataSuggestion(lease.price_per_period, nextBounds.period_start, nextBounds.period_end, customEnd) : null),
    [custom, nextBounds, lease.price_per_period, customEnd],
  )
  // Follow the suggestion while the user has not typed a price of their own.
  useEffect(() => {
    if (custom && !baseTouched && proRata) setBaseAmount(proRata.amount)
  }, [custom, baseTouched, proRata])

  // SPEC 2b.10: when the user picks an end date, derive the quantity with periodsToCover and show the computed end.
  const coverInfo = useMemo(() => {
    if (custom || !untilDate || !nextBounds) return null
    try {
      const n = periodsToCover(nextBounds.period_start, untilDate, lease.period_type)
      const bounds = nextPeriodBounds(lease, leaseInvoices, n)
      return { n, end: bounds.period_end, differs: bounds.period_end !== untilDate }
    } catch {
      return null
    }
  }, [custom, untilDate, nextBounds, lease, leaseInvoices])

  useEffect(() => {
    if (coverInfo) setQuantity(coverInfo.n)
  }, [coverInfo])

  const extraAmount = sumExtraBreakdown(parts)
  const preview = useMemo<{ draft: InvoiceDraft | null; error: string | null }>(() => {
    try {
      const draft = buildInvoiceDraft({
        lease,
        addons,
        quantity,
        periodEnd: custom && customEnd ? customEnd : undefined,
        baseAmount: custom ? baseAmount : undefined,
        extraAmount,
        discountAmount: discount,
        existingInvoices: leaseInvoices,
        orgInvoices,
      })
      return { draft, error: null }
    } catch (err) {
      return { draft: null, error: err instanceof Error ? err.message : 'Tidak dapat menghitung tagihan.' }
    }
  }, [lease, addons, quantity, custom, customEnd, baseAmount, extraAmount, discount, leaseInvoices, orgInvoices])

  const submit = async () => {
    if (!preview.draft) return
    setSaving(true)
    try {
      const invoice = await actions.issueInvoice({
        lease,
        addons,
        quantity,
        periodEnd: custom && customEnd ? customEnd : undefined,
        baseAmount: custom ? baseAmount : undefined,
        extraAmount,
        discountAmount: discount,
        notes: composeInvoiceNotes(parts, text),
        existingInvoices: leaseInvoices,
        orgInvoices,
      })
      toast.success(`Tagihan ${invoice.invoice_number} dibuat. Sewa diperpanjang s/d ${formatDate(invoice.period_end)}.`)
      onCreated?.(invoice)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat tagihan.')
    } finally {
      setSaving(false)
    }
  }

  const unit = PERIOD_UNIT_LABEL[lease.period_type]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat tagihan berikutnya"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={!preview.draft}>
            Buat tagihan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {nextBounds && (
          <p className="text-sm text-slate-600">
            Periode berikutnya mulai <strong>{formatDate(nextBounds.period_start)}</strong> ({formatRupiah(lease.price_per_period)} / {unit}).
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
          Periode khusus (pro-rata, mis. tambah 2 minggu saja)
        </label>
        {custom ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Sampai tanggal" type="date" value={customEnd} min={nextBounds?.period_start} onChange={(e) => setCustomEnd(e.target.value)} required />
            <MoneyInput
              label="Harga periode khusus"
              value={baseAmount}
              onChange={(v) => {
                setBaseTouched(true)
                setBaseAmount(v)
              }}
              hint={
                proRata
                  ? `Saran pro-rata: ${formatRupiah(proRata.amount)} untuk ${proRata.days} hari (${formatRupiah(lease.price_per_period)} / ${proRata.fullDays} hari).${
                      baseTouched && baseAmount !== proRata.amount ? ' Harga diubah manual.' : ''
                    }`
                  : 'Sesuaikan dengan kesepakatan (pro-rata).'
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={`Jumlah periode (${unit})`}
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(e) => {
                setUntilDate('')
                setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
              }}
              required
            />
            <Input
              label="atau sampai tanggal"
              type="date"
              value={untilDate}
              min={nextBounds?.period_start}
              onChange={(e) => setUntilDate(e.target.value)}
              hint={
                coverInfo
                  ? `${coverInfo.n} ${unit}, berakhir ${formatDate(coverInfo.end)}${coverInfo.differs ? ' (berbeda dari tanggal yang dipilih; periode dibulatkan ke atas)' : ''}`
                  : 'Jumlah periode dihitung otomatis.'
              }
            />
          </div>
        )}
        {preview.draft ? <DraftSummary draft={preview.draft} /> : <p className="text-sm text-red-600">{preview.error}</p>}
        <button
          type="button"
          onClick={() => setShowExtras((v) => !v)}
          aria-expanded={showExtras}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <span>
            Tambahan & diskon
            {!showExtras && (extraAmount > 0 || discount > 0 || text.trim()) ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                {extraAmount > 0 ? `+${formatRupiah(extraAmount)}` : ''}
                {extraAmount > 0 && discount > 0 ? ' · ' : ''}
                {discount > 0 ? `diskon ${formatRupiah(discount)}` : ''}
              </span>
            ) : null}
          </span>
          {showExtras ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showExtras && <ExtraFields parts={parts} onChange={setParts} discount={discount} onDiscount={setDiscount} text={text} onText={setText} />}
      </div>
    </Modal>
  )
}

export interface EditInvoiceModalProps {
  open: boolean
  onClose: () => void
  invoice: Invoice | null
  payments: Payment[]
  actions: LeaseActions
}

/** Edit extra / discount / notes of an existing invoice; total and status are recomputed (SPEC 2b.1). */
export function EditInvoiceModal({ open, onClose, invoice, payments, actions }: EditInvoiceModalProps) {
  const toast = useToast()
  const [parts, setParts] = useState<ExtraBreakdown>({})
  const [discount, setDiscount] = useState(0)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !invoice) return
    const split = splitInvoiceNotes(invoice.notes)
    const known = sumExtraBreakdown(split.breakdown)
    const rest = invoice.extra_amount - known
    setParts(rest > 0 ? { ...split.breakdown, lainnya: (split.breakdown.lainnya ?? 0) + rest } : split.breakdown)
    setDiscount(invoice.discount_amount)
    setText(split.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id])

  if (!invoice) return null
  const extra = sumExtraBreakdown(parts)
  const total = invoice.base_amount + invoice.addons_amount + extra - discount
  const paid = paidAmountFor(invoice.id, payments)
  const error =
    total < 0 ? 'Diskon melebihi jumlah tagihan.' : total < paid ? `Total tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paid)}).` : null

  const submit = async () => {
    if (error) return
    setSaving(true)
    try {
      await actions.updateInvoice(invoice, payments, { extra_amount: extra, discount_amount: discount, notes: composeInvoiceNotes(parts, text) })
      toast.success('Tagihan diperbarui.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui tagihan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ubah tagihan ${invoice.invoice_number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={Boolean(error)}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Periode {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)} · sewa dasar {formatRupiah(invoice.base_amount)}
          {invoice.addons_amount > 0 ? ` + add-on ${formatRupiah(invoice.addons_amount)}` : ''}
        </p>
        <ExtraFields parts={parts} onChange={setParts} discount={discount} onDiscount={setDiscount} text={text} onText={setText} />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3">
          <Row label="Total baru" value={formatRupiah(Math.max(0, total))} strong />
          <Row label="Sudah dibayar" value={formatRupiah(paid)} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, total - paid))} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
