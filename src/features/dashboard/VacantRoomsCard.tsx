import { Link } from 'react-router'
import { DoorOpen, Plus } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate, formatRupiah } from '../../lib/format'
import type { Room } from '../../types/db'
import type { VacantRoomGroup } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

/** Best available price label for a room: monthly first, then weekly, then daily. */
function priceLabel(room: Room): string {
  if (room.price_monthly) return `${formatRupiah(room.price_monthly)}/bln`
  if (room.price_weekly) return `${formatRupiah(room.price_weekly)}/mgg`
  if (room.price_daily) return `${formatRupiah(room.price_daily)}/hari`
  return 'Harga belum diisi'
}

export function VacantRoomsCard({ groups, count }: { groups: VacantRoomGroup[]; count: number }) {
  return (
    <SectionCard title="Kamar kosong" count={count} countTone="info" linkTo="/kos">
      {groups.length === 0 ? (
        <SectionEmpty>Semua kamar terisi. Mantap! 🙌</SectionEmpty>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map((group) => (
            <div key={group.propertyId}>
              <Link
                to={`/kos/${group.propertyId}`}
                className="flex items-center justify-between bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-brand-700"
              >
                <span className="truncate">{group.property?.name ?? 'Kos'}</span>
                <span className="text-slate-400">{group.rooms.length}</span>
              </Link>
              <ul className="divide-y divide-slate-100">
                {group.rooms.map(({ room, reservedFrom, reservedTenant }) => (
                  <li key={room.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                      <DoorOpen className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="truncate">Kamar {room.name}</span>
                        {reservedFrom && <Badge tone="brand">Dipesan</Badge>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {reservedFrom
                          ? `Mulai ${formatDate(reservedFrom)}${reservedTenant ? ` · ${reservedTenant.full_name}` : ''}`
                          : `${room.floor ? `Lantai ${room.floor} · ` : ''}${priceLabel(room)}`}
                      </p>
                    </div>
                    {!reservedFrom && (
                      <Link
                        to={`/sewa/baru?room=${room.id}`}
                        aria-label={`Sewa baru untuk kamar ${room.name}`}
                        title="Buat sewa baru"
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-50 px-2.5 text-xs font-medium text-brand-800 hover:bg-brand-100"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Sewa
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
