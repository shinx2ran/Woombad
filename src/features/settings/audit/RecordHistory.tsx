import { useMemo } from 'react'
import { History } from 'lucide-react'
import { useOrg } from '../../../hooks/useOrg'
import { useTable } from '../../../hooks/useTable'
import { formatDateTime } from '../../../lib/format'
import { actorLabel, memberEmails, summarizeAuditEntry } from './auditSummary'

const LIMIT = 20

/**
 * "Riwayat perubahan" of one invoice or payment (SPEC 7.5), newest first: who added or changed it, when, and what
 * (from the server's audit_log, the same source as Pengaturan → Riwayat perubahan; owner/admin only). Mode Demo keeps
 * no history.
 */
export function RecordHistory({ table, rowId }: { table: 'payments' | 'invoices'; rowId: string }) {
  const { isLocalMode } = useOrg()
  return (
    <section className="space-y-2 border-t border-slate-100 pt-3" aria-label="Riwayat perubahan">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <History className="h-3.5 w-3.5" aria-hidden /> Riwayat perubahan
      </p>
      {isLocalMode ? (
        <p className="text-xs text-slate-500">Mode Demo tidak mencatat riwayat. Di Mode Online setiap perubahan tercatat otomatis.</p>
      ) : (
        <OnlineRecordHistory table={table} rowId={rowId} />
      )}
    </section>
  )
}

function OnlineRecordHistory({ table, rowId }: { table: 'payments' | 'invoices'; rowId: string }) {
  const log = useTable('audit_log', { where: { row_id: rowId }, orderBy: { column: 'changed_at', ascending: false }, limit: LIMIT }, { staleTime: 0 })
  const members = useTable('organization_members')
  const entries = useMemo(() => (log.data ?? []).filter((e) => e.table_name === table), [log.data, table])
  const emails = useMemo(() => memberEmails(members.data ?? [], entries), [members.data, entries])

  if (log.isPending) return <p className="text-xs text-slate-500">Memuat riwayat…</p>
  if (log.isError) return <p className="text-xs text-red-600">Riwayat belum dapat dimuat.</p>
  if (entries.length === 0) return <p className="text-xs text-slate-500">Belum ada riwayat tercatat.</p>
  return (
    <ul className="space-y-2" data-testid="record-history">
      {entries.map((e) => {
        const s = summarizeAuditEntry(e)
        return (
          <li key={e.id} className="text-xs text-slate-600">
            <p>
              <span className="font-medium text-slate-900">{s.actionLabel === 'Tambah' ? 'Dibuat' : s.actionLabel === 'Ubah' ? 'Diubah' : 'Dihapus'}</span> ·{' '}
              {formatDateTime(e.changed_at)} · <span className="break-all">{actorLabel(e.changed_by, emails)}</span>
            </p>
            {s.changes.length > 0 && (
              <ul className="mt-0.5 list-disc pl-4">
                {s.changes.map((c, i) => (
                  <li key={i} className="break-words">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
