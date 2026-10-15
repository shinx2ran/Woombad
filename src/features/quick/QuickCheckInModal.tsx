import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { Button, CountInput, Input, LoadingState, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { formatCheckout, formatRupiah, formatStay, todayISO } from '../../lib/format'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod, type Room } from '../../types/db'
import { useLeaseActions } from '../leases/useLeaseActions'
import { useLeaseData } from '../leases/useLeaseData'
import {
  perNightText,
  planQuickCheckIn,
  QuickCheckInError,
  saveQuickCheckIn,
  tenantsNamed,
  validateQuickCheckIn,
  type QuickCheckInInput,
} from './quickCheckIn'

const CASH_METHODS = PAYMENT_METHODS.filter((m) => m !== 'deposit').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))
const NEW_TENANT = 'baru'

/**
 * Check-in cepat for an empty room (SPEC 7.4): name, nights and the total paid; the rest follows from the room
 * (daily rate, today, paid in full). Weekly / monthly stays, deposits and add-ons use the full Sewa baru form.
 */
export function QuickCheckInModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { repo } = useOrg()
  const data = useLeaseData()
  const actions = useLeaseActions()
  const invalidate = useInvalidate()
  const toast = useToast()
  const navigate = useNavigate()
  const today = todayISO()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  /** '' = automatic (the one same-name tenant, if any), NEW_TENANT, or a tenant id */
  const [tenantChoice, setTenantChoice] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [nights, setNights] = useState(1)
  /** an agreed total typed by the user; until then the total follows the room's daily rate x nights */
  const [typedTotal, setTypedTotal] = useState<number | null>(null)
  const [paid, setPaid] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const total = typedTotal ?? (room.price_daily ?? 0) * nights
  const sameName = useMemo(() => tenantsNamed(data.tenants, name), [data.tenants, name])
  const tenantId = tenantChoice === NEW_TENANT ? null : tenantChoice || (sameName.length === 1 ? sameName[0].id : null)
  const existing = tenantId ? data.tenantById.get(tenantId) ?? null : null

  const input: QuickCheckInInput = { room, startDate, nights, total, paid, method, tenantId: existing?.id ?? null, name, phone }
  const errors = validateQuickCheckIn(input, data.leases)
  const plan = planQuickCheckIn(startDate, nights, total)
  const hasErrors = Object.keys(errors).length > 0

  const submit = async () => {
    setTouched(true)
    if (hasErrors || !plan) return
    setSaving(true)
    try {
      const { lease, invoice } = await saveQuickCheckIn(input, {
        repo,
        insertFromDraft: actions.insertFromDraft,
        canWriteInvoiceStatus: actions.canWriteInvoiceStatus,
        orgInvoices: data.invoices,
        todayISO: today,
      })
      await invalidate('leases', 'invoices', 'payments', 'tenants')
      const noPhone = !existing && !phone.trim() ? ' HP penyewa belum diisi: lengkapi di halaman penyewa.' : ''
      toast.success(`Check-in kamar ${room.name} tersimpan. Tagihan ${invoice.invoice_number}${paid ? ' lunas' : ' belum dibayar'}.${noPhone}`)
      onClose()
      navigate(`/sewa/${lease.id}`)
    } catch (err) {
      await invalidate('leases', 'invoices', 'payments', 'tenants')
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan check-in.'
      const friendly = /violates foreign key constraint/i.test(msg) ? 'Data yang dirujuk tidak ditemukan. Muat ulang lalu coba lagi.' : msg
      if (err instanceof QuickCheckInError && err.lease) {
        toast.error(`Sewa tersimpan, tetapi langkah berikutnya gagal: ${friendly} Periksa tagihan & pembayaran di halaman sewa.`)
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
          <Input label="Nama penyewa" value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="off" error={touched ? errors.name : undefined} />
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
              hint="Boleh dikosongkan; lengkapi nanti di halaman penyewa."
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <CountInput label="Jumlah malam" value={nights} onChange={setNights} required error={touched ? errors.nights : undefined} />
            <Input label="Tanggal check-in" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required error={touched ? errors.startDate : undefined} />
          </div>
          <MoneyInput
            label="Total bayar"
            value={total}
            onChange={setTypedTotal}
            required
            error={touched ? errors.total : undefined}
            hint={plan ? perNightText(plan, total) : room.price_daily ? `Tarif kamar ${formatRupiah(room.price_daily)} / malam` : 'Kamar ini belum punya tarif harian.'}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Sudah dibayar lunas
          </label>
          {paid && <Select label="Metode" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={CASH_METHODS} />}
          {plan && (
            <div className="space-y-0.5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="quick-checkin-summary">
              <p>
                <span className="text-slate-500">Menginap</span> {formatStay(startDate, plan.end)} · {nights} malam
              </p>
              <p>
                <span className="text-slate-500">Check-out</span> <strong>{formatCheckout(plan.end)}</strong>
              </p>
              <p>
                <span className="text-slate-500">Bayar</span> {paid ? `Lunas ${formatRupiah(total)} · ${PAYMENT_METHOD_LABEL[method]}` : `Belum bayar (${formatRupiah(total)})`}
              </p>
              {existing && <p className="text-slate-500">Penyewa lama: {existing.full_name}{existing.phone ? ` · ${existing.phone}` : ' · tanpa HP'}</p>}
            </div>
          )}
          <p className="text-xs text-slate-500">Mingguan, bulanan, deposit atau add-on: pakai Form lengkap.</p>
        </div>
      )}
    </Modal>
  )
}
