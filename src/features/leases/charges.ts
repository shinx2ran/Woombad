/**
 * Biaya tambahan (SPEC 7.31): a one-off charge on a lease (late check-out, damage, ...) stored as its own invoice with
 * invoice_type 'charge'. Pure helpers for the dialog and useLeaseActions.addCharge: validation, the insert payload and
 * how a charge is named on screen.
 */
import { chargeNote, invoiceNumber, nextInvoiceSequence } from '../../domain/billing'
import { formatDate, formatRupiah } from '../../lib/format'
import { INVOICE_TYPE_LABEL, PAYMENT_METHOD_LABEL, type Invoice, type Lease, type OrgInsert, type PaymentMethod } from '../../types/db'

/** Quick picks for Keterangan; 'Lainnya' empties the field for free text instead of filling it. */
export const CHARGE_PRESETS = ['Late checkout', 'Kerusakan', 'Kebersihan', 'Tamu menginap', 'Lainnya'] as const
export type ChargePreset = (typeof CHARGE_PRESETS)[number]
export const CHARGE_OTHER_PRESET: ChargePreset = 'Lainnya'

/** the same limit the dialog's input enforces (SPEC 7.31) */
export const CHARGE_DESCRIPTION_MAX = 200

/** note written on a payment made together with the charge */
export const CHARGE_PAYMENT_NOTE = 'Biaya tambahan'

/** How the charge is settled when it is saved: paid now in cash/transfer/QRIS, from the held deposit, or later (null). */
export type ChargePayWith = Extract<PaymentMethod, 'cash' | 'transfer' | 'qris' | 'deposit'> | null
export const CHARGE_CASH_METHODS = ['cash', 'transfer', 'qris'] as const satisfies readonly PaymentMethod[]

/** What Keterangan becomes when a preset is tapped. */
export function chargePresetText(preset: ChargePreset): string {
  return preset === CHARGE_OTHER_PRESET ? '' : preset
}

export interface ChargeInput {
  description: string
  /** integer rupiah, > 0 */
  amount: number
  /** 'YYYY-MM-DD': the day of the charge (period_start = period_end = due_date) */
  date: string
}

export interface ValidateChargeInput extends ChargeInput {
  leaseStart: string
  /** depositBalance(...).held; only consulted when payWith is 'deposit' */
  depositHeld: number
  payWith: ChargePayWith
}

export interface ChargeErrors {
  description?: string
  amount?: string
  date?: string
  payWith?: string
}

/** Field errors in Indonesian; an empty object means the charge may be saved. */
export function validateCharge(input: ValidateChargeInput): ChargeErrors {
  const errors: ChargeErrors = {}
  const description = input.description.trim()
  if (!description) errors.description = 'Keterangan wajib diisi.'
  else if (description.length > CHARGE_DESCRIPTION_MAX) errors.description = `Keterangan maksimal ${CHARGE_DESCRIPTION_MAX} huruf.`
  const amountOk = Number.isInteger(input.amount) && input.amount > 0
  if (!amountOk) errors.amount = 'Jumlah harus lebih dari 0.'
  if (!input.date) errors.date = 'Tanggal wajib diisi.'
  else if (input.date < input.leaseStart) errors.date = `Tanggal tidak boleh sebelum mulai sewa (${formatDate(input.leaseStart)}).`
  // only a real amount can be compared with the deposit; a missing amount already has its own error
  if (input.payWith === 'deposit' && amountOk && input.depositHeld < input.amount) {
    errors.payWith = `Jaminan yang dipegang hanya ${formatRupiah(Math.max(0, input.depositHeld))}.`
  }
  return errors
}

export function hasChargeErrors(errors: ChargeErrors): boolean {
  return Object.values(errors).some(Boolean)
}

/**
 * Insert payload of a charge: the shape invoices_charge_shape_check requires (one day, quantity 1, the whole amount as
 * extra_amount, no period type) and an ordinary INV-YYYYMM-NNNN number in the month of the charge's date.
 * Pass every invoice of the org for the numbering.
 */
export function chargeInvoiceRow(lease: Pick<Lease, 'id' | 'property_id'>, input: ChargeInput, orgInvoices: Invoice[]): OrgInsert<'invoices'> {
  return {
    property_id: lease.property_id,
    lease_id: lease.id,
    invoice_number: invoiceNumber(input.date, nextInvoiceSequence(input.date, orgInvoices)),
    invoice_type: 'charge',
    period_type: null,
    period_start: input.date,
    period_end: input.date,
    quantity: 1,
    base_amount: 0,
    addons_amount: 0,
    extra_amount: input.amount,
    discount_amount: 0,
    total_amount: input.amount,
    due_date: input.date,
    status: 'unpaid',
    notes: input.description.trim(),
  }
}

/** Label of a Pembayaran choice in the dialog. */
export function chargePayWithLabel(payWith: ChargePayWith): string {
  if (payWith === null) return 'Bayar nanti'
  return payWith === 'deposit' ? 'Potong jaminan' : PAYMENT_METHOD_LABEL[payWith]
}

/** The dialog's one-line summary of what saving does with the money; null until there is an amount. */
export function chargeSummaryText(amount: number, payWith: ChargePayWith, depositHeld: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return null
  const money = formatRupiah(amount)
  if (payWith === 'deposit') return `${money} dipotong dari jaminan; jaminan dipegang menjadi ${formatRupiah(Math.max(0, depositHeld - amount))}.`
  if (payWith) return `${money} dibayar ${chargePayWithLabel(payWith)} hari ini; biaya langsung lunas.`
  return `${money} belum dibayar: masuk Sisa tagihan, bayar nanti dari daftar tagihan.`
}

/** Toast after a charge was saved. */
export function chargeSavedText(amount: number, payWith: ChargePayWith): string {
  const money = formatRupiah(amount)
  if (payWith === 'deposit') return `Biaya tambahan ${money} dicatat, dipotong dari jaminan.`
  if (payWith) return `Biaya tambahan ${money} dicatat, lunas (${chargePayWithLabel(payWith)}).`
  return `Biaya tambahan ${money} dicatat, belum dibayar.`
}

/** A charge's row title: 'Biaya tambahan · Late checkout' (chargeNote); just 'Biaya tambahan' when it has none. */
export function chargeTitle(invoice: Pick<Invoice, 'invoice_type' | 'notes'>): string {
  const note = chargeNote(invoice)
  return note ? `${INVOICE_TYPE_LABEL.charge} · ${note}` : INVOICE_TYPE_LABEL.charge
}
