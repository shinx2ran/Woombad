import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import { Button, Input, InvoiceStatusBadge, Modal, Textarea, useToast } from '../../components/ui'
import type { Invoice, Lease, Payment, Tenant } from '../../types/db'
import { invoiceUnitLabel, nextPeriodBounds, paidAmountFor } from '../../domain/billing'
import { formatCheckout, formatDate, formatRupiah, formatStay, todayISO } from '../../lib/format'
import { applyRedatePlan, nightsOf, planLeaseRedate, redateNoteLine, redateStatePreview, type InvoiceRedate } from './redate'
import type { LeaseActions } from './useLeaseActions'

export interface RedateLeaseModalProps {
  onClose: () => void
  lease: Lease
  /** the lease's invoices */
  invoices: Invoice[]
  payments: Payment[]
  /** every lease of the org: the room double-booking check */
  leases: Lease[]
  tenants: Pick<Tenant, 'id' | 'full_name'>[]
  actions: LeaseActions
}

/** 'old → new' on one line that may wrap between the two halves on a narrow phone. */
function Change({ from, to, changed = true }: { from: string; to: string; changed?: boolean }) {
  if (!changed) return <span className="tabular-nums">{to}</span>
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1 tabular-nums">
      <span className="text-slate-500 line-through decoration-slate-300">{from}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="menjadi" />
      <span className="font-semibold text-slate-900">{to}</span>
    </span>
  )
}

function PreviewRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-slate-600">{label}</span>
      <Change from={from} to={to} changed={from !== to} />
    </div>
  )
}

function InvoiceChange({ row, lease, paid }: { row: InvoiceRedate; lease: Lease; paid: number }) {
  const inv = row.invoice
  const isVoid = inv.status === 'void'
  const nightsBefore = nightsOf(row.before.period_start, row.before.period_end)
  const nightsAfter = nightsOf(row.after.period_start, row.after.period_end)
  return (
    <li className={clsx('space-y-0.5 px-3 py-2.5', isVoid && 'bg-slate-50 opacity-60')} data-testid="redate-invoice" data-void={isVoid || undefined}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-slate-900">{inv.invoice_number}</span>
        <InvoiceStatusBadge status={inv.status} />
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm" data-testid="redate-period">
        <span className="whitespace-nowrap text-slate-500 line-through decoration-slate-300">{formatStay(row.before.period_start, row.before.period_end)}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="menjadi" />
        <span className={clsx('whitespace-nowrap font-semibold', isVoid ? 'text-slate-600' : 'text-slate-900')}>{formatStay(row.after.period_start, row.after.period_end)}</span>
      </p>
      <p className="text-xs text-slate-500">
        {inv.quantity} {invoiceUnitLabel(inv, lease)} · {nightsBefore === nightsAfter ? `${nightsAfter} malam` : `${nightsBefore} → ${nightsAfter} malam`} · jatuh tempo{' '}
        {row.before.due_date === row.after.due_date ? formatDate(row.after.due_date, 'd MMM') : `${formatDate(row.before.due_date, 'd MMM')} → ${formatDate(row.after.due_date, 'd MMM')}`}
      </p>
      <p className="text-xs text-slate-500">
        {formatRupiah(inv.total_amount)}
        {!isVoid && ` · dibayar ${formatRupiah(paid)}`} · tidak berubah
      </p>
    </li>
  )
}

/**
 * SPEC 7.6 'Ubah tanggal mulai': the right start date, a live preview of every invoice (old → new period, due date,
 * nights), the new end and what the tenant's position becomes today, then one atomic save. Mount it only while open:
 * its state starts from the lease each time.
 */
export function RedateLeaseModal({ onClose, lease, invoices, payments, leases, tenants, actions }: RedateLeaseModalProps) {
  const toast = useToast()
  const [newStart, setNewStart] = useState(lease.start_date)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const today = todayISO()

  const plan = useMemo(() => planLeaseRedate(lease, invoices, newStart, { leases, tenants }), [lease, invoices, newStart, leases, tenants])
  const unchanged = newStart === lease.start_date
  // only a plan that was computed gets a preview (a collision still is; an empty, invalid or same date is not)
  const hasPreview = !unchanged && plan.lease.start_date === newStart
  const preview = useMemo(() => {
    if (!hasPreview) return null
    const state = redateStatePreview(lease, invoices, payments, plan, today)
    const after = applyRedatePlan(lease, invoices, plan)
    let next: { period_start: string; period_end: string } | null = null
    try {
      next = nextPeriodBounds(after.lease, after.invoices, 1)
    } catch {
      next = null
    }
    return { state, next }
  }, [hasPreview, lease, invoices, payments, plan, today])

  const dateError = unchanged ? null : !hasPreview ? plan.error : null
  const canSave = hasPreview && !plan.error && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const done = await actions.redateLease({ lease, invoices, newStart, reason, tenants })
      const n = done.patches.length
      toast.success(`Tanggal mulai diubah ke ${formatDate(done.lease.start_date)}${n > 0 ? `; ${n} tagihan ikut digeser` : ''}.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah tanggal mulai.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ubah tanggal mulai sewa"
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Batal
          </Button>
          <Button className="h-11" onClick={submit} loading={saving} disabled={!canSave}>
            Simpan perubahan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Untuk tanggal mulai yang salah input. Semua periode tagihan, jatuh tempo dan check-out ikut digeser ke tanggal yang benar; jumlah tagihan, nomor tagihan
          dan pembayaran tidak berubah.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">Tanggal mulai sekarang</span>
          <span className="font-semibold tabular-nums text-slate-900" data-testid="redate-current">
            {formatDate(lease.start_date)}
          </span>
        </div>
        <Input
          label="Tanggal mulai yang benar"
          type="date"
          className="h-11"
          value={newStart}
          onChange={(e) => setNewStart(e.target.value)}
          required
          error={dateError ?? undefined}
          hint={unchanged ? 'Pilih tanggal penyewa benar-benar mulai menempati kamar.' : undefined}
        />

        {hasPreview && preview && (
          <section className="space-y-3" aria-label="Pratinjau perubahan" data-testid="redate-preview">
            {plan.error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {plan.error}
              </p>
            )}
            {plan.warnings.map((w) => (
              <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="redate-warning">
                {w}
              </p>
            ))}
            <div className="space-y-1.5 rounded-lg bg-slate-50 p-3" data-testid="redate-summary">
              <PreviewRow label="Mulai" from={formatDate(plan.oldStart)} to={formatDate(plan.lease.start_date)} />
              <PreviewRow label="Check-out" from={formatCheckout(lease.end_date)} to={formatCheckout(plan.lease.end_date)} />
              <PreviewRow
                label="Dibayar s/d"
                from={preview.state.before.paidThrough ? formatCheckout(preview.state.before.paidThrough) : '-'}
                to={preview.state.after.paidThrough ? formatCheckout(preview.state.after.paidThrough) : '-'}
              />
              {preview.next && (
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="shrink-0 text-slate-600">Tagihan berikutnya</span>
                  <span className="text-right tabular-nums text-slate-900" data-testid="redate-next">
                    {formatStay(preview.next.period_start, preview.next.period_end)}
                  </span>
                </div>
              )}
              <div className="space-y-0.5 border-t border-slate-200 pt-1.5 text-sm">
                <p className="text-slate-600" data-testid="redate-state-before">
                  Sekarang: {preview.state.beforeText}
                </p>
                <p
                  className={clsx('font-semibold', preview.state.after.state === 'overdue' ? 'text-red-700' : 'text-slate-900')}
                  data-testid="redate-state-after"
                >
                  Setelah diubah: {preview.state.afterText}
                </p>
              </div>
            </div>
            {plan.invoices.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Tagihan ({plan.invoices.length})</p>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200" data-testid="redate-invoices">
                  {plan.invoices.map((row) => (
                    <InvoiceChange key={row.invoice.id} row={row} lease={lease} paid={paidAmountFor(row.invoice.id, payments)} />
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Belum ada tagihan; hanya tanggal sewa yang berubah.</p>
            )}
          </section>
        )}

        <Textarea label="Alasan (opsional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah ketik bulan" />
        {hasPreview && (
          <p className="text-xs text-slate-500" data-testid="redate-note">
            Dicatat di catatan sewa: “{redateNoteLine(lease.start_date, newStart, today, reason)}”
          </p>
        )}
      </div>
    </Modal>
  )
}
