import { useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Button, Input, Modal, MoneyInput, useToast } from '../../components/ui'
import { depositBalance } from '../../domain/billing'
import { formatRupiah, todayISO } from '../../lib/format'
import type { Expense, Invoice, Lease, Payment } from '../../types/db'
import {
  CHARGE_CASH_METHODS,
  CHARGE_DESCRIPTION_MAX,
  CHARGE_PRESETS,
  chargePayWithLabel,
  chargePresetText,
  chargeSavedText,
  chargeSummaryText,
  hasChargeErrors,
  validateCharge,
  type ChargePayWith,
  type ChargePreset,
} from './charges'
import { ChargeSavedError, type LeaseActions } from './useLeaseActions'

export interface ChargeModalProps {
  lease: Lease
  tenantName: string
  roomName: string
  /** every invoice of the org: numbers the charge */
  orgInvoices: Invoice[]
  /** payments and expenses (a superset is fine): the deposit held, for "Potong jaminan" */
  payments: Payment[]
  expenses: Expense[]
  actions: Pick<LeaseActions, 'addCharge'>
  /** cancel, a save, and also a ChargeSavedError (the charge exists then, so the sheet must not stay to save it again) */
  onClose: () => void
}

const choiceClass = (selected: boolean) =>
  clsx(
    'min-h-11 rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  )

/**
 * Biaya tambahan (SPEC 7.31): a one-off charge on the lease (late check-out, damage, ...), not rent for a period, so the
 * paid-through date and the due date stay as they are. Paid now, from the deposit held, or later from the invoice list.
 * Every member may add one. Opened from Lainnya on the lease page and from the Checkout dialog.
 */
export function ChargeModal({ lease, tenantName, roomName, orgInvoices, payments, expenses, actions, onClose }: ChargeModalProps) {
  const toast = useToast()
  const today = todayISO()
  const held = useMemo(() => depositBalance(lease, payments, expenses).held, [lease, payments, expenses])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(0)
  // a booking that has not started cannot be charged before its first day
  const [date, setDate] = useState(today < lease.start_date ? lease.start_date : today)
  const [payWith, setPayWith] = useState<ChargePayWith>('cash')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<HTMLInputElement>(null)

  const errors = validateCharge({ description, amount, date, leaseStart: lease.start_date, depositHeld: held, payWith })
  const summary = chargeSummaryText(amount, payWith, held)
  const depositShort = held <= 0 || (amount > 0 && held < amount)

  const pickPreset = (preset: ChargePreset) => {
    setDescription(chargePresetText(preset))
    // 'Lainnya': the field is emptied for the owner's own words
    if (!chargePresetText(preset)) descriptionRef.current?.focus()
  }

  const save = async () => {
    setTouched(true)
    if (hasChargeErrors(errors)) return
    setSaving(true)
    try {
      await actions.addCharge(lease, { description, amount, date }, orgInvoices, payWith)
      toast.success(chargeSavedText(amount, payWith))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan biaya tambahan.')
      // the charge itself is saved: closing keeps it from being saved a second time
      if (err instanceof ChargeSavedError) onClose()
    } finally {
      setSaving(false)
    }
  }

  const payChoice = (value: ChargePayWith, sub?: string, disabled?: boolean) => (
    <button
      key={value ?? 'later'}
      type="button"
      role="radio"
      aria-checked={payWith === value}
      disabled={disabled}
      onClick={() => setPayWith(value)}
      className={clsx(choiceClass(payWith === value), 'flex flex-col items-center justify-center leading-tight')}
    >
      <span>{chargePayWithLabel(value)}</span>
      {sub && <span className={clsx('text-xs font-normal', payWith === value ? 'text-brand-100' : 'text-slate-500')}>{sub}</span>}
    </button>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={`Biaya tambahan · Kamar ${roomName}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" onClick={() => void save()} loading={saving} disabled={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="charge-sheet">
        <p className="text-sm text-slate-600">
          Biaya sekali untuk <strong className="text-slate-900">{tenantName}</strong>, bukan sewa: masa sewa dan jatuh tempo tidak berubah.
        </p>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat keterangan">
            {CHARGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={description.trim() === preset}
                onClick={() => pickPreset(preset)}
                className={clsx(
                  'min-h-9 rounded-full border px-3 text-sm transition-colors',
                  description.trim() === preset ? 'border-brand-700 bg-brand-50 font-medium text-brand-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {preset}
              </button>
            ))}
          </div>
          <Input
            ref={descriptionRef}
            label="Keterangan"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={CHARGE_DESCRIPTION_MAX}
            placeholder="mis. kunci hilang"
            required
            error={touched ? errors.description : undefined}
          />
        </div>
        <MoneyInput label="Jumlah" value={amount} onChange={setAmount} required error={touched ? errors.amount : undefined} />
        <Input label="Tanggal" type="date" value={date} min={lease.start_date} onChange={(e) => setDate(e.target.value)} required error={errors.date} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Pembayaran</span>
          <div role="radiogroup" aria-label="Pembayaran" className="space-y-2">
            <div className="grid grid-cols-3 gap-2">{CHARGE_CASH_METHODS.map((m) => payChoice(m))}</div>
            <div className="grid grid-cols-2 gap-2">
              {payChoice('deposit', `dipegang ${formatRupiah(Math.max(0, held))}`, depositShort && payWith !== 'deposit')}
              {payChoice(null)}
            </div>
          </div>
          {errors.payWith && <p className="text-xs text-red-600">{errors.payWith}</p>}
        </div>
        {summary && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="charge-summary">
            {summary}
          </p>
        )}
      </div>
    </Modal>
  )
}
