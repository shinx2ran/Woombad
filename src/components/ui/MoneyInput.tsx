import { useId, useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { Field, inputClass } from './Input'
import { formatNumber, parseRupiah } from '../../lib/format'

export interface MoneyInputProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  value: number | null | undefined
  onChange: (value: number) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  min?: number
  name?: string
}

/** Rupiah input that shows thousands separators ("1.500.000") while storing an integer. */
export function MoneyInput({ label, hint, error, required, value, onChange, placeholder, disabled, className, id, min, name }: MoneyInputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [text, setText] = useState(value ? formatNumber(value) : '')

  useEffect(() => {
    // Keep display in sync when parent changes value (e.g. after selecting a room).
    const parsed = parseRupiah(text)
    if ((value ?? 0) !== parsed) setText(value ? formatNumber(value) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">Rp</span>
        <input
          id={inputId}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder ?? '0'}
          className={clsx(inputClass, 'pl-10 text-right tabular-nums', error && 'border-red-400', className)}
          value={text}
          onChange={(e) => {
            const n = parseRupiah(e.target.value)
            const clamped = min != null && n < min ? min : n
            setText(e.target.value === '' ? '' : formatNumber(clamped))
            onChange(clamped)
          }}
          onBlur={() => setText(value ? formatNumber(value) : '')}
        />
      </div>
    </Field>
  )
}
