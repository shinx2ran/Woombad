import { describe, expect, it } from 'vitest'
import { receiptText, reminderText } from './messages'

describe('messages', () => {
  it('reminderText includes amount, due date and payment info', () => {
    const t = reminderText({
      tenantName: 'Budi Santoso',
      roomName: 'A1',
      propertyName: 'Kos Melati',
      outstanding: 1_250_000,
      dueDate: '2026-03-05',
      periodStart: '2026-03-05',
      periodEnd: '2026-04-04',
      paymentInfo: 'BCA 1234567890 a.n. Ibu Sari',
    })
    expect(t).toContain('Halo Kak Budi')
    expect(t).toContain('Rp 1.250.000')
    expect(t).toContain('5 Mar 2026')
    expect(t).toContain('4 Apr 2026')
    expect(t).toContain('BCA 1234567890')
  })
  it('reminderText omits the payment line when info is empty', () => {
    const t = reminderText({ tenantName: 'Siti', roomName: 'B2', propertyName: 'Kos Anggrek', outstanding: 500_000, dueDate: '2026-03-05', paymentInfo: '  ' })
    expect(t).not.toContain('Pembayaran dapat dilakukan')
  })
  it('receiptText marks lunas vs remaining', () => {
    const base = { tenantName: 'Siti', roomName: 'B2', propertyName: 'Kos Anggrek', amount: 600_000, paidAt: '2026-03-06', methodLabel: 'Transfer', invoiceNumber: 'INV-202603-0002' }
    expect(receiptText({ ...base, remaining: 0 })).toContain('LUNAS')
    expect(receiptText({ ...base, remaining: 600_000 })).toContain('Sisa tagihan: Rp 600.000')
  })
})
