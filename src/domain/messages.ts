/**
 * Indonesian message templates for WhatsApp reminders and receipts. Pure functions; the UI passes
 * the resolved names and numbers and opens wa.me via whatsappLink().
 */
import { formatCheckout, formatDate, formatRupiah } from '../lib/format'

export interface ReminderInput {
  tenantName: string
  roomName: string
  propertyName: string
  /** amount still owed */
  outstanding: number
  /** 'YYYY-MM-DD' */
  dueDate: string
  /** period covered by the invoice, optional: period_start and period_end as stored (period_end = last night) */
  periodStart?: string
  periodEnd?: string
  /** owner's bank / QRIS instructions (properties.payment_info); omitted when empty */
  paymentInfo?: string | null
}

const honorific = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first ? `Kak ${first}` : 'Kak'
}

/**
 * 'periode 15 Okt 2026 s/d 17 Okt 2026': check-in s/d the check-out day (SPEC 7.3: the stored period_end is the last
 * night, people read the end of a stay as the day they leave). Empty without both dates.
 */
function periodText(start: string | undefined, lastNight: string | undefined): string {
  return start && lastNight ? `${formatDate(start)} s/d ${formatCheckout(lastNight)}` : ''
}

export function reminderText(input: ReminderInput): string {
  const period = periodText(input.periodStart, input.periodEnd)
  const lines = [
    `Halo ${honorific(input.tenantName)}, ini pengingat dari ${input.propertyName}.`,
    `Tagihan kamar ${input.roomName}${period ? ` periode ${period}` : ''} sebesar *${formatRupiah(input.outstanding)}* jatuh tempo ${formatDate(input.dueDate)}.`,
  ]
  if (input.paymentInfo?.trim()) lines.push(`Pembayaran dapat dilakukan ke: ${input.paymentInfo.trim()}`)
  lines.push('Mohon konfirmasi setelah transfer ya. Terima kasih 🙏')
  return lines.join('\n')
}

export interface ReceiptInput {
  tenantName: string
  roomName: string
  propertyName: string
  amount: number
  /** 'YYYY-MM-DD' */
  paidAt: string
  methodLabel: string
  invoiceNumber?: string | null
  /** period of the invoice as stored (periodEnd = last night; the text shows the check-out day) */
  periodStart?: string
  periodEnd?: string
  /** remaining balance after this payment; 0 = lunas */
  remaining: number
}

export function receiptText(input: ReceiptInput): string {
  const lines = [
    `*Kwitansi ${input.propertyName}*`,
    `Diterima dari: ${input.tenantName} (kamar ${input.roomName})`,
    `Jumlah: *${formatRupiah(input.amount)}* via ${input.methodLabel}`,
    `Tanggal: ${formatDate(input.paidAt)}`,
  ]
  if (input.invoiceNumber) lines.push(`Untuk tagihan: ${input.invoiceNumber}`)
  const period = periodText(input.periodStart, input.periodEnd)
  if (period) lines.push(`Periode: ${period}`)
  lines.push(input.remaining > 0 ? `Sisa tagihan: ${formatRupiah(input.remaining)}` : 'Status: *LUNAS* ✅')
  lines.push('Terima kasih 🙏')
  return lines.join('\n')
}
