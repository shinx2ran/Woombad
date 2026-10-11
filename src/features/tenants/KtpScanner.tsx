import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Camera, Image as ImageIcon, RefreshCw, ScanLine, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Button, useToast } from '../../components/ui'
import { GENDER_LABEL } from '../../types/db'
import { formatDate } from '../../lib/format'
import { hasOcrDataCached, recognizeKtp, type KtpScanResult, type OcrProgress } from './ktpOcr'
import { applyPrefill, diffPrefill, type PrefillDiff, type TenantFormValues } from './tenantUtils'

type ScanState =
  | { status: 'idle' }
  | { status: 'running'; progress: OcrProgress }
  | { status: 'review'; result: KtpScanResult; diff: PrefillDiff[]; previewUrl: string }

const DOWNLOAD_NOTICE = 'Mengunduh data OCR ±15 MB, hanya sekali.'
const PHONE_NOTICE = 'Nomor HP tidak ada di KTP, isi manual.'

function displayValue(key: PrefillDiff['key'], value: string): string {
  if (!value) return '—'
  if (key === 'gender') return value === 'L' || value === 'P' ? GENDER_LABEL[value] : value
  if (key === 'birth_date') return formatDate(value)
  return value
}

function ConfidenceBadge({ keyFields, ocr }: { keyFields: number; ocr: number }) {
  const pct = Math.round(keyFields * 100)
  const tone = keyFields >= 0.8 ? 'success' : keyFields >= 0.4 ? 'warning' : 'danger'
  const label = keyFields >= 0.8 ? 'Keyakinan tinggi' : keyFields >= 0.4 ? 'Keyakinan sedang' : 'Keyakinan rendah'
  return (
    <span title={`${pct}% data utama terbaca; akurasi teks OCR ${ocr}%`}>
      <Badge tone={tone}>
        {label} · {pct}%
      </Badge>
    </span>
  )
}

/**
 * "Scan KTP" panel used inside the tenant form. Picks a photo (camera on phones, drag & drop on desktop),
 * runs OCR with a progress bar, then shows the detected fields as a checklist so the user decides which
 * values to apply. Never overwrites typed data silently: fields that already hold a different value start
 * unchecked.
 */
export function KtpScanner({
  current,
  onApply,
}: {
  current: TenantFormValues
  /** receives the merged form values and the preprocessed JPEG */
  onApply: (next: TenantFormValues, image: Blob) => void
}) {
  const toast = useToast()
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)
  const firstRun = !hasOcrDataCached()

  // Release the preview object URL when the component unmounts or a new scan starts.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  const start = async (file: File | Blob) => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setState({ status: 'running', progress: { phase: 'preprocess', percent: 0, status: 'Memulai…', downloading: false } })
    try {
      const result = await recognizeKtp(file, (progress) => setState({ status: 'running', progress }))
      const previewUrl = URL.createObjectURL(result.image)
      previewRef.current = previewUrl
      setState({ status: 'review', result, diff: diffPrefill(result.prefill, current), previewUrl })
      if (Object.keys(result.prefill).length === 0) toast.error('Tidak ada data KTP yang terbaca. Coba foto yang lebih jelas.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan KTP gagal.')
      setState({ status: 'idle' })
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

  const toggle = (key: PrefillDiff['key']) => {
    if (state.status !== 'review') return
    setState({ ...state, diff: state.diff.map((d) => (d.key === key ? { ...d, apply: !d.apply } : d)) })
  }

  const apply = () => {
    if (state.status !== 'review') return
    const applied = state.diff.filter((d) => d.apply).length
    onApply(applyPrefill(current, state.diff), state.result.image)
    toast.success(applied > 0 ? `${applied} data dari KTP diterapkan ke formulir.` : 'Foto KTP disimpan, tidak ada data yang diubah.')
    setState({ status: 'idle' })
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-sm">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} data-testid="ktp-camera-input" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} data-testid="ktp-file-input" />

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
            <p className="font-medium text-slate-900">Foto KTP akan dibaca otomatis</p>
            <p className="text-xs text-slate-500">Letakkan KTP di permukaan rata, pencahayaan cukup, lalu foto dari atas. Di komputer, seret gambar ke sini.</p>
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
          <progress className="sr-only" max={100} value={Math.round(state.progress.percent)} aria-label="Progres scan KTP" />
          {state.progress.downloading && <p className="text-xs text-amber-700">{DOWNLOAD_NOTICE} Tunggu sebentar…</p>}
          <p className="text-xs text-slate-500">Membaca teks bisa memakan waktu 10–30 detik di HP.</p>
        </div>
      )}

      {state.status === 'review' && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <img src={state.previewUrl} alt="Pratinjau foto KTP" className="h-16 w-24 shrink-0 rounded-md border border-slate-200 object-cover" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-slate-900">Hasil scan KTP</p>
              <ConfidenceBadge keyFields={state.result.parse.confidence} ocr={state.result.ocrConfidence} />
              <p className="text-xs text-slate-500">Centang data yang ingin dimasukkan ke formulir, lalu tekan Terapkan. Periksa ejaan, OCR bisa salah baca.</p>
            </div>
          </div>

          {state.diff.length === 0 ? (
            <p className="rounded-lg bg-white p-3 text-slate-600">Tidak ada data yang terbaca dari foto ini. Coba foto ulang dengan cahaya lebih terang dan tanpa pantulan.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {state.diff.map((d) => (
                <li key={d.key}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                    <input type="checkbox" checked={d.apply} onChange={() => toggle(d.key)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{d.label}</span>
                      <span className="block break-words text-slate-900">{displayValue(d.key, d.detected)}</span>
                      {d.current !== '' && d.current !== d.detected && (
                        <span className="block text-xs text-amber-700">Saat ini: {displayValue(d.key, d.current)} (akan diganti jika dicentang)</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500">{PHONE_NOTICE}</p>

          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer select-none font-medium">Lihat teks hasil OCR</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-900 p-2 text-[11px] text-slate-100">{state.result.parse.lines.join('\n') || '(kosong)'}</pre>
          </details>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setState({ status: 'idle' })}>
              Scan ulang
            </Button>
            <Button type="button" icon={<ImageIcon className="h-4 w-4" />} onClick={apply}>
              Terapkan
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
