import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, Check, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, ErrorState, Input, LoadingState, MoneyInput, PageHeader, Select, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { AddonBilling, Lease, LeaseAddon, PaymentMethod, PeriodType, Tenant } from '../../types/db'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PERIOD_TYPES, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { computeAddonsAmount, deriveInvoiceStatus } from '../../domain/billing'
import { periodBounds } from '../../domain/period'
import { formatDate, formatRupiah, normalizePhone, todayISO } from '../../lib/format'
import { useLeaseData } from './useLeaseData'
import { useLeaseActions } from './useLeaseActions'
import { matchesTenantQuery, roomAvailability, roomPriceFor, ROOM_AVAILABILITY_LABEL, type RoomAvailability } from './leaseUtils'
import { Row } from './components'

interface DraftAddon {
  key: string
  name: string
  amount: number
  billing: AddonBilling
}

const AVAIL_TONE: Record<RoomAvailability, string> = {
  kosong: 'border-slate-200 bg-white hover:border-brand-400',
  terisi: 'border-slate-200 bg-slate-50 text-slate-400',
  dipesan: 'border-amber-200 bg-amber-50 text-amber-700',
  perbaikan: 'border-slate-200 bg-slate-50 text-slate-400',
  bentrok: 'border-rose-200 bg-rose-50 text-rose-700',
}

function Section({ step, title, children, hint }: { step: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">{step}</span>
            {title}
          </span>
        }
        subtitle={hint}
      />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  )
}

export function NewLeasePage() {
  const { properties, selectedPropertyId, repo } = useOrg()
  const data = useLeaseData()
  const actions = useLeaseActions()
  const invalidate = useInvalidate()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const today = todayISO()

  const presetRoom = params.get('room')
  const presetTenant = params.get('tenant')

  // 1) kos
  const [propertyId, setPropertyId] = useState(() => {
    if (presetRoom) return ''
    return selectedPropertyId !== 'all' ? selectedPropertyId : properties.length === 1 ? properties[0].id : ''
  })
  // 2) kamar
  const [roomId, setRoomId] = useState(presetRoom ?? '')
  // 3) penyewa
  const [tenantId, setTenantId] = useState(presetTenant ?? '')
  const [tenantQuery, setTenantQuery] = useState('')
  const [newTenant, setNewTenant] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  // 4) periode
  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [price, setPrice] = useState(0)
  const [startDate, setStartDate] = useState(today)
  const [quantity, setQuantity] = useState(1)
  const [deposit, setDeposit] = useState(0)
  const [notes, setNotes] = useState('')
  // 5) add-on
  const [addons, setAddons] = useState<DraftAddon[]>([])
  const [customAddon, setCustomAddon] = useState<{ name: string; amount: number; billing: AddonBilling } | null>(null)
  // 6) pembayaran
  const [payNow, setPayNow] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(today)
  const [depositNow, setDepositNow] = useState(false)
  const [depositAmount, setDepositAmount] = useState(0)
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('cash')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  // Preset room -> derive kos once rooms are loaded.
  useEffect(() => {
    if (presetRoom && !propertyId) {
      const r = data.roomById.get(presetRoom)
      if (r) setPropertyId(r.property_id)
    }
  }, [presetRoom, propertyId, data.roomById])

  const room = data.roomById.get(roomId)
  const property = data.propertyById.get(propertyId)
  const tenant = data.tenantById.get(tenantId)

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

  // Prefill price from the room for the chosen period type.
  useEffect(() => {
    const p = roomPriceFor(room, periodType)
    if (p != null) setPrice(p)
  }, [room, periodType])

  const tenantMatches = useMemo(
    () => data.tenants.filter((t) => matchesTenantQuery(t, tenantQuery)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'id')).slice(0, 8),
    [data.tenants, tenantQuery],
  )
  const catalog = useMemo(
    () => data.addonCatalog.filter((c) => c.property_id === null || c.property_id === propertyId),
    [data.addonCatalog, propertyId],
  )

  // Summary (first invoice)
  const base = price * Math.max(1, quantity)
  const addonsAmount = computeAddonsAmount(
    addons.map<LeaseAddon>((a) => ({ id: a.key, org_id: '', created_at: '', lease_id: '', name: a.name, amount: a.amount, billing: a.billing })),
    Math.max(1, quantity),
    true,
  )
  const total = base + addonsAmount

  useEffect(() => {
    if (!payNow) setPayAmount(total)
  }, [total, payNow])
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

  // Validation
  const errors: Record<string, string> = {}
  if (!propertyId) errors.property = 'Pilih kos.'
  if (!roomId) errors.room = 'Pilih kamar.'
  else if (roomState && roomState !== 'kosong') errors.room = `Kamar ${ROOM_AVAILABILITY_LABEL[roomState].toLowerCase()} pada periode ini.`
  if (newTenant) {
    if (!newName.trim()) errors.tenant = 'Nama penyewa wajib diisi.'
    else if (!newPhone.trim()) errors.tenant = 'Nomor telepon wajib diisi.'
  } else if (!tenantId) errors.tenant = 'Pilih penyewa atau buat penyewa baru.'
  if (!startDate) errors.start = 'Tanggal mulai wajib diisi.'
  if (price <= 0) errors.price = 'Harga per periode harus lebih dari 0.'
  if (quantity < 1) errors.quantity = 'Jumlah periode minimal 1.'
  if (payNow && (payAmount <= 0 || payAmount > total)) errors.pay = payAmount <= 0 ? 'Jumlah harus lebih dari 0.' : `Maksimal ${formatRupiah(total)} (sisa bisa dibayar nanti).`
  if (depositNow && deposit <= 0) errors.deposit = 'Isi deposit yang disepakati dahulu.'
  else if (depositNow && depositAmount <= 0) errors.deposit = 'Jumlah deposit harus lebih dari 0.'
  const hasErrors = Object.keys(errors).length > 0

  const addFromCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id)
    if (!c) return
    setAddons((prev) => [...prev, { key: `${c.id}-${Date.now()}`, name: c.name, amount: c.default_price, billing: c.billing }])
  }

  const save = async () => {
    setTouched(true)
    if (hasErrors || !periodPreview || !room) return
    setSaving(true)
    let lease: Lease | null = null
    try {
      let finalTenantId = tenantId
      if (newTenant) {
        const created = await repo.insert('tenants', {
          property_id: propertyId,
          full_name: newName.trim(),
          phone: normalizePhone(newPhone),
          nik: null,
          gender: null,
          birth_place: null,
          birth_date: null,
          address: null,
          religion: null,
          marital_status: null,
          occupation: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          ktp_image_path: null,
          notes: null,
        })
        finalTenantId = created.id
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
        leaseAddons = await repo.insertMany(
          'lease_addons',
          addons.map((a) => ({ lease_id: lease!.id, name: a.name, amount: a.amount, billing: a.billing })),
        )
      }
      const { invoice } = await actions.insertFromDraft(
        { lease, addons: leaseAddons, quantity: Math.max(1, quantity), existingInvoices: [], orgInvoices: data.invoices },
        null,
      )
      if (payNow && payAmount > 0) {
        await repo.insert('payments', {
          property_id: propertyId,
          invoice_id: invoice.id,
          lease_id: lease.id,
          amount: payAmount,
          paid_at: payDate,
          method: payMethod,
          kind: 'rent',
          notes: payAmount < invoice.total_amount ? 'DP' : null,
        })
        const status = deriveInvoiceStatus(invoice.total_amount, payAmount, invoice.status)
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
      toast.success(`Sewa kamar ${room.name} dibuat. Tagihan ${invoice.invoice_number} diterbitkan.`)
      navigate(`/sewa/${lease.id}`, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan sewa.')
      await invalidate('leases', 'lease_addons', 'invoices', 'payments', 'tenants')
      if (lease) navigate(`/sewa/${lease.id}`, { replace: true })
    } finally {
      setSaving(false)
    }
  }

  if (data.isPending) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />

  const unit = PERIOD_UNIT_LABEL[periodType]

  return (
    <>
      <PageHeader
        title="Sewa Baru"
        subtitle="Penyewa masuk: pilih kamar, periode, add-on, lalu simpan. Tagihan pertama dibuat otomatis."
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            Kembali
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section step={1} title="Kos">
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
          </Section>

          <Section step={2} title="Kamar" hint={propertyId ? 'Hanya kamar kosong pada tanggal mulai yang bisa dipilih.' : 'Pilih kos dahulu.'}>
            {propertyId && roomsOfKos.length === 0 && <p className="text-sm text-slate-500">Kos ini belum punya kamar.</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {roomsOfKos.map(({ room: r, availability }) => {
                const selectable = availability === 'kosong'
                const selected = r.id === roomId
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!selectable}
                    onClick={() => setRoomId(r.id)}
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
                    {roomPriceFor(r, periodType) != null && <span className="text-xs text-slate-500">{formatRupiah(roomPriceFor(r, periodType))}/{unit}</span>}
                  </button>
                )
              })}
            </div>
            {touched && errors.room && <p className="text-xs text-red-600">{errors.room}</p>}
          </Section>

          <Section step={3} title="Penyewa">
            <div className="flex gap-2 text-sm">
              <button type="button" onClick={() => setNewTenant(false)} className={clsx('rounded-lg px-3 py-1.5 font-medium', !newTenant ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700')}>
                Pilih yang ada
              </button>
              <button type="button" onClick={() => setNewTenant(true)} className={clsx('inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium', newTenant ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700')}>
                <UserPlus className="h-4 w-4" /> Buat penyewa baru
              </button>
            </div>
            {newTenant ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Nama lengkap" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                <Input label="Nomor HP (WhatsApp)" type="tel" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="08xxxxxxxxxx" required hint="Data KTP bisa dilengkapi nanti di halaman Penyewa." />
              </div>
            ) : tenant ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{tenant.full_name}</p>
                  <p className="text-xs text-slate-600">{tenant.phone ?? 'Tanpa nomor HP'}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setTenantId('')}>
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
                    placeholder="Cari nama / HP / NIK…"
                    aria-label="Cari penyewa"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                  {tenantMatches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ada penyewa yang cocok.</li>}
                  {tenantMatches.map((t: Tenant) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setTenantId(t.id)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span>
                          <span className="block font-medium text-slate-900">{t.full_name}</span>
                          <span className="block text-xs text-slate-500">{t.phone ?? '-'}</span>
                        </span>
                        <span className="text-xs text-slate-400">{data.propertyById.get(t.property_id ?? '')?.name ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500">
                  Tidak ketemu? <Link to="/penyewa?new=1" className="font-medium text-brand-700 hover:underline">Buat lengkap di halaman Penyewa</Link> atau pakai “Buat penyewa baru”.
                </p>
              </div>
            )}
            {touched && errors.tenant && <p className="text-xs text-red-600">{errors.tenant}</p>}
          </Section>

          <Section step={4} title="Periode & harga">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Tipe periode" value={periodType} onChange={(e) => setPeriodType(e.target.value as PeriodType)} options={PERIOD_TYPES.map((p) => ({ value: p, label: PERIOD_TYPE_LABEL[p] }))} />
              <MoneyInput label={`Harga per ${unit}`} value={price} onChange={setPrice} required error={touched ? errors.price : undefined} hint={room ? 'Terisi dari harga kamar; boleh diubah.' : undefined} />
              <Input label="Tanggal mulai" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required error={touched ? errors.start : undefined} />
              <Input
                label={`Jumlah periode pertama (${unit})`}
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                required
                hint={periodPreview ? `Periode pertama ${formatDate(periodPreview.start)} – ${formatDate(periodPreview.end)}` : undefined}
                error={touched ? errors.quantity : undefined}
              />
              <MoneyInput label="Deposit (uang jaminan) disepakati" value={deposit} onChange={setDeposit} hint="0 bila tanpa deposit." />
              <Textarea label="Catatan sewa" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />
            </div>
          </Section>

          <Section step={5} title="Add-on" hint="Kasur tambahan, parkir, laundry… Per periode dikali jumlah periode; sekali bayar hanya di tagihan pertama.">
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
                    <button type="button" aria-label="Hapus add-on" onClick={() => setAddons(addons.filter((_, i) => i !== idx))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {catalog.map((c) => (
                <button key={c.id} type="button" onClick={() => addFromCatalog(c.id)} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700">
                  <Plus className="h-3 w-3" /> {c.name} · {formatRupiah(c.default_price)}
                </button>
              ))}
              <button type="button" onClick={() => setCustomAddon({ name: '', amount: 0, billing: 'per_period' })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700">
                <Plus className="h-3 w-3" /> Add-on lain
              </button>
            </div>
            {customAddon && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_140px_150px_auto] sm:items-end">
                <Input label="Nama add-on" value={customAddon.name} onChange={(e) => setCustomAddon({ ...customAddon, name: e.target.value })} />
                <MoneyInput label="Jumlah" value={customAddon.amount} onChange={(v) => setCustomAddon({ ...customAddon, amount: v })} />
                <Select label="Penagihan" value={customAddon.billing} onChange={(e) => setCustomAddon({ ...customAddon, billing: e.target.value as AddonBilling })} options={ADDON_BILLINGS.map((b) => ({ value: b, label: ADDON_BILLING_LABEL[b] }))} />
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
          </Section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Section step={6} title="Ringkasan & simpan">
            <div className="space-y-1">
              <Row label="Kamar" value={room ? `${room.name} · ${property?.name ?? ''}` : '-'} />
              <Row label="Penyewa" value={newTenant ? newName || '-' : (tenant?.full_name ?? '-')} />
              <Row label="Periode pertama" value={periodPreview ? `${formatDate(periodPreview.start)} – ${formatDate(periodPreview.end)}` : '-'} />
              <Row label={`Sewa ${quantity} ${unit}`} value={formatRupiah(base)} />
              {addonsAmount > 0 && <Row label="Add-on" value={formatRupiah(addonsAmount)} />}
              <div className="border-t border-slate-200 pt-1">
                <Row label="Total tagihan pertama" value={formatRupiah(total)} strong />
              </div>
              <Row label="Deposit disepakati" value={formatRupiah(deposit)} />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
              Catat pembayaran tagihan pertama sekarang
            </label>
            {payNow && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <MoneyInput label="Jumlah dibayar" value={payAmount} onChange={setPayAmount} error={touched ? errors.pay : undefined} hint={payAmount < total && payAmount > 0 ? `DP; sisa ${formatRupiah(total - payAmount)} dibayar nanti.` : undefined} />
                <Select label="Metode" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
                <Input label="Tanggal bayar" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            )}
            <label className={clsx('flex items-start gap-2 text-sm', deposit > 0 ? 'text-slate-700' : 'text-slate-400')}>
              <input type="checkbox" className="mt-0.5" checked={depositNow && deposit > 0} disabled={deposit <= 0 && !depositNow} onChange={(e) => setDepositNow(e.target.checked)} />
              Catat deposit diterima sekarang
            </label>
            {depositNow && deposit > 0 && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <MoneyInput label="Jumlah deposit diterima" value={depositAmount} onChange={setDepositAmount} error={touched ? errors.deposit : undefined} />
                <Select label="Metode" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
              </div>
            )}
            {touched && hasErrors && <p className="text-xs text-red-600">Lengkapi data yang ditandai merah.</p>}
            <Button fullWidth size="lg" onClick={save} loading={saving}>
              Simpan sewa
            </Button>
          </Section>
        </div>
      </div>
    </>
  )
}
