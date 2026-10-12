import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Input, Modal, MoneyInput, Textarea, useToast } from '../../components/ui'
import type { Invoice, Lease, LeaseAddon, Payment, PeriodType, Room } from '../../types/db'
import { PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { buildInvoiceDraft, nextPeriodBounds, paidAmountFor, type ExtraBreakdown, type InvoiceDraft } from '../../domain/billing'
import { periodsToCover } from '../../domain/period'
import { formatDate, formatRupiah } from '../../lib/format'
import {
  composeInvoiceNotes,
  defaultMakePermanent,
  extensionChangesTerms,
  extensionPriceFor,
  invoicesToPinType,
  permanentSwitchAddonsAmount,
  previewFollowingPeriod,
  proRataSuggestion,
  rescaledAddonDefaults,
  roomPriceFor,
  splitInvoiceNotes,
  sumExtraBreakdown,
} from './leaseUtils'
import { PeriodTypePicker, PriceField, Row } from './components'
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

function DraftSummary({ draft, hasAddons, custom }: { draft: InvoiceDraft; hasAddons: boolean; custom: boolean }) {
  const unit = PERIOD_UNIT_LABEL[draft.period_type]
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3" data-testid="invoice-draft">
      <Row label="Nomor" value={<span className="font-mono text-xs">{draft.invoice_number}</span>} />
      <Row label="Periode" value={`${formatDate(draft.period_start)} – ${formatDate(draft.period_end)}`} />
      <Row label="Jatuh tempo" value={formatDate(draft.due_date)} />
      <Row
        label={custom ? 'Sewa periode khusus' : `Sewa ${draft.quantity} ${unit}`}
        value={
          <span>
            {formatRupiah(draft.base_amount)}
            {!custom && draft.quantity > 1 && <span className="block text-xs text-slate-500">{`${draft.quantity} × ${formatRupiah(draft.price_per_period)}`}</span>}
          </span>
        }
      />
      {(hasAddons || draft.addons_amount > 0) && <Row label="Add-on" value={formatRupiah(draft.addons_amount)} />}
      {draft.extra_amount > 0 && <Row label="Tambahan" value={formatRupiah(draft.extra_amount)} />}
      {draft.discount_amount > 0 && <Row label="Diskon" value={`- ${formatRupiah(draft.discount_amount)}`} />}
      <div className="border-t border-slate-200 pt-1">
        <Row label="Total tagihan" value={formatRupiah(draft.total_amount)} strong />
      </div>
      <Row label="Sewa berakhir menjadi" value={formatDate(draft.new_lease_end_date)} />
      {draft.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 pt-1 text-xs text-amber-700" data-testid="draft-warning">
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
  /** the lease's room (standard rates per period type for the price hint / prefill) */
  room?: Room
  addons: LeaseAddon[]
  /** invoices of this lease */
  leaseInvoices: Invoice[]
  /** every invoice of the org (numbering) */
  orgInvoices: Invoice[]
  actions: LeaseActions
  onCreated?: (invoice: Invoice) => void
}

/**
 * "Buat tagihan berikutnya": quantity-driven (SPEC 2b.10) with a pro-rata 'Periode khusus' override, a
 * 'Jenis periode' switch (SPEC 5.2: a daily guest extends monthly) and a negotiable price for this invoice
 * (SPEC 5.4). Switching the type prefills the room's standard rate for that type; 'Jadikan jenis/harga tetap
 * sewa ini' copies type and price to the lease (default on when the type changed). The custom pro-rata price
 * follows the chosen end date until the user edits it.
 */
export function NextInvoiceModal({ open, onClose, lease, room, addons, leaseInvoices, orgInvoices, actions, onCreated }: NextInvoiceModalProps) {
  const toast = useToast()
  const [periodType, setPeriodType] = useState<PeriodType>(lease.period_type)
  const [price, setPrice] = useState(lease.price_per_period)
  const [permanentOverride, setPermanentOverride] = useState<boolean | null>(null)
  const [addonOverrides, setAddonOverrides] = useState<Record<string, number>>({})
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
  const [touched, setTouched] = useState(false)

  const nextBounds = useMemo(() => {
    try {
      return nextPeriodBounds(lease, leaseInvoices, 1, periodType)
    } catch {
      return null
    }
  }, [lease, leaseInvoices, periodType])

  useEffect(() => {
    if (!open) return
    setPeriodType(lease.period_type)
    setPrice(lease.price_per_period)
    setPermanentOverride(null)
    setAddonOverrides({})
    setQuantity(1)
    setUntilDate('')
    setCustom(false)
    let end = ''
    try {
      end = nextPeriodBounds(lease, leaseInvoices, 1).period_end
    } catch {
      end = ''
    }
    setCustomEnd(end)
    setBaseAmount(lease.price_per_period)
    setBaseTouched(false)
    setShowExtras(false)
    setParts({})
    setDiscount(0)
    setText('')
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const changeType = (t: PeriodType) => {
    if (t === periodType) return
    setPeriodType(t)
    setPrice(extensionPriceFor(lease, room, t))
    setAddonOverrides({})
    setUntilDate('')
    setQuantity(1)
    setBaseTouched(false)
    try {
      setCustomEnd(nextPeriodBounds(lease, leaseInvoices, 1, t).period_end)
    } catch {
      /* keep the previous end */
    }
  }

  const unit = PERIOD_UNIT_LABEL[periodType]
  const standard = roomPriceFor(room, periodType)
  const typeChanged = periodType !== lease.period_type
  const changesTerms = extensionChangesTerms(lease, periodType, price)
  // Old invoices with period_type null get pinned on a permanent type switch; staff cannot update invoices (Supabase RLS).
  const permanentBlocked = typeChanged && !actions.canWriteInvoiceStatus && invoicesToPinType(lease, leaseInvoices, periodType).length > 0
  const permanent = !permanentBlocked && (permanentOverride ?? defaultMakePermanent(lease, periodType))
  const makePermanent = changesTerms && permanent

  // A permanent type switch converts the per-period add-ons to the new unit (editable), so later invoices stay consistent.
  const perPeriodAddons = useMemo(() => addons.filter((a) => a.billing === 'per_period'), [addons])
  const rescaleAddons = makePermanent && typeChanged && perPeriodAddons.length > 0
  const addonAmounts = useMemo<Record<string, number>>(() => {
    if (!rescaleAddons || !nextBounds) return {}
    return { ...rescaledAddonDefaults(addons, lease.period_type, periodType, nextBounds.period_start), ...addonOverrides }
  }, [rescaleAddons, nextBounds, addons, lease.period_type, periodType, addonOverrides])
  const addonsAmount = rescaleAddons ? permanentSwitchAddonsAmount(addons, addonAmounts, custom ? 1 : quantity, leaseInvoices) : undefined

  // Pro-rata suggestion for the custom period against the full next period (SPEC 2b.10 'tambah 2 minggu saja').
  const proRata = useMemo(
    () => (custom && nextBounds ? proRataSuggestion(price, nextBounds.period_start, nextBounds.period_end, customEnd) : null),
    [custom, nextBounds, price, customEnd],
  )
  // Follow the suggestion while the user has not typed a price of their own.
  useEffect(() => {
    if (custom && !baseTouched && proRata) setBaseAmount(proRata.amount)
  }, [custom, baseTouched, proRata])

  // SPEC 2b.10: when the user picks an end date, derive the quantity with periodsToCover and show the computed end.
  const coverInfo = useMemo(() => {
    if (custom || !untilDate || !nextBounds) return null
    try {
      const n = periodsToCover(nextBounds.period_start, untilDate, periodType)
      const bounds = nextPeriodBounds(lease, leaseInvoices, n, periodType)
      return { n, end: bounds.period_end, differs: bounds.period_end !== untilDate }
    } catch {
      return null
    }
  }, [custom, untilDate, nextBounds, lease, leaseInvoices, periodType])

  useEffect(() => {
    if (coverInfo) setQuantity(coverInfo.n)
  }, [coverInfo])

  const priceError = !custom && price <= 0 ? `Isi harga per ${unit}.` : undefined
  const extraAmount = sumExtraBreakdown(parts)
  const preview = useMemo<{ draft: InvoiceDraft | null; error: string | null }>(() => {
    try {
      const draft = buildInvoiceDraft({
        lease,
        addons,
        quantity,
        periodType,
        // Always pass the agreed price: on a type change the domain would otherwise bill the old unit's price.
        pricePerPeriod: price,
        periodEnd: custom && customEnd ? customEnd : undefined,
        baseAmount: custom ? baseAmount : undefined,
        addonsAmount,
        extraAmount,
        discountAmount: discount,
        existingInvoices: leaseInvoices,
        orgInvoices,
      })
      return { draft, error: null }
    } catch (err) {
      return { draft: null, error: err instanceof Error ? err.message : 'Tidak dapat menghitung tagihan.' }
    }
  }, [lease, addons, quantity, periodType, price, custom, customEnd, baseAmount, addonsAmount, extraAmount, discount, leaseInvoices, orgInvoices])

  const following = useMemo(
    () => (preview.draft ? previewFollowingPeriod(lease, leaseInvoices, preview.draft, makePermanent) : null),
    [preview.draft, lease, leaseInvoices, makePermanent],
  )

  const submit = async () => {
    setTouched(true)
    if (!preview.draft || priceError) return
    setSaving(true)
    try {
      const invoice = await actions.issueInvoice({
        lease,
        addons,
        quantity,
        periodType,
        pricePerPeriod: price,
        makePermanent,
        periodEnd: custom && customEnd ? customEnd : undefined,
        baseAmount: custom ? baseAmount : undefined,
        addonsAmount,
        addonAmounts: rescaleAddons ? addonAmounts : undefined,
        extraAmount,
        discountAmount: discount,
        notes: composeInvoiceNotes(parts, text),
        existingInvoices: leaseInvoices,
        orgInvoices,
      })
      const terms = makePermanent ? ` Sewa kini ${PERIOD_TYPE_LABEL[periodType]} ${formatRupiah(price)} / ${unit}.` : ''
      toast.success(`Tagihan ${invoice.invoice_number} dibuat. Sewa diperpanjang s/d ${formatDate(invoice.period_end)}.${terms}`)
      onCreated?.(invoice)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat tagihan.')
    } finally {
      setSaving(false)
    }
  }

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
            Periode berikutnya mulai <strong>{formatDate(nextBounds.period_start)}</strong>. Sewa saat ini {PERIOD_TYPE_LABEL[lease.period_type].toLowerCase()}{' '}
            {formatRupiah(lease.price_per_period)} / {PERIOD_UNIT_LABEL[lease.period_type]}.
          </p>
        )}
        <PeriodTypePicker value={periodType} onChange={changeType} />
        <PriceField
          label={`Harga per ${unit}`}
          value={price}
          onChange={setPrice}
          standard={standard}
          unit={unit}
          required
          error={touched ? priceError : undefined}
          extraHint={typeChanged ? `Diisi dari tarif kamar untuk sewa ${PERIOD_TYPE_LABEL[periodType].toLowerCase()}; boleh diubah sesuai kesepakatan.` : 'Boleh diubah khusus untuk tagihan ini.'}
        />
        {changesTerms && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={permanent}
              disabled={permanentBlocked}
              onChange={(e) => setPermanentOverride(e.target.checked)}
              aria-label="Jadikan jenis/harga tetap sewa ini"
            />
            <span>
              <span className="block font-medium text-slate-900">Jadikan jenis/harga tetap sewa ini</span>
              <span className="block text-xs text-slate-500">
                {permanentBlocked
                  ? 'Hanya admin yang dapat mengganti jenis sewa secara tetap. Tagihan ini dibuat sekali saja.'
                  : permanent
                    ? `Sewa menjadi ${PERIOD_TYPE_LABEL[periodType]} ${formatRupiah(price)} / ${unit}; catatan otomatis ditambahkan.`
                    : `Hanya tagihan ini; sewa tetap ${PERIOD_TYPE_LABEL[lease.period_type]} ${formatRupiah(lease.price_per_period)} / ${PERIOD_UNIT_LABEL[lease.period_type]}.`}
              </span>
            </span>
          </label>
        )}
        {rescaleAddons && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="addon-rescale">
            <div>
              <p className="text-sm font-medium text-slate-900">Add-on per periode ikut menjadi per {unit}</p>
              <p className="text-xs text-slate-500">Dihitung dari tarif per {PERIOD_UNIT_LABEL[lease.period_type]}; sesuaikan bila perlu. Berlaku untuk tagihan ini dan berikutnya.</p>
            </div>
            {perPeriodAddons.map((a) => (
              <MoneyInput
                key={a.id}
                label={`${a.name} / ${unit}`}
                value={addonAmounts[a.id] ?? a.amount}
                onChange={(v) => setAddonOverrides((prev) => ({ ...prev, [a.id]: v }))}
                hint={`Sebelumnya ${formatRupiah(a.amount)} / ${PERIOD_UNIT_LABEL[lease.period_type]}`}
              />
            ))}
          </div>
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
                  ? `Saran pro-rata: ${formatRupiah(proRata.amount)} untuk ${proRata.days} hari (${formatRupiah(price)} / ${proRata.fullDays} hari).${
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
        {preview.draft ? <DraftSummary draft={preview.draft} hasAddons={addons.length > 0} custom={custom} /> : <p className="text-sm text-red-600">{preview.error}</p>}
        {following && (
          <p className="text-xs text-slate-500" data-testid="following-period">
            Tagihan berikutnya setelah ini: {formatDate(following.period_start)} – {formatDate(following.period_end)} ({PERIOD_TYPE_LABEL[following.period_type].toLowerCase()}
            {following.anchored && following.anchor ? `, mengikuti jadwal sejak ${formatDate(following.anchor)}` : ', dihitung dari akhir tagihan ini'}).
          </p>
        )}
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
