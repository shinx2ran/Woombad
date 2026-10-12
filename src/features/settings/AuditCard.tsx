import { useMemo, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, LoadingState } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { formatDateTime } from '../../lib/format'
import type { AuditAction, AuditLogEntry } from '../../types/db'
import { actorLabel, memberEmails, relativeTime, summarizeAuditEntry, type RefResolver } from './audit/auditSummary'

// ---------------------------------------------------------------- Change history (SPEC 6.3, owner/admin)

const LIMIT = 100
const PAGE = 20
const CHANGES_COLLAPSED = 3

const ACTION_TONE: Record<AuditAction, 'success' | 'info' | 'danger'> = {
  insert: 'success',
  update: 'info',
  delete: 'danger',
}

export function AuditCard({ isLocalMode }: { isLocalMode: boolean }) {
  if (isLocalMode) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader title="Riwayat perubahan" subtitle="Siapa mengubah apa, dan kapan" action={<History className="h-5 w-5 text-slate-400" />} />
        <CardBody>
          <p className="text-sm text-slate-600">
            Riwayat perubahan hanya dicatat di <strong>Mode Online</strong>. Di Mode Demo perubahan tidak dicatat.
          </p>
        </CardBody>
      </Card>
    )
  }
  return <OnlineAuditCard />
}

function OnlineAuditCard() {
  const { properties } = useOrg()
  const log = useTable('audit_log', { orderBy: { column: 'changed_at', ascending: false }, limit: LIMIT }, { staleTime: 0 })
  const members = useTable('organization_members')
  const rooms = useTable('rooms')
  const tenants = useTable('tenants')
  const [shown, setShown] = useState(PAGE)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const entries = useMemo(() => log.data ?? [], [log.data])
  const emails = useMemo(() => memberEmails(members.data ?? [], entries), [members.data, entries])
  const resolve = useMemo<RefResolver>(() => {
    const names = new Map<string, string>()
    for (const p of properties) names.set(`property_id:${p.id}`, p.name)
    for (const r of rooms.data ?? []) names.set(`room_id:${r.id}`, r.name)
    for (const t of tenants.data ?? []) names.set(`tenant_id:${t.id}`, t.full_name)
    return (column, id) => {
      if (column === 'user_id' || column === 'invited_by' || column === 'accepted_by') return emails.get(id) ?? null
      return names.get(`${column}:${id}`) ?? null
    }
  }, [properties, rooms.data, tenants.data, emails])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Relative times ('3 jam lalu') are measured from when the list was loaded.
  const now = new Date(log.dataUpdatedAt)
  const visible = entries.slice(0, shown)

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Riwayat perubahan"
        subtitle={`${LIMIT} perubahan terakhir: siapa, kapan, apa`}
        action={
          <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void log.refetch()} loading={log.isFetching} aria-label="Muat ulang riwayat">
            <span className="hidden sm:inline">Muat ulang</span>
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {log.isPending ? (
          <LoadingState />
        ) : log.isError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Riwayat belum dapat dimuat. {log.error instanceof Error ? log.error.message : ''}
          </p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Belum ada perubahan tercatat.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {visible.map((e) => (
                <AuditRow
                  key={e.id}
                  entry={e}
                  who={actorLabel(e.changed_by, emails)}
                  resolve={resolve}
                  now={now}
                  expanded={expanded.has(e.id)}
                  onToggle={() => toggle(e.id)}
                />
              ))}
            </ul>
            {entries.length > shown && (
              <Button variant="outline" fullWidth onClick={() => setShown((n) => n + PAGE)}>
                Lihat lainnya ({Math.min(PAGE, entries.length - shown)})
              </Button>
            )}
          </>
        )}
        <p className="text-xs text-slate-500">Riwayat dicatat otomatis oleh server dan tidak dapat diubah atau dihapus, juga oleh pemilik.</p>
      </CardBody>
    </Card>
  )
}

function AuditRow({
  entry,
  who,
  resolve,
  now,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry
  who: string
  resolve: RefResolver
  now: Date
  expanded: boolean
  onToggle: () => void
}) {
  const s = summarizeAuditEntry(entry, resolve)
  const changes = expanded ? s.changes : s.changes.slice(0, CHANGES_COLLAPSED)
  const hidden = s.changes.length - changes.length
  const relative = relativeTime(entry.changed_at, now)

  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-slate-900">
          {s.tableLabel}
          <Badge tone={ACTION_TONE[s.action] ?? 'neutral'}>{s.actionLabel}</Badge>
        </p>
        {relative && <span className="shrink-0 text-xs text-slate-500">{relative}</span>}
      </div>
      {s.subject && <p className="mt-0.5 break-words text-sm text-slate-700">{s.subject}</p>}
      {s.action === 'update' && s.changes.length === 0 && <p className="mt-0.5 text-xs text-slate-500">Tanpa perubahan isi.</p>}
      {changes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {changes.map((c, i) => (
            <li key={i} className="break-words">
              {c}
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || (expanded && s.changes.length > CHANGES_COLLAPSED)) && (
        <button type="button" onClick={onToggle} className="mt-0.5 text-xs font-medium text-brand-700 hover:underline">
          {hidden > 0 ? `+${hidden} perubahan lain` : 'Tampilkan lebih sedikit'}
        </button>
      )}
      <p className="mt-1 text-xs text-slate-500">
        <span className="break-all">{who}</span> · {formatDateTime(entry.changed_at)}
      </p>
    </li>
  )
}
