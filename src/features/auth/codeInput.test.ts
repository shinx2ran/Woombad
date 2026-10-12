import { describe, expect, it } from 'vitest'
import { formatCodeInput, isCompleteCode } from './codeInput'

describe('formatCodeInput', () => {
  it('uppercases and inserts the dash after four characters', () => {
    expect(formatCodeInput('')).toBe('')
    expect(formatCodeInput('abc')).toBe('ABC')
    expect(formatCodeInput('abcd')).toBe('ABCD')
    expect(formatCodeInput('abcde')).toBe('ABCD-E')
    expect(formatCodeInput('abcdefgh')).toBe('ABCD-EFGH')
  })

  it('drops spaces, dashes and other punctuation the user typed or pasted', () => {
    expect(formatCodeInput(' ab cd-ef.gh ')).toBe('ABCD-EFGH')
    expect(formatCodeInput('ABCD-EFGH')).toBe('ABCD-EFGH')
  })

  it('leaves no trailing dash, so backspace over the dash works', () => {
    // the field showed "ABCD-E"; backspace leaves "ABCD-"
    expect(formatCodeInput('ABCD-')).toBe('ABCD')
  })

  it('takes the code out of a pasted invitation link', () => {
    expect(formatCodeInput('https://example.github.io/Woombad/gabung?kode=ABCD-EFGH')).toBe('ABCD-EFGH')
    expect(formatCodeInput('Buka http://localhost:5173/gabung?x=1&kode=wxyz2345#top')).toBe('WXYZ-2345')
  })

  it('takes the code out of a pasted line or message without the link', () => {
    // G3 of the launch rehearsal: this used to become 3KOD-ETER-ISIS-ENDI
    expect(formatCodeInput('3. Kode terisi sendiri. Jika diminta, ketik kode: ABCD-EFGH')).toBe('ABCD-EFGH')
    expect(formatCodeInput('ketik kode: wxyz-2345\n\nKode hanya untuk Anda dan berlaku sampai 19 Okt 2026 pukul 10.20.')).toBe('WXYZ-2345')
    expect(formatCodeInput('Kode pemilik: *ABCD-EFGH*')).toBe('ABCD-EFGH')
    // a dashed code beats an 8-letter word that happens to use only code letters
    expect(formatCodeInput('Kode ABCD-EFGH, pakai sekarang')).toBe('ABCD-EFGH')
    expect(formatCodeInput('kode saya ABCDEFGH')).toBe('ABCD-EFGH')
  })

  it('keeps typing a longer setup code working', () => {
    expect(formatCodeInput('ABCD-EFGHJ')).toBe('ABCD-EFGH-J')
    expect(formatCodeInput('ABCD-EFGH-JK')).toBe('ABCD-EFGH-JK')
    expect(formatCodeInput('ABCD-EFGH-JKMN-PQRS')).toBe('ABCD-EFGH-JKMN-PQRS')
    // letters outside the code alphabet are still accepted as typed
    expect(formatCodeInput('kosmelati')).toBe('KOSM-ELAT-I')
  })

  it('caps very long input', () => {
    expect(formatCodeInput('A'.repeat(40))).toBe('AAAA-AAAA-AAAA-AAAA')
  })
})

describe('isCompleteCode', () => {
  it('needs at least eight letters or digits', () => {
    expect(isCompleteCode('ABCD-EFG')).toBe(false)
    expect(isCompleteCode('ABCD-EFGH')).toBe(true)
    expect(isCompleteCode('abcdefgh')).toBe(true)
    expect(isCompleteCode('')).toBe(false)
  })
})
