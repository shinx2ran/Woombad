/**
 * Which reader the document scanner uses (SPEC 7.19): Claude through the scan-ktp Edge Function, or tesseract.js on the
 * device. The organisation chooses a default (Pengaturan → Scan KTP, owner/admin); anyone may switch for one scan;
 * without a network connection the photo is always read on the device. Pure, no React.
 */
import { KTP_SCAN_ENGINES, type KtpScanEngine } from '../../types/db'

export type ScanEngine = KtpScanEngine

export const DEFAULT_SCAN_ENGINE: ScanEngine = 'claude'
/** the readers, in the order the switch shows them (the database CHECK lists the same two) */
export const SCAN_ENGINES: readonly ScanEngine[] = KTP_SCAN_ENGINES

/** the two buttons of the reader switch */
export const SCAN_ENGINE_LABEL: Record<ScanEngine, string> = { claude: 'Claude', tesseract: 'Di HP' }

/** what each reader means for the person, in one line under the switch */
export const SCAN_ENGINE_DESCRIPTION: Record<ScanEngine, string> = {
  claude: 'Foto dikirim ke Anthropic (Claude) untuk dibaca; biayanya dari kredit Claude, kira-kira US$0,03–0,06 per foto.',
  tesseract: 'Dibaca di HP ini, foto tidak dikirim ke mana pun. Hasilnya lebih sering perlu dikoreksi.',
}

export const OFFLINE_ENGINE_NOTICE = 'Sedang offline: foto dibaca di HP.'

/** The organisation's saved default, read tolerantly: an older server or backup has no such column. */
export function orgScanEngine(value: unknown): ScanEngine {
  return value === 'tesseract' ? 'tesseract' : DEFAULT_SCAN_ENGINE
}

export type EngineFallback = 'offline' | null

/** The reader that will run: the chosen one, except that Claude needs the network. */
export function effectiveEngine(chosen: ScanEngine, online: boolean): { engine: ScanEngine; fallback: EngineFallback } {
  if (chosen === 'claude' && !online) return { engine: 'tesseract', fallback: 'offline' }
  return { engine: chosen, fallback: null }
}
