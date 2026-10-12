import { clsx } from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)} {...rest} />
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('px-4 py-3', className)} {...rest} />
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'warning'
  icon?: ReactNode
}) {
  const tones = {
    default: 'text-slate-900',
    positive: 'text-emerald-700',
    negative: 'text-red-700',
    warning: 'text-amber-700',
  }
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className={clsx('mt-1 whitespace-nowrap text-[clamp(1rem,4.5vw,1.25rem)] font-semibold tabular-nums sm:text-2xl', tones[tone])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  )
}
