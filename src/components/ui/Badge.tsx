import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import type { InvoiceStatus, LeaseStatus } from '../../types/db'
import { INVOICE_STATUS_LABEL, LEASE_STATUS_LABEL } from '../../types/db'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-800',
  brand: 'bg-brand-100 text-brand-800',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const tone: Tone = status === 'paid' ? 'success' : status === 'partial' ? 'warning' : status === 'void' ? 'neutral' : 'danger'
  return <Badge tone={tone}>{INVOICE_STATUS_LABEL[status]}</Badge>
}

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  const tone: Tone = status === 'active' ? 'success' : status === 'ended' ? 'neutral' : 'danger'
  return <Badge tone={tone}>{LEASE_STATUS_LABEL[status]}</Badge>
}
