import { Building2 } from 'lucide-react'
import { useOrg } from '../hooks/useOrg'
import { clsx } from 'clsx'

/** Global filter: all properties or one. Used in the shell header; pages read `useOrg().propertyFilterIds`. */
export function PropertySwitcher({ className }: { className?: string }) {
  const { properties, selectedPropertyId, setSelectedPropertyId } = useOrg()
  if (properties.length <= 1) return null
  return (
    <label className={clsx('relative inline-flex items-center', className)}>
      <Building2 className="pointer-events-none absolute left-2.5 h-4 w-4 text-slate-500" aria-hidden />
      <select
        aria-label="Pilih kos"
        value={selectedPropertyId}
        onChange={(e) => setSelectedPropertyId(e.target.value)}
        className="h-9 appearance-none rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        <option value="all">Semua kos</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 text-slate-500">▾</span>
    </label>
  )
}
