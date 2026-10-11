import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { DateRange } from '../../domain/period'
import { todayISO } from '../../lib/format'
import {
  effectiveGranularity,
  rangeForPresetChange,
  rangeLabel,
  resolveRangeState,
  shiftReportRange,
  type GranularityChoice,
  type ReportPreset,
} from './reportRange'

/**
 * Preset / range / granularity of the Laporan page, persisted in the query string
 * (?preset=monthly&from=2026-03-01&to=2026-03-31&g=auto) so the browser back button and reloads keep it.
 */
export function useReportRange() {
  const [params, setParams] = useSearchParams()
  const today = todayISO()

  const state = useMemo(
    () =>
      resolveRangeState(
        { preset: params.get('preset'), from: params.get('from'), to: params.get('to'), granularity: params.get('g') },
        today,
      ),
    [params, today],
  )

  const write = useCallback(
    (next: { preset: ReportPreset; range: DateRange; granularity: GranularityChoice }) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set('preset', next.preset)
          p.set('from', next.range.start)
          p.set('to', next.range.end)
          if (next.granularity === 'auto') p.delete('g')
          else p.set('g', next.granularity)
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setPreset = useCallback(
    (preset: ReportPreset) => write({ preset, range: rangeForPresetChange(preset, state.range, today), granularity: state.granularity }),
    [state, today, write],
  )
  const shift = useCallback(
    (n: number) => write({ ...state, range: shiftReportRange(state.range, state.preset, n) }),
    [state, write],
  )
  const setCustomRange = useCallback(
    (range: DateRange) => write({ preset: 'custom', range, granularity: state.granularity }),
    [state.granularity, write],
  )
  const setGranularity = useCallback((granularity: GranularityChoice) => write({ ...state, granularity }), [state, write])
  const goToday = useCallback(
    () => write({ ...state, range: rangeForPresetChange(state.preset === 'custom' ? 'monthly' : state.preset, { start: today, end: today }, today), preset: state.preset === 'custom' ? 'monthly' : state.preset }),
    [state, today, write],
  )

  return {
    today,
    preset: state.preset,
    range: state.range,
    granularityChoice: state.granularity,
    granularity: effectiveGranularity(state.range, state.granularity),
    label: rangeLabel(state.range, state.preset),
    setPreset,
    shift,
    setCustomRange,
    setGranularity,
    goToday,
  }
}

export type ReportRange = ReturnType<typeof useReportRange>
