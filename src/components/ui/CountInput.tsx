import { useEffect, useId, useState } from 'react'
import { clsx } from 'clsx'
import { Field, inputClass } from './Input'

export interface CountInputProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  /** the last valid count; the parent keeps it while the box is empty */
  value: number
  onChange: (value: number) => void
  /** smallest count accepted (default 1) */
  min?: number
  /** largest count accepted (default 9999) */
  max?: number
  disabled?: boolean
  className?: string
  id?: string
}

/** Digits only, at most four (9999 nights is far beyond any stay). */
export function parseCount(text: string): number | null {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits === '' ? null : Number.parseInt(digits, 10)
}

/**
 * Whole-number input for counts such as "Jumlah periode". The box may be emptied while typing (the parent keeps the
 * last valid count, so totals never jump to 0) and is filled with that count again when it loses focus. Tapping it
 * selects the number, so typing replaces it instead of appending ("1" + "3" = "13").
 */
export function CountInput({ label, hint, error, required, value, onChange, min = 1, max = 9999, disabled, className, id }: CountInputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [text, setText] = useState(String(value))

  // the parent changed the count (another field, a reset): show it, unless the box already says the same
  useEffect(() => {
    if (parseCount(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        required={required}
        disabled={disabled}
        className={clsx(inputClass, 'tabular-nums', error && 'border-red-400 focus:border-red-500 focus:ring-red-100', className)}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const n = parseCount(e.target.value)
          setText(n === null ? '' : String(n))
          if (n !== null) onChange(Math.min(max, Math.max(min, n)))
        }}
        onBlur={() => setText(String(value))}
      />
    </Field>
  )
}
