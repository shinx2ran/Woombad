/**
 * KTP (Indonesian ID card) text parsing. Input is raw OCR text (tesseract.js, 'ind' + 'eng');
 * output is best-effort structured fields the user can correct in the form.
 *
 * KTP layout (top to bottom): PROVINSI, KABUPATEN/KOTA, NIK, Nama, Tempat/Tgl Lahir, Jenis Kelamin,
 * Gol. Darah, Alamat, RT/RW, Kel/Desa, Kecamatan, Agama, Status Perkawinan, Pekerjaan,
 * Kewarganegaraan, Berlaku Hingga. There is NO phone number on a KTP.
 *
 * OCR is noisy: labels may be misspelled ("Nama" -> "Narna", "Alamat" -> "Alarnat"), colons may be
 * missing or read as ';' or '-', and the NIK may contain O/o for 0, I/l for 1, S for 5, B for 8.
 */
import type { Gender } from '../types/db'

const notImplemented = (name: string): never => {
  throw new Error(`${name} belum diimplementasikan`)
}

export interface KtpFields {
  nik?: string
  nama?: string
  tempat_lahir?: string
  /** 'YYYY-MM-DD' */
  tanggal_lahir?: string
  jenis_kelamin?: Gender
  gol_darah?: string
  alamat?: string
  rt_rw?: string
  kel_desa?: string
  kecamatan?: string
  kota?: string
  provinsi?: string
  agama?: string
  status_perkawinan?: string
  pekerjaan?: string
  kewarganegaraan?: string
}

export interface KtpParseResult {
  fields: KtpFields
  /** 0..1: share of the key fields (nik, nama, tanggal_lahir, jenis_kelamin, alamat) that were found */
  confidence: number
  /** cleaned, non-empty lines of the OCR text */
  lines: string[]
}

/** 16 digits. */
export function isValidNik(nik: string): boolean {
  return notImplemented('isValidNik') as never ?? nik
}

/**
 * Fix common OCR digit confusions in a NIK candidate (O->0, I/l->1, S->5, B->8, Z->2, G->6) and strip spaces.
 * Returns null when the result is not 16 digits.
 */
export function normalizeNik(candidate: string): string | null {
  return notImplemented('normalizeNik') as never ?? candidate
}

/**
 * NIK digits 7-12 encode birth date DDMMYY; DD > 40 means female (DD - 40). Century: YY > current 2-digit
 * year -> 19YY, else 20YY. Returns null for an invalid NIK or an impossible date.
 */
export function nikInfo(nik: string, now?: Date): { birthDate: string; gender: Gender } | null {
  return notImplemented('nikInfo') as never ?? [nik, now]
}

/**
 * Parse Indonesian date strings from the card: '05-03-1990', '05/03/1990', '05 03 1990', '5-3-1990'
 * -> '1990-03-05'. Returns null when not parseable or impossible.
 */
export function parseKtpDate(text: string): string | null {
  return notImplemented('parseKtpDate') as never ?? text
}

export function parseKtpText(ocrText: string, now?: Date): KtpParseResult {
  return notImplemented('parseKtpText') as never ?? [ocrText, now]
}

export interface TenantPrefill {
  full_name?: string
  nik?: string
  gender?: Gender
  birth_place?: string
  birth_date?: string
  /** alamat + RT/RW + kel/desa + kecamatan + kota + provinsi joined with ', ' (missing parts skipped) */
  address?: string
  religion?: string
  marital_status?: string
  occupation?: string
}

/** Map parsed fields to tenant columns; title-cases the name ("BUDI SANTOSO" -> "Budi Santoso"). */
export function ktpFieldsToTenant(fields: KtpFields): TenantPrefill {
  return notImplemented('ktpFieldsToTenant') as never ?? fields
}
