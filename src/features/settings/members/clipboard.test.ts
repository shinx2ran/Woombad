// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

function field(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.readOnly = true
  input.value = value
  document.body.appendChild(input)
  return input
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

function setExecCommand(value: unknown) {
  Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true })
}

describe('copyText', () => {
  afterEach(() => {
    setClipboard(undefined)
    setExecCommand(undefined)
    document.body.innerHTML = ''
  })

  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    expect(await copyText('ABCD-EFGH', field('ABCD-EFGH'))).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH')
  })

  it('without the Clipboard API (http, old iPhone) selects the field and uses the copy command', async () => {
    setClipboard(undefined)
    const exec = vi.fn(() => true)
    setExecCommand(exec)
    const input = field('https://x.example/gabung?kode=ABCD-EFGH')
    expect(await copyText(input.value, input)).toBe('copied')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.activeElement).toBe(input)
  })

  it('leaves the text selected for a manual copy when nothing else works', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    setExecCommand(vi.fn(() => false))
    const input = field('ABCD-EFGH')
    expect(await copyText('ABCD-EFGH', input)).toBe('selected')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('ABCD-EFGH'.length)
  })

  it('reports failure when there is no field to fall back to', async () => {
    setClipboard(undefined)
    expect(await copyText('ABCD-EFGH')).toBe('failed')
  })
})
