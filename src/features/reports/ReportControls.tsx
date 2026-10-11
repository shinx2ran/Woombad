import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { Select } from '../../components/ui'
import { inputClass } from '../../components/ui/Input'
import { useOrg } from '../../hooks/useOrg'
import { GRANULARITY_LABEL, GRANULARITY_OPTIONS, PRESET_OPTIONS, type GranularityChoice, type ReportPreset } from './reportRange'
import type { ReportRange } from './useReportRange'

/** Height of the app's sticky header, so the controls stick right under it. */
function useHeaderOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const update = () => setOffset(header.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])
  return offset
}

export function ReportControls({ report }: { report: ReportRange }) {
  const { selectedPropertyId, properties } = useOrg()
  const top = useHeaderOffset()
  const { preset, range, label, granularity, granularityChoice } = report
  const [customStart, setCustomStart] = useState(range.start)
  const [customEnd, setCustomEnd] = useState(range.end)
  const [customError, setCustomError] = useState<string | null>(null)

  // keep the custom inputs in sync when the range changes from outside (◀ ▶ or URL)
  useEffect(() => {
    setCustomStart(range.start)
    setCustomEnd(range.end)
    setCustomError(null)
  }, [range.start, range.end])

  const applyCustom = (start: string, end: string) => {
    if (!start || !end) {
      setCustomError('Isi tanggal awal dan akhir.')
      return
    }
    if (start > end) {
      setCustomError('Tanggal awal harus sebelum tanggal akhir.')
      return
    }
    setCustomError(null)
    report.setCustomRange({ start, end })
  }

  const singleKos = selectedPropertyId !== 'all' && properties.length > 1
  const kosName = properties.find((p) => p.id === selectedPropertyId)?.name

  return (
    <div
      className="sticky z-20 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur print:hidden md:-mx-6 md:px-6"
      style={{ top }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {/* preset segmented control */}
        <div role="tablist" aria-label="Preset periode" className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200/70 p-1">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={preset === opt.value}
              onClick={() => report.setPreset(opt.value as ReportPreset)}
              className={clsx(
                'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                preset === opt.value ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => report.shift(-1)}
              aria-label="Periode sebelumnya"
              className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={report.goToday}
              title="Kembali ke periode saat ini"
              className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              {label}
            </button>
            <button
              type="button"
              onClick={() => report.shift(1)}
              aria-label="Periode berikutnya"
              className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="whitespace-nowrap">Per</span>
            <Select
              aria-label="Granularitas grafik"
              options={GRANULARITY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.value === 'auto' ? `Otomatis (${GRANULARITY_LABEL[granularity]})` : o.label,
              }))}
              value={granularityChoice}
              onChange={(e) => report.setGranularity(e.target.value as GranularityChoice)}
              className="h-9 w-auto min-w-[9rem] text-xs"
            />
          </label>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 min-w-[8rem] flex-col gap-1 text-xs text-slate-600">
              Dari
              <input
                type="date"
                aria-label="Tanggal awal"
                className={clsx(inputClass, 'h-9')}
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  applyCustom(e.target.value, customEnd)
                }}
              />
            </label>
            <label className="flex flex-1 min-w-[8rem] flex-col gap-1 text-xs text-slate-600">
              Sampai
              <input
                type="date"
                aria-label="Tanggal akhir"
                className={clsx(inputClass, 'h-9')}
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  applyCustom(customStart, e.target.value)
                }}
              />
            </label>
            {customError && <p className="w-full text-xs text-red-600">{customError}</p>}
          </div>
        )}

        {singleKos && (
          <p className="flex items-center gap-1.5 text-xs text-amber-800">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Menampilkan {kosName ?? 'satu kos'}. Pengeluaran bersama tidak termasuk.
          </p>
        )}
      </div>
    </div>
  )
}
