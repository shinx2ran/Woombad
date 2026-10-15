import { clsx } from 'clsx'
import { Check, Layers } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate } from '../../lib/format'
import type { RoomWithState } from './RoomsTab'
import { paidThroughText, roomPriceLabel, type RoomStateKind } from './roomUtils'

export const ROOM_STATE_LABEL: Record<RoomStateKind, string> = {
  occupied: 'Terisi',
  reserved: 'Dipesan',
  vacant: 'Kosong',
  maintenance: 'Perbaikan',
}

const STATE_TONE: Record<RoomStateKind, 'success' | 'info' | 'neutral' | 'warning'> = {
  occupied: 'success',
  reserved: 'info',
  vacant: 'neutral',
  maintenance: 'warning',
}

const STATE_BORDER: Record<RoomStateKind, string> = {
  occupied: 'border-emerald-200',
  reserved: 'border-sky-200',
  vacant: 'border-slate-200',
  maintenance: 'border-amber-200 bg-amber-50/40',
}

export function RoomStateBadge({ kind }: { kind: RoomStateKind }) {
  return <Badge tone={STATE_TONE[kind]}>{ROOM_STATE_LABEL[kind]}</Badge>
}

/** One tile in the room grid. In selection mode the tile toggles instead of opening the sheet. */
export function RoomCard({
  item,
  selecting,
  selected,
  onClick,
}: {
  item: RoomWithState
  selecting: boolean
  selected: boolean
  onClick: () => void
}) {
  const { room, state } = item
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecting ? selected : undefined}
      aria-label={`Kamar ${room.name}, ${ROOM_STATE_LABEL[state.kind]}${
        state.kind === 'maintenance' && state.occupancy ? `, ${ROOM_STATE_LABEL[state.occupancy].toLowerCase()}` : ''
      }`}
      className={clsx(
        'relative flex min-h-[7.5rem] flex-col rounded-xl border bg-white p-3 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        STATE_BORDER[state.kind],
        selecting && selected && 'ring-2 ring-brand-500',
      )}
    >
      {selecting && (
        <span
          aria-hidden
          className={clsx(
            'absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border',
            selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white',
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      )}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{room.name}</p>
          {room.floor && (
            <p className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Layers className="h-3 w-3" aria-hidden /> Lantai {room.floor}
            </p>
          )}
        </div>
        {!selecting && <RoomStateBadge kind={state.kind} />}
      </div>
      <div className="mt-auto pt-2 text-xs text-slate-600">
        {state.occupancy === 'occupied' && (
          <>
            <p className="truncate font-medium text-slate-800">{state.tenant?.full_name ?? 'Penyewa'}</p>
            <p className={clsx(state.outstanding > 0 && 'text-amber-700')}>
              {paidThroughText(state.paidThrough) ?? 'Belum ada pembayaran'}
            </p>
          </>
        )}
        {state.occupancy === 'reserved' && (
          <>
            <p className="truncate font-medium text-slate-800">{state.tenant?.full_name ?? 'Penyewa'}</p>
            <p>Mulai {formatDate(state.startDate)}</p>
          </>
        )}
        {state.kind === 'vacant' && <p className="font-medium text-slate-800">{roomPriceLabel(room)}</p>}
        {state.kind === 'maintenance' && (
          <p className={clsx(state.occupancy !== null && 'mt-0.5 text-amber-700')}>
            {state.occupancy === null ? 'Tidak disewakan sementara' : 'Sedang diperbaiki'}
          </p>
        )}
      </div>
    </button>
  )
}
