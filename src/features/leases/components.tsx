import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import { Badge, MoneyInput, Input } from '../../components/ui'
import type { DepositBalance } from '../../domain/billing'
import { formatDate, formatRupiah } from '../../lib/format'
import { BILLING_STATE_META, type DepositSettlement, type DisplayBillingState, type TimelineSegment } from './leaseUtils'

export function BillingStateBadge({ state }: { state: DisplayBillingState }) {
  const meta = BILLING_STATE_META[state]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

// ---------- action menu ----------

export interface MenuItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** small explanation shown under the label */
  hint?: string
}

/** Minimal dropdown for row / page actions; closes on outside click and Escape. */
export function ActionMenu({ items, label = 'Aksi lainnya', trigger, align = 'right' }: { items: MenuItem[]; label?: string; trigger?: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={clsx(trigger ? '' : 'rounded-lg p-1.5 text-slate-500 hover:bg-slate-100')}
      >
        {trigger ?? <MoreHorizontal className="h-5 w-5" />}
      </button>
      {open && (
        <div
          role="menu"
          className={clsx('absolute z-40 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onClick()
              }}
              className={clsx(
                'flex w-full items-start gap-2 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
                item.danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {item.icon && <span className="mt-0.5 shrink-0 text-slate-400">{item.icon}</span>}
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.hint && <span className="block text-xs text-slate-500">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- timeline ----------

const SEGMENT_CLASS: Record<TimelineSegment['kind'], string> = {
  paid: 'bg-emerald-500',
  partial: 'bg-amber-400',
  unpaid: 'bg-red-500',
  gap: 'bg-[repeating-linear-gradient(135deg,#fecdd3_0_4px,#fff_4px_8px)] border border-rose-300',
  unbilled: 'bg-[repeating-linear-gradient(135deg,#e2e8f0_0_4px,#fff_4px_8px)] border border-slate-300',
}

const SEGMENT_LABEL: Record<TimelineSegment['kind'], string> = {
  paid: 'Lunas',
  partial: 'DP / Sebagian',
  unpaid: 'Belum bayar',
  gap: 'Tidak ditagih (celah)',
  unbilled: 'Belum ditagih',
}

/** Compact proportional bar of invoice periods with gaps, plus a legend. */
export function InvoiceTimeline({ segments, today }: { segments: TimelineSegment[]; today: string }) {
  if (segments.length === 0) return <p className="text-sm text-slate-500">Belum ada tagihan.</p>
  const total = segments.reduce((s, seg) => s + seg.days, 0)
  const first = segments[0].start
  const last = segments[segments.length - 1].end
  const gaps = segments.filter((s) => s.kind === 'gap')
  const overlaps = segments.filter((s) => s.overlap)
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-md" role="img" aria-label="Linimasa tagihan">
        {segments.map((seg, i) => (
          <div
            key={`${seg.start}-${i}`}
            title={`${SEGMENT_LABEL[seg.kind]}: ${formatDate(seg.start)} – ${formatDate(seg.end)} (${seg.days} hari)${seg.invoice ? ` · ${seg.invoice.invoice_number}` : ''}`}
            className={clsx('h-full border-r border-white last:border-r-0', SEGMENT_CLASS[seg.kind], seg.overlap && 'ring-2 ring-inset ring-rose-600')}
            style={{ width: `${Math.max(2, (seg.days / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{formatDate(first)}</span>
        {today >= first && today <= last && <span className="font-medium text-brand-700">hari ini {formatDate(today)}</span>}
        <span>{formatDate(last)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {(['paid', 'partial', 'unpaid', 'gap', 'unbilled'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={clsx('inline-block h-2.5 w-2.5 rounded-sm', SEGMENT_CLASS[k])} />
            {SEGMENT_LABEL[k]}
          </span>
        ))}
      </div>
      {gaps.length > 0 && (
        <p className="mt-2 text-xs text-rose-700">
          Ada {gaps.length} celah periode yang belum ditagih:{' '}
          {gaps.map((g) => `${formatDate(g.start)} – ${formatDate(g.end)}`).join(', ')}.
        </p>
      )}
      {overlaps.length > 0 && <p className="mt-1 text-xs text-rose-700">Ada tagihan dengan periode yang tumpang tindih.</p>}
    </div>
  )
}

// ---------- deposit settlement form ----------

export function DepositSettlementForm({
  balance,
  value,
  onChange,
  rentCapacity,
  error,
}: {
  balance: DepositBalance
  value: DepositSettlement
  onChange: (next: DepositSettlement) => void
  /** total outstanding of open invoices the deposit may be applied to (0 disables that option) */
  rentCapacity: number
  error: string | null
}) {
  const sum = value.refund + value.rent + value.damage
  const remaining = balance.held - sum
  const set = (patch: Partial<DepositSettlement>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">Jaminan dipegang</span>
        <span className="font-semibold tabular-nums text-slate-900">{formatRupiah(balance.held)}</span>
      </div>
      <p className="text-xs text-slate-500">
        Diterima {formatRupiah(balance.received)} · Dipotong {formatRupiah(balance.applied)} · Dikembalikan {formatRupiah(balance.returned)}
      </p>
      {balance.held <= 0 ? (
        <p className="text-sm text-slate-600">Tidak ada jaminan yang perlu diselesaikan.</p>
      ) : (
        <>
          <MoneyInput label="Kembalikan ke penyewa" value={value.refund} onChange={(v) => set({ refund: v })} hint="Dicatat sebagai pengeluaran 'Pengembalian Uang Jaminan'." />
          <MoneyInput
            label="Potong untuk sewa"
            value={value.rent}
            onChange={(v) => set({ rent: v })}
            disabled={rentCapacity <= 0}
            hint={rentCapacity > 0 ? `Sisa tagihan yang bisa dipotong: ${formatRupiah(rentCapacity)}.` : 'Tidak ada tagihan terbuka.'}
          />
          <MoneyInput label="Potong untuk kerusakan / lainnya" value={value.damage} onChange={(v) => set({ damage: v })} hint="Dicatat sebagai pemasukan lain (potong jaminan)." />
          {value.damage > 0 && (
            <Input label="Keterangan potongan" value={value.damageNotes} onChange={(e) => set({ damageNotes: e.target.value })} placeholder="mis. ganti kunci, cat tembok" required />
          )}
          <div className={clsx('flex items-center justify-between text-sm', remaining === 0 ? 'text-emerald-700' : 'text-amber-700')}>
            <span>{remaining === 0 ? 'Jumlah sudah pas' : remaining > 0 ? 'Belum dialokasikan' : 'Melebihi jaminan'}</span>
            <span className="tabular-nums font-medium">{formatRupiah(Math.abs(remaining))}</span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}

/** Label/value row used in summary lists. */
export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={clsx('tabular-nums text-right', strong ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</span>
    </div>
  )
}
