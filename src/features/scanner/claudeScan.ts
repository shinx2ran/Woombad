/**
 * Scan KTP with Claude (SPEC 7.19), the app side: send the photo to the "scan-ktp" Edge Function and turn the fields it
 * read into the same DocumentScanResult the on-device reader produces, so both readers meet the same review screen
 * (tick the values, Terapkan). The reading itself (prompt, schema, strict check) lives in
 * supabase/functions/scan-ktp/ktp.ts and is shared with the function; the KTP fields become form values through the
 * same ktpFieldsToTenant the on-device reader uses.
 */
import { KTP_KEY_FIELDS, ktpFieldsToTenant, nikInfo, titleCase, type KtpFields } from '../../domain/ktp'
import { getSupabase } from '../../lib/supabase'
import { parseKtpScanOutput, type KtpScanFields, type KtpScanResult, type PassportScanFields } from '../../../supabase/functions/scan-ktp/ktp.ts'
import { parseScanCostReply } from '../../../supabase/functions/scan-nota/scan.ts'
import { prepareScanImage, ScanRequestError, toScanError } from '../expenses/scanNota'
import { ScanAbortedError, throwIfAborted, untilAborted, type DocumentScanResult, type OcrInterpretation, type OcrProgress } from './ocr'
import type { ScanPrefill, ScanPrefillKey } from './types'

/** the card's field names as Claude returns them → the form field each fills (fields the form has no column for: none) */
const KTP_FIELD_TO_PREFILL: Partial<Record<keyof KtpScanFields, ScanPrefillKey>> = {
  nik: 'nik',
  nama: 'full_name',
  tempat_lahir: 'birth_place',
  tanggal_lahir: 'birth_date',
  jenis_kelamin: 'gender',
  alamat: 'address',
  rt_rw: 'address',
  kel_desa: 'address',
  kecamatan: 'address',
  kota: 'address',
  provinsi: 'address',
  agama: 'religion',
  status_perkawinan: 'marital_status',
  pekerjaan: 'occupation',
}
const PASSPORT_FIELD_TO_PREFILL: Partial<Record<keyof PassportScanFields, ScanPrefillKey>> = {
  surname: 'full_name',
  given_names: 'full_name',
  passport_number: 'id_number',
  nationality: 'nationality',
  birth_date: 'birth_date',
  sex: 'gender',
}

/** labels for the "data yang terbaca" panel, in the card's own words */
const KTP_LINE_LABEL: Record<keyof KtpScanFields, string> = {
  nik: 'NIK',
  nama: 'Nama',
  tempat_lahir: 'Tempat lahir',
  tanggal_lahir: 'Tgl lahir',
  jenis_kelamin: 'Jenis kelamin',
  gol_darah: 'Gol. darah',
  alamat: 'Alamat',
  rt_rw: 'RT/RW',
  kel_desa: 'Kel/Desa',
  kecamatan: 'Kecamatan',
  kota: 'Kota/Kabupaten',
  provinsi: 'Provinsi',
  agama: 'Agama',
  status_perkawinan: 'Status perkawinan',
  pekerjaan: 'Pekerjaan',
  kewarganegaraan: 'Kewarganegaraan',
}
const PASSPORT_LINE_LABEL: Record<keyof PassportScanFields, string> = {
  surname: 'Nama belakang',
  given_names: 'Nama depan',
  passport_number: 'No. paspor',
  nationality: 'Kewarganegaraan',
  birth_date: 'Tgl lahir',
  sex: 'Jenis kelamin',
  expiry_date: 'Berlaku s/d',
}

/** the parts of a passport that drive the confidence figure (a name counts once) */
const PASSPORT_KEY_PARTS = 4

export interface ClaudeInterpretation extends OcrInterpretation {
  /** review rows Claude marked as unsure */
  unclear: ScanPrefillKey[]
  notes: string
}

function readLines<K extends string>(fields: Record<K, string | null>, labels: Record<K, string>): string[] {
  return (Object.keys(labels) as K[]).filter((k) => fields[k] !== null).map((k) => `${labels[k]}: ${fields[k]}`)
}

/**
 * Pure step after the function replied: the fields Claude read, as the review screen wants them.
 * - 'ktp': the fields go through ktpFieldsToTenant (title case, the address joined), like the on-device reader's; a
 *   birth date or gender the card did not yield is taken from the NIK (digits 7-12), as the on-device parser does, but
 *   marked for checking; confidence = share of the five key fields (NIK, nama, tanggal lahir, jenis kelamin, alamat)
 *   read and not unsure.
 * - 'passport': name, number, nationality, gender and birth date straight from the machine-readable fields; no check
 *   digits to verify here (`passport` stays null, so the MRZ badges are not shown); confidence = share of name, number,
 *   nationality and birth date read and not unsure.
 * - 'unknown': an empty prefill (id_type 'ktp', the form default), confidence 0, Claude's reason in notes.
 */
export function interpretClaudeScan(result: KtpScanResult): ClaudeInterpretation {
  const notes = result.notes
  if (result.kind === 'ktp' && result.ktp) {
    const k = result.ktp
    const fields: KtpFields = {}
    if (k.nik) fields.nik = k.nik
    if (k.nama) fields.nama = k.nama
    if (k.tempat_lahir) fields.tempat_lahir = k.tempat_lahir
    if (k.tanggal_lahir) fields.tanggal_lahir = k.tanggal_lahir
    if (k.jenis_kelamin === 'L' || k.jenis_kelamin === 'P') fields.jenis_kelamin = k.jenis_kelamin
    if (k.gol_darah) fields.gol_darah = k.gol_darah
    if (k.alamat) fields.alamat = k.alamat
    if (k.rt_rw) fields.rt_rw = k.rt_rw
    if (k.kel_desa) fields.kel_desa = k.kel_desa
    if (k.kecamatan) fields.kecamatan = k.kecamatan
    if (k.kota) fields.kota = k.kota
    if (k.provinsi) fields.provinsi = k.provinsi
    if (k.agama) fields.agama = k.agama
    if (k.status_perkawinan) fields.status_perkawinan = k.status_perkawinan
    if (k.pekerjaan) fields.pekerjaan = k.pekerjaan
    if (k.kewarganegaraan) fields.kewarganegaraan = k.kewarganegaraan
    const unsure = new Set(result.unclear)
    // what the NIK encodes stands in for a line the photo did not yield (glare over "Tempat/Tgl Lahir"), to be checked
    const fromNik = fields.nik ? nikInfo(fields.nik) : null
    if (fromNik && !fields.tanggal_lahir) {
      fields.tanggal_lahir = fromNik.birthDate
      unsure.add('tanggal_lahir')
    }
    if (fromNik && !fields.jenis_kelamin) {
      fields.jenis_kelamin = fromNik.gender
      unsure.add('jenis_kelamin')
    }
    const sure = KTP_KEY_FIELDS.filter((f) => fields[f] !== undefined && !unsure.has(f)).length
    const lines = readLines(k, KTP_LINE_LABEL)
    const unclear = prefillKeys([...unsure], KTP_FIELD_TO_PREFILL)
    return {
      kind: 'ktp',
      prefill: { id_type: 'ktp', ...ktpFieldsToTenant(fields) },
      ktp: { fields, confidence: sure / KTP_KEY_FIELDS.length, lines },
      passport: null,
      confidence: sure / KTP_KEY_FIELDS.length,
      lines,
      unclear,
      notes,
    }
  }
  if (result.kind === 'passport' && result.passport) {
    const p = result.passport
    const prefill: ScanPrefill = { id_type: 'passport' }
    const name = [p.given_names, p.surname].filter((part): part is string => Boolean(part)).map(titleCase).join(' ')
    if (name) prefill.full_name = name
    if (p.passport_number) prefill.id_number = p.passport_number
    if (p.nationality) prefill.nationality = p.nationality
    if (p.sex === 'L' || p.sex === 'P') prefill.gender = p.sex
    if (p.birth_date) prefill.birth_date = p.birth_date
    const unsure = new Set(result.unclear)
    const sure =
      (name && !unsure.has('surname') && !unsure.has('given_names') ? 1 : 0) +
      (p.passport_number && !unsure.has('passport_number') ? 1 : 0) +
      (p.nationality && !unsure.has('nationality') ? 1 : 0) +
      (p.birth_date && !unsure.has('birth_date') ? 1 : 0)
    return {
      kind: 'passport',
      prefill,
      ktp: null,
      passport: null,
      confidence: sure / PASSPORT_KEY_PARTS,
      lines: readLines(p, PASSPORT_LINE_LABEL),
      unclear: prefillKeys(result.unclear, PASSPORT_FIELD_TO_PREFILL),
      notes,
    }
  }
  return { kind: 'unknown', prefill: { id_type: 'ktp' }, ktp: null, passport: null, confidence: 0, lines: [], unclear: [], notes }
}

function prefillKeys(names: string[], map: Partial<Record<string, ScanPrefillKey>>): ScanPrefillKey[] {
  const out: ScanPrefillKey[] = []
  for (const name of names) {
    const key = map[name]
    if (key && !out.includes(key)) out.push(key)
  }
  return out
}

const asFile = (blob: Blob) => (blob instanceof File ? blob : new File([blob], 'dokumen.jpg', { type: blob.type || 'image/jpeg' }))

/** the function's own wording is kept; only the gateway's "not deployed" and the Scan nota wording are reworded */
async function claudeScanError(err: unknown): Promise<ScanRequestError> {
  const mapped = await toScanError(err)
  if (mapped.code === 'not_deployed') return new ScanRequestError(mapped.code, 'Scan KTP lewat Claude belum tersedia di server. Hubungi pemilik, atau pilih "Di HP".')
  return mapped
}

/**
 * Full pipeline through Claude: the photo scaled to a 2000 px JPEG (prepareScanImage; the same JPEG is kept as the
 * document photo) → the scan-ktp function → interpretClaudeScan. Throws ScanRequestError with a message to show as is,
 * or ScanAbortedError when `signal` aborts (the scanner was closed).
 */
export async function recognizeDocumentWithClaude(file: Blob, orgId: string, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<DocumentScanResult> {
  const report = (p: OcrProgress) => {
    if (!signal?.aborted) onProgress(p)
  }
  report({ phase: 'preprocess', percent: 5, status: 'Memproses gambar…', downloading: false })
  const prepared = await untilAborted(prepareScanImage(asFile(file)), signal)
  throwIfAborted(signal)
  report({ phase: 'recognize', percent: 35, status: 'Claude sedang membaca dokumen…', downloading: false })
  let data: unknown
  try {
    const res = await getSupabase().functions.invoke('scan-ktp', { body: { orgId, image: prepared.base64, mediaType: prepared.mediaType }, signal })
    if (res.error) throw res.error
    data = res.data
  } catch (err) {
    if (signal?.aborted) throw new ScanAbortedError()
    throw await claudeScanError(err)
  }
  throwIfAborted(signal)
  const reply = data as { result?: unknown; cost?: unknown } | null
  let read: KtpScanResult
  try {
    read = parseKtpScanOutput(reply?.result)
  } catch {
    throw new ScanRequestError('upstream', 'Hasil baca tidak lengkap. Coba lagi atau ambil ulang fotonya.')
  }
  report({ phase: 'parse', percent: 100, status: 'Selesai', downloading: false })
  const interpretation = interpretClaudeScan(read)
  return { ...interpretation, text: interpretation.lines.join('\n'), ocrConfidence: null, image: prepared.file, engine: 'claude', cost: parseScanCostReply(reply?.cost) }
}

/**
 * Mode Demo has no server: the review shows this made-up card instead (it says so on screen), so the flow can be tried
 * without a key. Synthetic data, not a real person; the NIK's digits 7-12 (250590) agree with the printed birth date.
 */
export const DEMO_KTP_SCAN_RESULT: KtpScanResult = {
  kind: 'ktp',
  ktp: {
    nik: '3273012505900002',
    nama: 'BUDI SANTOSO',
    tempat_lahir: 'BANDUNG',
    tanggal_lahir: '1990-05-25',
    jenis_kelamin: 'L',
    gol_darah: 'O',
    alamat: 'JL. MELATI NO. 12',
    rt_rw: '003/005',
    kel_desa: 'SUKAJADI',
    kecamatan: 'COBLONG',
    kota: 'BANDUNG',
    provinsi: 'JAWA BARAT',
    agama: 'ISLAM',
    status_perkawinan: 'BELUM KAWIN',
    pekerjaan: 'KARYAWAN SWASTA',
    kewarganegaraan: 'WNI',
  },
  passport: null,
  unclear: ['alamat'],
  notes: 'Baris alamat agak buram, mohon dicek.',
}

/**
 * Mode Demo's stand-in for what a KTP scan costs (SPEC 7.17): Claude Opus 5.5 reading 3,000 tokens and writing 900 is
 * 3,000 × $4 + 900 × $20 per million = US$0.03. Written as a scan_usage row in the demo data, labelled as a sample.
 */
export const DEMO_KTP_SCAN_USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 3000,
  output_tokens: 900,
  cost_usd: 0.03,
} as const

/** The demo reading: the sample card after a short pause, the photo itself kept as the document photo. */
export async function demoClaudeScan(file: Blob, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<DocumentScanResult> {
  if (!signal?.aborted) onProgress({ phase: 'recognize', percent: 40, status: 'Contoh Mode Demo…', downloading: false })
  await untilAborted(new Promise<void>((resolve) => setTimeout(resolve, 400)), signal)
  if (!signal?.aborted) onProgress({ phase: 'parse', percent: 100, status: 'Selesai', downloading: false })
  const interpretation = interpretClaudeScan(DEMO_KTP_SCAN_RESULT)
  return {
    ...interpretation,
    text: interpretation.lines.join('\n'),
    ocrConfidence: null,
    image: file,
    engine: 'claude',
    cost: { cost_usd: DEMO_KTP_SCAN_USAGE.cost_usd, fell_back: false },
  }
}
