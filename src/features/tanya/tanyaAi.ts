/**
 * Tanya AI (SPEC 7.29), the app side of the "tanya-ai" Edge Function: send the conversation and the data summary, get
 * the answer and what it cost. Mode Demo has no server: demoAnswer builds a labelled sample from the summary itself.
 */
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { formatDate, formatRupiah } from '../../lib/format'
import { getSupabase } from '../../lib/supabase'
import { parseScanCostReply, type ScanCostReply } from '../../../supabase/functions/scan-nota/scan.ts'
import type { ChatMessage } from '../../../supabase/functions/tanya-ai/chat.ts'
import type { AiSnapshot } from './snapshot'

export class AskAiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface AiAnswer {
  answer: string
  /** the answer was cut at the length limit */
  truncated: boolean
  cost: ScanCostReply | null
}

/** Questions offered before the first one is typed (the owner's own examples first). */
export const SUGGESTED_QUESTIONS = [
  'Berapa proyeksi pendapatan sewa bulan ini?',
  'Siapa saja yang telat bayar atau jatuh tempo minggu ini?',
  'Bandingkan pendapatan bulan ini dengan bulan lalu.',
  'Kamar mana yang kosong atau segera kosong?',
]

/**
 * The function's own message when it sent one ({ error, message }); otherwise a plain explanation. The Supabase gateway
 * answers 404 in English before the function is deployed.
 */
async function toAskError(err: unknown): Promise<AskAiError> {
  if (err instanceof AskAiError) return err
  if (err instanceof FunctionsHttpError) {
    const response = err.context as Response | undefined
    if (response?.status === 404) return new AskAiError('not_deployed', 'Tanya AI belum tersedia di server. Hubungi pemilik.')
    const payload = await response
      ?.clone()
      .json()
      .catch(() => null)
    if (payload && typeof payload.error === 'string' && typeof payload.message === 'string') return new AskAiError(payload.error, payload.message)
    return new AskAiError('upstream', 'Claude tidak dapat menjawab saat ini. Coba lagi.')
  }
  if (err instanceof FunctionsFetchError) return new AskAiError('offline', 'Tidak ada sambungan ke server. Periksa internet lalu coba lagi.')
  return new AskAiError('upstream', 'Claude tidak dapat menjawab saat ini. Coba lagi.')
}

/** `snapshot` is the summary text (buildAiSnapshotText); `messages` ends with the question being asked. */
export async function askAi(orgId: string, snapshot: string, messages: ChatMessage[]): Promise<AiAnswer> {
  let data: unknown
  try {
    const res = await getSupabase().functions.invoke('tanya-ai', { body: { orgId, snapshot, messages } })
    if (res.error) throw res.error
    data = res.data
  } catch (err) {
    throw await toAskError(err)
  }
  const reply = data as { answer?: unknown; truncated?: unknown; cost?: unknown } | null
  if (typeof reply?.answer !== 'string' || reply.answer.trim() === '') throw new AskAiError('upstream', 'Jawaban kosong. Coba lagi.')
  return { answer: reply.answer, truncated: reply.truncated === true, cost: parseScanCostReply(reply.cost) }
}

/**
 * Mode Demo: no question is sent anywhere. The sample answer is the month's projection read straight from the summary
 * (the same figures Claude would be given), so the page can be tried; it says that it is a sample.
 */
export function demoAnswer(snapshot: AiSnapshot): string {
  const p = snapshot.proyeksi_bulan_ini
  const lines = [
    'Contoh jawaban (Mode Demo: pertanyaan tidak dikirim ke Claude; angkanya dari data contoh di perangkat ini).',
    '',
    `Proyeksi pendapatan sewa bulan ini sekitar ${formatRupiah(p.proyeksi_dasar)}.`,
    `• Sudah diterima: ${formatRupiah(p.pendapatan_sudah_diterima)}`,
    `• Tagihan belum lunas (jatuh tempo s/d akhir bulan): ${formatRupiah(p.tagihan_belum_lunas_jatuh_tempo_sampai_akhir_bulan)}`,
    `• Perpanjangan sampai ${formatDate(p.hari_terakhir, 'd MMM')} (${p.perpanjangan_diharapkan.length} kamar): ${formatRupiah(p.total_perpanjangan_diharapkan)}`,
  ]
  for (const r of p.perpanjangan_diharapkan.slice(0, 5)) lines.push(`   – Kamar ${r.kamar} (${r.penyewa}) ${formatDate(r.jatuh_tempo, 'd MMM')}: ${formatRupiah(r.jumlah)}`)
  if (p.perpanjangan_diharapkan.length > 5) lines.push(`   – dan ${p.perpanjangan_diharapkan.length - 5} kamar lain`)
  lines.push('', 'Ini perkiraan: menganggap semua penyewa bulanan dan mingguan memperpanjang dan membayar tepat waktu. Kamar harian tidak dihitung.')
  return lines.join('\n')
}

/** Sample cost shown with the demo answer: about 20,000 summary tokens in, 1,500 out on claude-opus-5-5. */
export const DEMO_ANSWER_COST_USD = 0.11
