import { useId } from 'react'
import { clsx } from 'clsx'
import type { MemberRole } from '../../../types/db'
import { ROLE_OPTION } from './permissions'

/** Large radio cards (one per role) with a one-line explanation each. */
export function RoleOptions<R extends MemberRole>({
  label,
  roles,
  value,
  onChange,
}: {
  label: string
  roles: readonly R[]
  value: R
  onChange: (role: R) => void
}) {
  const name = useId()
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-slate-700">{label}</legend>
      {roles.map((role) => {
        const checked = role === value
        return (
          <label
            key={role}
            className={clsx(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
              checked ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={role}
              checked={checked}
              onChange={() => onChange(role)}
              className="mt-1 h-4 w-4 accent-brand-700"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{ROLE_OPTION[role].title}</span>
              <span className="block text-xs text-slate-600">{ROLE_OPTION[role].description}</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
