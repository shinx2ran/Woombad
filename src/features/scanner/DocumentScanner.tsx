import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { BookUser, Camera, Check, FileQuestionMark, IdCard, Keyboard, RefreshCw, ScanLine, ShieldAlert, ShieldCheck, Smartphone, Sparkles, Upload, WifiOff } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Button, useToast } from '../../components/ui'
import { formatUsd } from '../../lib/format'
import { ID_TYPE_LABEL } from '../../types/db'
import { demoClaudeScan, recognizeDocumentWithClaude } from './claudeScan'
import { effectiveEngine, OFFLINE_ENGINE_NOTICE, SCAN_ENGINE_DESCRIPTION, SCAN_ENGINE_LABEL, SCAN_ENGINES, type ScanEngine } from './engine'
import { hasOcrDataCached, recognizeDocument, ScanAbortedError, type DocumentScanResult, type OcrProgress } from './ocr'
import { diffScanPrefill, displayPrefillValue, idTypeChange, lockIdentityRows, selectedPrefill, type IdTypeChange, type PrefillDiff } from './prefill'
import { DOCUMENT_KIND_LABEL, type ScanPrefill, type ScanPrefillKey } from './types'
import { useScanEngine } from './useScanEngine'

type ScanState =
  | { status: 'idle' }
  | { status: 'running'; progress: OcrProgress }
  | { status: 'review'; result: DocumentScanResult; previewUrl: string }

const DOWNLOAD_NOTICE = 'Mengunduh data OCR ±15 MB, hanya sekali.'
const PHONE_NOTICE = 'Nomor HP tidak ada di KTP/paspor, isi manual.'
export const UNKNOWN_DOCUMENT_NOTICE = 'Dokumen tidak dikenali, coba foto lebih jelas.'
export const PASSPORT_NUMBER_OK = 'Nomor paspor terverifikasi'
export const PASSPORT_NUMBER_CHECK = 'Periksa nomor paspor'
export const PASSPORT_NUMBER_MISMATCH = 'Digit kontrol tidak cocok, bandingkan dengan paspor.'
/** SPEC 7.19: Mode Demo has no server, the review shows a made-up card */
export const CLAUDE_DEMO_NOTICE = 'Mode Demo: contoh hasil Claude, foto tidak dibaca.'
/** on a review row Claude marked as unsure */
export const UNSURE_NOTICE = 'Claude kurang yakin, periksa.'
const ENGINE_ICON: Record<ScanEngine, typeof Sparkles> = { claude: Sparkles, tesseract: Smartphone }

/** 'KTP → Paspor (NIK 3273… akan dihapus)' */
export function describeIdTypeChange(change: IdTypeChange): string {
  const base = `${ID_TYPE_LABEL[change.from]} → ${ID_TYPE_LABEL[change.to]}`
  return change.dropped ? `${base} (${change.dropped.label} ${change.dropped.value} akan dihapus)` : base
}

export interface DocumentScannerProps {
  /** receives the accepted values (always with `id_type`) and the preprocessed JPEG (null when none) */
  onApply: (prefill: ScanPrefill, image: Blob | null) => void
  /** "Isi manual" / close without applying */
  onCancel?: () => void
  /** open the camera picker right away (check-in shortcut) */
  autoStart?: boolean
  /** what the form holds now, so typed values are never overwritten silently */
  current?: Partial<ScanPrefill>
}

function ConfidenceBadge({ kind, confidence, ocr, engine }: { kind: DocumentScanResult['kind']; confidence: number; ocr: number | null; engine: ScanEngine }) {
  const pct = Math.round(confidence * 100)
  const tone = confidence >= 0.8 ? 'success' : confidence >= 0.4 ? 'warning' : 'danger'
  const label = confidence >= 0.8 ? 'Keyakinan tinggi' : confidence >= 0.4 ? 'Keyakinan sedang' : 'Keyakinan rendah'
  // Claude reports which fields it was unsure of, not MRZ check digits
  const detail = engine === 'claude' ? `${pct}% data utama terbaca dengan yakin` : kind === 'passport' ? `${pct}% digit kontrol MRZ cocok` : `${pct}% data utama terbaca`
  return (
    <span title={ocr === null ? detail : `${detail}; akurasi teks OCR ${ocr}%`}>
      <Badge tone={tone}>
        {label} · {pct}%
      </Badge>
    </span>
  )
}

function KindBadge({ kind }: { kind: DocumentScanResult['kind'] }) {
  const Icon = kind === 'passport' ? BookUser : kind === 'ktp' ? IdCard : FileQuestionMark
  return (
    <Badge tone={kind === 'unknown' ? 'danger' : 'brand'}>
      <Icon className="mr-1 h-3 w-3" aria-hidden />
      {kind === 'unknown' ? 'Dokumen tidak dikenali' : `Terdeteksi: ${DOCUMENT_KIND_LABEL[kind]}`}
    </Badge>
  )
}

/**
 * Shared "Scan KTP / Paspor" panel (SPEC 5.3). Picks a photo (camera on phones, drag & drop on desktop),
 * reads it with Claude (the scan-ktp function) or on the device (tesseract.js) per the organisation's default and a
 * per-scan switch (SPEC 7.19; offline always on the device, except Mode Demo's Claude sample, which needs no network),
 * auto-detects KTP vs passport and shows the detected
 * fields as a checklist so the user decides which values to apply. Never overwrites typed data silently: fields that
 * already hold a different value start unchecked. The diff is derived from the *latest* `current` values (also text
 * typed while the scan was running), while the user's manual check/uncheck choices are kept separately.
 */
export function DocumentScanner({ onApply, onCancel, autoStart = false, current }: DocumentScannerProps) {
  const toast = useToast()
  const ctx = useScanEngine()
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  /** the reader picked for this panel; null = the organisation's default */
  const [chosenEngine, setChosenEngine] = useState<ScanEngine | null>(null)
  const chosen = chosenEngine ?? ctx.defaultEngine
  // Mode Demo's Claude is a sample that needs no network (the on-device reader would need its download)
  const { engine, fallback } = effectiveEngine(chosen, ctx.online || ctx.isLocalMode)
  const [dragging, setDragging] = useState(false)
  /** manual checkbox overrides, keyed by field; anything not here follows the diff default */
  const [overrides, setOverrides] = useState<Partial<Record<ScanPrefillKey, boolean>>>({})
  /** manual choice for the identity-type switch (undefined = follow idTypeChange's default) */
  const [typeOverride, setTypeOverride] = useState<boolean | undefined>(undefined)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)
  /** the running scan; aborted on unmount or when a new scan starts so the OCR worker stops */
  const scanRef = useRef<AbortController | null>(null)
  const firstRun = engine === 'tesseract' && !hasOcrDataCached()

  // On unmount: stop a running OCR (worker + downloads) and release the preview object URL.
  useEffect(
    () => () => {
      scanRef.current?.abort()
      scanRef.current = null
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    },
    [],
  )

  // Check-in shortcut: open the camera picker as soon as the panel mounts (browsers may ignore it without a
  // recent tap; the buttons stay available either way).
  useEffect(() => {
    if (autoStart) cameraRef.current?.click()
  }, [autoStart])

  const start = async (file: File | Blob) => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    scanRef.current?.abort()
    const controller = new AbortController()
    scanRef.current = controller
    setOverrides({})
    setTypeOverride(undefined)
    setState({ status: 'running', progress: { phase: 'preprocess', percent: 0, status: 'Memulai…', downloading: false } })
    const onProgress = (progress: OcrProgress) => {
      if (!controller.signal.aborted) setState({ status: 'running', progress })
    }
    try {
      const result =
        engine === 'claude'
          ? ctx.isLocalMode
            ? await demoClaudeScan(file, onProgress, controller.signal)
            : await recognizeDocumentWithClaude(file, ctx.orgId, onProgress, controller.signal)
          : await recognizeDocument(file, onProgress, controller.signal)
      // Closed (unmounted) or superseded while the scan ran: no preview URL, no state update.
      if (controller.signal.aborted) return
      if (result.engine === 'claude') void ctx.recordClaudeScan(result)
      const previewUrl = URL.createObjectURL(result.image)
      previewRef.current = previewUrl
      setState({ status: 'review', result, previewUrl })
      if (result.kind === 'unknown') toast.error(UNKNOWN_DOCUMENT_NOTICE)
    } catch (err) {
      if (controller.signal.aborted || err instanceof ScanAbortedError) return
      toast.error(err instanceof Error ? err.message : 'Scan dokumen gagal.')
      setState({ status: 'idle' })
    } finally {
      if (scanRef.current === controller) scanRef.current = null
    }
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void start(file)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void start(file)
  }

  // Always compare against the form values as they are *now*, so text typed while the scan was running
  // (or while reviewing) is never overwritten by default.
  // A scan of another document type than the form holds (KTP -> Paspor …) is a reviewable row of its own:
  // unchecked by default when switching would drop a number the form holds.
  const typeChange = useMemo<IdTypeChange | null>(() => {
    if (state.status !== 'review' || state.result.kind === 'unknown') return null
    const change = idTypeChange(state.result.prefill, current)
    return change && typeOverride !== undefined ? { ...change, apply: typeOverride } : change
  }, [state, current, typeOverride])

  const diff = useMemo<(PrefillDiff & { locked: boolean })[]>(() => {
    if (state.status !== 'review') return []
    const rows = diffScanPrefill(state.result.prefill, current).map((d) => {
      const override = overrides[d.key]
      return override === undefined ? d : { ...d, apply: override }
    })
    return lockIdentityRows(state.result.prefill, rows, typeChange)
  }, [state, current, overrides, typeChange])

  const toggle = (key: ScanPrefillKey) => {
    const entry = diff.find((d) => d.key === key)
    if (!entry || entry.locked) return
    setOverrides((prev) => ({ ...prev, [key]: !entry.apply }))
  }

  const reset = () => {
    setOverrides({})
    setTypeOverride(undefined)
    setState({ status: 'idle' })
  }

  const apply = () => {
    if (state.status !== 'review') return
    const applied = diff.filter((d) => d.apply).length + (typeChange?.apply ? 1 : 0)
    const label = DOCUMENT_KIND_LABEL[state.result.kind]
    onApply(selectedPrefill(state.result.prefill, diff, typeChange), state.result.image)
    toast.success(applied > 0 ? `${applied} data dari ${label} diterapkan ke formulir.` : 'Foto dokumen disimpan, tidak ada data yang diubah.')
    reset()
  }

  const manual = () => {
    reset()
    onCancel?.()
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-sm" data-testid="document-scanner">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} data-testid="scanner-camera-input" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} data-testid="scanner-file-input" />

      {state.status === 'idle' && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx(
            'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-3 py-5 text-center transition-colors',
            dragging ? 'border-brand-500 bg-brand-100/60' : 'border-brand-300 bg-white',
          )}
        >
          <ScanLine className="h-8 w-8 text-brand-600" aria-hidden />
          <div>
            <p className="font-medium text-slate-900">Foto KTP atau paspor akan dibaca otomatis</p>
            <p className="text-xs text-slate-500">
              Letakkan dokumen di permukaan rata dengan cahaya cukup, lalu foto dari atas. Untuk paspor, pastikan dua baris kode di bawah halaman data ikut terfoto.
              Di komputer, seret gambar ke sini.
            </p>
          </div>
          <div className="w-full space-y-1.5 text-left">
            <div role="radiogroup" aria-label="Pembaca dokumen" className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1 text-sm" data-testid="scanner-engine">
              {SCAN_ENGINES.map((e) => {
                const Icon = ENGINE_ICON[e]
                const selected = e === chosen
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChosenEngine(e)}
                    className={clsx(
                      'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-colors',
                      selected ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {SCAN_ENGINE_LABEL[e]}
                  </button>
                )
              })}
            </div>
            {fallback === 'offline' ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700" data-testid="scanner-engine-note">
                <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {OFFLINE_ENGINE_NOTICE}
              </p>
            ) : (
              <p className="text-xs text-slate-500" data-testid="scanner-engine-note">
                {SCAN_ENGINE_DESCRIPTION[engine]}
                {engine === 'claude' && ctx.isLocalMode && ' Mode Demo: contoh hasil, foto tidak dikirim.'}
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button type="button" icon={<Camera className="h-4 w-4" />} onClick={() => cameraRef.current?.click()}>
              Ambil foto
            </Button>
            <Button type="button" variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              Pilih gambar
            </Button>
          </div>
          <ul className="space-y-0.5 text-xs text-slate-500">
            {firstRun && <li>{DOWNLOAD_NOTICE}</li>}
            <li>{PHONE_NOTICE}</li>
          </ul>
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" icon={<Keyboard className="h-4 w-4" />} onClick={manual}>
              Isi manual tanpa scan
            </Button>
          )}
        </div>
      )}

      {state.status === 'running' && (
        <div className="space-y-2 rounded-lg bg-white p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-900">{state.progress.status}</span>
            <span className="tabular-nums text-slate-600">{Math.round(state.progress.percent)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden>
            <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.round(state.progress.percent)}%` }} />
          </div>
          <progress className="sr-only" max={100} value={Math.round(state.progress.percent)} aria-label="Progres scan dokumen" />
          {state.progress.downloading && <p className="text-xs text-amber-700">{DOWNLOAD_NOTICE} Tunggu sebentar…</p>}
          <p className="text-xs text-slate-500">{engine === 'claude' ? 'Claude biasanya selesai dalam 5–20 detik.' : 'Membaca teks bisa memakan waktu 10–30 detik di HP.'}</p>
        </div>
      )}

      {state.status === 'review' && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <img src={state.previewUrl} alt="Pratinjau foto dokumen" className="h-16 w-24 shrink-0 rounded-md border border-slate-200 object-cover" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-slate-900">Hasil scan</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <KindBadge kind={state.result.kind} />
                <Badge tone={state.result.engine === 'claude' ? 'info' : 'neutral'} title={SCAN_ENGINE_DESCRIPTION[state.result.engine]}>
                  {state.result.engine === 'claude' ? <Sparkles className="mr-1 h-3 w-3" aria-hidden /> : <Smartphone className="mr-1 h-3 w-3" aria-hidden />}
                  {state.result.engine === 'claude' ? 'Dibaca Claude' : 'Dibaca di HP'}
                </Badge>
                {state.result.kind !== 'unknown' && (
                  <ConfidenceBadge kind={state.result.kind} confidence={state.result.confidence} ocr={state.result.ocrConfidence} engine={state.result.engine} />
                )}
                {state.result.passport &&
                  (state.result.passport.checks.number ? (
                    <Badge tone="success">
                      <ShieldCheck className="mr-1 h-3 w-3" aria-hidden />
                      {PASSPORT_NUMBER_OK}
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <ShieldAlert className="mr-1 h-3 w-3" aria-hidden />
                      {PASSPORT_NUMBER_CHECK}
                    </Badge>
                  ))}
              </div>
              {state.result.kind !== 'unknown' && (
                <p className="text-xs text-slate-500">
                  Centang data yang ingin dimasukkan ke formulir, lalu tekan Terapkan.{' '}
                  {state.result.engine === 'claude' ? 'Periksa ejaan dan angkanya sebelum disimpan.' : 'Periksa ejaan, OCR bisa salah baca.'}
                </p>
              )}
            </div>
          </div>

          {state.result.engine === 'claude' && ctx.isLocalMode && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="scanner-demo-note">
              {CLAUDE_DEMO_NOTICE}
            </p>
          )}
          {state.result.notes && (
            <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700" data-testid="scanner-notes">
              <span className="font-medium">Catatan Claude:</span> {state.result.notes}
            </p>
          )}

          {state.result.kind === 'unknown' ? (
            <div className="rounded-lg bg-white p-3 text-slate-700">
              <p className="font-medium text-slate-900">{UNKNOWN_DOCUMENT_NOTICE}</p>
              <p className="mt-1 text-xs text-slate-500">
                {state.result.engine === 'claude'
                  ? 'Claude tidak mengenali KTP maupun paspor di foto ini. Pastikan seluruh dokumen terfoto tanpa pantulan, atau isi data secara manual.'
                  : 'Tidak ditemukan NIK maupun kode MRZ paspor. Pastikan seluruh dokumen terfoto tanpa pantulan, atau isi data secara manual.'}
              </p>
            </div>
          ) : diff.length === 0 && !typeChange ? (
            <p className="rounded-lg bg-white p-3 text-slate-600">Tidak ada data yang terbaca dari foto ini. Coba foto ulang dengan cahaya lebih terang dan tanpa pantulan.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {typeChange && (
                <li data-testid="scanner-id-type-row">
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={typeChange.apply}
                      onChange={() => setTypeOverride(!typeChange.apply)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Jenis identitas</span>
                      <span className="block break-words text-slate-900">{describeIdTypeChange(typeChange)}</span>
                      {typeChange.dropped && (
                        <span className="block text-xs text-amber-700">
                          {typeChange.apply
                            ? `${typeChange.dropped.label} lama tidak disimpan lagi.`
                            : `Tidak dicentang: tetap ${ID_TYPE_LABEL[typeChange.from]}, hanya data lain yang diterapkan.`}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )}
              {diff.map((d) => (
                <li key={d.key}>
                  <label className={clsx('flex items-start gap-3 px-3 py-2', d.locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
                    <input
                      type="checkbox"
                      checked={d.apply}
                      disabled={d.locked}
                      onChange={() => toggle(d.key)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{d.label}</span>
                      <span className="block break-words text-slate-900">{displayPrefillValue(d.key, d.detected)}</span>
                      {d.key === 'id_number' && state.result.passport && !state.result.passport.checks.number && (
                        <span className="block text-xs text-amber-700">{PASSPORT_NUMBER_MISMATCH}</span>
                      )}
                      {state.result.unclear.includes(d.key) && <span className="block text-xs text-amber-700">{UNSURE_NOTICE}</span>}
                      {d.locked ? (
                        <span className="block text-xs text-slate-500">Centang &quot;Jenis identitas&quot; untuk memakai data ini.</span>
                      ) : (
                        d.current !== '' &&
                        d.current !== d.detected && (
                          <span className="block text-xs text-amber-700">Saat ini: {displayPrefillValue(d.key, d.current)} (akan diganti jika dicentang)</span>
                        )
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500">{PHONE_NOTICE}</p>
          {state.result.cost && ctx.showsCost && (
            <p className="text-xs text-slate-500" data-testid="scan-cost">
              Biaya scan ini: {formatUsd(state.result.cost.cost_usd, 4)}
              {ctx.isLocalMode && ' (contoh)'}
              {state.result.cost.fell_back && ' · termasuk model cadangan'}
            </p>
          )}

          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer select-none font-medium">{state.result.engine === 'claude' ? 'Lihat data yang terbaca' : 'Lihat teks hasil OCR'}</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-900 p-2 text-[11px] text-slate-100">{state.result.lines.join('\n') || '(kosong)'}</pre>
          </details>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={reset}>
              Scan ulang
            </Button>
            {state.result.kind === 'unknown' ? (
              <Button type="button" icon={<Keyboard className="h-4 w-4" />} onClick={manual}>
                Isi manual
              </Button>
            ) : (
              <Button type="button" icon={<Check className="h-4 w-4" />} onClick={apply}>
                Terapkan
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
