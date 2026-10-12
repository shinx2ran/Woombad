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
