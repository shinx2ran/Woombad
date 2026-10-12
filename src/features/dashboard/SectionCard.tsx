import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { Badge, Card, CardHeader } from '../../components/ui'

/** Card with a titled header, optional count badge and "Lihat semua" link; children render the list. */
export function SectionCard({
  title,
  count,
  countTone = 'neutral',
  linkTo,
  linkLabel = 'Lihat semua',
  children,
}: {
  title: string
  count?: number
  countTone?: 'neutral' | 'danger' | 'warning' | 'success' | 'info' | 'brand'
  linkTo?: string
  linkLabel?: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {title}
            {count !== undefined && count > 0 && <Badge tone={countTone}>{count}</Badge>}
          </span>
        }
        action={
          linkTo && (
            <Link to={linkTo} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline">
              {linkLabel}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )
        }
      />
      {children}
    </Card>
  )
}

/** Centered, compact empty text inside a SectionCard. */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-500">{children}</p>
}
