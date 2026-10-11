import { Link } from 'react-router'
import { FilePlus2, UserPlus, Wallet } from 'lucide-react'

const ACTIONS = [
  { to: '/sewa/baru', label: 'Sewa baru', icon: FilePlus2, className: 'bg-brand-700 text-white hover:bg-brand-800' },
  { to: '/pengeluaran?new=1', label: 'Catat pengeluaran', icon: Wallet, className: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50' },
  { to: '/penyewa?new=1', label: 'Tambah penyewa', icon: UserPlus, className: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50' },
]

/** Three big shortcuts for the most common morning tasks. */
export function QuickActions() {
  return (
    <nav aria-label="Aksi cepat" className="grid grid-cols-3 gap-2 sm:inline-flex sm:gap-2">
      {ACTIONS.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className={`flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-medium leading-tight sm:min-h-0 sm:h-10 sm:flex-row sm:gap-2 sm:rounded-lg sm:px-4 sm:text-sm ${a.className}`}
        >
          <a.icon className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
          <span>{a.label}</span>
        </Link>
      ))}
    </nav>
  )
}
