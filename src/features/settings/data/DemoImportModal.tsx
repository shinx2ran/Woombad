import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Smartphone } from 'lucide-react'
import { Badge, Button, LoadingState, Modal } from '../../../components/ui'
import { readDeviceData } from '../../../components/deviceData'
import { useOrg } from '../../../hooks/useOrg'
import { translateDbError } from '../../../lib/repo/supabaseRepo'
import { formatDateTime } from '../../../lib/format'
import { BackupFileError, TABLE_LABEL, parseBackupText, type ParsedBackup } from './backupFormat'
import {
  IMPORT_ORDER,
  SKIP_REASONS,
  SKIP_REASON_LABEL,
  defaultSelection,
  emptySkipped,
  planDemoImport,
  plannedCount,
  previewBackup,
  sampleOutsideKosCount,
  skippedByReason,
  skippedCount,
  type BackupPreview,
  type ExistingOnline,
  type ImportSelection,
  type KosPreview,
  type SampleOutsideKos,
  type SkipReason,
} from './demoImport'
import { fetchExistingOnline } from './orgData'
import { importedCount, runImportPlan, type ImportProgress, type ImportResult } from './runImport'

const noop = () => {}

type Step =
  | { kind: 'source' }
  | { kind: 'checking' }
  | { kind: 'preview'; backup: ParsedBackup; existing: ExistingOnline; preview: BackupPreview }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'done'; result: ImportResult }

const kosCounts = (p: KosPreview) =>
  `${p.rooms} kamar · ${p.tenants} penyewa · ${p.leases} sewa · ${p.invoices} tagihan · ${p.payments} pembayaran · ${p.expenses} pengeluaran`

const sampleCounts = (s: SampleOutsideKos) =>
  [
    s.expenses > 0 && `${s.expenses} pengeluaran bersama`,
    s.addons > 0 && `${s.addons} add-on`,
    s.tenants > 0 && `${s.tenants} penyewa tanpa kos`,
  ]
    .filter(Boolean)
    .join(' · ')

function reasonsText(skipped: Record<SkipReason, number>): string {
  return SKIP_REASONS.filter((r) => skipped[r] > 0)
    .map((r) => `${SKIP_REASON_LABEL[r]}: ${skipped[r]}`)
    .join(', ')
}

/** Mode Demo data left on this device (the same address used to run without Supabase). */
function readDeviceBackup(): ParsedBackup | null {
  const raw = readDeviceData()
  if (!raw) return null
  try {
    const backup = parseBackupText(raw)
    return backup.tables.properties.length > 0 || backup.tables.expenses.length > 0 ? backup : null
  } catch {
    return null
  }
}

/** "Impor dari Mode Demo": choose a source, preview per kos, pick kos, import, show the result. */
export function DemoImportModal({ onClose }: { onClose: () => void }) {
  const { repo } = useOrg()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'source' })
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ImportSelection>({ propertyIds: [], includeShared: false, includeSample: false })
  const [deviceBackup] = useState(readDeviceBackup)

  const plan = useMemo(
    () => (step.kind === 'preview' ? planDemoImport(step.backup, selection, step.existing) : null),
    [step, selection],
  )

  const choose = async (backup: ParsedBackup) => {
    setError(null)
    setStep({ kind: 'checking' })
    try {
      const existing = await fetchExistingOnline(repo)
      const preview = previewBackup(backup, existing)
      setSelection(defaultSelection(preview))
      setStep({ kind: 'preview', backup, existing, preview })
    } catch (err) {
      setError(err instanceof Error ? translateDbError(err.message) : 'Gagal memeriksa data online.')
      setStep({ kind: 'source' })
    }
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await choose(parseBackupText(await file.text()))
    } catch (err) {
      setError(err instanceof BackupFileError ? err.message : 'File tidak bisa dibaca.')
    }
  }

  const run = async () => {
    if (!plan) return
    setStep({ kind: 'running', progress: null })
    let result: ImportResult
    try {
      result = await runImportPlan(plan, (table, rows) => repo.insertMany(table, rows as never), {
        onProgress: (progress) => setStep({ kind: 'running', progress }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impor gagal.')
      setStep({ kind: 'source' })
      return
    } finally {
      await qc.invalidateQueries()
    }
    setStep({ kind: 'done', result })
  }

  const busy = step.kind === 'checking' || step.kind === 'running'
  const sampleOutside = step.kind === 'preview' ? sampleOutsideKosCount(step.preview) : 0
  const total = plan ? plannedCount(plan) : 0
  const planSkipped = plan ? skippedByReason(plan) : emptySkipped()

  const toggleKos = (id: string, checked: boolean) =>
    setSelection((s) => ({ ...s, propertyIds: checked ? [...s.propertyIds, id] : s.propertyIds.filter((p) => p !== id) }))

  const footer =
    step.kind === 'source' ? (
      <Button variant="ghost" onClick={onClose}>
        Batal
      </Button>
    ) : step.kind === 'preview' ? (
      <>
        <Button variant="ghost" onClick={() => setStep({ kind: 'source' })}>
          Kembali
        </Button>
        <Button onClick={run} disabled={total === 0}>
          Impor {total} data
        </Button>
      </>
    ) : step.kind === 'done' ? (
      <Button onClick={onClose}>Selesai</Button>
    ) : undefined

  return (
    <Modal open onClose={busy ? noop : onClose} title="Impor dari Mode Demo" footer={footer}>
      {step.kind === 'source' && (
        <div className="space-y-3 text-sm text-slate-700">
          <p>Pindahkan kos, kamar, penyewa, sewa, tagihan, pembayaran, dan pengeluaran dari Mode Demo ke akun online ini.</p>
          {deviceBackup && (
            <button
              type="button"
              onClick={() => void choose(deviceBackup)}
              className="flex w-full items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-left hover:bg-brand-100"
            >
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
              <span>
                <span className="block font-medium text-slate-900">Pakai data Mode Demo di perangkat ini</span>
                <span className="block text-xs text-slate-600">
                  {deviceBackup.orgName ?? 'Tanpa nama'} · {deviceBackup.tables.properties.length} kos
                </span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-start gap-3 rounded-lg border border-slate-300 p-3 text-left hover:bg-slate-50"
          >
            <FileUp className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
            <span>
              <span className="block font-medium text-slate-900">Pilih file cadangan</span>
              <span className="block text-xs text-slate-600">File dari "Unduh cadangan JSON" di Mode Demo (woombad-cadangan-….json)</span>
            </span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</p>}
        </div>
      )}

      {step.kind === 'checking' && <LoadingState label="Memeriksa data online…" />}

      {step.kind === 'preview' && plan && (
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Dari: <strong>{step.backup.orgName ?? 'Mode Demo'}</strong>
            {step.backup.exportedAt && <> · dicadangkan {formatDateTime(step.backup.exportedAt)}</>}
          </p>
          {(step.preview.properties.some((p) => p.sample) || sampleOutside > 0) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              Data bertanda <strong>Contoh</strong> adalah data contoh Mode Demo dan tidak dicentang
              {sampleOutside > 0 && ', termasuk pengeluaran bersama dan add-on contoh'}. Centang hanya bila memang milik Anda.
            </p>
          )}
          {step.preview.properties.length === 0 && <p className="text-slate-500">Tidak ada kos di file ini.</p>}
          <ul className="space-y-2">
            {step.preview.properties.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
                    checked={selection.propertyIds.includes(p.id)}
                    onChange={(e) => toggleKos(p.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      {p.sample && <Badge tone="warning">Contoh</Badge>}
                      {p.alreadyOnline && <Badge tone="info">Sudah pernah diimpor</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{kosCounts(p)}</span>
                  </span>
                </label>
              </li>
            ))}
            {step.preview.sharedExpenses > 0 && (
              <li>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
                    checked={selection.includeShared}
                    onChange={(e) => setSelection((s) => ({ ...s, includeShared: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">Pengeluaran bersama (tanpa kos)</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{step.preview.sharedExpenses} pengeluaran</span>
                  </span>
                </label>
              </li>
            )}
            {sampleOutside > 0 && (
              <li>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
                    checked={selection.includeSample === true}
                    onChange={(e) => setSelection((s) => ({ ...s, includeSample: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">Data contoh tanpa kos</span>
                      <Badge tone="warning">Contoh</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{sampleCounts(step.preview.sample)}</span>
                  </span>
                </label>
              </li>
            )}
          </ul>

          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p>
              Akan diimpor: <strong>{total} data</strong>
            </p>
            {total > 0 && (
              <p className="text-xs text-slate-500">
                {IMPORT_ORDER.filter((t) => plan.tables[t].rows.length > 0)
                  .map((t) => `${plan.tables[t].rows.length} ${TABLE_LABEL[t].toLowerCase()}`)
                  .join(' · ')}
              </p>
            )}
            {skippedCount(planSkipped) > 0 && (
              <p className="text-xs text-slate-500">
                Dilewati {skippedCount(planSkipped)}: {reasonsText(planSkipped)}
              </p>
            )}
          </div>
          <p className="text-xs text-slate-500">Foto KTP dan struk tidak ikut. Status tagihan dihitung ulang dari pembayaran.</p>
        </div>
      )}

      {step.kind === 'running' && (
        <div className="space-y-3 py-4 text-sm text-slate-700">
          <p>
            Mengimpor{step.progress ? ` ${TABLE_LABEL[step.progress.table].toLowerCase()}` : ''}… Jangan tutup aplikasi.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${step.progress && step.progress.total > 0 ? Math.round((step.progress.done / step.progress.total) * 100) : 0}%` }}
            />
          </div>
          {step.progress && (
            <p className="text-xs text-slate-500">
              {step.progress.done} / {step.progress.total} data
            </p>
          )}
        </div>
      )}

      {step.kind === 'done' && <ImportResultView result={step.result} />}
    </Modal>
  )
}

function ImportResultView({ result }: { result: ImportResult }) {
  const rows = IMPORT_ORDER.map((t) => ({ table: t, ...result.tables[t], skippedTotal: skippedCount(result.tables[t].skipped) })).filter(
    (r) => r.imported + r.skippedTotal + r.failed > 0,
  )
  const allSkipped = emptySkipped()
  for (const r of rows) for (const reason of SKIP_REASONS) allSkipped[reason] += r.skipped[reason]
  const failed = rows.filter((r) => r.failed > 0)

  return (
    <div className="space-y-3 text-sm text-slate-700">
      <p className="font-medium text-slate-900">
        {result.error ? 'Impor terhenti.' : 'Impor selesai.'} {importedCount(result)} data masuk.
      </p>
      {result.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
          <p>{result.error}</p>
          <p className="mt-1 text-xs">Data yang sudah masuk aman. Jalankan impor lagi; data yang sudah ada akan dilewati.</p>
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 font-medium">Data</th>
              <th className="py-1 text-right font-medium">Masuk</th>
              <th className="py-1 text-right font-medium">Dilewati</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.table}>
                <td className="py-1.5">{TABLE_LABEL[r.table]}</td>
                <td className="py-1.5 text-right tabular-nums">{r.imported}</td>
                <td className="py-1.5 text-right tabular-nums">{r.skippedTotal + r.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {skippedCount(allSkipped) > 0 && <p className="text-xs text-slate-500">Dilewati karena {reasonsText(allSkipped)}.</p>}
      {failed.map((r) => (
        <p key={r.table} className="text-xs text-red-700">
          {TABLE_LABEL[r.table]}: {r.failed} ditolak server ({r.firstError})
        </p>
      ))}
      {result.renumberedInvoices > 0 && (
        <p className="text-xs text-slate-500">
          {result.renumberedInvoices} nomor tagihan sudah dipakai, jadi diberi nomor baru. Nomor lama dicatat di catatan tagihan.
        </p>
      )}
    </div>
  )
}
