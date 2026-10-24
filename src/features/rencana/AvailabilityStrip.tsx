import { clsx } from 'clsx'
import { formatDate } from '../../lib/format'
import { STRIP_STATE_LABEL, stripText, type StripDay, type StripState } from './availability'

const CELL: Record<StripState, string> = {
  free: 'bg-emerald-100 text-emerald-800',
  occupied: 'bg-sky-300 text-sky-950',
  reserved: 'bg-violet-300 text-violet-950',
  checkout: 'bg-amber-100 text-amber-900',
}

/**
 * 14 days from the check-in day, one cell per night: kosong / terisi / dipesan / hari check-out (free to check in, a guest
 * leaves that day). The planned nights are outlined. The cells are decoration for the eye; screen readers get the same
 * information as one sentence (stripText).
 */
export function AvailabilityStrip({ cells }: { cells: StripDay[] }) {
  if (cells.length === 0) return null
  return (
    <div className="space-y-0.5">
      <div
        role="img"
        aria-label={`Ketersediaan ${cells.length} hari mulai ${formatDate(cells[0].date, 'd MMM')}: ${stripText(cells)}`}
        className="grid gap-px"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
        data-testid="availability-strip"
      >
        {cells.map((c) => (
          <span
            key={c.date}
            data-state={c.state}
            className={clsx(
              'flex h-7 items-center justify-center rounded-[3px] text-[10px] font-medium tabular-nums leading-none',
              CELL[c.state],
              c.inStay && 'ring-2 ring-inset ring-brand-700',
            )}
          >
            {formatDate(c.date, 'd')}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-500" aria-hidden>
        <span>{formatDate(cells[0].date, 'd MMM')}</span>
        <span>{formatDate(cells[cells.length - 1].date, 'd MMM')}</span>
      </div>
    </div>
  )
}

/** Colour key of the strip. */
export function StripLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Keterangan warna">
      {(Object.keys(CELL) as StripState[]).map((s) => (
        <li key={s} className="inline-flex items-center gap-1">
          <span className={clsx('h-2.5 w-2.5 rounded-sm', CELL[s])} aria-hidden />
          {STRIP_STATE_LABEL[s][0].toUpperCase() + STRIP_STATE_LABEL[s].slice(1)}
        </li>
      ))}
      <li className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm ring-2 ring-inset ring-brand-700" aria-hidden />
        Tanggal dipilih
      </li>
    </ul>
  )
}
