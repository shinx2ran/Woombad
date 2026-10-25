import { Link } from 'react-router'
import { ChevronRight, DoorOpen } from 'lucide-react'
import { Card } from '../../components/ui'

// ---------------------------------------------------------------- Kos & Kamar shortcut

/** The phone's bottom tabs hold five entries without Kos & Kamar, so Pengaturan (the gear up top) links to it. */
export function KosShortcutCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card className="lg:col-span-2">
      <Link to="/kos" className="flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-slate-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <DoorOpen className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Kos &amp; Kamar</span>
          <span className="block text-xs text-slate-500">{isAdmin ? 'Tambah kos baru, kamar, dan harga sewa' : 'Lihat daftar kos dan kamar'}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </Link>
    </Card>
  )
}
