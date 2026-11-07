import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, Camera, CheckCircle2, Loader2, Pencil } from 'lucide-react'
import { Button, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { formatDate, formatRupiah, formatUsd, todayISO } from '../../lib/format'
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from '../../types/db'
import { ORDERED_CATEGORIES, SHARED_VALUE, canEditExpenses, isRefundCategory, saveErrorMessage } from './expenseUtils'
import { saveScannedExpenses } from './saveExpense'
import {
  DEMO_SCAN_RESULT,
  DEMO_SCAN_USAGE,
  ScanRequestError,
  buildScanRows,
  prepareScanImage,
  requestScan,
  scanRowError,
  scanTotalCheck,
  scannedExpenseDrafts,
  totalToCheck,
  type PreparedScanImage,
  type ScanCostReply,
  type ScanReply,
  type ScanResult,
  type ScanRow,
} from './scanNota'

/** a scan only produces operating costs; refunds need a lease and are recorded in the normal form */
const SCAN_CATEGORY_OPTIONS = ORDERED_CATEGORIES.filter((c) => !isRefundCategory(c)).map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }))

type Step = 'pick' | 'reading' | 'review'

interface RowCardProps {
  row: ScanRow
  error: string | null
  expanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<ScanRow>) => void
}

function ScanRowCard({ row, error, expanded, onToggle, onChange }: RowCardProps) {
  return (
    <li
      data-testid="scan-row"
      className={clsx(
        'rounded-lg border p-3',
        !row.include ? 'border-slate-200 bg-slate-50' : error ? 'border-red-300 bg-white' : row.unclear ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          checked={row.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Simpan baris ${row.description || 'tanpa keterangan'}`}
        />
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={clsx('min-w-0 flex-1 text-left', !row.include && 'opacity-60')}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-slate-900">{row.description || 'Tanpa keterangan'}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-900">
              {formatRupiah(row.amount)}
              <Pencil className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {row.date ? formatDate(row.date) : 'Tanggal belum terbaca'} · {EXPENSE_CATEGORY_LABEL[row.category]}
          </span>
          {(row.unclear || row.duplicateOf || row.monthGuessed) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {row.unclear && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Periksa: tulisan kurang jelas</span>}
              {row.duplicateOf && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Mungkin sudah tercatat</span>}
              {row.monthGuessed && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Bulan diperkirakan</span>}
            </span>
          )}
        </button>
      </div>
      {error && <p className="mt-1 pl-8 text-xs font-medium text-red-700">{error}</p>}
      {expanded && (
        <div className="mt-3 grid gap-3 pl-8">
          <Input
            label="Tanggal"
            type="date"
            value={row.date}
            onChange={(e) => onChange({ date: e.target.value, monthGuessed: false })}
            hint={row.monthGuessed ? `Bulan tidak tertulis: diisi ${row.date ? formatDate(row.date, 'MMMM yyyy') : 'perkiraan'}. Periksa.` : undefined}
          />
          <Input label="Keterangan" value={row.description} onChange={(e) => onChange({ description: e.target.value })} />
          <MoneyInput label="Jumlah" value={row.amount} onChange={(v) => onChange({ amount: v })} min={0} />
          <Select label="Kategori" value={row.category} onChange={(e) => onChange({ category: e.target.value as ExpenseCategory })} options={SCAN_CATEGORY_OPTIONS} />
          <Input label="Vendor / penerima" value={row.vendor} onChange={(e) => onChange({ vendor: e.target.value })} placeholder="opsional" />
          {row.writtenText && <p className="text-xs text-slate-500">Terbaca di foto: &ldquo;{row.writtenText}&rdquo;</p>}
        </div>
      )}
    </li>
  )
}

const demoScan = () =>
  new Promise<ScanReply>((resolve) => setTimeout(() => resolve({ result: DEMO_SCAN_RESULT, cost: { cost_usd: DEMO_SCAN_USAGE.cost_usd, fell_back: false } }), 400))

/**
 * Scan nota (SPEC 7.16): photograph a shop receipt or a handwritten page of expenses; the lines are read (Edge
 * Function "scan-nota", Claude) and shown for checking. Nothing is written until "Simpan": then one expense per ticked
 * line, all with the same kos, sharing the photo as their receipt. Mode Demo shows a made-up sample instead of
 * reading the photo, and says so.
 */
export function ScanNotaModal({ onClose, onSaved }: { onClose: () => void; onSaved?: (date: string) => void }) {
  const { org, repo, role, properties, selectedPropertyId, isLocalMode } = useOrg()
  const { session } = useAuth()
  const invalidate = useInvalidate()
  const toast = useToast()

  const [step, setStep] = useState<Step>('pick')
  const [error, setError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<PreparedScanImage | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  /** what the scan shown cost (SPEC 7.17); null from an older function */
  const [cost, setCost] = useState<ScanCostReply | null>(null)
  const [rows, setRows] = useState<ScanRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // the global kos filter when it is one kos, the only kos when there is one, else an explicit choice
  const [property, setProperty] = useState(() => (selectedPropertyId !== 'all' ? selectedPropertyId : properties.length === 1 ? properties[0].id : ''))
  const [attachPhoto, setAttachPhoto] = useState(true)
  /** the recorded expenses could not be read, so no line could be checked against them */
  const [duplicatesUnchecked, setDuplicatesUnchecked] = useState(false)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  // a photo picked again, or the sheet closed, makes an earlier reading's late answer void
  const attempt = useRef(0)

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo.file) : null), [photo])
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])
  useEffect(() => {
    return () => {
      attempt.current += 1
    }
  }, [])

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const picked = input.files?.[0]
    input.value = ''
    if (!picked) return
    const id = ++attempt.current
    setError(null)
    setStep('reading')
    try {
      const prepared = await prepareScanImage(picked)
      if (id !== attempt.current) return
      const reply = isLocalMode ? await demoScan() : await requestScan(org.id, prepared)
      // a reading is billed even when its answer is no longer wanted: the server records it; Mode Demo writes a sample
      if (isLocalMode) {
        await repo
          .insert('scan_usage', {
            user_id: session?.user.id ?? null,
            ...DEMO_SCAN_USAGE,
            outcome: 'ok',
            kind: reply.result.kind,
            lines: reply.result.items.length,
            attempts: [],
          })
          .catch(() => undefined)
      }
      void invalidate('scan_usage')
      if (id !== attempt.current) return
      const scanned = reply.result
      // the expenses as recorded now (another phone may have saved some meanwhile), for "mungkin sudah tercatat"
      const existing = await repo.list('expenses').catch(() => null)
      if (id !== attempt.current) return
      const built = buildScanRows(scanned, todayISO(), existing ?? [])
      // the earlier result stays until a new one is complete ("Kembali ke hasil" after a failed re-take)
      setPhoto(prepared)
      setDuplicatesUnchecked(existing === null)
      setTouched(false)
      setResult(scanned)
      setCost(reply.cost)
      setRows(built)
      // what needs a look starts open
      setExpanded(new Set(built.filter((r) => r.unclear || scanRowError(r)).map((r) => r.key)))
      setStep('review')
    } catch (err) {
      if (id !== attempt.current) return
      setError(err instanceof ScanRequestError ? err.message : 'Foto tidak dapat dibaca. Coba lagi.')
      setStep('pick')
    }
  }

  const updateRow = (key: string, patch: Partial<ScanRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // a handwritten list's own total is a real check; a receipt's total is the same number read once, so it proves nothing
  const check = scanTotalCheck(rows, result ? totalToCheck(result) : null)
  const included = rows.filter((r) => r.include)
  const includedSum = included.reduce((sum, r) => sum + r.amount, 0)
  const errorOf = (r: ScanRow) => (r.include && touched ? scanRowError(r) : null)

  const save = async () => {
    setTouched(true)
    const invalid = included.filter((r) => scanRowError(r))
    if (!property || invalid.length > 0) {
      if (invalid.length > 0) setExpanded((prev) => new Set([...prev, ...invalid.map((r) => r.key)]))
      toast.error(!property ? 'Pilih kos untuk pengeluaran ini.' : 'Lengkapi baris yang ditandai merah, atau hapus centangnya.')
      return
    }
    setSaving(true)
    try {
      const drafts = scannedExpenseDrafts(rows, property === SHARED_VALUE ? null : property)
      const { count, receiptWarning } = await saveScannedExpenses(repo, {
        drafts,
        file: attachPhoto && !isLocalMode ? photo?.file : null,
        canEdit: canEditExpenses(role),
      })
      await invalidate('expenses')
      if (receiptWarning) toast.error(receiptWarning)
      else toast.success(`${count} pengeluaran dicatat dari scan nota.`)
      // show the month of the scanned lines (the latest one)
      onSaved?.(drafts.map((d) => d.expense_date).sort().at(-1)!)
      onClose()
    } catch (err) {
      toast.error(saveErrorMessage(err, 'Gagal menyimpan pengeluaran.'))
    } finally {
      setSaving(false)
    }
  }

  const propertyOptions = [{ value: SHARED_VALUE, label: 'Bersama (semua kos)' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]

  return (
    <Modal
      open
      onClose={onClose}
      title="Scan nota"
      footer={
        step === 'review' && rows.length > 0 ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button onClick={save} loading={saving} disabled={included.length === 0}>
              {included.length === 0 ? 'Tidak ada yang dipilih' : `Simpan ${included.length} pengeluaran`}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
        )
      }
    >
      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Foto nota toko atau halaman catatan pengeluaran. Tanggal, keterangan, dan jumlahnya dibaca otomatis; Anda periksa dulu sebelum disimpan.
          </p>
          <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-base font-medium text-white hover:bg-brand-800">
            <Camera className="h-5 w-5" aria-hidden />
            {photo ? 'Foto ulang' : 'Ambil / pilih foto'}
            <input type="file" accept="image/*" className="sr-only" onChange={onPick} data-testid="scan-input" />
          </label>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
            <li>Satu halaman atau satu nota per foto.</li>
            <li>Foto lurus dari atas, terang, semua angka terlihat.</li>
          </ul>
          {result && rows.length > 0 && (
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                setError(null)
                setStep('review')
              }}
            >
              Kembali ke hasil sebelumnya
            </Button>
          )}
          {isLocalMode && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Mode Demo: foto tidak dikirim ke mana pun; yang tampil adalah contoh hasil scan.
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </div>
      )}

      {step === 'reading' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-brand-700" aria-hidden />
          <p className="text-sm font-medium text-slate-800">Membaca foto…</p>
          <p className="text-xs text-slate-500">Biasanya 10–30 detik. Jangan tutup layar ini.</p>
        </div>
      )}

      {step === 'review' && result && (
        <div className="space-y-4">
          {isLocalMode && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="scan-demo-note">
              Mode Demo: ini contoh hasil scan (data rekaan), bukan isi foto Anda. Di Mode Online foto Anda dibaca otomatis.
            </p>
          )}
          <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3" data-testid="scan-summary">
            {photoUrl && <img src={photoUrl} alt="Foto yang dibaca" className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-cover" />}
            <div className="min-w-0 space-y-1 text-sm">
              <p className="text-slate-800">
                <strong>{rows.length} baris terbaca</strong> · jumlah {formatRupiah(check.sum)}
              </p>
              {check.writtenTotal !== null &&
                (check.difference === 0 ? (
                  <p className="flex items-start gap-1.5 text-emerald-700" data-testid="scan-total-ok">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Sama dengan total di kertas ({formatRupiah(check.writtenTotal)}).
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-amber-800" data-testid="scan-total-mismatch">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Total di kertas {formatRupiah(check.writtenTotal)}, jumlah baris {formatRupiah(check.sum)}: selisih {formatRupiah(Math.abs(check.difference))}.
                    Periksa angka yang ditandai.
                  </p>
                ))}
              {result.kind === 'receipt' && rows.length > 0 && <p className="text-xs text-slate-600">Cocokkan jumlahnya dengan total di nota.</p>}
              {result.notes && <p className="text-xs text-slate-600">{result.notes}</p>}
              {rows.length > 0 && (
                <p className="text-slate-700" data-testid="scan-included">
                  Dicentang: {included.length} baris · {formatRupiah(includedSum)}
                </p>
              )}
              {duplicatesUnchecked && (
                <p className="text-xs text-amber-800">Daftar pengeluaran belum termuat: periksa sendiri apakah baris ini sudah tercatat.</p>
              )}
              {cost && canEditExpenses(role) && (
                <p className="text-xs text-slate-500" data-testid="scan-cost">
                  Biaya scan ini: {formatUsd(cost.cost_usd, 4)}
                  {isLocalMode && ' (contoh)'}
                  {cost.fell_back && ' · termasuk model cadangan'}
                </p>
              )}
              {rows.length > 0 && (
                <button type="button" onClick={() => setStep('pick')} disabled={saving} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                  <Camera className="h-4 w-4" aria-hidden /> Foto ulang
                </button>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p>Tidak ada pengeluaran yang terbaca dari foto ini.</p>
              <Button variant="outline" icon={<Camera className="h-4 w-4" />} onClick={() => setStep('pick')}>
                Foto ulang
              </Button>
            </div>
          ) : (
            <>
              <Select
                label="Kos"
                required
                value={property}
                onChange={(e) => setProperty(e.target.value)}
                options={propertyOptions}
                placeholder="— Pilih kos —"
                error={touched && !property ? 'Pilih kos.' : undefined}
                hint="Berlaku untuk semua baris di bawah."
              />
              <ul className="space-y-2">
                {rows.map((row) => (
                  <ScanRowCard
                    key={row.key}
                    row={row}
                    error={errorOf(row)}
                    expanded={expanded.has(row.key)}
                    onToggle={() => toggle(row.key)}
                    onChange={(patch) => updateRow(row.key, patch)}
                  />
                ))}
              </ul>
              {!isLocalMode && photo && (
                <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-700" checked={attachPhoto} onChange={(e) => setAttachPhoto(e.target.checked)} />
                  Simpan foto ini sebagai bukti di setiap baris
                </label>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
