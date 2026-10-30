import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, CountInput, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import type { Expense, Invoice, Lease, LeaseAddon, Payment, PaymentMethod, PeriodType, Room } from '../../types/db'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { buildInvoiceDraft, depositBalance, nextPeriodBounds, paidAmountFor, type ExtraBreakdown, type InvoiceDraft } from '../../domain/billing'
import { checkoutISO, formatCheckout, formatDate, formatRupiah, formatStay, lastNightISO, todayISO } from '../../lib/format'
import { plannedCheckoutOf } from '../../domain/occupancy'
import {
  checkoutInputError,
  composeInvoiceNotes,
  coverUntilCheckout,
  coverUntilCheckoutHint,
  defaultMakePermanent,
  extensionChangesTerms,
  extensionPriceFor,
  invoicesToPinType,
  nextPeriodCheckout,
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
import { RecordHistory } from '../settings/audit/RecordHistory'

const DEPOSIT_METHODS = PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))

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
      <Row label="Periode" value={formatStay(draft.period_start, draft.period_end)} />
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
      <Row label="Check-out menjadi" value={formatCheckout(draft.new_lease_end_date)} />
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
  /** the org's payments and expenses: how much deposit this lease already received (SPEC 7.12) */
  payments?: Payment[]
  expenses?: Expense[]
  actions: LeaseActions
  onCreated?: (invoice: Invoice) => void
}

/**
 * "Buat tagihan berikutnya": quantity-driven (SPEC 2b.10) with a pro-rata 'Periode khusus' override, a
 * 'Jenis periode' switch (SPEC 5.2: a daily guest extends monthly) and a negotiable price for this invoice
 * (SPEC 5.4). Switching the type prefills the room's standard rate for that type; 'Jadikan jenis/harga tetap
 * sewa ini' copies type and price to the lease (default on when the type changed). The custom pro-rata price
 * follows the chosen end date until the user edits it. Every end date typed here is a CHECK-OUT day: the period
 * ends the night before (lastNightISO), and computed ends are shown as check-out days (SPEC 7.3). Switching into a
 * weekly or monthly period asks for the uang jaminan a daily stay usually went without (SPEC 7.12).
 */
export function NextInvoiceModal({ open, onClose, lease, room, addons, leaseInvoices, orgInvoices, payments = [], expenses = [], actions, onCreated }: NextInvoiceModalProps) {
  const toast = useToast()
  const [periodType, setPeriodType] = useState<PeriodType>(lease.period_type)
  const [price, setPrice] = useState(lease.price_per_period)
  const [permanentOverride, setPermanentOverride] = useState<boolean | null>(null)
  const [addonOverrides, setAddonOverrides] = useState<Record<string, number>>({})
  const [quantity, setQuantity] = useState(1)
  /** 'atau sampai tanggal check-out': the day the tenant leaves, as typed (SPEC 7.3) */
  const [untilDate, setUntilDate] = useState('')
  const [custom, setCustom] = useState(false)
  /** 'Periode khusus' end as typed: a CHECK-OUT day; the period ends the night before (customLastNight) */
  const [customEnd, setCustomEnd] = useState('')
  const [baseAmount, setBaseAmount] = useState(0)
  const [baseTouched, setBaseTouched] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const [parts, setParts] = useState<ExtraBreakdown>({})
  const [discount, setDiscount] = useState(0)
  const [text, setText] = useState('')
  /** SPEC 7.12: the agreed deposit after a switch into weekly/monthly, and whether what is still owed is paid now */
  const [depositAmount, setDepositAmount] = useState(lease.deposit_amount)
  const [depositNow, setDepositNow] = useState(true)
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('cash')
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
    // prefilled with the check-out day of one full next period
    setCustomEnd(nextPeriodCheckout(lease, leaseInvoices))
    setBaseAmount(lease.price_per_period)
    setBaseTouched(false)
    setShowExtras(false)
    setParts({})
    setDiscount(0)
    setText('')
    setDepositAmount(lease.deposit_amount)
    setDepositNow(true)
    setDepositMethod('cash')
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
    const out = nextPeriodCheckout(lease, leaseInvoices, t)
    if (out) setCustomEnd(out) // else keep the previous end
  }

  const unit = PERIOD_UNIT_LABEL[periodType]
  const standard = roomPriceFor(room, periodType)
  const typeChanged = periodType !== lease.period_type
  const changesTerms = extensionChangesTerms(lease, periodType, price)
  // Staff may bill a one-off extension but never change the lease's type or price (SPEC 6.2). Old invoices with
  // period_type null get pinned on a permanent type switch, which needs invoice updates (Supabase RLS).
  const staffBlocked = !actions.canEditLeaseTerms
  const permanentBlocked = staffBlocked || (typeChanged && !actions.canWriteInvoiceStatus && invoicesToPinType(lease, leaseInvoices, periodType).length > 0)
  const permanent = !permanentBlocked && (permanentOverride ?? defaultMakePermanent(lease, periodType))
  const makePermanent = changesTerms && permanent

  // SPEC 7.12: a daily stay often has no deposit; extending it as weekly or monthly asks for one (a lease term: owner/admin)
  const askDeposit = typeChanged && periodType !== 'daily'
  const setsDeposit = askDeposit && actions.canEditLeaseTerms
  const depositReceived = useMemo(() => depositBalance(lease, payments, expenses).received, [lease, payments, expenses])
  const depositDue = setsDeposit ? Math.max(0, depositAmount - depositReceived) : 0
  const depositError = setsDeposit && depositAmount < 0 ? 'Tidak boleh negatif.' : undefined

  // A permanent type switch converts the per-period add-ons to the new unit (editable), so later invoices stay consistent.
  const perPeriodAddons = useMemo(() => addons.filter((a) => a.billing === 'per_period'), [addons])
  const rescaleAddons = makePermanent && typeChanged && perPeriodAddons.length > 0
  const addonAmounts = useMemo<Record<string, number>>(() => {
    if (!rescaleAddons || !nextBounds) return {}
    return { ...rescaledAddonDefaults(addons, lease.period_type, periodType, nextBounds.period_start), ...addonOverrides }
  }, [rescaleAddons, nextBounds, addons, lease.period_type, periodType, addonOverrides])
  const addonsAmount = rescaleAddons ? permanentSwitchAddonsAmount(addons, addonAmounts, custom ? 1 : quantity, leaseInvoices) : undefined

  // The typed check-out day -> the last night the custom period bills (SPEC 7.3); null while the field is empty.
  const customLastNight = customEnd ? lastNightISO(customEnd) : null
  const customError = custom ? (customEnd ? checkoutInputError(customEnd, nextBounds?.period_start) : 'Isi tanggal check-out.') : null
  // Pro-rata suggestion for the custom period against the full next period (SPEC 2b.10 'tambah 2 minggu saja').
  const proRata = useMemo(
    () => (custom && nextBounds && customLastNight ? proRataSuggestion(price, nextBounds.period_start, nextBounds.period_end, customLastNight) : null),
    [custom, nextBounds, price, customLastNight],
  )
  // Follow the suggestion while the user has not typed a price of their own.
  useEffect(() => {
    if (custom && !baseTouched && proRata) setBaseAmount(proRata.amount)
  }, [custom, baseTouched, proRata])

  // SPEC 2b.10 + 7.3: when the user picks a check-out day, derive the quantity on the billing grid (up to the night
  // before, coverUntilCheckout) and show the computed check-out day.
  const untilError = custom ? null : checkoutInputError(untilDate, nextBounds?.period_start)
  const coverInfo = useMemo(
    () => (custom ? null : coverUntilCheckout(lease, leaseInvoices, periodType, untilDate)),
    [custom, untilDate, lease, leaseInvoices, periodType],
  )

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
        periodEnd: custom && customLastNight ? customLastNight : undefined,
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
  }, [lease, addons, quantity, periodType, price, custom, customLastNight, baseAmount, addonsAmount, extraAmount, discount, leaseInvoices, orgInvoices])

  const following = useMemo(
    () => (preview.draft ? previewFollowingPeriod(lease, leaseInvoices, preview.draft, makePermanent) : null),
    [preview.draft, lease, leaseInvoices, makePermanent],
  )

  // SPEC 7.8: the tenant said he leaves on or before the start of the period billed here. Only a warning: he may have
  // changed his mind (the plan is changed or cancelled on the lease page), and nothing about the billing changes.
  const planned = plannedCheckoutOf(lease)
  const billedFrom = preview.draft?.period_start ?? nextBounds?.period_start ?? null
  const leavingBefore = planned !== null && billedFrom !== null && planned <= billedFrom

  const dateError = customError ?? untilError
  const submit = async () => {
    setTouched(true)
    if (!preview.draft || priceError || dateError || depositError) return
    setSaving(true)
    try {
      const invoice = await actions.issueInvoice({
        lease,
        addons,
        quantity,
        periodType,
        pricePerPeriod: price,
        makePermanent,
        periodEnd: custom && customLastNight ? customLastNight : undefined,
        baseAmount: custom ? baseAmount : undefined,
        addonsAmount,
        addonAmounts: rescaleAddons ? addonAmounts : undefined,
        extraAmount,
        discountAmount: discount,
        notes: composeInvoiceNotes(parts, text),
        depositAmount: setsDeposit ? depositAmount : undefined,
        existingInvoices: leaseInvoices,
        orgInvoices,
      })
      const terms = makePermanent ? ` Sewa kini ${PERIOD_TYPE_LABEL[periodType]} ${formatRupiah(price)} / ${unit}.` : ''
      let deposit = ''
      if (setsDeposit && depositAmount !== lease.deposit_amount) deposit = ` Deposit ${formatRupiah(depositAmount)}${depositDue > 0 && !depositNow ? ' belum diterima' : ''}.`
      if (depositDue > 0 && depositNow) {
        try {
          await actions.recordDeposit(lease, depositDue, depositMethod, todayISO(), 'Uang jaminan')
          deposit = ` Deposit ${formatRupiah(depositAmount)}, diterima ${formatRupiah(depositDue)} (${PAYMENT_METHOD_LABEL[depositMethod]}).`
        } catch (err) {
          // the invoice and the lease are saved: say what is missing and where to finish it
          toast.error(
            `Tagihan ${invoice.invoice_number} dibuat, tetapi deposit yang diterima gagal dicatat: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'} Catat lewat Lainnya → Catat deposit diterima.`,
          )
          onCreated?.(invoice)
          onClose()
          return
        }
      }
      toast.success(`Tagihan ${invoice.invoice_number} dibuat. Sewa diperpanjang, check-out ${formatCheckout(invoice.period_end)}.${terms}${deposit}`)
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
          <Button onClick={submit} loading={saving} disabled={!preview.draft || Boolean(dateError)}>
            Buat tagihan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {leavingBefore && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="planned-checkout-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Penyewa berencana keluar {formatDate(planned)}.</strong> Tagihan ini untuk periode mulai {formatDate(billedFrom)}: pastikan ia memang
              memperpanjang. Bila rencananya berubah, ubah atau batalkan lewat Lainnya → Rencana keluar.
            </span>
          </p>
        )}
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
                  ? `${staffBlocked ? 'Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.' : 'Hanya pemilik/admin yang dapat mengganti jenis sewa secara tetap.'} Tagihan ini dibuat sekali saja.`
                  : permanent
                    ? `Sewa menjadi ${PERIOD_TYPE_LABEL[periodType]} ${formatRupiah(price)} / ${unit}; catatan otomatis ditambahkan.`
                    : `Hanya tagihan ini; sewa tetap ${PERIOD_TYPE_LABEL[lease.period_type]} ${formatRupiah(lease.price_per_period)} / ${PERIOD_UNIT_LABEL[lease.period_type]}.`}
              </span>
            </span>
          </label>
        )}
        {askDeposit && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="extension-deposit">
            {setsDeposit ? (
              <>
                <MoneyInput
                  label="Uang jaminan (deposit)"
                  value={depositAmount}
                  onChange={setDepositAmount}
                  error={depositError}
                  hint={`Disepakati untuk sewa ${PERIOD_TYPE_LABEL[periodType].toLowerCase()}; dikembalikan saat check-out.${depositReceived > 0 ? ` Sudah diterima ${formatRupiah(depositReceived)}.` : ''}`}
                />
                {depositAmount <= 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-800" data-testid="extension-deposit-missing">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Belum ada deposit. Harian biasanya tanpa deposit, tetapi sewa {PERIOD_TYPE_LABEL[periodType].toLowerCase()} sebaiknya memakai deposit.
                  </p>
                )}
                {depositDue > 0 && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={depositNow} onChange={(e) => setDepositNow(e.target.checked)} />
                      Deposit {formatRupiah(depositDue)} sudah diterima
                    </label>
                    {depositNow && <Select label="Metode deposit" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)} options={DEPOSIT_METHODS} />}
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Deposit untuk sewa {PERIOD_TYPE_LABEL[periodType].toLowerCase()}: hanya pemilik/admin yang dapat mengisinya.
              </p>
            )}
          </div>
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
            <Input
              label="Sampai tanggal (check-out)"
              type="date"
              value={customEnd}
              min={checkoutISO(nextBounds?.period_start) ?? undefined}
              onChange={(e) => setCustomEnd(e.target.value)}
              required
              error={customError ?? undefined}
              hint="Hari penyewa keluar kamar."
            />
            <MoneyInput
              label="Harga periode khusus"
              value={baseAmount}
              onChange={(v) => {
                setBaseTouched(true)
                setBaseAmount(v)
              }}
              hint={
                proRata
                  ? `Saran pro-rata: ${formatRupiah(proRata.amount)} untuk ${proRata.days} malam (${formatRupiah(price)} / ${proRata.fullDays} malam).${
                      baseTouched && baseAmount !== proRata.amount ? ' Harga diubah manual.' : ''
                    }`
                  : 'Sesuaikan dengan kesepakatan (pro-rata).'
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CountInput
              label={`Jumlah periode (${unit})`}
              value={quantity}
              onChange={(n) => {
                setUntilDate('')
                setQuantity(n)
              }}
              required
            />
            <Input
              label="atau sampai tanggal check-out"
              type="date"
              value={untilDate}
              min={checkoutISO(nextBounds?.period_start) ?? undefined}
              onChange={(e) => setUntilDate(e.target.value)}
              error={untilError ?? undefined}
              hint={coverInfo ? coverUntilCheckoutHint(coverInfo, unit, untilDate) : 'Hari penyewa keluar; jumlah periode dihitung otomatis.'}
            />
          </div>
        )}
        {preview.draft ? <DraftSummary draft={preview.draft} hasAddons={addons.length > 0} custom={custom} /> : <p className="text-sm text-red-600">{preview.error}</p>}
        {following && (
          <p className="text-xs text-slate-500" data-testid="following-period">
            Tagihan berikutnya setelah ini: {formatStay(following.period_start, following.period_end)} ({PERIOD_TYPE_LABEL[following.period_type].toLowerCase()}
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

/**
 * Edit the rent amount (harga sewa of this invoice, SPEC 7.5), extra / discount / notes of an existing invoice; total
 * and status are recomputed (SPEC 2b.1). The invoice's change history is shown underneath.
 */
export function EditInvoiceModal({ open, onClose, invoice, payments, actions }: EditInvoiceModalProps) {
  const toast = useToast()
  const [base, setBase] = useState(0)
  const [parts, setParts] = useState<ExtraBreakdown>({})
  const [discount, setDiscount] = useState(0)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !invoice) return
    setBase(invoice.base_amount)
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
  const total = base + invoice.addons_amount + extra - discount
  const paid = paidAmountFor(invoice.id, payments)
  const error =
    total < 0 ? 'Diskon melebihi jumlah tagihan.' : total < paid ? `Total tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paid)}).` : null

  const submit = async () => {
    if (error) return
    setSaving(true)
    try {
      await actions.updateInvoice(invoice, payments, { base_amount: base, extra_amount: extra, discount_amount: discount, notes: composeInvoiceNotes(parts, text) })
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
          Periode {formatStay(invoice.period_start, invoice.period_end)}
          {invoice.addons_amount > 0 ? ` · add-on ${formatRupiah(invoice.addons_amount)}` : ''}
        </p>
        <MoneyInput
          label="Harga sewa (tagihan ini)"
          value={base}
          onChange={setBase}
          hint={base !== invoice.base_amount ? `Sebelumnya ${formatRupiah(invoice.base_amount)}. Harga sewa untuk tagihan berikutnya tidak berubah.` : 'Ubah bila salah ketik; tagihan berikutnya tetap memakai harga sewa.'}
        />
        <ExtraFields parts={parts} onChange={setParts} discount={discount} onDiscount={setDiscount} text={text} onText={setText} />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3">
          <Row label="Total baru" value={formatRupiah(Math.max(0, total))} strong />
          <Row label="Sudah dibayar" value={formatRupiah(paid)} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, total - paid))} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <RecordHistory table="invoices" rowId={invoice.id} />
      </div>
    </Modal>
  )
}
