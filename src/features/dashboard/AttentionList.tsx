import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCircle } from 'lucide-react'
import { Badge } from '../../components/ui'
import { formatDate, formatRupiah, whatsappLink } from '../../lib/format'
import { reminderText } from '../../domain/messages'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { ATTENTION_LABEL, dueLabel, type AttentionGroup, type AttentionItem, type AttentionSection } from './dashboardModel'
import { SectionCard, SectionEmpty } from './SectionCard'

const GROUP_STYLE: Record<AttentionGroup, { tone: 'danger' | 'warning' | 'info'; bar: string }> = {
  overdue: { tone: 'danger', bar: 'bg-red-500' },
  due_soon: { tone: 'warning', bar: 'bg-amber-500' },
  unbilled: { tone: 'info', bar: 'bg-sky-500' },
}

export function AttentionList({ sections, count }: { sections: AttentionSection[]; count: number }) {
  const overdue = sections.find((s) => s.group === 'overdue')?.items.length ?? 0
  return (
    <SectionCard title="Perlu perhatian" count={count} countTone={overdue > 0 ? 'danger' : count > 0 ? 'warning' : 'neutral'} linkTo="/sewa">
      {sections.length === 0 ? (
        <SectionEmpty>Semua pembayaran aman 🎉</SectionEmpty>
      ) : (
        <div className="divide-y divide-slate-100">
          {sections.map((section) => (
            <div key={section.group}>
              <div className="flex items-center gap-2 bg-slate-50 px-4 py-1.5">
                <span className={clsx('h-2 w-2 rounded-full', GROUP_STYLE[section.group].bar)} aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{ATTENTION_LABEL[section.group]}</span>
                <span className="text-xs text-slate-400">{section.items.length}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {section.items.map((item) => (
                  <AttentionRow key={item.lease.id} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { lease, tenant, room, property, summary, group, openInvoice, openInvoiceCount, amount, nextPeriodAmount } = item
  const style = GROUP_STYLE[group]
  const tenantName = tenant?.full_name ?? 'Penyewa'
  const roomName = room?.name ?? '-'
  const propertyName = property?.name ?? '-'
  const nextStart = summary.nextDueDate ?? lease.start_date
  const wa = whatsappLink(
    tenant?.phone,
    reminderText({
      tenantName,
      roomName,
      propertyName,
      outstanding: amount,
      dueDate: nextStart,
      periodStart: openInvoiceCount === 1 ? openInvoice?.period_start : undefined,
      periodEnd: openInvoiceCount === 1 ? openInvoice?.period_end : undefined,
      paymentInfo: property?.payment_info,
    }),
  )
  const amountLine =
    summary.outstanding > 0 ? (
      <>
        Sisa <span className="font-semibold text-slate-900">{formatRupiah(summary.outstanding)}</span>
      </>
    ) : (
      <>
        Periode berikutnya <span className="font-semibold text-slate-900">{formatRupiah(nextPeriodAmount)}</span>
        <span className="text-slate-400">/{PERIOD_UNIT_LABEL[lease.period_type]}</span>
      </>
    )

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/sewa/${lease.id}`} className="block truncate text-sm font-semibold text-slate-900 hover:underline">
            {tenantName}
          </Link>
          <p className="truncate text-xs text-slate-500">
            Kamar {roomName} · {propertyName}
          </p>
          <p className="mt-1 text-sm text-slate-700">{amountLine}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <Badge tone={style.tone}>{dueLabel(summary.daysUntilDue, group === 'due_soon')}</Badge>
            <span>{formatDate(nextStart, 'EEE, d MMM yyyy')}</span>
          </p>
        </div>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            aria-label={`Kirim pengingat WhatsApp ke ${tenantName}`}
            title="Kirim pengingat WhatsApp"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
          </a>
        ) : (
          <span
            aria-label="Nomor HP belum diisi"
            title="Nomor HP belum diisi"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-300"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link
          to={`/sewa/${lease.id}?action=bayar`}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800"
        >
          Bayar
        </Link>
        <Link
          to={`/sewa/${lease.id}?action=tagih`}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Tagih
        </Link>
      </div>
    </li>
  )
}
