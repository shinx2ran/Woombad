import { useEffect, useId, useState } from 'react'
import { clsx } from 'clsx'
import { Field, inputClass } from './Input'
import { parseCount } from '../../lib/format'

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

/**
 * Whole-number input for counts such as "Jumlah periode". The box may be emptied (or read 0) while typing: the parent
 * keeps the last valid count, so totals never jump, and the box shows that count again when it loses focus. Tapping it
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
          // keep the digits exactly as typed: rewriting them ('0' -> '1', '05' -> '5') would move the caret mid-edit,
          // so deleting the 3 of 30 to type 20 would end as 12. A draft below `min` is treated like an empty box.
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
          setText(digits)
          const n = parseCount(digits)
          if (n !== null && n >= min) onChange(Math.min(max, n))
        }}
        onBlur={() => setText(String(value))}
      />
    </Field>
  )
}
