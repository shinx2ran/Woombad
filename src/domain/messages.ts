/**
 * Indonesian message templates for WhatsApp reminders and receipts. Pure functions; the UI passes
 * the resolved names and numbers and opens wa.me via whatsappLink().
 */
import { formatDate, formatRupiah } from '../lib/format'

export interface ReminderInput {
  tenantName: string
  roomName: string
  propertyName: string
  /** amount still owed */
  outstanding: number
  /** 'YYYY-MM-DD' */
  dueDate: string
  /** period covered by the invoice, optional */
  periodStart?: string
  periodEnd?: string
  /** owner's bank / QRIS instructions (properties.payment_info); omitted when empty */
  paymentInfo?: string | null
}

const honorific = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first ? `Kak ${first}` : 'Kak'
}

export function reminderText(input: ReminderInput): string {
  const lines = [
    `Halo ${honorific(input.tenantName)}, ini pengingat dari ${input.propertyName}.`,
    `Tagihan kamar ${input.roomName}${input.periodStart && input.periodEnd ? ` periode ${formatDate(input.periodStart)} s/d ${formatDate(input.periodEnd)}` : ''} sebesar *${formatRupiah(input.outstanding)}* jatuh tempo ${formatDate(input.dueDate)}.`,
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
  if (input.periodStart && input.periodEnd) lines.push(`Periode: ${formatDate(input.periodStart)} s/d ${formatDate(input.periodEnd)}`)
  lines.push(input.remaining > 0 ? `Sisa tagihan: ${formatRupiah(input.remaining)}` : 'Status: *LUNAS* ✅')
  lines.push('Terima kasih 🙏')
  return lines.join('\n')
}
