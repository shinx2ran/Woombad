import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { clsx } from 'clsx'
import { AlertTriangle, CalendarClock, FilePlus2, MessageCircle, MoreHorizontal, User, Wallet } from 'lucide-react'
import { Badge, LeaseStatusBadge, MoneyInput, Input } from '../../components/ui'
import type { DepositBalance } from '../../domain/billing'
import type { PeriodType } from '../../types/db'
import { PERIOD_TYPES, PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL } from '../../types/db'
import { checkoutISO, formatCheckout, formatDate, formatRupiah, formatStay } from '../../lib/format'
import {
  BILLING_STATE_META,
  leaseEndDisplay,
  priceDelta,
  priceDeltaText,
  remainingDays,
  type DepositSettlement,
  type DisplayBillingState,
  type DueLabel,
  type DueTone,
  type LeaseListItem,
  type TimelineSegment,
} from './leaseUtils'

// ---------- negotiated price (SPEC 5.4) ----------

/**
 * Money input for an agreed price with the room's standard rate as a hint ('Harga standar Rp X / bulan') and,
 * when the price differs, the difference inline ('Diskon Rp Y' / 'Lebih Rp Y').
 */
export function PriceField({
  label,
  value,
  onChange,
  standard,
  unit,
  error,
  required,
  extraHint,
  missingText,
}: {
  /** hint when there is no standard rate (default: the room has no rate for this type) */
  missingText?: string
  label: string
  value: number
  onChange: (v: number) => void
  /** room's standard rate for the selected type; null/undefined = not set */
  standard: number | null | undefined
  /** 'malam' | 'minggu' | 'bulan' */
  unit: string
  error?: string
  required?: boolean
  extraHint?: string
}) {
  const delta = priceDelta(value, standard)
  return (
    <div className="flex flex-col gap-1">
      <MoneyInput label={label} value={value} onChange={onChange} error={error} required={required} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500" data-testid="price-hint">
        <span>{standard == null ? (missingText ?? `Harga standar kamar per ${unit} belum diatur.`) : `Harga standar ${formatRupiah(standard)} / ${unit}`}</span>
        {delta.kind === 'discount' && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">{priceDeltaText(delta)}</span>}
        {delta.kind === 'more' && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">{priceDeltaText(delta)}</span>}
        {standard != null && (delta.kind === 'discount' || delta.kind === 'more') && (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onChange(standard)}>
            Pakai harga standar
          </button>
        )}
      </p>
      {extraHint && <p className="text-xs text-slate-500">{extraHint}</p>}
    </div>
  )
}

// ---------- period type picker ----------

/**
 * Harian / Mingguan / Bulanan. `variant='segmented'` is a compact segmented control (extension modal);
 * `variant='cards'` renders three large tap targets with the room's standard price per type (check-in wizard).
 */
export function PeriodTypePicker({
  value,
  onChange,
  prices,
  variant = 'segmented',
  label = 'Jenis periode',
}: {
  value: PeriodType
  onChange: (type: PeriodType) => void
  prices?: Record<PeriodType, number | null>
  variant?: 'segmented' | 'cards'
  label?: string
}) {
  if (variant === 'cards') {
    return (
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
        {PERIOD_TYPES.map((t) => {
          const selected = t === value
          const price = prices?.[t]
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(t)}
              className={clsx(
                'flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 py-3 text-center transition-colors',
                selected ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-slate-200 bg-white text-slate-800 hover:border-brand-300',
              )}
            >
              <span className="text-base font-semibold">{PERIOD_TYPE_LABEL[t]}</span>
              {prices && (
                <span className={clsx('text-xs tabular-nums', selected ? 'text-brand-800' : 'text-slate-500')}>
                  {price != null ? formatRupiah(price) : 'Tarif belum diatur'}
                </span>
              )}
              <span className="text-[11px] text-slate-400">per {PERIOD_UNIT_LABEL[t]}</span>
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {PERIOD_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === value}
            onClick={() => onChange(t)}
            className={clsx('min-h-11 rounded-md px-2 py-2 font-medium transition-colors sm:min-h-0 sm:py-1.5', t === value ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
          >
            {PERIOD_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- next due line (SPEC 5.1) ----------

const DUE_TONE_CLASS: Record<DueLabel['tone'], string> = {
  danger: 'bg-red-50 text-red-800',
  warning: 'bg-amber-50 text-amber-800',
  info: 'bg-sky-50 text-sky-800',
  neutral: 'bg-slate-50 text-slate-700',
}

export function DueLine({ due }: { due: DueLabel }) {
  const Icon = due.tone === 'danger' ? AlertTriangle : CalendarClock
  return (
    <p className={clsx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold', DUE_TONE_CLASS[due.tone])} data-testid="due-line">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{due.text}</span>
    </p>
  )
}

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

// ---------- dense lease list (SPEC 7.1) ----------

const REMAINING_TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-sky-700',
  neutral: 'text-slate-700',
}

/** Column names above the rows on lg and up; the widths mirror the cells of LeaseRow (the spacer = its menu cell). */
export function LeaseListHeader() {
  return (
    <div className="hidden items-center gap-3 border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 lg:flex">
      <span className="w-12 shrink-0 text-center">Kamar</span>
      <span className="min-w-0 flex-1">Penyewa</span>
      <span className="w-28 shrink-0 text-right">Dibayar s/d</span>
      <span className="w-32 shrink-0 text-right">Sisa tagihan</span>
      <span className="w-32 shrink-0 text-right">Sisa hari</span>
      <span className="w-9 shrink-0" aria-hidden />
    </div>
  )
}

/**
 * One lease per row, about 56px tall on a phone so eight or more fit on one screen: room chip, tenant name with
 * a one-line billing summary, the remaining days (or the lease status on the finished tab) and an action menu.
 * The whole row except the menu button links to the lease. On md and up the paid-through date and the
 * outstanding amount get their own columns (see LeaseListHeader); at md the sidebar leaves too little room for them.
 */
export function LeaseRow({
  item,
  today,
  showKos,
  onPay,
  onInvoice,
  onReminder,
  extraItems = [],
}: {
  item: LeaseListItem
  today: string
  /** second line ends with the kos name (global filter = Semua kos) */
  showKos: boolean
  onPay: () => void
  onInvoice: () => void
  /** opens the WhatsApp reminder; the item is offered only when the tenant has a phone number */
  onReminder: () => void
  /** extra menu items, placed after 'Tagihan berikutnya' */
  extraItems?: MenuItem[]
}) {
  const navigate = useNavigate()
  const { lease, summary, room, tenant, propertyName } = item
  const isActive = lease.status === 'active'
  const remaining = isActive ? remainingDays(lease, summary, today) : null
  const roomName = room?.name ?? '?'
  const owes = summary.outstanding > 0
  // finished tab: 'Checkout <checkout_date>' / 'Berakhir <check-out day of end_date>' (SPEC 7.3)
  const end = leaseEndDisplay(lease)

  const items: MenuItem[] = []
  if (isActive) {
    items.push({ label: 'Bayar', icon: <Wallet className="h-4 w-4" />, disabled: !owes, onClick: onPay })
    items.push({ label: 'Tagihan berikutnya', icon: <FilePlus2 className="h-4 w-4" />, onClick: onInvoice })
    items.push(...extraItems)
    if (tenant?.phone) items.push({ label: 'Pengingat WhatsApp', icon: <MessageCircle className="h-4 w-4" />, onClick: onReminder })
  }
  if (tenant) items.push({ label: 'Profil penyewa', icon: <User className="h-4 w-4" />, onClick: () => navigate(`/penyewa/${tenant.id}`) })

  return (
    <li data-testid="lease-row" data-room={room?.name} data-tenant={tenant?.full_name} data-days={remaining?.days} className="group flex items-stretch">
      <Link
        to={`/sewa/${lease.id}`}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-3 py-2 hover:bg-slate-50 lg:gap-3 group-first:rounded-tl-xl group-last:rounded-bl-xl lg:group-first:rounded-tl-none"
      >
        <span className="flex h-10 min-w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-1.5 text-sm font-semibold tabular-nums text-slate-800">{roomName}</span>
        <span className="min-w-0 flex-1">
          <span data-testid="lease-tenant" className="block truncate text-sm font-semibold text-slate-900">{tenant?.full_name ?? 'Penyewa tidak ditemukan'}</span>
          {/* the amount never shrinks; on a phone only the tail (period type, kos name) is cut short */}
          <span className="flex min-w-0 overflow-hidden text-xs text-slate-500">
            <span data-testid="lease-amount" className={clsx('shrink-0 whitespace-nowrap', owes && 'font-medium text-red-700')}>
              {owes ? `sisa ${formatRupiah(summary.outstanding)}` : summary.paidThrough ? `lunas s/d ${formatCheckout(summary.paidThrough, 'd MMM')}` : 'belum ditagih'}
            </span>
            <span className="min-w-0 truncate">
              {`\u00a0· ${PERIOD_TYPE_LABEL[lease.period_type]}`}
              {showKos && ` · ${propertyName}`}
            </span>
          </span>
        </span>
        <span className="hidden w-28 shrink-0 text-right text-sm tabular-nums text-slate-700 lg:block">{summary.paidThrough ? formatCheckout(summary.paidThrough) : '-'}</span>
        <span className={clsx('hidden w-32 shrink-0 text-right text-sm tabular-nums lg:block', owes ? 'font-medium text-red-700' : 'text-slate-700')}>{formatRupiah(summary.outstanding)}</span>
        <span className="shrink-0 text-right lg:w-32">
          {isActive ? (
            remaining && (
              <>
                <span className={clsx('block text-sm font-bold tabular-nums', REMAINING_TONE_CLASS[remaining.tone])}>{remaining.value}</span>
                <span className="block max-w-24 truncate text-[11px] text-slate-500 lg:max-w-none">{remaining.caption}</span>
              </>
            )
          ) : (
            <>
              <LeaseStatusBadge status={lease.status} />
              <span className="block max-w-32 truncate text-[11px] text-slate-500 lg:max-w-none">
                {`${end.label} ${end.date}`}
              </span>
            </>
          )}
        </span>
      </Link>
      <span className="flex shrink-0 items-center pr-1">
        {/* a 44px target: a mis-tap must open the menu, not the row link next to it */}
        <ActionMenu
          items={items}
          label={`Aksi sewa ${roomName}`}
          trigger={
            <span className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <MoreHorizontal className="h-5 w-5" />
            </span>
          }
        />
      </span>
    </li>
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

/**
 * Compact proportional bar of invoice periods with gaps, plus a legend. Segment ends are last nights; ranges and the
 * right-hand date are shown as check-out days (formatStay / formatCheckout, SPEC 7.3).
 */
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
            title={`${SEGMENT_LABEL[seg.kind]}: ${formatStay(seg.start, seg.end)} (${seg.days} hari)${seg.invoice ? ` · ${seg.invoice.invoice_number}` : ''}`}
            className={clsx('h-full border-r border-white last:border-r-0', SEGMENT_CLASS[seg.kind], seg.overlap && 'ring-2 ring-inset ring-rose-600')}
            style={{ width: `${Math.max(2, (seg.days / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{formatDate(first)}</span>
        {today >= first && today <= checkoutISO(last) && <span className="font-medium text-brand-700">hari ini {formatDate(today)}</span>}
        <span>{formatCheckout(last)}</span>
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
          {gaps.map((g) => formatStay(g.start, g.end)).join(', ')}.
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
