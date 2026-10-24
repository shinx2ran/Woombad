/**
 * The planner's inputs live in the address (/rencana?jenis=harian&mulai=2026-11-05&jumlah=2&maks=150000&kamar=…&tunggu=…),
 * so a link from the room board or the daftar tunggu opens it filled in, and Back keeps what was typed. Pure.
 */
import type { PeriodType } from '../../types/db'
import { PERIOD_TYPES } from '../../types/db'

export interface PlannerParams {
  periodType: PeriodType
  /** check-in day */
  start: string
  /** nights / weeks / months */
  quantity: number
  /** highest price per night / week / month; null = any */
  maxPrice: number | null
  /** only this room (room board "Pesan tanggal lain") */
  roomId: string | null
  /** booking for this daftar tunggu entry */
  waitlistId: string | null
}

export const PERIOD_PARAM: Record<PeriodType, string> = { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan' }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null
  const n = Number.parseInt(value, 10)
  return n >= 1 ? n : null
}

/** Planner inputs from the address; anything missing or invalid falls back to Harian, today, 1, no budget. */
export function parsePlannerParams(params: URLSearchParams, today: string): PlannerParams {
  const type = PERIOD_TYPES.find((t) => PERIOD_PARAM[t] === params.get('jenis')) ?? 'daily'
  const start = params.get('mulai') ?? ''
  return {
    periodType: type,
    start: ISO_DAY.test(start) ? start : today,
    quantity: Math.min(positiveInt(params.get('jumlah')) ?? 1, 9999),
    maxPrice: positiveInt(params.get('maks')),
    roomId: params.get('kamar') || null,
    waitlistId: params.get('tunggu') || null,
  }
}

/** '?jenis=harian&mulai=…' for the given inputs (defaults left out except the type and the date). */
export function plannerSearch(p: Partial<PlannerParams>): string {
  const q = new URLSearchParams()
  q.set('jenis', PERIOD_PARAM[p.periodType ?? 'daily'])
  if (p.start) q.set('mulai', p.start)
  if (p.quantity && p.quantity > 1) q.set('jumlah', String(p.quantity))
  if (p.maxPrice) q.set('maks', String(p.maxPrice))
  if (p.roomId) q.set('kamar', p.roomId)
  if (p.waitlistId) q.set('tunggu', p.waitlistId)
  return `?${q.toString()}`
}
