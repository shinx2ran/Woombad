import { clsx } from 'clsx'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface FieldProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
  htmlFor?: string
}

export function Field({ label, hint, error, required, className, children, htmlFor }: FieldProps) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, required, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <input
        ref={ref}
        id={inputId}
        required={required}
        className={clsx(inputClass, error && 'border-red-400 focus:border-red-500 focus:ring-red-100', className)}
        {...rest}
      />
    </Field>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, required, rows = 3, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        className={clsx(inputClass, 'h-auto py-2', error && 'border-red-400', className)}
        {...rest}
      />
    </Field>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  options: { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, required, options, placeholder, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <select
        ref={ref}
        id={inputId}
        required={required}
        className={clsx(inputClass, error && 'border-red-400', className)}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
})
