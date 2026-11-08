import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { clsx } from 'clsx'
import { AlertTriangle, ScanLine, X } from 'lucide-react'
import { Button, CountInput, Input, LoadingState, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import { normalizePlate } from '../../domain/plate'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { formatCheckout, formatRupiah, formatStay, todayISO } from '../../lib/format'
import { ID_TYPE_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PERIOD_UNIT_LABEL, type PaymentMethod, type PeriodType, type Room, type Tenant } from '../../types/db'
import { PlateInput } from '../leases/PlateInput'
import { usePriceConfirm } from '../leases/usePriceConfirm'
import { PriceConfirm } from '../leases/PriceConfirm'
import { useRencanaActions } from '../rencana/useRencanaActions'
import { DocumentScanner } from '../scanner/DocumentScanner'
import { SCAN_FIELD_LABEL, SCAN_PREFILL_ORDER, type ScanPrefill } from '../scanner/types'
import {
  mergeScanPrefill,
  perPeriodText,
  planStayBooking,
  QuickCheckInError,
  quantityText,
  resolveScanTenant,
  sameNameCandidates,
  scanFillsTenant,
  scannedDocument,
  tenantByDocument,
  validateStayBooking,
  type StayBookingInput,
} from './quickCheckIn'
import { useBoardData } from './useBoardData'

const CASH_METHODS = PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))
const NEW_TENANT = 'baru'

/** What the owner picks: the lease's period type, with a year as 12 months (SPEC 7.4). */
type StayKind = PeriodType | 'yearly'
const STAY_KINDS: { kind: StayKind; label: string }[] = [
  { kind: 'daily', label: 'Harian' },
  { kind: 'weekly', label: 'Mingguan' },
  { kind: 'monthly', label: 'Bulanan' },
  { kind: 'yearly', label: 'Tahunan' },
]
const periodTypeOf = (kind: StayKind): PeriodType => (kind === 'yearly' ? 'monthly' : kind)
const defaultQuantity = (kind: StayKind) => (kind === 'yearly' ? 12 : 1)
const QUANTITY_LABEL: Record<StayKind, string> = { daily: 'Jumlah malam', weekly: 'Jumlah minggu', monthly: 'Jumlah bulan', yearly: 'Jumlah bulan dibayar' }
const rateOf = (room: Room, kind: StayKind) => (kind === 'daily' ? room.price_daily : kind === 'weekly' ? room.price_weekly : room.price_monthly)

/**
 * Check-in cepat for an empty room (SPEC 7.4): name, how long (nights / weeks / months, or a year = 12 months with
 * optional bonus months) and the total; paid in full, a DP or nothing yet; an optional uang jaminan for monthly and
 * yearly stays; an optional vehicle plate (SPEC 7.11). Scan KTP (SPEC 7.19) fills the name and keeps the document's
 * other values for the tenant that is created (and the photo, in Mode Online); a scanned NIK that an existing tenant
 * already has picks that tenant, and a scanned NIK that nobody has makes the stay a new tenant's unless an existing one
 * is picked by hand; an existing tenant only gets the columns still empty on his record. "Scan ulang" adds to the
 * earlier scan; "Hapus hasil scan" drops it. Saved through the Rencana booking path (bookStay: a fresh room check, then
 * the same rows as the Sewa baru wizard). Add-ons use the full form.
 */
export function QuickCheckInModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const data = useBoardData()
  const actions = useRencanaActions()
  const { repo, isLocalMode } = useOrg()
  const invalidate = useInvalidate()
  const toast = useToast()
  const navigate = useNavigate()
  const today = todayISO()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  /** SPEC 7.19: the scanner panel, and what it read (kept for the new tenant) */
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanned, setScanned] = useState<ScanPrefill | null>(null)
  const [scanImage, setScanImage] = useState<Blob | null>(null)
  /** optional, SPEC 7.11 */
  const [plate, setPlate] = useState('')
  /** '' = automatic (the one same-name tenant, if any), NEW_TENANT, or a tenant id */
  const [tenantChoice, setTenantChoice] = useState('')
  const [kind, setKind] = useState<StayKind>('daily')
  const [startDate, setStartDate] = useState(today)
  const [quantity, setQuantity] = useState(1)
  const [bonus, setBonus] = useState(0)
  /** an agreed total typed by the user; until then the total follows the room's rate x quantity */
  const [typedTotal, setTypedTotal] = useState<number | null>(null)
  const [paidFull, setPaidFull] = useState(true)
  const [dp, setDp] = useState(0)
  const [depositAmount, setDepositAmount] = useState(0)
  const [depositNow, setDepositNow] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const periodType = periodTypeOf(kind)
  const unit = PERIOD_UNIT_LABEL[periodType]
  const rate = rateOf(room, kind)
  const total = typedTotal ?? (rate ?? 0) * quantity
  const paidAmount = paidFull ? total : dp
  const withDeposit = kind === 'monthly' || kind === 'yearly'
  const deposit = withDeposit && depositAmount > 0 ? { amount: depositAmount, paidNow: depositNow } : null
  // a same-name tenant whose known NIK / passport number differs from the scanned one is another person (SPEC 7.19)
  const sameName = useMemo(() => sameNameCandidates(data.tenants, name, scanned), [data.tenants, name, scanned])
  // a scanned number an existing tenant already has: that tenant, whatever the name was typed as
  const byDocument = useMemo(() => tenantByDocument(data.tenants, scanned), [data.tenants, scanned])
  // with a scan, never a pick by name alone: the number's owner, a tenant picked by hand, or a new tenant
  const tenantId = resolveScanTenant({ sameName, byDocument, choice: tenantChoice, newChoice: NEW_TENANT, scanned })
  const existing = tenantId ? data.tenantById.get(tenantId) ?? null : null
  // what the scan adds to that tenant (matched by number or picked by hand): only what his record still lacks
  const fill = existing && scanned ? scanFillsTenant(existing, scanned) : null
  const fillLabels = fill
    ? SCAN_PREFILL_ORDER.filter((k) => k in fill && fill[k as keyof typeof fill] != null).map((k) => (k === 'nik' ? 'NIK' : SCAN_FIELD_LABEL[k].toLowerCase()))
    : []

  const applyScan = (prefill: ScanPrefill, image: Blob | null) => {
    if (prefill.full_name) setName(prefill.full_name)
    const merged = mergeScanPrefill(scanned, prefill)
    // a rescan of the same document keeps the tenant picked by hand; another document starts the choice over
    const before = scannedDocument(scanned)
    const after = scannedDocument(merged)
    if (scanned && (before?.column !== after?.column || before?.value !== after?.value)) setTenantChoice('')
    setScanned(merged)
    if (image) setScanImage(image)
    setScannerOpen(false)
    const match = tenantByDocument(data.tenants, merged)
    if (match) toast.success(`${after?.column === 'nik' ? 'NIK' : 'Nomor paspor'} ini milik penyewa lama ${match.full_name}: sewa dicatat atas namanya.`)
  }

  // the tenant picked by hand stays picked (also one this form created before a failed save)
  const dropScan = () => {
    setScanned(null)
    setScanImage(null)
  }

  /**
   * After the stay is saved, and never failing it: the tenant matched or picked gets what his record lacks, and the
   * document photo goes with the tenant (Mode Online) unless he already has one, as in the Sewa baru wizard.
   */
  const saveScanExtras = async (created: Tenant | null) => {
    if (!scanned) return
    if (existing && fill && Object.keys(fill).length > 0) {
      try {
        await repo.update('tenants', existing.id, fill)
      } catch (err) {
        toast.error(`Data penyewa lama gagal dilengkapi dari scan: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}. Check-in tetap tersimpan.`)
      }
    }
    const photoFor = created ?? (existing && !existing.ktp_image_path ? existing : null)
    if (photoFor && scanImage && !isLocalMode) {
      try {
        const path = await repo.uploadFile('ktp', `${photoFor.id}.jpg`, scanImage, 'image/jpeg')
        if (path) await repo.update('tenants', photoFor.id, { ktp_image_path: path })
      } catch (err) {
        toast.error(`Foto dokumen gagal diunggah: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}. Check-in tetap tersimpan.`)
      }
    }
    // bookStay refreshed the tenants before these were written
    await invalidate('tenants').catch(() => undefined)
  }

  const input: StayBookingInput = {
    room,
    periodType,
    startDate,
    quantity,
    total,
    paidAmount,
    method,
    tenantId: existing?.id ?? null,
    name,
    phone,
    notes: null,
    vehiclePlate: plate,
    bonusQuantity: kind === 'yearly' ? bonus : 0,
    deposit,
    tenantPrefill: existing ? null : scanned,
  }
  const errors = validateStayBooking(input, data.leases)
  const plan = planStayBooking(startDate, periodType, quantity, total, input.bonusQuantity)
  const hasErrors = Object.keys(errors).length > 0
  // SPEC 7.14: the price per night / week / month the total works out to, against the room's rate
  const priceCheck = usePriceConfirm(plan?.pricePerPeriod ?? 0, rate, unit)

  const pickKind = (next: StayKind) => {
    // re-tapping the selected kind (to close the keyboard, a mis-tap) keeps what was typed
    if (next === kind) return
    setKind(next)
    setQuantity(defaultQuantity(next))
    setBonus(0)
    setTypedTotal(null)
  }

  const submit = async () => {
    setTouched(true)
    if (hasErrors || !plan) return
    if (!priceCheck.ok) {
      priceCheck.focus()
      return
    }
    setSaving(true)
    try {
      const { lease, invoice, createdTenant } = await actions.bookStay({ ...input, orgInvoices: data.invoices, today })
      await saveScanExtras(createdTenant)
      const noPhone = !existing && !phone.trim() ? ' HP penyewa belum diisi: lengkapi di halaman penyewa.' : ''
      const paid = paidAmount <= 0 ? ' belum dibayar' : paidAmount >= invoice.total_amount ? ' lunas' : ` DP ${formatRupiah(paidAmount)}`
      toast.success(`Check-in kamar ${room.name} tersimpan. Tagihan ${invoice.invoice_number}${paid}.${noPhone}`)
      onClose()
      navigate(`/sewa/${lease.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan check-in.'
      const friendly = /violates foreign key constraint/i.test(msg) ? 'Data yang dirujuk tidak ditemukan. Muat ulang lalu coba lagi.' : msg
      if (err instanceof QuickCheckInError && err.lease) {
        toast.error(`Sewa tersimpan, tetapi langkah berikutnya gagal: ${friendly} Periksa tagihan & pembayaran di halaman sewa.`)
        // the stay exists: the scan's data and photo go with its tenant all the same
        await saveScanExtras(err.createdTenant)
        onClose()
        navigate(`/sewa/${err.lease.id}`)
      } else if (err instanceof QuickCheckInError && err.createdTenant) {
        // the tenant exists now: a retry uses it instead of creating a duplicate
        setTenantChoice(err.createdTenant.id)
        toast.error(`Penyewa ${err.createdTenant.full_name} tersimpan, tetapi sewa gagal dibuat: ${friendly}`)
      } else {
        toast.error(friendly)
      }
    } finally {
      setSaving(false)
    }
  }

  const payText = paidAmount <= 0 ? `Belum bayar (${formatRupiah(total)})` : paidAmount >= total ? `Lunas ${formatRupiah(total)} · ${PAYMENT_METHOD_LABEL[method]}` : `DP ${formatRupiah(paidAmount)} · sisa ${formatRupiah(total - paidAmount)} · ${PAYMENT_METHOD_LABEL[method]}`

  return (
    <Modal
      open
      onClose={onClose}
      title={`Check-in cepat · Kamar ${room.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={data.isPending}>
            Simpan check-in
          </Button>
        </>
      }
    >
      {data.isPending ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          {errors.room && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {errors.room}
            </p>
          )}
          <Button
            type="button"
            variant={scannerOpen ? 'ghost' : 'secondary'}
            fullWidth
            icon={scannerOpen ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
            onClick={() => setScannerOpen((o) => !o)}
          >
            {scannerOpen ? 'Tutup scanner' : scanned ? 'Scan ulang KTP / Paspor' : 'Scan KTP / Paspor'}
          </Button>
          {scannerOpen && (
            <DocumentScanner
              autoStart
              // what the scan holds so far: a rescan's review warns before it drops a number, and never repeats a value
              current={{ ...scanned, id_type: scanned?.id_type ?? 'ktp', full_name: name.trim() || undefined }}
              onApply={applyScan}
              onCancel={() => setScannerOpen(false)}
            />
          )}
          {scanned && !scannerOpen && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600" data-testid="quick-checkin-scan-result">
              <span>
                Hasil scan {ID_TYPE_LABEL[scanned.id_type]}
                {scanned.nik ? ` · NIK ${scanned.nik}` : scanned.id_number ? ` · ${scanned.id_number}` : ''}
              </span>
              <button type="button" className="font-medium text-red-700 underline" onClick={dropScan}>
                Hapus hasil scan
              </button>
            </p>
          )}
          <Input label="Nama penyewa" value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="off" error={touched ? errors.name : undefined} />
          {byDocument && tenantChoice !== NEW_TENANT && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="quick-checkin-nik-match">
              {scannedDocument(scanned)?.column === 'nik' ? 'NIK' : 'Nomor paspor'} dari scan milik penyewa lama <strong>{byDocument.full_name}</strong>
              {byDocument.phone ? ` · ${byDocument.phone}` : ''}.{' '}
              <button type="button" className="font-medium underline" onClick={() => setTenantChoice(NEW_TENANT)}>
                Bukan dia?
              </button>
            </p>
          )}
          {!byDocument && sameName.length > 0 && (
            <Select
              label="Nama ini sudah ada"
              value={tenantId ?? NEW_TENANT}
              onChange={(e) => setTenantChoice(e.target.value)}
              options={[
                ...sameName.map((t) => ({ value: t.id, label: `Penyewa lama · ${t.phone ?? 'tanpa HP'}` })),
                { value: NEW_TENANT, label: 'Orang lain (penyewa baru)' },
              ]}
              hint={
                scanned
                  ? 'Hasil scan dianggap penyewa baru. Pilih penyewa lama bila orangnya sama; data yang masih kosong dilengkapi dari scan.'
                  : 'Pilih penyewa lama supaya datanya tidak dobel.'
              }
            />
          )}
          {!existing && (
            <Input
              label="Nomor HP"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              error={touched ? errors.phone : undefined}
              hint="Boleh dikosongkan; lengkapi nanti di halaman penyewa."
            />
          )}
          <PlateInput value={plate} onChange={setPlate} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Jenis sewa</span>
            <div role="radiogroup" aria-label="Jenis sewa" className="grid grid-cols-4 rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {STAY_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={k.kind === kind}
                  onClick={() => pickKind(k.kind)}
                  className={clsx('min-h-11 rounded-md px-1 py-2 font-medium transition-colors sm:min-h-0 sm:py-1.5', k.kind === kind ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CountInput label={QUANTITY_LABEL[kind]} value={quantity} onChange={setQuantity} required error={touched ? errors.quantity : undefined} />
            <Input label="Tanggal check-in" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required error={touched ? errors.startDate : undefined} />
          </div>
          {kind === 'yearly' && (
            <CountInput label="Bonus bulan gratis" value={bonus} onChange={setBonus} min={0} max={12} error={touched ? errors.bonus : undefined} hint="Mis. bayar 12 bulan, bonus 1 bulan: sewa 13 bulan, tagihan tetap 12 bulan." />
          )}
          <MoneyInput
            label="Total bayar"
            value={total}
            onChange={setTypedTotal}
            required
            error={touched ? errors.total : undefined}
            hint={plan ? perPeriodText(plan, total, periodType) : rate ? `Tarif kamar ${formatRupiah(rate)} / ${unit}` : `Kamar ini belum punya tarif ${kind === 'yearly' ? 'bulanan' : STAY_KINDS.find((k) => k.kind === kind)!.label.toLowerCase()}.`}
          />
          <PriceConfirm state={priceCheck} showError={touched} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={paidFull} onChange={(e) => setPaidFull(e.target.checked)} />
            Sudah dibayar lunas
          </label>
          {!paidFull && <MoneyInput label="DP dibayar sekarang" value={dp} onChange={setDp} error={touched ? errors.paid : undefined} hint="0 bila belum bayar sama sekali." />}
          {withDeposit && (
            <>
              <MoneyInput label="Uang jaminan (deposit)" value={depositAmount} onChange={setDepositAmount} error={touched ? errors.deposit : undefined} hint="0 bila tanpa deposit. Dikembalikan saat check-out." />
              {depositAmount > 0 && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={depositNow} onChange={(e) => setDepositNow(e.target.checked)} />
                  Deposit sudah diterima
                </label>
              )}
            </>
          )}
          {(paidAmount > 0 || (deposit?.paidNow ?? false)) && <Select label="Metode" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={CASH_METHODS} />}
          {plan && (
            <div className="space-y-0.5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="quick-checkin-summary">
              <p>
                <span className="text-slate-500">Menginap</span> {formatStay(startDate, plan.end)} · {quantityText(quantity, input.bonusQuantity ?? 0, periodType)}
              </p>
              <p>
                <span className="text-slate-500">Check-out</span> <strong>{formatCheckout(plan.end)}</strong>
              </p>
              <p>
                <span className="text-slate-500">Bayar</span> {payText}
              </p>
              {deposit && (
                <p>
                  <span className="text-slate-500">Deposit</span> {formatRupiah(deposit.amount)} {deposit.paidNow ? `diterima · ${PAYMENT_METHOD_LABEL[method]}` : 'belum diterima'}
                </p>
              )}
              {normalizePlate(plate) && (
                <p>
                  <span className="text-slate-500">Kendaraan</span> {normalizePlate(plate)}
                </p>
              )}
              {existing && <p className="text-slate-500">Penyewa lama: {existing.full_name}{existing.phone ? ` · ${existing.phone}` : ' · tanpa HP'}</p>}
              {!existing && scanned && (
                <p data-testid="quick-checkin-scanned">
                  <span className="text-slate-500">Dokumen</span> {ID_TYPE_LABEL[scanned.id_type]}
                  {scanned.nik ? ` · NIK ${scanned.nik}` : scanned.id_number ? ` · ${scanned.id_number}` : ''} · data penyewa diisi dari scan
                </p>
              )}
              {existing && fillLabels.length > 0 && (
                <p data-testid="quick-checkin-scan-fill">
                  <span className="text-slate-500">Dari scan</span> melengkapi {fillLabels.join(', ')}
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-500">Add-on (listrik, laundry, dll.): pakai Form lengkap.</p>
        </div>
      )}
    </Modal>
  )
}
