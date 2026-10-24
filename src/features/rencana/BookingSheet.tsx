import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { clsx } from 'clsx'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, Input, MoneyInput, Modal, Select, Textarea, useToast } from '../../components/ui'
import { formatCheckout, formatDate, formatRupiah, formatStay, todayISO } from '../../lib/format'
import type { Invoice, PaymentMethod, Property, Room, Tenant, WaitlistEntry } from '../../types/db'
import { PAYMENT_METHOD_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { EMPTY_TENANT_FORM, validateTenantForm } from '../tenants/tenantUtils'
import { perPeriodText, planStayBooking, QuickCheckInError, resolveTenantChoice, tenantsNamed } from '../quick/quickCheckIn'
import { rateText, type PlannedStay } from './availability'
import { useRencanaActions } from './useRencanaActions'

const NEW_TENANT = 'baru'
const DP_METHODS: PaymentMethod[] = ['cash', 'transfer', 'qris']

export interface BookingSheetProps {
  room: Room
  property: Property | undefined
  stay: PlannedStay
  /** the room's price per night / week / month for the stay's type; null = not set */
  rate: number | null
  /** for a daftar tunggu entry: prefilled name / phone / note, and the entry becomes 'booked' */
  entry: WaitlistEntry | null
  tenants: Tenant[]
  tenantById: Map<string, Tenant>
  orgInvoices: Invoice[]
  onClose: () => void
}

/**
 * "Pesan" on a free room (SPEC 7.7): who (with the same existing-tenant matching as Check-in cepat), the total (from the
 * room's rate, editable), an optional DP and a note. Saved through the Check-in cepat path (useRencanaActions.bookStay),
 * after a fresh check of the room. A check-in for today is a Check-in cepat; a later day books the room ("Dipesan").
 */
export function BookingSheet({ room, property, stay, rate, entry, tenants, tenantById, orgInvoices, onClose }: BookingSheetProps) {
  const actions = useRencanaActions()
  const toast = useToast()
  const navigate = useNavigate()
  const today = todayISO()
  const isToday = stay.start === today
  const unit = PERIOD_UNIT_LABEL[stay.periodType]

  const [name, setName] = useState(entry?.name ?? '')
  const [phone, setPhone] = useState(entry?.phone ?? '')
  /** '' = automatic (the one same-name tenant, if any), NEW_TENANT, or a tenant id */
  const [tenantChoice, setTenantChoice] = useState('')
  const [typedTotal, setTypedTotal] = useState<number | null>(null)
  const [dp, setDp] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const total = typedTotal ?? (rate ?? 0) * stay.quantity
  const sameName = useMemo(() => tenantsNamed(tenants, name), [tenants, name])
  const tenantId = resolveTenantChoice(sameName, tenantChoice, NEW_TENANT)
  const existing = tenantId ? tenantById.get(tenantId) ?? null : null
  const plan = planStayBooking(stay.start, stay.periodType, stay.quantity, total)

  const errors: Partial<Record<'name' | 'phone' | 'total' | 'dp', string>> = {}
  if (!existing) {
    const tenantErrors = validateTenantForm({ ...EMPTY_TENANT_FORM, full_name: name, phone, property_id: room.property_id })
    if (tenantErrors.full_name) errors.name = tenantErrors.full_name
    if (tenantErrors.phone) errors.phone = tenantErrors.phone
  }
  if (total <= 0) errors.total = 'Isi total harga.'
  if (dp < 0) errors.dp = 'Tidak boleh negatif.'
  else if (dp > total) errors.dp = `DP tidak boleh lebih dari total (${formatRupiah(total)}).`
  const hasErrors = Object.keys(errors).length > 0

  const submit = async () => {
    setTouched(true)
    setRefusal(null)
    if (hasErrors || !plan) return
    setSaving(true)
    try {
      const { lease, invoice, waitlistError } = await actions.bookStay({
        room,
        periodType: stay.periodType,
        startDate: stay.start,
        quantity: stay.quantity,
        total,
        paidAmount: dp,
        method,
        tenantId: existing?.id ?? null,
        name,
        phone,
        notes: notes.trim() || null,
        orgInvoices,
        waitlistId: entry?.id ?? null,
        today,
      })
      const noPhone = !existing && !phone.trim() ? ' HP penyewa belum diisi: lengkapi di halaman penyewa.' : ''
      const paid = dp <= 0 ? ' belum dibayar' : dp >= invoice.total_amount ? ' lunas' : ` DP ${formatRupiah(dp)}`
      toast.success(
        isToday
          ? `Check-in kamar ${room.name} tersimpan. Tagihan ${invoice.invoice_number}${paid}.${noPhone}`
          : `Kamar ${room.name} dipesan ${formatStay(stay.start, stay.end)}. Tagihan ${invoice.invoice_number}${paid}.${noPhone}`,
      )
      if (waitlistError) toast.error(`Pesanan tersimpan, tetapi daftar tunggu belum ditandai: ${waitlistError}`)
      onClose()
      navigate(`/sewa/${lease.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pesanan.'
      const friendly = /violates foreign key constraint/i.test(msg) ? 'Data yang dirujuk tidak ditemukan. Muat ulang lalu coba lagi.' : msg
      if (err instanceof QuickCheckInError && err.lease) {
        toast.error(`Sewa tersimpan, tetapi langkah berikutnya gagal: ${friendly} Periksa tagihan & pembayaran di halaman sewa.`)
        onClose()
        navigate(`/sewa/${err.lease.id}`)
        return
      }
      if (err instanceof QuickCheckInError && err.createdTenant) {
        // the tenant exists now: a retry uses it instead of creating a duplicate
        setTenantChoice(err.createdTenant.id)
      }
      setRefusal(friendly)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${isToday ? 'Check-in' : 'Pesan'} · Kamar ${room.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" onClick={submit} loading={saving}>
            {isToday ? 'Simpan check-in' : 'Simpan pesanan'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="booking-sheet">
        <div className="space-y-0.5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="booking-summary">
          <p className="font-medium text-slate-900">
            Kamar {room.name}
            {property ? ` · ${property.name}` : ''}
          </p>
          <p>
            <span className="text-slate-500">Menginap</span> {formatStay(stay.start, stay.end)} · {stay.quantity} {unit}
            {stay.periodType !== 'daily' ? ` (${stay.nights} malam)` : ''}
          </p>
          <p>
            <span className="text-slate-500">Check-out</span> <strong>{formatCheckout(stay.end)}</strong>
          </p>
          <p className="text-slate-500">{rateText(rate, stay.periodType)}</p>
          {!isToday && <p className="text-slate-500">Sampai {formatDate(stay.start)} kamar ini tampil &ldquo;Dipesan&rdquo;.</p>}
        </div>

        {refusal && (
          <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {refusal}
          </p>
        )}

        <Input label="Nama penyewa" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" error={touched ? errors.name : undefined} />
        {sameName.length > 0 && (
          <Select
            label="Nama ini sudah ada"
            value={tenantId ?? NEW_TENANT}
            onChange={(e) => setTenantChoice(e.target.value)}
            options={[
              ...sameName.map((t) => ({ value: t.id, label: `Penyewa lama · ${t.phone ?? 'tanpa HP'}` })),
              { value: NEW_TENANT, label: 'Orang lain (penyewa baru)' },
            ]}
            hint="Pilih penyewa lama supaya datanya tidak dobel."
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
            hint={phone.trim() ? undefined : 'HP belum diisi: boleh nanti, lengkapi di halaman penyewa.'}
          />
        )}
        {existing && (
          <p className="text-sm text-slate-600">
            Penyewa lama: {existing.full_name}
            {existing.phone ? ` · ${existing.phone}` : ' · HP belum diisi'}
          </p>
        )}

        <MoneyInput
          label={`Total ${stay.quantity} ${unit}`}
          value={total}
          onChange={setTypedTotal}
          required
          error={touched ? errors.total : undefined}
          hint={plan ? perPeriodText(plan, total, stay.periodType) : rate === null ? 'Harga kamar belum diatur: ketik total yang disepakati.' : undefined}
        />
        <MoneyInput label="DP / sudah dibayar (opsional)" value={dp} onChange={setDp} error={touched ? errors.dp : undefined} hint="Kosongkan bila belum bayar; isi sama dengan total bila lunas." />
        {dp > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Dibayar dengan</span>
            <div role="radiogroup" aria-label="Metode pembayaran" className="grid grid-cols-3 gap-2">
              {DP_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={clsx(
                    'h-11 rounded-lg border text-sm font-medium',
                    method === m ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        )}
        <Textarea label="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Tamu tidak jadi datang? Pemilik/admin membuka sewanya, lalu <strong>Lainnya → Batalkan sewa</strong> dengan tanggal hari itu: tagihan dibatalkan,
            sewa tercatat &ldquo;belum menginap&rdquo;, dan kamar kosong lagi.
          </span>
        </p>
      </div>
    </Modal>
  )
}
