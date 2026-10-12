// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { DocumentScanResult } from './ocr'
import { interpretOcrText } from './ocr'

vi.mock('./ocr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ocr')>()
  return { ...actual, recognizeDocument: vi.fn(), hasOcrDataCached: () => true }
})

import { recognizeDocument } from './ocr'
import { DocumentScanner, PASSPORT_NUMBER_OK, UNKNOWN_DOCUMENT_NOTICE } from './DocumentScanner'

const recognize = vi.mocked(recognizeDocument)

const PASSPORT_TEXT = `P<AUSSMITH<<JOHN<ROBERT<<<<<<<<<<<<<<<<<<<<<
N1234567<7AUS9001011M3001019<<<<<<<<<<<<<<02`

const KTP_TEXT = `NIK : 3273010503900001
Nama : BUDI SANTOSO
Tempat/Tgl Lahir : BANDUNG, 05-03-1990
Jenis Kelamin : LAKI-LAKI`

function scanResultFor(text: string): DocumentScanResult {
  return { text, ocrConfidence: 90, image: new Blob(['jpg'], { type: 'image/jpeg' }), ...interpretOcrText(text, new Date(2026, 9, 12)) }
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
})
