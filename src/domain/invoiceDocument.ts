/**
 * Digital invoice (tagihan) document: everything the invoice image and its WhatsApp caption need, derived
 * from the stored rows. Pure (no React, no I/O): the UI draws the document on a canvas, shares the PNG
 * via WhatsApp and uses invoiceShareText as the caption.
 *
 * Amounts come from the invoice row as stored (total_amount is never recomputed); only the line labels are
 * reconstructed: add-ons from the lease's add-ons when they explain addons_amount, extras from the
 * 'Listrik: …; Denda: …' notes convention (see billing.parseExtraBreakdown), and a single summary line
 * otherwise. Status is derived from the rent payments (SPEC 2), not from the stored status column.
 */
import type { Invoice, InvoiceStatus, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../types/db'
import { PAYMENT_METHOD_LABEL, PERIOD_TYPE_LABEL } from '../types/db'
import { formatDate, formatRupiah, parseDate, toDateISO } from '../lib/format'
import {
  computeAddonsAmount,
  formatExtraBreakdown,
  invoicePeriodType,
  invoiceUnitLabel,
  paidAmountFor,
  parseExtraBreakdown,
} from './billing'

export interface InvoiceDocumentLine {
  /** e.g. 'Sewa kamar A1', 'Kasur tambahan', 'Listrik / token', 'Denda', 'Lainnya', 'Add-on', 'Tambahan' */
  label: string
  /** secondary text under the label, e.g. 'Bulanan · 1 bulan · 1 Okt – 31 Okt 2026' or '2 × Rp 1.500.000' */
  detail?: string
  amount: number
}

export interface InvoiceDocument {
  title: 'TAGIHAN'
  number: string
  /** 'YYYY-MM-DD', the invoice's created_at in local time */
  issuedDate: string
  dueDate: string
  status: InvoiceStatus
  /** derived from payments, not the stored status: 'LUNAS' | 'DP / SEBAGIAN' | 'BELUM BAYAR' | 'DIBATALKAN' */
  statusLabel: string
  property: { name: string; address: string | null; paymentInfo: string | null; logoPath: string | null }
  tenant: { name: string; phone: string | null }
  room: string
  period: { start: string; end: string; quantity: number; unit: string; typeLabel: string }
  lines: InvoiceDocumentLine[]
  discount: number
  total: number
  /** rent payments recorded against this invoice */
  paid: number
  /** max(0, total - paid) */
  remaining: number
  /** rent payments of this invoice, oldest first */
  payments: { date: string; amount: number; methodLabel: string }[]
  /** free-text part of invoice.notes (without the 'Listrik: …; Denda: …' breakdown line), or null */
  notes: string | null
}

export interface InvoiceDocumentInput {
  invoice: Invoice
  lease: Lease
  tenant?: Tenant | null
  room?: Room | null
  property?: Property | null
  /** all payments (superset is fine) */
  payments: Payment[]
  /** add-ons of the lease (used to name the add-on lines) */
  leaseAddons: LeaseAddon[]
}

/** Shown when the tenant / room / kos row is missing (deleted or not loaded yet). */
export const FALLBACK_TENANT_NAME = 'Penyewa'
export const FALLBACK_ROOM_NAME = '-'
export const FALLBACK_PROPERTY_NAME = 'Kos'

export const STATUS_LABEL_PAID = 'LUNAS'
export const STATUS_LABEL_PARTIAL = 'DP / SEBAGIAN'
export const STATUS_LABEL_UNPAID = 'BELUM BAYAR'
export const STATUS_LABEL_VOID = 'DIBATALKAN'

// ---------- lines ----------

function rentLine(invoice: Invoice, lease: Lease, room: string): InvoiceDocumentLine {
  const typeLabel = PERIOD_TYPE_LABEL[invoicePeriodType(invoice, lease)]
  const unit = invoiceUnitLabel(invoice, lease)
  return {
    label: `Sewa kamar ${room}`,
    detail: `${typeLabel} · ${invoice.quantity} ${unit} · ${formatDate(invoice.period_start, 'd MMM')} – ${formatDate(invoice.period_end, 'd MMM yyyy')}`,
    amount: invoice.base_amount,
  }
}

/**
 * One line per add-on when the lease's add-ons explain addons_amount. Whether this was the lease's first
 * invoice (the only one that carries one_time add-ons) is not known from one invoice, so both combinations
 * are tried: per_period add-ons alone first, then per_period + one_time. When neither sums to addons_amount
 * (an owner override, or a SPEC 5.2 type-changed invoice whose add-ons were multiplied by lease periods)
 * a single 'Add-on' line carries the stored amount. Nothing when addons_amount is 0.
 */
function addonLines(invoice: Invoice, addons: LeaseAddon[]): InvoiceDocumentLine[] {
  if (invoice.addons_amount === 0) return []
  const perPeriod = addons.filter((a) => a.billing === 'per_period')
  const oneTime = addons.filter((a) => a.billing === 'one_time')
  let named: LeaseAddon[] | null = null
  if (computeAddonsAmount(addons, invoice.quantity, false) === invoice.addons_amount) named = perPeriod
  else if (computeAddonsAmount(addons, invoice.quantity, true) === invoice.addons_amount) named = [...perPeriod, ...oneTime]
  if (named === null) return [{ label: 'Add-on', amount: invoice.addons_amount }]
  return named.map((a) =>
    a.billing === 'per_period'
      ? { label: a.name, detail: `${invoice.quantity} × ${formatRupiah(a.amount)}`, amount: a.amount * invoice.quantity }
      : { label: a.name, detail: 'Sekali bayar', amount: a.amount },
  )
}

const EXTRA_LINE_LABEL = { listrik: 'Listrik / token', denda: 'Denda', lainnya: 'Lainnya' } as const

/**
 * The extras (listrik / denda / lainnya) from the notes convention when they add up to extra_amount,
 * otherwise a single 'Tambahan' line with the stored amount. Nothing when extra_amount is 0.
 */
function extraLines(invoice: Invoice): InvoiceDocumentLine[] {
  if (!(invoice.extra_amount > 0)) return []
  const parts = parseExtraBreakdown(invoice.notes)
  const known = (parts.listrik ?? 0) + (parts.denda ?? 0) + (parts.lainnya ?? 0)
  if (known <= 0 || known !== invoice.extra_amount) return [{ label: 'Tambahan', amount: invoice.extra_amount }]
  const lines: InvoiceDocumentLine[] = []
  for (const key of ['listrik', 'denda', 'lainnya'] as const) {
    const amount = parts[key]
    if (amount !== undefined && amount > 0) lines.push({ label: EXTRA_LINE_LABEL[key], amount })
  }
  return lines
}

// ---------- notes & status ----------

/**
 * Free text of the invoice notes: the first line is dropped when it is exactly the extras breakdown
 * (formatExtraBreakdown(parseExtraBreakdown(notes)), same rule as the invoice form). null when empty.
 */
export function invoiceFreeText(notes: string | null): string | null {
  if (!notes) return null
  const canonical = formatExtraBreakdown(parseExtraBreakdown(notes))
  const lines = notes.split('\n')
  const rest = canonical && lines[0]?.trim() === canonical ? lines.slice(1) : lines
  const text = rest.join('\n').trim()
  return text ? text : null
}

/** void -> DIBATALKAN; nothing left -> LUNAS; something paid -> DP / SEBAGIAN; else BELUM BAYAR. */
export function invoiceStatusLabel(status: InvoiceStatus, paid: number, remaining: number): string {
  if (status === 'void') return STATUS_LABEL_VOID
  if (remaining <= 0) return STATUS_LABEL_PAID
  if (paid > 0) return STATUS_LABEL_PARTIAL
  return STATUS_LABEL_UNPAID
}

// ---------- document ----------

/**
 * Build the document for one invoice. lines[0] is always the rent line; add-on and extra lines follow (see
 * addonLines / extraLines). total is invoice.total_amount as stored; paid = paidAmountFor; remaining =
 * max(0, total - paid) even for a void invoice (statusLabel says DIBATALKAN; show that instead of the
 * amount). issuedDate is created_at in local time, or period_start when created_at is empty / invalid.
 * A missing tenant / room / kos falls back to 'Penyewa' / '-' / 'Kos'.
 */
export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocument {
  const { invoice, lease, tenant, room, property } = input
  const roomName = room?.name.trim() || FALLBACK_ROOM_NAME
  const paid = paidAmountFor(invoice.id, input.payments)
  const total = invoice.total_amount
  const remaining = Math.max(0, total - paid)
  const issued = parseDate(invoice.created_at)

  const payments = input.payments
    .filter((p) => p.kind === 'rent' && p.invoice_id === invoice.id)
    .sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.created_at.localeCompare(b.created_at))
    .map((p) => ({ date: p.paid_at, amount: p.amount, methodLabel: PAYMENT_METHOD_LABEL[p.method] }))

  return {
    title: 'TAGIHAN',
    number: invoice.invoice_number,
    issuedDate: issued ? toDateISO(issued) : invoice.period_start,
    dueDate: invoice.due_date,
    status: invoice.status,
    statusLabel: invoiceStatusLabel(invoice.status, paid, remaining),
    property: {
      name: property?.name.trim() || FALLBACK_PROPERTY_NAME,
      address: property?.address ?? null,
      paymentInfo: property?.payment_info?.trim() || null,
      logoPath: property?.logo_path ?? null,
    },
    tenant: { name: tenant?.full_name.trim() || FALLBACK_TENANT_NAME, phone: tenant?.phone ?? null },
    room: roomName,
    period: {
      start: invoice.period_start,
      end: invoice.period_end,
      quantity: invoice.quantity,
      unit: invoiceUnitLabel(invoice, lease),
      typeLabel: PERIOD_TYPE_LABEL[invoicePeriodType(invoice, lease)],
    },
    lines: [rentLine(invoice, lease, roomName), ...addonLines(invoice, input.leaseAddons), ...extraLines(invoice)],
    discount: invoice.discount_amount,
    total,
    paid,
    remaining,
    payments,
    notes: invoiceFreeText(invoice.notes),
  }
}

// ---------- WhatsApp caption & file name ----------

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/**
 * WhatsApp caption sent with the invoice image (Indonesian, short): greeting 'Halo Kak <first name>' (just
 * 'Halo Kak' for the unnamed fallback tenant), number, room + kos, period, total, then the status (LUNAS /
 * DIBATALKAN) or the remaining amount with the due date, the kos payment info when present and something is
 * still owed, and 'Terima kasih 🙏'.
 */
export function invoiceShareText(doc: InvoiceDocument): string {
  const first = firstName(doc.tenant.name)
  const greeting = first && first !== FALLBACK_TENANT_NAME ? `Halo Kak ${first}` : 'Halo Kak'
  const lines = [
    `${greeting}, berikut tagihan sewa kamar ${doc.room} ${doc.property.name}.`,
    `No. tagihan: ${doc.number}`,
    `Periode: ${doc.period.typeLabel} · ${doc.period.quantity} ${doc.period.unit} · ${formatDate(doc.period.start)} s/d ${formatDate(doc.period.end)}`,
    `Total: *${formatRupiah(doc.total)}*`,
  ]
  const open = doc.status !== 'void' && doc.remaining > 0
  if (doc.status === 'void') lines.push(`Status: *${STATUS_LABEL_VOID}*`)
  else if (!open) lines.push(`Status: *${STATUS_LABEL_PAID}* ✅`)
  else if (doc.paid > 0) lines.push(`Sudah dibayar ${formatRupiah(doc.paid)}, sisa *${formatRupiah(doc.remaining)}* jatuh tempo ${formatDate(doc.dueDate)}.`)
  else lines.push(`Sisa *${formatRupiah(doc.remaining)}* jatuh tempo ${formatDate(doc.dueDate)}.`)
  if (open && doc.property.paymentInfo) lines.push(`Pembayaran dapat dilakukan ke: ${doc.property.paymentInfo}`)
  lines.push('Rincian lengkap ada di gambar terlampir. Terima kasih 🙏')
  return lines.join('\n')
}

/** 'Tagihan-<number>-Kamar-<room>.png' with characters outside [A-Za-z0-9._-] replaced by '-'. */
export function invoiceFileName(doc: InvoiceDocument): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '-')
  return `Tagihan-${safe(doc.number)}-Kamar-${safe(doc.room)}.png`
}
