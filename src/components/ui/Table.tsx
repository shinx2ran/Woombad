import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  /** right-align numbers */
  align?: 'left' | 'right' | 'center'
  /** hide on small screens */
  hideOnMobile?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = 'Tidak ada data.',
  footer,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
  footer?: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={clsx(
                  'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
                  c.align === 'right' && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(onRowClick && 'cursor-pointer hover:bg-brand-50/50')}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      'px-3 py-2.5 align-middle text-slate-800',
                      c.align === 'right' && 'text-right tabular-nums',
                      c.align === 'center' && 'text-center',
                      c.hideOnMobile && 'hidden md:table-cell',
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="bg-slate-50 text-sm font-medium">{footer}</tfoot>}
      </table>
    </div>
  )
}
