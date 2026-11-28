// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Invoice, Payment } from '../../types/db'
import { EditInvoiceModal } from './InvoiceFormModal'
import type { LeaseActions } from './useLeaseActions'

vi.mock('../settings/audit/RecordHistory', () => ({ RecordHistory: () => null }))

afterEach(cleanup)

const ts = { org_id: 'o', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function charge(notes: string, over: Partial<Invoice> = {}): Invoice {
  return {
    ...ts,
    id: 'c',
    property_id: 'P',
    lease_id: 'L',
    invoice_number: 'INV-202611-0009',
    invoice_type: 'charge',
    period_type: null,
    period_start: '2026-11-20',
    period_end: '2026-11-20',
    quantity: 1,
    base_amount: 0,
    addons_amount: 0,
    extra_amount: 300_000,
    discount_amount: 200_000,
    total_amount: 100_000,
    due_date: '2026-11-20',
    status: 'paid',
    notes,
    ...over,
  } as Invoice
}

const paid: Payment[] = [{ ...ts, id: 'p', property_id: 'P', invoice_id: 'c', lease_id: 'L', amount: 100_000, paid_at: '2026-11-21', method: 'cash', kind: 'rent', notes: null, created_by: null } as Payment]

function setup(invoice: Invoice) {
  const updateInvoice = vi.fn(async () => {})
  render(
    <ToastProvider>
      <EditInvoiceModal open onClose={() => {}} invoice={invoice} payments={paid} actions={{ updateInvoice } as unknown as LeaseActions} />
    </ToastProvider>,
  )
  return { updateInvoice, save: screen.getByRole('button', { name: 'Simpan' }) }
}

// SPEC 7.31 + 2b.4: Batalkan sewa writes a closing line under a part-paid charge's keterangan
describe('Ubah biaya tambahan on a charge closed by Batalkan sewa', () => {
  it('shows only the keterangan and keeps the closing line when saved', async () => {
    const { updateInvoice, save } = setup(charge('Kerusakan\nSisa dianggap hangus (sewa dibatalkan)'))
    const field = screen.getByLabelText('Keterangan') as HTMLInputElement
    expect(field.value).toBe('Kerusakan')
    fireEvent.change(field, { target: { value: 'Kerusakan kipas' } })
    fireEvent.click(save)
    await waitFor(() => expect(updateInvoice).toHaveBeenCalled())
    expect(updateInvoice).toHaveBeenCalledWith(expect.anything(), paid, {
      base_amount: 0,
      extra_amount: 300_000,
      discount_amount: 200_000,
      notes: 'Kerusakan kipas\nSisa dianggap hangus (sewa dibatalkan)',
    })
  })

  it('a long keterangan is not pushed over the 200-letter limit by the closing line', () => {
    const long = 'K'.repeat(190)
    const { save } = setup(charge(`${long}\nDP dikembalikan (sewa dibatalkan)`))
    expect((screen.getByLabelText('Keterangan') as HTMLInputElement).value).toBe(long)
    expect(screen.queryByText(/Keterangan maksimal/)).toBeNull()
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('a charge without closing notes saves its keterangan alone', async () => {
    const { updateInvoice, save } = setup(charge('Late checkout', { discount_amount: 0, total_amount: 300_000, status: 'partial' }))
    fireEvent.click(save)
    await waitFor(() => expect(updateInvoice).toHaveBeenCalled())
    expect(updateInvoice).toHaveBeenCalledWith(expect.anything(), paid, expect.objectContaining({ notes: 'Late checkout' }))
  })
})
