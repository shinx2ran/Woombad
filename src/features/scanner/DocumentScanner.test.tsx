// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { DocumentScanResult } from './ocr'
import { interpretOcrText } from './ocr'
import { DEMO_KTP_SCAN_RESULT, interpretClaudeScan } from './claudeScan'
import { OFFLINE_ENGINE_NOTICE, SCAN_ENGINE_DESCRIPTION } from './engine'
import type { ScanEngineContext } from './useScanEngine'

vi.mock('./ocr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ocr')>()
  return { ...actual, recognizeDocument: vi.fn(), hasOcrDataCached: () => true }
})
vi.mock('./claudeScan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claudeScan')>()
  return { ...actual, recognizeDocumentWithClaude: vi.fn() }
})
// SPEC 7.19: what the panel takes from the app around it (the organisation's default reader, Mode Demo, who sees costs)
const engine: ScanEngineContext = {
  orgId: 'org-1',
  defaultEngine: 'tesseract',
  isLocalMode: false,
  showsCost: true,
  online: true,
  recordClaudeScan: vi.fn(async () => undefined),
}
vi.mock('./useScanEngine', () => ({ useScanEngine: () => engine }))

import { recognizeDocument } from './ocr'
import { recognizeDocumentWithClaude } from './claudeScan'
import { CLAUDE_DEMO_NOTICE, DocumentScanner, PASSPORT_NUMBER_CHECK, PASSPORT_NUMBER_MISMATCH, PASSPORT_NUMBER_OK, UNKNOWN_DOCUMENT_NOTICE, UNSURE_NOTICE } from './DocumentScanner'

const recognize = vi.mocked(recognizeDocument)
const recognizeClaude = vi.mocked(recognizeDocumentWithClaude)

const PASSPORT_TEXT = `P<AUSSMITH<<JOHN<ROBERT<<<<<<<<<<<<<<<<<<<<<
N1234567<7AUS9001011M3001019<<<<<<<<<<<<<<02`

const KTP_TEXT = `NIK : 3273010503900001
Nama : BUDI SANTOSO
Tempat/Tgl Lahir : BANDUNG, 05-03-1990
Jenis Kelamin : LAKI-LAKI`

function scanResultFor(text: string): DocumentScanResult {
  return { text, ocrConfidence: 90, image: new Blob(['jpg'], { type: 'image/jpeg' }), engine: 'tesseract', unclear: [], notes: '', cost: null, ...interpretOcrText(text, new Date(2026, 9, 12)) }
}

function claudeResult(cost: number | null = 0.0312): DocumentScanResult {
  const read = interpretClaudeScan(DEMO_KTP_SCAN_RESULT)
  return { ...read, text: read.lines.join('\n'), ocrConfidence: null, image: new Blob(['jpg'], { type: 'image/jpeg' }), engine: 'claude', cost: cost === null ? null : { cost_usd: cost, fell_back: false } }
}

function pickFile() {
  const input = screen.getByTestId('scanner-file-input')
  fireEvent.change(input, { target: { files: [new File(['x'], 'doc.jpg', { type: 'image/jpeg' })] } })
}

describe('DocumentScanner', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
  })
  afterEach(() => {
    cleanup()
    recognize.mockReset()
    recognizeClaude.mockReset()
    vi.mocked(engine.recordClaudeScan).mockClear()
    Object.assign(engine, { defaultEngine: 'tesseract', isLocalMode: false, showsCost: true, online: true })
    vi.unstubAllGlobals()
  })

  it('shows the idle panel with camera / gallery buttons and the phone notice', () => {
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.getByRole('button', { name: /Ambil foto/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pilih gambar/ })).toBeTruthy()
    expect(screen.getByText(/Nomor HP tidak ada/)).toBeTruthy()
  })

  it('detects a passport, shows the check-digit status and applies id_type/id_number/nationality', async () => {
    recognize.mockResolvedValue(scanResultFor(PASSPORT_TEXT))
    const onApply = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} current={{ id_type: 'ktp', full_name: 'Johnny' }} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: Paspor')).toBeTruthy())
    expect(screen.getByText(PASSPORT_NUMBER_OK)).toBeTruthy()
    expect(screen.getByText('N1234567')).toBeTruthy()
    expect(screen.getByText('AUS')).toBeTruthy()
    // the typed name differs -> unchecked by default
    const nameBox = screen.getByLabelText(/Nama lengkap/) as HTMLInputElement
    expect(nameBox.checked).toBe(false)
    const numberBox = screen.getByLabelText(/Nomor paspor/) as HTMLInputElement
    expect(numberBox.checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Terapkan/ }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const [prefill, image] = onApply.mock.calls[0] as [Record<string, unknown>, Blob | null]
    expect(prefill).toMatchObject({ id_type: 'passport', id_number: 'N1234567', nationality: 'AUS', gender: 'L', birth_date: '1990-01-01' })
    expect(prefill.full_name).toBeUndefined()
    expect(image).toBeInstanceOf(Blob)
  })

  it('warns "Periksa nomor paspor" and marks the number row when the check digit fails', async () => {
    recognize.mockResolvedValue(scanResultFor(PASSPORT_TEXT.replace('N1234567', 'N1234568')))
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: Paspor')).toBeTruthy())
    expect(screen.getByText(PASSPORT_NUMBER_CHECK)).toBeTruthy()
    expect(screen.queryByText(PASSPORT_NUMBER_OK)).toBeNull()
    expect(screen.getByText('N1234568')).toBeTruthy()
    expect(screen.getByText(PASSPORT_NUMBER_MISMATCH)).toBeTruthy()
    expect(screen.queryByText(/Keyakinan tinggi · 100%/)).toBeNull()
  })

  it('asks before a passport scan replaces a typed NIK (switch unchecked by default)', async () => {
    recognize.mockResolvedValue(scanResultFor(PASSPORT_TEXT))
    const onApply = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} current={{ id_type: 'ktp', nik: '3273011501900003' }} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: Paspor')).toBeTruthy())
    const row = screen.getByTestId('scanner-id-type-row')
    expect(row.textContent).toContain('KTP → Paspor (NIK 3273011501900003 akan dihapus)')
    const typeBox = row.querySelector('input') as HTMLInputElement
    expect(typeBox.checked).toBe(false)
    const numberBox = screen.getByLabelText(/Nomor paspor/) as HTMLInputElement
    expect(numberBox.checked).toBe(false)
    expect(numberBox.disabled).toBe(true)

    // Unchecked: the form keeps KTP (and its NIK); only the other fields are applied.
    fireEvent.click(screen.getByRole('button', { name: /Terapkan/ }))
    const [kept] = onApply.mock.calls[0] as [Record<string, unknown>]
    expect(kept).toMatchObject({ id_type: 'ktp', full_name: 'John Robert Smith', gender: 'L' })
    expect(kept.id_number).toBeUndefined()
    expect(kept.nationality).toBeUndefined()
  })

  it('switches to Paspor when the identity-type row is checked', async () => {
    recognize.mockResolvedValue(scanResultFor(PASSPORT_TEXT))
    const onApply = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} current={{ id_type: 'ktp', nik: '3273011501900003' }} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByTestId('scanner-id-type-row')).toBeTruthy())
    fireEvent.click(screen.getByTestId('scanner-id-type-row').querySelector('input') as HTMLInputElement)
    expect((screen.getByLabelText(/Nomor paspor/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Terapkan/ }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ id_type: 'passport', id_number: 'N1234567', nationality: 'AUS' })
  })

  it('stops a running scan on unmount without creating a preview URL', async () => {
    let finish: (r: DocumentScanResult) => void = () => undefined
    recognize.mockImplementation(
      () =>
        new Promise<DocumentScanResult>((resolve) => {
          finish = resolve
        }),
    )
    const { unmount } = render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1))
    const signal = recognize.mock.calls[0][2]
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
    finish(scanResultFor(PASSPORT_TEXT))
    await Promise.resolve()
    await Promise.resolve()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('detects a KTP and applies the NIK with id_type ktp', async () => {
    recognize.mockResolvedValue(scanResultFor(KTP_TEXT))
    const onApply = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: KTP')).toBeTruthy())
    expect(screen.getByText('3273010503900001')).toBeTruthy()
    expect(screen.queryByText(PASSPORT_NUMBER_OK)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Terapkan/ }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ id_type: 'ktp', nik: '3273010503900001', full_name: 'Budi Santoso', gender: 'L', birth_date: '1990-03-05' })
  })

  it('reports an unrecognised document and offers manual entry', async () => {
    recognize.mockResolvedValue(scanResultFor('Struk belanja\nTotal 25.000'))
    const onApply = vi.fn()
    const onCancel = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} onCancel={onCancel} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getAllByText(UNKNOWN_DOCUMENT_NOTICE).length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /Terapkan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Isi manual$/ }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('returns to idle and shows the OCR error when recognition fails', async () => {
    recognize.mockRejectedValue(new Error('Scan dokumen gagal: x'))
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText(/Scan dokumen gagal/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Ambil foto/ })).toBeTruthy()
  })

  // SPEC 7.19: Claude as the reader, chosen by the organisation and switchable for one scan
  it('with Claude as the default: the switch starts on Claude with the consent line, the photo goes to Claude, and the review shows its note, the unsure row and the cost', async () => {
    engine.defaultEngine = 'claude'
    recognizeClaude.mockResolvedValue(claudeResult())
    const onApply = vi.fn()
    render(
      <ToastProvider>
        <DocumentScanner onApply={onApply} />
      </ToastProvider>,
    )
    const claude = screen.getByRole('radio', { name: /Claude/ })
    expect(claude.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('scanner-engine-note').textContent).toContain(SCAN_ENGINE_DESCRIPTION.claude)
    expect(screen.queryByText(/Mengunduh data OCR/)).toBeNull()

    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: KTP')).toBeTruthy())
    expect(recognizeClaude).toHaveBeenCalledTimes(1)
    expect(recognizeClaude.mock.calls[0][1]).toBe('org-1')
    expect(recognize).not.toHaveBeenCalled()
    expect(engine.recordClaudeScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Dibaca Claude')).toBeTruthy()
    expect(screen.getByTestId('scanner-notes').textContent).toContain('Baris alamat agak buram, mohon dicek.')
    expect(screen.getByTestId('scan-cost').textContent).toBe('Biaya scan ini: US$0,0312')
    expect(screen.queryByTestId('scanner-demo-note')).toBeNull()
    // the unsure mark sits on the address row only
    const addressRow = screen.getByText('Jl. Melati No. 12, RT/RW 003/005, Sukajadi, Coblong, Bandung, Jawa Barat').closest('li') as HTMLElement
    expect(addressRow.textContent).toContain(UNSURE_NOTICE)
    const nameRow = screen.getByText('Budi Santoso').closest('li') as HTMLElement
    expect(nameRow.textContent).not.toContain(UNSURE_NOTICE)
    expect(screen.getByText('Lihat data yang terbaca')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Terapkan/ }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ id_type: 'ktp', nik: '3273012505900002', full_name: 'Budi Santoso', gender: 'L', birth_date: '1990-05-25' })
  })

  it('switching to "Di HP" for one scan reads on the device instead', async () => {
    engine.defaultEngine = 'claude'
    recognize.mockResolvedValue(scanResultFor(KTP_TEXT))
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Di HP/ }))
    expect(screen.getByTestId('scanner-engine-note').textContent).toContain(SCAN_ENGINE_DESCRIPTION.tesseract)
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: KTP')).toBeTruthy())
    expect(recognize).toHaveBeenCalledTimes(1)
    expect(recognizeClaude).not.toHaveBeenCalled()
    expect(engine.recordClaudeScan).not.toHaveBeenCalled()
    expect(screen.getByText('Dibaca di HP')).toBeTruthy()
    expect(screen.queryByTestId('scan-cost')).toBeNull()
    expect(screen.getByText('Lihat teks hasil OCR')).toBeTruthy()
  })

  it('offline, Claude falls back to the device and says so', async () => {
    engine.defaultEngine = 'claude'
    engine.online = false
    recognize.mockResolvedValue(scanResultFor(KTP_TEXT))
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.getByTestId('scanner-engine-note').textContent).toContain(OFFLINE_ENGINE_NOTICE)
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: KTP')).toBeTruthy())
    expect(recognize).toHaveBeenCalledTimes(1)
    expect(recognizeClaude).not.toHaveBeenCalled()
  })

  it('Mode Demo: Claude shows the labelled sample card at the sample cost, without calling the server (also offline: the sample needs no network)', async () => {
    engine.defaultEngine = 'claude'
    engine.isLocalMode = true
    engine.online = false
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Terdeteksi: KTP')).toBeTruthy())
    expect(recognizeClaude).not.toHaveBeenCalled()
    expect(screen.getByTestId('scanner-demo-note').textContent).toBe(CLAUDE_DEMO_NOTICE)
    expect(screen.getByTestId('scan-cost').textContent).toBe('Biaya scan ini: US$0,03 (contoh)')
    expect(engine.recordClaudeScan).toHaveBeenCalledTimes(1)
  })

  it('staff do not see what a Claude scan cost', async () => {
    engine.defaultEngine = 'claude'
    engine.showsCost = false
    recognizeClaude.mockResolvedValue(claudeResult())
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText('Dibaca Claude')).toBeTruthy())
    expect(screen.queryByTestId('scan-cost')).toBeNull()
  })

  it('shows the Claude error as is and returns to idle', async () => {
    engine.defaultEngine = 'claude'
    recognizeClaude.mockRejectedValue(new Error('Kredit API Claude habis. Pemilik perlu menambah kredit di platform.claude.com, atau menunggu kredit bulan berikutnya.'))
    render(
      <ToastProvider>
        <DocumentScanner onApply={() => undefined} />
      </ToastProvider>,
    )
    pickFile()
    await waitFor(() => expect(screen.getByText(/Kredit API Claude habis/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Ambil foto/ })).toBeTruthy()
    expect(engine.recordClaudeScan).not.toHaveBeenCalled()
  })
})
