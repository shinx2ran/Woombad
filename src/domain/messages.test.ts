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
    // one month from 5 Mar: last night 4 Apr, shown as the check-out day 5 Apr (SPEC 7.3)
    expect(t).toContain('Tagihan kamar A1 periode 5 Mar 2026 s/d 5 Apr 2026 sebesar *Rp 1.250.000* jatuh tempo 5 Mar 2026.')
    expect(t).not.toContain('4 Apr 2026')
    expect(t).toContain('BCA 1234567890')
  })
  it('reminderText shows a 2-night stay up to its check-out day, and no period without both dates', () => {
    const base = { tenantName: 'Siti', roomName: 'B2', propertyName: 'Kos Anggrek', outstanding: 300_000, dueDate: '2026-10-15' }
    expect(reminderText({ ...base, periodStart: '2026-10-15', periodEnd: '2026-10-16' })).toContain('periode 15 Okt 2026 s/d 17 Okt 2026 sebesar')
    expect(reminderText({ ...base, periodStart: '2026-12-31', periodEnd: '2026-12-31' })).toContain('periode 31 Des 2026 s/d 1 Jan 2027 sebesar')
    expect(reminderText({ ...base, periodStart: '2026-10-15' })).toContain('Tagihan kamar B2 sebesar *Rp 300.000* jatuh tempo 15 Okt 2026.')
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
  it('receiptText prints the period up to the check-out day (stored period_end + 1)', () => {
    const base = { tenantName: 'Siti', roomName: 'B2', propertyName: 'Kos Anggrek', amount: 700_000, paidAt: '2026-10-15', methodLabel: 'Tunai', remaining: 0 }
    const week = receiptText({ ...base, periodStart: '2026-10-15', periodEnd: '2026-10-21' })
    expect(week).toContain('Periode: 15 Okt 2026 s/d 22 Okt 2026')
    expect(week).toContain('Tanggal: 15 Okt 2026')
    expect(receiptText(base)).not.toContain('Periode:')
  })
})
