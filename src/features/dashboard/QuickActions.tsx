import { Link } from 'react-router'
import { FilePlus2, ScanLine, UserPlus, Wallet } from 'lucide-react'

const PRIMARY = 'bg-brand-700 text-white hover:bg-brand-800'
const SECONDARY = 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'

/** Check-in (SPEC 5.3) opens the Sewa baru wizard with the KTP / Paspor scanner already open. */
const QUICK_ACTIONS = [
  { to: '/sewa/baru?scan=1', label: 'Check-in', icon: ScanLine, className: PRIMARY },
  { to: '/sewa/baru', label: 'Sewa baru', icon: FilePlus2, className: SECONDARY },
  { to: '/pengeluaran?new=1', label: 'Catat pengeluaran', icon: Wallet, className: SECONDARY },
  { to: '/penyewa?new=1', label: 'Tambah penyewa', icon: UserPlus, className: SECONDARY },
]

/** Big shortcuts for the most common tasks; Check-in first because it is what happens at the front desk. */
export function QuickActions() {
  return (
    <nav aria-label="Aksi cepat" className="grid grid-cols-4 gap-2 sm:inline-flex sm:gap-2">
      {QUICK_ACTIONS.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className={`flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-xs font-medium leading-tight sm:min-h-0 sm:h-10 sm:flex-row sm:gap-2 sm:rounded-lg sm:px-4 sm:text-sm ${a.className}`}
        >
          <a.icon className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
          <span>{a.label}</span>
        </Link>
      ))}
    </nav>
  )
}
