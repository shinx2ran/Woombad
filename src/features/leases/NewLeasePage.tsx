import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, Check, ChevronDown, ChevronUp, PenLine, Plus, ScanLine, Search, Trash2, Users } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, CountInput, ErrorState, Input, LoadingState, MoneyInput, PageHeader, Select, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { AddonBilling, Lease, LeaseAddon, PaymentMethod, PeriodType, Tenant } from '../../types/db'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, ID_TYPES, ID_TYPE_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { computeAddonsAmount, deriveInvoiceStatus } from '../../domain/billing'
import { periodBounds } from '../../domain/period'
import { formatCheckout, formatDate, formatRupiah, formatStay, todayISO } from '../../lib/format'
import { DocumentScanner } from '../scanner/DocumentScanner'
import type { ScanPrefill } from '../scanner/types'
import {
  EMPTY_TENANT_FORM,
  applyScanPrefill,
  describeIdentity,
  formToScanPrefill,
  formToTenantPayload,
  validateTenantForm,
  type TenantFormValues,
} from '../tenants/tenantUtils'
import { useLeaseData } from './useLeaseData'
import { useLeaseActions } from './useLeaseActions'
import { matchesTenantQuery, roomAvailability, roomPriceFor, ROOM_AVAILABILITY_LABEL, type RoomAvailability } from './leaseUtils'
import { PeriodTypePicker, PriceField, Row } from './components'
import { PAY_MODE_LABEL, scannedExtraFields, validatePayment, type PayMode } from './newLeaseUtils'

interface DraftAddon {
  key: string
  name: string
  amount: number
  billing: AddonBilling
}

/** How the tenant step is being filled. */
type TenantMode = 'choose' | 'scan' | 'existing' | 'new'

const AVAIL_TONE: Record<RoomAvailability, string> = {
  kosong: 'border-slate-200 bg-white hover:border-brand-400',
  terisi: 'border-slate-200 bg-slate-50 text-slate-400',
  dipesan: 'border-amber-200 bg-amber-50 text-amber-700',
  perbaikan: 'border-slate-200 bg-slate-50 text-slate-400',
  bentrok: 'border-rose-200 bg-rose-50 text-rose-700',
}

const CASH_METHODS = PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))

function Section({ step, title, children, hint, done }: { step: number; title: string; hint?: string; done?: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span
              className={clsx(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
                done ? 'bg-emerald-600' : 'bg-brand-700',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : step}
            </span>
            {title}
          </span>
        }
        subtitle={hint}
      />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  )
}

/**
 * Check-in wizard (SPEC 5.3): (1) Penyewa — scan KTP / paspor, pick an existing tenant or type one in;
 * (2) Kos & kamar; (3) Jenis sewa + jumlah periode + harga disepakati (SPEC 5.4); (4) Add-on (collapsed);
 * (5) Pembayaran (Lunas / DP / Belum bayar + deposit) & simpan. Saves tenant (if new) -> lease -> add-ons ->
 * first invoice (buildInvoiceDraft) -> payments, sequentially with clear errors. `?room=`, `?tenant=` and
 * `?scan=1` deep links are honoured.
 */
export function NewLeasePage() {
  const { properties, selectedPropertyId, repo, isLocalMode } = useOrg()
  const data = useLeaseData()
  const actions = useLeaseActions()
  const invalidate = useInvalidate()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const today = todayISO()

  const presetRoom = params.get('room')
  const presetTenant = params.get('tenant')
  const autoScan = params.get('scan') === '1'

  // 1) penyewa
  const [tenantMode, setTenantMode] = useState<TenantMode>(() => (presetTenant ? 'existing' : autoScan ? 'scan' : 'choose'))
  const [scanAutoStart, setScanAutoStart] = useState(autoScan)
  const [tenantId, setTenantId] = useState(presetTenant ?? '')
  const [tenantQuery, setTenantQuery] = useState('')
  const [form, setForm] = useState<TenantFormValues>(EMPTY_TENANT_FORM)
  const [scanned, setScanned] = useState<ScanPrefill | null>(null)
  const [scanImage, setScanImage] = useState<Blob | null>(null)
  // 2) kos & kamar
  const [propertyId, setPropertyId] = useState(() => {
    if (presetRoom) return ''
    return selectedPropertyId !== 'all' ? selectedPropertyId : properties.length === 1 ? properties[0].id : ''
  })
  const [roomId, setRoomId] = useState(presetRoom ?? '')
  const [startDate, setStartDate] = useState(today)
  // 3) jenis sewa
  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [price, setPrice] = useState(0)
  const [quantity, setQuantity] = useState(1)
  // 4) add-on
  const [addonsOpen, setAddonsOpen] = useState(false)
  const [addons, setAddons] = useState<DraftAddon[]>([])
  const [customAddon, setCustomAddon] = useState<{ name: string; amount: number; billing: AddonBilling } | null>(null)
  // 5) pembayaran
  const [payMode, setPayMode] = useState<PayMode | null>(null)
  const [dpAmount, setDpAmount] = useState(0)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(today)
  const [deposit, setDeposit] = useState(0)
  const [depositNow, setDepositNow] = useState(false)
  const [depositAmount, setDepositAmount] = useState(0)
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  // Preset room -> derive kos once rooms are loaded.
  useEffect(() => {
    if (presetRoom && !propertyId) {
      const r = data.roomById.get(presetRoom)
      if (r) setPropertyId(r.property_id)
    }
  }, [presetRoom, propertyId, data.roomById])

  // ?room= / ?tenant= ids that do not resolve to a row (deleted, typo, other org) are dropped once data has
  // loaded, so the wizard never writes a lease that points at a tenant or room that does not exist.
  useEffect(() => {
    if (data.isPending) return
    if (roomId && !data.roomById.has(roomId)) setRoomId('')
    if (tenantId && !data.tenantById.has(tenantId)) {
      setTenantId('')
      setTenantMode((m) => (m === 'existing' ? 'choose' : m))
    }
  }, [data.isPending, data.roomById, data.tenantById, roomId, tenantId])

  const room = data.roomById.get(roomId)
  const property = data.propertyById.get(propertyId)
  const tenant = tenantMode === 'existing' ? data.tenantById.get(tenantId) : undefined
  const isNewTenant = tenantMode === 'new'

  const periodPreview = useMemo(() => {
    try {
      return periodBounds(startDate, periodType, 0, Math.max(1, quantity))
    } catch {
      return null
    }
  }, [startDate, periodType, quantity])
  const stayEnd = periodPreview?.end ?? startDate

  const roomsOfKos = useMemo(
    () =>
      data.rooms
        .filter((r) => r.property_id === propertyId)
        .map((r) => ({ room: r, availability: roomAvailability(r, data.leases, startDate, stayEnd) }))
        .sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true })),
    [data.rooms, data.leases, propertyId, startDate, stayEnd],
  )
  const roomState = roomsOfKos.find((r) => r.room.id === roomId)?.availability

  // Prefill the agreed price from the room's standard rate for the chosen period type (SPEC 5.4: editable).
  // No rate for that type -> 0, so the 'harus lebih dari 0' validation asks for a price instead of silently
  // keeping the previous type's price (a monthly price billed per night).
  useEffect(() => {
    if (!room) return
    setPrice(roomPriceFor(room, periodType) ?? 0)
  }, [room, periodType])

  const tenantMatches = useMemo(
    () => data.tenants.filter((t) => matchesTenantQuery(t, tenantQuery)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'id')).slice(0, 8),
    [data.tenants, tenantQuery],
  )
  const catalog = useMemo(() => data.addonCatalog.filter((c) => c.property_id === null || c.property_id === propertyId), [data.addonCatalog, propertyId])

  // Summary (first invoice)
  const qty = Math.max(1, quantity)
  const base = price * qty
  const addonsAmount = computeAddonsAmount(
    addons.map<LeaseAddon>((a) => ({ id: a.key, org_id: '', created_at: '', lease_id: '', name: a.name, amount: a.amount, billing: a.billing })),
    qty,
    true,
  )
  const total = base + addonsAmount
  const payAmount = payMode === 'lunas' ? total : payMode === 'dp' ? dpAmount : 0

  // The received-deposit section follows the agreed deposit: clearing the agreement to 0 unticks it,
  // so no deposit payment can be written for a lease whose deposit_amount is 0.
  useEffect(() => {
    if (deposit <= 0) {
      setDepositNow(false)
      setDepositAmount(0)
      return
    }
    if (!depositNow) setDepositAmount(deposit)
  }, [deposit, depositNow])

  // ---------- validation ----------
  const tenantErrors = useMemo(() => {
    if (!isNewTenant) return {}
    const errs = validateTenantForm({ ...form, property_id: propertyId || '-' })
    delete errs.property_id
    if (!form.phone.trim()) errs.phone = 'Nomor HP wajib diisi (tidak ada di KTP/paspor).'
    return errs
  }, [isNewTenant, form, propertyId])

  const errors: Record<string, string> = {}
  if (isNewTenant) {
    const first = Object.values(tenantErrors).find(Boolean)
    if (first) errors.tenant = first
  } else if (!tenant) {
    errors.tenant = tenantId ? 'Penyewa tidak ditemukan. Pilih penyewa lain.' : 'Scan KTP/paspor, pilih penyewa lama, atau isi data penyewa baru.'
  }
  if (!propertyId) errors.property = 'Pilih kos.'
  // Validate the resolved rows, not the id strings: a preset id from the URL may not exist.
  if (!roomId) errors.room = 'Pilih kamar.'
  else if (!room) errors.room = 'Kamar tidak ditemukan. Pilih kamar lain.'
  else if (room.property_id !== propertyId) errors.room = 'Kamar tidak termasuk kos yang dipilih.'
  else if (roomState && roomState !== 'kosong') errors.room = `Kamar ${ROOM_AVAILABILITY_LABEL[roomState].toLowerCase()} pada periode ini.`
  if (!startDate) errors.start = 'Tanggal check-in wajib diisi.'
  if (room && price <= 0) errors.price = `Harga per ${PERIOD_UNIT_LABEL[periodType]} harus lebih dari 0.`
  if (quantity < 1) errors.quantity = 'Jumlah periode minimal 1.'
  const payError = validatePayment(payMode, dpAmount, total)
  if (payError) errors.pay = payError
  if (depositNow && deposit <= 0) errors.deposit = 'Isi deposit yang disepakati dahulu.'
  else if (depositNow && depositAmount <= 0) errors.deposit = 'Jumlah deposit harus lebih dari 0.'
  const hasErrors = Object.keys(errors).length > 0

  // ---------- tenant step actions ----------
  const openScanner = () => {
    setScanAutoStart(true)
    setTenantMode('scan')
  }
  const applyScan = (prefill: ScanPrefill, image: Blob | null) => {
    setForm((f) => applyScanPrefill(f, prefill))
    setScanned(prefill)
    setScanImage(image)
    setTenantMode('new')
  }
  const setField = <K extends keyof TenantFormValues>(key: K, value: TenantFormValues[K]) => setForm((f) => ({ ...f, [key]: value }))
  const extraScanned = scanned ? scannedExtraFields(scanned) : []

  const addFromCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id)
    if (!c) return
    setAddons((prev) => [...prev, { key: `${c.id}-${Date.now()}`, name: c.name, amount: c.default_price, billing: c.billing }])
  }

  // ---------- save ----------
  const save = async () => {
    setTouched(true)
    if (hasErrors || !periodPreview || !room) {
      toast.error('Lengkapi data yang ditandai merah.')
      return
    }
    if (!isNewTenant && !tenant) return
    setSaving(true)
    let lease: Lease | null = null
    let createdTenant: Tenant | null = null
    try {
      let finalTenantId = tenant?.id ?? ''
      if (isNewTenant) {
        createdTenant = await repo.insert('tenants', formToTenantPayload({ ...form, property_id: propertyId }))
        finalTenantId = createdTenant.id
        if (scanImage && !isLocalMode) {
          try {
            const path = await repo.uploadFile('ktp', `${createdTenant.id}.jpg`, scanImage, 'image/jpeg')
            if (path) await repo.update('tenants', createdTenant.id, { ktp_image_path: path })
          } catch (err) {
            toast.error(`Foto dokumen gagal diunggah: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}. Sewa tetap disimpan.`)
          }
        }
      }
      lease = await repo.insert('leases', {
        property_id: propertyId,
        room_id: roomId,
        tenant_id: finalTenantId,
        period_type: periodType,
        price_per_period: price,
        deposit_amount: deposit,
        start_date: startDate,
        end_date: periodPreview.end,
        status: 'active',
        checkout_date: null,
        notes: notes.trim() || null,
      })
      let leaseAddons: LeaseAddon[] = []
      if (addons.length > 0) {
        const leaseId = lease.id
        leaseAddons = await repo.insertMany(
          'lease_addons',
          addons.map((a) => ({ lease_id: leaseId, name: a.name, amount: a.amount, billing: a.billing })),
        )
      }
      const { invoice } = await actions.insertFromDraft({ lease, addons: leaseAddons, quantity: qty, existingInvoices: [], orgInvoices: data.invoices }, null)
      if (payMode !== 'none' && payAmount > 0) {
        await repo.insert('payments', {
          property_id: propertyId,
          invoice_id: invoice.id,
          lease_id: lease.id,
          amount: Math.min(payAmount, invoice.total_amount),
          paid_at: payDate,
          method: payMethod,
          kind: 'rent',
          notes: payAmount < invoice.total_amount ? 'DP' : null,
        })
        const status = deriveInvoiceStatus(invoice.total_amount, Math.min(payAmount, invoice.total_amount), invoice.status)
        if (status !== invoice.status && actions.canWriteInvoiceStatus) await repo.update('invoices', invoice.id, { status })
      }
      if (depositNow && deposit > 0 && depositAmount > 0) {
        await repo.insert('payments', {
          property_id: propertyId,
          invoice_id: null,
          lease_id: lease.id,
          amount: depositAmount,
          paid_at: payDate,
          method: depositMethod,
          kind: 'deposit',
          notes: 'Uang jaminan',
        })
      }
      await invalidate('leases', 'lease_addons', 'invoices', 'payments', 'tenants')
      toast.success(`Check-in kamar ${room.name} tersimpan. Tagihan ${invoice.invoice_number} diterbitkan.`)
      navigate(`/sewa/${lease.id}`, { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan sewa.'
      // Insert-time FK failure (Supabase): the referenced tenant/room/kos vanished between load and save.
      const friendly = /violates foreign key constraint/i.test(msg) ? 'Data yang dirujuk tidak ditemukan (mis. penyewa/kamar sudah dihapus). Muat ulang lalu coba lagi.' : msg
      await invalidate('leases', 'lease_addons', 'invoices', 'payments', 'tenants')
      if (lease) {
        toast.error(`Sewa tersimpan, tetapi langkah berikutnya gagal: ${friendly} Periksa tagihan & pembayaran di halaman sewa.`)
        navigate(`/sewa/${lease.id}`, { replace: true })
      } else if (createdTenant) {
        // The tenant exists now: switch to it so a retry does not create a duplicate.
        setTenantId(createdTenant.id)
        setTenantMode('existing')
        toast.error(`Penyewa ${createdTenant.full_name} tersimpan, tetapi sewa gagal dibuat: ${friendly}`)
      } else {
        toast.error(friendly)
      }
    } finally {
      setSaving(false)
    }
  }

  if (data.isPending) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />

  const unit = PERIOD_UNIT_LABEL[periodType]
  const standard = roomPriceFor(room, periodType)
  const isPassport = form.id_type === 'passport'
  const idNumberLabel = isPassport ? 'Nomor paspor' : form.id_type === 'other' ? 'Nomor identitas' : 'NIK'
  const tenantName = isNewTenant ? form.full_name.trim() : tenant?.full_name
  const tenantDone = isNewTenant ? Object.keys(tenantErrors).length === 0 : Boolean(tenant)

  return (
    <>
      <PageHeader
        title="Check-in / Sewa Baru"
        subtitle="Scan KTP/paspor, pilih kamar dan jenis sewa, lalu simpan. Tagihan pertama dibuat otomatis."
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            Kembali
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {/* 1) Penyewa */}
          <Section step={1} title="Penyewa" done={tenantDone}>
            {tenantMode === 'choose' && (
              <div className="space-y-3">
                <Button fullWidth size="lg" icon={<ScanLine className="h-5 w-5" />} onClick={openScanner}>
                  Scan KTP / Paspor
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" icon={<Users className="h-4 w-4" />} onClick={() => setTenantMode('existing')}>
                    Pilih penyewa lama
                  </Button>
                  <Button variant="outline" icon={<PenLine className="h-4 w-4" />} onClick={() => setTenantMode('new')}>
                    Isi sendiri
                  </Button>
                </div>
                <p className="text-xs text-slate-500">Data dari KTP/paspor terisi otomatis; nomor HP tetap diisi manual.</p>
              </div>
            )}

            {tenantMode === 'scan' && (
              <div className="space-y-2">
                <DocumentScanner autoStart={scanAutoStart} current={formToScanPrefill(form)} onApply={applyScan} onCancel={() => setTenantMode('new')} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTenantMode('existing')}>
                    Pilih penyewa lama
                  </button>
                  <button type="button" className="font-medium text-slate-600 hover:underline" onClick={() => setTenantMode('choose')}>
                    Batal scan
                  </button>
                </div>
              </div>
            )}

            {tenantMode === 'existing' &&
              (tenant ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{tenant.full_name}</p>
                    <p className="truncate text-xs text-slate-600">
                      {[tenant.phone ?? 'Tanpa nomor HP', describeIdentity(tenant).text].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTenantId('')
                      setTenantMode('choose')
                    }}
                  >
                    Ganti
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={tenantQuery}
                      onChange={(e) => setTenantQuery(e.target.value)}
                      placeholder="Cari nama / HP / NIK / paspor…"
                      aria-label="Cari penyewa"
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                    {tenantMatches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ada penyewa yang cocok.</li>}
                    {tenantMatches.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => setTenantId(t.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">{t.full_name}</span>
                            <span className="block truncate text-xs text-slate-500">{t.phone ?? '-'}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">{data.propertyById.get(t.property_id ?? '')?.name ?? ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500">
                    Penyewa baru?{' '}
                    <button type="button" className="font-medium text-brand-700 hover:underline" onClick={openScanner}>
                      Scan KTP / Paspor
                    </button>{' '}
                    atau{' '}
                    <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTenantMode('new')}>
                      isi sendiri
                    </button>
                    .
                  </p>
                </div>
              ))}

            {tenantMode === 'new' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {scanned ? (
                    <Badge tone="success">Terisi dari scan {ID_TYPE_LABEL[scanned.id_type]}</Badge>
                  ) : (
                    <span className="text-xs text-slate-500">Penyewa baru, diisi manual.</span>
                  )}
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" icon={<ScanLine className="h-4 w-4" />} onClick={openScanner}>
                      {scanned ? 'Scan ulang' : 'Scan'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTenantMode('existing')}>
                      Penyewa lama
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Input
                      label="Nama lengkap"
                      value={form.full_name}
                      onChange={(e) => setField('full_name', e.target.value)}
                      required
                      autoComplete="off"
                      error={touched ? tenantErrors.full_name : undefined}
                    />
                  </div>
                  <Input
                    label="Nomor HP (WhatsApp)"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    required
                    error={touched ? tenantErrors.phone : undefined}
                    hint="Tidak ada di KTP/paspor; isi manual."
                  />
                  <Select
                    label="Jenis identitas"
                    value={form.id_type}
                    onChange={(e) => setField('id_type', e.target.value as TenantFormValues['id_type'])}
                    options={ID_TYPES.map((t) => ({ value: t, label: ID_TYPE_LABEL[t] }))}
                  />
                  {form.id_type === 'ktp' ? (
                    <Input
                      label="NIK"
                      inputMode="numeric"
                      value={form.nik}
                      onChange={(e) => setField('nik', e.target.value)}
                      placeholder="16 digit"
                      error={touched ? tenantErrors.nik : undefined}
                    />
                  ) : (
                    <Input
                      label={idNumberLabel}
                      value={form.id_number}
                      onChange={(e) => setField('id_number', e.target.value)}
                      autoCapitalize="characters"
                      error={touched ? tenantErrors.id_number : undefined}
                    />
                  )}
                  {isPassport && (
                    <Input
                      label="Kewarganegaraan"
                      value={form.nationality}
                      onChange={(e) => setField('nationality', e.target.value)}
                      placeholder="mis. AUS"
                      autoCapitalize="characters"
                      error={touched ? tenantErrors.nationality : undefined}
                    />
                  )}
                </div>
                {extraScanned.length > 0 && <p className="text-xs text-slate-500">Juga disimpan dari scan: {extraScanned.join(', ')}.</p>}
              </div>
            )}
            {touched && errors.tenant && tenantMode !== 'new' && <p className="text-xs text-red-600">{errors.tenant}</p>}
          </Section>

          {/* 2) Kos & kamar */}
          <Section step={2} title="Kos & kamar" done={Boolean(room) && !errors.room} hint={propertyId ? 'Hanya kamar kosong pada tanggal check-in yang bisa dipilih.' : 'Pilih kos dahulu.'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Kos"
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value)
                  setRoomId('')
                }}
                placeholder="Pilih kos"
                required
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
                error={touched ? errors.property : undefined}
              />
              <Input label="Tanggal check-in" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required error={touched ? errors.start : undefined} />
            </div>
            {propertyId && roomsOfKos.length === 0 && <p className="text-sm text-slate-500">Kos ini belum punya kamar.</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {roomsOfKos.map(({ room: r, availability }) => {
                const selectable = availability === 'kosong'
                const selected = r.id === roomId
                const rate = roomPriceFor(r, periodType)
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!selectable}
                    onClick={() => setRoomId(r.id)}
                    aria-pressed={selected}
                    className={clsx(
                      'flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed',
                      selected ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-200' : AVAIL_TONE[availability],
                    )}
                  >
                    <span className="flex w-full items-center justify-between font-semibold">
                      {r.name}
                      {selected && <Check className="h-4 w-4 text-brand-700" />}
                    </span>
                    <span className="text-xs">{ROOM_AVAILABILITY_LABEL[availability]}</span>
                    {rate != null && (
                      <span className="text-xs text-slate-500">
                        {formatRupiah(rate)}/{unit}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {touched && errors.room && <p className="text-xs text-red-600">{errors.room}</p>}
          </Section>

          {/* 3) Jenis sewa */}
          <Section step={3} title="Jenis sewa" done={!errors.price && !errors.quantity && Boolean(room)} hint={room ? `Tarif standar kamar ${room.name}; harga bisa dinegosiasi.` : 'Pilih kamar untuk melihat tarifnya.'}>
            <PeriodTypePicker
              variant="cards"
              label="Jenis sewa"
              value={periodType}
              onChange={setPeriodType}
              prices={room ? { daily: room.price_daily, weekly: room.price_weekly, monthly: room.price_monthly } : undefined}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CountInput
                label={`Jumlah periode (${unit})`}
                value={quantity}
                onChange={setQuantity}
                required
                error={touched ? errors.quantity : undefined}
              />
              <PriceField
                label={`Harga disepakati per ${unit}`}
                value={price}
                onChange={setPrice}
                standard={standard}
                unit={unit}
                required
                error={touched ? errors.price : undefined}
                missingText={room ? undefined : 'Pilih kamar untuk melihat harga standar.'}
              />
            </div>
            {periodPreview && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="stay-preview">
                {/* periodPreview.end is the last night; people read the end as the check-out day (SPEC 7.3) */}
                {qty} {unit}: <strong>{formatDate(periodPreview.start)}</strong> s/d <strong>{formatCheckout(periodPreview.end)}</strong>
                <span className="text-slate-500"> · {formatRupiah(base)}</span>
              </p>
            )}
          </Section>

          {/* 4) Add-on */}
          <Section step={4} title="Add-on" hint="Opsional: kasur tambahan, parkir, laundry…">
            <button
              type="button"
              onClick={() => setAddonsOpen((o) => !o)}
              aria-expanded={addonsOpen}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-slate-400" aria-hidden /> Tambah add-on
                {addons.length > 0 && (
                  <span className="text-xs font-normal text-slate-500">
                    {addons.length} dipilih · {formatRupiah(addonsAmount)}
                  </span>
                )}
              </span>
              {addonsOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {addonsOpen && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Per periode dikali jumlah periode; sekali bayar hanya di tagihan pertama.</p>
                {addons.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {addons.map((a, idx) => (
                      <li key={a.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="w-full min-w-0 font-medium text-slate-900 sm:w-auto sm:flex-1">{a.name}</span>
                        <MoneyInput value={a.amount} onChange={(v) => setAddons(addons.map((x, i) => (i === idx ? { ...x, amount: v } : x)))} className="w-36" />
                        <select
                          value={a.billing}
                          onChange={(e) => setAddons(addons.map((x, i) => (i === idx ? { ...x, billing: e.target.value as AddonBilling } : x)))}
                          aria-label="Penagihan add-on"
                          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                        >
                          {ADDON_BILLINGS.map((b) => (
                            <option key={b} value={b}>
                              {ADDON_BILLING_LABEL[b]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="Hapus add-on"
                          onClick={() => setAddons(addons.filter((_, i) => i !== idx))}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  {catalog.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => addFromCatalog(c.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700"
                    >
                      <Plus className="h-3 w-3" /> {c.name} · {formatRupiah(c.default_price)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomAddon({ name: '', amount: 0, billing: 'per_period' })}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700"
                  >
                    <Plus className="h-3 w-3" /> Add-on lain
                  </button>
                </div>
                {customAddon && (
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_140px_150px_auto] sm:items-end">
                    <Input label="Nama add-on" value={customAddon.name} onChange={(e) => setCustomAddon({ ...customAddon, name: e.target.value })} />
                    <MoneyInput label="Jumlah" value={customAddon.amount} onChange={(v) => setCustomAddon({ ...customAddon, amount: v })} />
                    <Select
                      label="Penagihan"
                      value={customAddon.billing}
                      onChange={(e) => setCustomAddon({ ...customAddon, billing: e.target.value as AddonBilling })}
                      options={ADDON_BILLINGS.map((b) => ({ value: b, label: ADDON_BILLING_LABEL[b] }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="md"
                        disabled={!customAddon.name.trim()}
                        onClick={() => {
                          setAddons([...addons, { key: `custom-${Date.now()}`, ...customAddon, name: customAddon.name.trim() }])
                          setCustomAddon(null)
                        }}
                      >
                        Tambah
                      </Button>
                      <Button size="md" variant="ghost" onClick={() => setCustomAddon(null)}>
                        Batal
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* 5) Pembayaran & simpan */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Section step={5} title="Pembayaran & simpan">
            <div className="space-y-1">
              <Row label="Penyewa" value={tenantName || '-'} />
              <Row label="Kamar" value={room ? `${room.name} · ${property?.name ?? ''}` : '-'} />
              <Row label="Periode" value={periodPreview ? formatStay(periodPreview.start, periodPreview.end) : '-'} />
              <Row label={`${PERIOD_TYPE_LABEL[periodType]} ${qty} ${unit}`} value={formatRupiah(base)} />
              {addonsAmount > 0 && <Row label="Add-on" value={formatRupiah(addonsAmount)} />}
              <div className="border-t border-slate-200 pt-1">
                <Row label="Total tagihan pertama" value={formatRupiah(total)} strong />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">
                Pembayaran tagihan pertama <span className="text-red-600">*</span>
              </legend>
              {(['lunas', 'dp', 'none'] as PayMode[]).map((m) => (
                <label
                  key={m}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
                    payMode === m ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-300',
                  )}
                >
                  <input type="radio" name="pay-mode" value={m} checked={payMode === m} onChange={() => setPayMode(m)} className="h-4 w-4" />
                  <span className="flex-1 font-medium text-slate-900">{PAY_MODE_LABEL[m]}</span>
                  {m === 'lunas' && <span className="tabular-nums text-slate-600">{formatRupiah(total)}</span>}
                </label>
              ))}
              {touched && errors.pay && <p className="text-xs text-red-600">{errors.pay}</p>}
            </fieldset>

            {(payMode === 'lunas' || payMode === 'dp') && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {payMode === 'dp' && (
                  <MoneyInput
                    label="Jumlah DP"
                    value={dpAmount}
                    onChange={setDpAmount}
                    required
                    hint={dpAmount > 0 && dpAmount < total ? `Sisa ${formatRupiah(total - dpAmount)} dibayar nanti.` : undefined}
                  />
                )}
                <Select label="Metode" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} options={CASH_METHODS} />
                <Input label="Tanggal bayar" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            )}

            <MoneyInput label="Deposit (uang jaminan) disepakati" value={deposit} onChange={setDeposit} hint="0 bila tanpa deposit." />
            <label className={clsx('flex items-start gap-2 text-sm', deposit > 0 ? 'text-slate-700' : 'text-slate-400')}>
              <input type="checkbox" className="mt-0.5" checked={depositNow && deposit > 0} disabled={deposit <= 0 && !depositNow} onChange={(e) => setDepositNow(e.target.checked)} />
              Deposit sudah diterima
            </label>
            {depositNow && deposit > 0 && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <MoneyInput label="Jumlah deposit diterima" value={depositAmount} onChange={setDepositAmount} error={touched ? errors.deposit : undefined} />
                <Select label="Metode" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)} options={CASH_METHODS} />
                {payMode !== 'lunas' && payMode !== 'dp' && <Input label="Tanggal diterima" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />}
              </div>
            )}
            <Textarea label="Catatan sewa" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />

            {touched && hasErrors && (
              <ul className="space-y-0.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="wizard-errors">
                {Object.values(errors).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <Button fullWidth size="lg" onClick={save} loading={saving} icon={<Check className="h-5 w-5" />}>
              Simpan & check-in
            </Button>
            <p className="text-center text-xs text-slate-500">
              Penyewa belum terdaftar lengkap? Data lain bisa dilengkapi di <Link to="/penyewa" className="font-medium text-brand-700 hover:underline">halaman Penyewa</Link>.
            </p>
          </Section>
        </div>
      </div>
    </>
  )
}
