import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, CountInput, LoadingState, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { formatDate, formatDateTime, formatUsd, todayISO } from '../../lib/format'
import { DEFAULT_MONTHLY_CREDIT_USD, DEFAULT_RENEWAL_DAY, costMicros, creditCycle, startOfDayInstant, summarizeCredit } from '../../domain/scanCredit'
import type { ScanOutcome, ScanUsage } from '../../types/db'
import { FORMER_MEMBER_ACTOR, actorLabel, memberEmails } from './audit/auditSummary'
import { isMissingTableError } from './data/orgData'

// ---------------------------------------------------------------- Kredit Claude (SPEC 7.17, owner/admin)

/** where the owner sees the exact balance: Anthropic has no API for it */
export const CONSOLE_BILLING_URL = 'https://platform.claude.com/settings/billing'
const PAGE = 20

const KIND_LABEL: Record<NonNullable<ScanUsage['kind']>, string> = {
  expense_list: 'catatan tulisan tangan',
  receipt: 'nota toko',
  unreadable: 'tidak terbaca',
}
const OUTCOME_LABEL: Record<Exclude<ScanOutcome, 'ok'>, string> = {
  refused: 'Ditolak',
  max_tokens: 'Terlalu panjang',
  invalid: 'Hasil tidak terpakai',
}

const fellBack = (row: ScanUsage) => Array.isArray(row.attempts) && row.attempts.some((a) => (a as { kind?: unknown } | null)?.kind === 'fallback_message')

/**
 * What each Scan nota cost and an estimate of the Claude API credit left this cycle: the monthly credit minus the scans
 * recorded since it renewed. The exact balance is only on the Claude Console (linked).
 */
export function ScanCreditCard({ isLocalMode }: { isLocalMode: boolean }) {
  const { org, repo } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const today = todayISO()

  const savedCredit = Number(org.claude_credit_monthly_usd ?? DEFAULT_MONTHLY_CREDIT_USD)
  const savedDay = org.claude_credit_renewal_day ?? DEFAULT_RENEWAL_DAY
  // what the owner is typing; null = show the saved settings (so a save elsewhere shows up without an effect)
  const [draft, setDraft] = useState<{ credit: number; day: number } | null>(null)
  const credit = draft?.credit ?? Math.round(savedCredit)
  const day = draft?.day ?? savedDay
  const [saving, setSaving] = useState(false)
  const [shown, setShown] = useState(PAGE)

  // this cycle and the one before, by the saved renewal day
  const cycle = creditCycle(today, savedDay)
  const usage = useTable(
    'scan_usage',
    { gte: { created_at: startOfDayInstant(cycle.previousStart) }, orderBy: { column: 'created_at', ascending: false } },
    { staleTime: 0 },
  )
  const members = useTable('organization_members')
  const rows = useMemo(() => usage.data ?? [], [usage.data])
  const emails = useMemo(() => memberEmails(members.data ?? []), [members.data])
  const summary = summarizeCredit({ monthlyUsd: savedCredit, renewalDay: savedDay }, rows, today)
  const notDeployed = usage.isError && isMissingTableError(usage.error)

  const changed = credit !== Math.round(savedCredit) || day !== savedDay
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await repo.raw.update('organizations', org.id, { claude_credit_monthly_usd: credit, claude_credit_renewal_day: day })
      await qc.invalidateQueries({ queryKey: ['membership'] })
      setDraft(null)
      toast.success('Pengaturan kredit disimpan.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(false)
    }
  }

  const used = summary.monthlyUsd > 0 ? Math.min(1, Math.max(0, summary.usedUsd / summary.monthlyUsd)) : 1
  const tone = summary.remainingUsd <= 0 ? 'red' : summary.remainingUsd < summary.monthlyUsd * 0.1 ? 'amber' : 'emerald'
  const visible = rows.slice(0, shown)

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Kredit Claude"
        subtitle="Biaya tiap Scan nota dan perkiraan sisa kredit API"
        action={
          isLocalMode ? (
            <Sparkles className="h-5 w-5 text-slate-400" />
          ) : (
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void usage.refetch()} loading={usage.isFetching} aria-label="Muat ulang biaya scan">
              <span className="hidden sm:inline">Muat ulang</span>
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {isLocalMode && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="credit-demo-note">
            Mode Demo: foto tidak dibaca Claude, jadi tidak ada kredit terpakai. Biaya di sini contoh dari scan contoh.
          </p>
        )}

        {notDeployed ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Biaya scan belum tercatat: database server belum diperbarui. Minta operator memperbaruinya.
          </p>
        ) : (
          <>
            <div className="space-y-2" data-testid="credit-remaining">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sisa kredit (perkiraan)</p>
              <p
                className={clsx(
                  'text-2xl font-semibold tabular-nums',
                  tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-emerald-700',
                )}
              >
                {usage.isPending ? '…' : formatUsd(summary.remainingUsd)}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div
                  className={clsx('h-full rounded-full', tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.round((1 - used) * 100)}%` }}
                />
              </div>
              <p className="text-sm text-slate-600">
                dari {formatUsd(summary.monthlyUsd)} · diperbarui tiap tgl {summary.renewalDay} (berikutnya {formatDate(cycle.next)})
              </p>
            </div>

            {usage.isError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Biaya scan belum dapat dimuat. {usage.error instanceof Error ? usage.error.message : ''}
              </p>
            ) : (
              !usage.isPending && (
                <div className="space-y-1 text-sm text-slate-700">
                  <p data-testid="credit-cycle">
                    Sejak {formatDate(cycle.start)}: {summary.scans} scan · {formatUsd(summary.usedUsd, 4)}
                    {summary.averageUsd !== null && <> · rata-rata {formatUsd(summary.averageUsd, 4)} per scan</>}
                  </p>
                  {summary.scansLeft !== null && summary.remainingUsd > 0 && (
                    <p className="text-slate-600">Cukup untuk sekitar {summary.scansLeft.toLocaleString('id-ID')} scan lagi.</p>
                  )}
                  <p className="text-xs text-slate-500">
                    Siklus sebelumnya ({formatDate(cycle.previousStart)}): {summary.previousScans} scan · {formatUsd(summary.previousUsedUsd, 4)}
                  </p>
                </div>
              )
            )}

            {summary.remainingUsd <= 0 && !usage.isPending && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="credit-empty">
                Perkiraan kredit habis. Scan berikutnya bisa ditolak sampai kredit diperbarui {formatDate(cycle.next)}, kecuali ada kredit lain di
                Console.
              </p>
            )}
          </>
        )}

        <a
          href={CONSOLE_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-testid="credit-console-link"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Lihat saldo pasti di Claude Console
        </a>
        <p className="text-xs text-slate-500">
          Anthropic tidak menyediakan saldo kredit lewat API, jadi angka di atas dihitung dari scan yang tercatat di Woombad. Pemakaian lain di
          organisasi Console yang sama tidak ikut terhitung.
        </p>

        <form onSubmit={save} className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-900">Pengaturan kredit</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CountInput label="Kredit per bulan (US$)" value={credit} onChange={(n) => setDraft({ credit: n, day })} min={0} max={9999} hint="Paket Claude Max: 100" />
            <CountInput label="Tanggal pembaruan" value={day} onChange={(n) => setDraft({ credit, day: n })} min={1} max={31} hint="Tanggal kredit bulanan diperbarui" />
          </div>
          <p className="text-xs text-slate-500">
            Tanggalnya terlihat di Claude Console → Billing (tanggal kedaluwarsa kredit bulanan). Tanggal 29–31 berarti hari terakhir untuk
            bulan yang lebih pendek.
          </p>
          <Button type="submit" loading={saving} disabled={!changed}>
            Simpan
          </Button>
        </form>

        {!notDeployed && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-sm font-medium text-slate-900">Scan terakhir</p>
            {usage.isPending ? (
              <LoadingState />
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada scan sejak {formatDate(cycle.previousStart)}.</p>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {visible.map((row) => (
                    <li key={row.id} className="py-2" data-testid="scan-usage-row">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-sm text-slate-800">
                          {row.outcome === 'ok' ? (
                            <>
                              {row.lines ?? 0} baris · {row.kind ? KIND_LABEL[row.kind] : '–'}
                            </>
                          ) : (
                            <Badge tone="warning">{OUTCOME_LABEL[row.outcome]}</Badge>
                          )}
                          {fellBack(row) && (
                            <Badge tone="info" className="ml-1.5">
                              Model cadangan
                            </Badge>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatUsd(costMicros(row.cost_usd) / 1_000_000, 4)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        <span className="break-all">{row.user_id ? actorLabel(row.user_id, emails) : FORMER_MEMBER_ACTOR}</span> · {formatDateTime(row.created_at)} · {row.model}
                      </p>
                    </li>
                  ))}
                </ul>
                {rows.length > shown && (
                  <Button variant="outline" fullWidth onClick={() => setShown((n) => n + PAGE)}>
                    Lihat lainnya ({Math.min(PAGE, rows.length - shown)})
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
