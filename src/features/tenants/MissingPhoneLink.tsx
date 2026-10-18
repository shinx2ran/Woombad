import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCirclePlus } from 'lucide-react'
import type { Tenant } from '../../types/db'

/**
 * Stands in for a WhatsApp button when the tenant has no phone number: an amber "add" bubble that opens the tenant's
 * form at Nomor HP, so the number is one tap away instead of a dead grey icon.
 */
export function MissingPhoneLink({ tenant, className, iconClassName = 'h-5 w-5' }: { tenant: Pick<Tenant, 'id' | 'full_name'> | null | undefined; className: string; iconClassName?: string }) {
  if (!tenant) {
    return (
      <span aria-label="Nomor HP belum diisi" title="Nomor HP belum diisi" className={clsx(className, 'bg-slate-100 text-slate-300')}>
        <MessageCirclePlus className={iconClassName} aria-hidden />
      </span>
    )
  }
  return (
    <Link
      // TenantDetailPage opens the form at Nomor HP for ?isi=hp
      to={`/penyewa/${tenant.id}?isi=hp`}
      aria-label={`Nomor HP ${tenant.full_name} belum diisi: isi sekarang`}
      title="Nomor HP belum diisi: ketuk untuk mengisi"
      className={clsx(className, 'bg-amber-50 text-amber-600 hover:bg-amber-100')}
    >
      <MessageCirclePlus className={iconClassName} aria-hidden />
    </Link>
  )
}
