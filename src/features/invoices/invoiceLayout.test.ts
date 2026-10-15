import { describe, expect, it } from 'vitest'
import type { InvoiceDocument } from '../../domain/invoiceDocument'
import {
  COLORS,
  LOGO_MAX_HEIGHT,
  LOGO_MAX_WIDTH,
  MIN_PAGE_HEIGHT,
  PAGE_PADDING,
  PAGE_WIDTH,
  STATUS_COLORS,
  font,
  layoutInvoice,
  logoSize,
  wrapText,
  type DrawOp,
  type ImageOp,
  type MeasureText,
  type RectOp,
  type TextOp,
} from './invoiceLayout'

/** Fake canvas: every glyph is 0.55 em wide, bold 0.6 em. */
const measure: MeasureText = (text, f) => {
  const size = Number(/(\d+)px/.exec(f)?.[1] ?? 30)
  return text.length * size * (f.startsWith('bold') ? 0.6 : 0.55)
}

const doc: InvoiceDocument = {
  title: 'TAGIHAN',
  number: 'INV-202610-0007',
  issuedDate: '2026-10-13',
  dueDate: '2026-10-01',
  status: 'unpaid',
  statusLabel: 'BELUM BAYAR',
  property: { name: 'EG Kost', address: 'Jl. Melati No. 12, Bandung', paymentInfo: 'BCA 1234567890 a.n. Ibu Sari', logoPath: null },
  tenant: { name: 'Budi Santoso', phone: '+6281234567801' },
  room: 'A1',
  period: { start: '2026-10-01', end: '2026-10-31', checkout: '2026-11-01', quantity: 1, unit: 'bulan', typeLabel: 'Bulanan' },
  lines: [
    { label: 'Sewa kamar A1', detail: 'Bulanan · 1 bulan · 1 Okt – 1 Nov 2026', amount: 1_200_000 },
    { label: 'Parkir motor', detail: '1 × Rp 50.000', amount: 50_000 },
  ],
  discount: 0,
  total: 1_250_000,
  paid: 0,
  remaining: 1_250_000,
  payments: [],
  notes: null,
}

const texts = (ops: DrawOp[]) => ops.filter((o): o is TextOp => o.kind === 'text')
const findText = (ops: DrawOp[], t: string) => texts(ops).find((o) => o.text === t)
const rects = (ops: DrawOp[]) => ops.filter((o): o is RectOp => o.kind === 'rect')
const images = (ops: DrawOp[]) => ops.filter((o): o is ImageOp => o.kind === 'image')

describe('wrapText', () => {
  const mono = (s: string) => s.length * 10

  it('keeps short text on one line and wraps at word boundaries', () => {
    expect(wrapText(mono, 'Kos Melati', 200)).toEqual(['Kos Melati'])
    expect(wrapText(mono, 'Jl. Melati No. 12, Bandung', 120)).toEqual(['Jl. Melati', 'No. 12,', 'Bandung'])
  })

  it('forces a break on \\n and keeps empty paragraphs as empty lines', () => {
    expect(wrapText(mono, 'BCA 123\na.n. Sari', 500)).toEqual(['BCA 123', 'a.n. Sari'])
    expect(wrapText(mono, 'satu\n\ndua', 500)).toEqual(['satu', '', 'dua'])
    expect(wrapText(mono, '', 500)).toEqual([''])
  })

  it('breaks a word wider than the column by characters', () => {
    expect(wrapText(mono, 'rek 1234567890123', 60)).toEqual(['rek', '123456', '789012', '3'])
    // a column narrower than one character still makes progress
    expect(wrapText(mono, 'abc', 5)).toEqual(['a', 'b', 'c'])
  })

  it('collapses runs of whitespace', () => {
    expect(wrapText(mono, '  a   b  ', 500)).toEqual(['a b'])
  })
})

describe('logoSize', () => {
  it('fits the logo in the header box keeping its aspect ratio', () => {
    expect(logoSize({ width: 1889, height: 1643 })).toEqual({ width: 172, height: LOGO_MAX_HEIGHT })
    expect(logoSize({ width: 300, height: 300 })).toEqual({ width: LOGO_MAX_HEIGHT, height: LOGO_MAX_HEIGHT })
    // a wide banner is limited by the width instead
    expect(logoSize({ width: 2000, height: 300 })).toEqual({ width: LOGO_MAX_WIDTH, height: 48 })
  })
})

describe('STATUS_COLORS', () => {
  it('covers every status label', () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(['BELUM BAYAR', 'DIBATALKAN', 'DP / SEBAGIAN', 'LUNAS'])
  })
})

describe('layoutInvoice', () => {
  const layout = layoutInvoice(doc, measure, { generatedOn: '2026-10-13' })

  it('is a 1080 px page at least 600 px tall with every op inside the padding', () => {
    expect(layout.width).toBe(PAGE_WIDTH)
    expect(layout.height).toBeGreaterThanOrEqual(MIN_PAGE_HEIGHT)
    for (const op of layout.ops) {
      if (op.kind === 'text') {
        expect(op.x).toBeGreaterThanOrEqual(PAGE_PADDING)
        expect(op.x).toBeLessThanOrEqual(PAGE_WIDTH - PAGE_PADDING)
        expect(op.y).toBeGreaterThanOrEqual(PAGE_PADDING)
        expect(op.y).toBeLessThanOrEqual(layout.height - PAGE_PADDING)
        if (op.align === 'left') expect(op.x + measure(op.text, op.font)).toBeLessThanOrEqual(PAGE_WIDTH - PAGE_PADDING + 1)
      }
    }
  })

  it('draws the header: kos name, address, TAGIHAN, number and a status pill in the status colours', () => {
    expect(findText(layout.ops, 'EG Kost')?.font).toBe(font(40, 'bold'))
    expect(findText(layout.ops, 'Jl. Melati No. 12, Bandung')?.color).toBe(COLORS.muted)
    const title = findText(layout.ops, 'TAGIHAN')
    expect(title).toMatchObject({ align: 'right', x: PAGE_WIDTH - PAGE_PADDING, font: font(44, 'bold') })
    expect(findText(layout.ops, 'INV-202610-0007')?.align).toBe('right')
    const pill = findText(layout.ops, 'BELUM BAYAR')
    expect(pill).toMatchObject({ align: 'center', baseline: 'middle', color: STATUS_COLORS['BELUM BAYAR'].fg })
    const pillRect = rects(layout.ops).find((r) => r.color === STATUS_COLORS['BELUM BAYAR'].bg)
    expect(pillRect).toBeDefined()
    expect(pill!.y).toBe(pillRect!.y + pillRect!.height / 2)
    expect(images(layout.ops)).toEqual([])
  })

  it('places the logo on the left and moves the kos name next to it', () => {
    const withLogo = layoutInvoice(doc, measure, { logo: { width: 1889, height: 1643 }, generatedOn: '2026-10-13' })
    const [img] = images(withLogo.ops)
    expect(img).toMatchObject({ x: PAGE_PADDING, y: PAGE_PADDING, width: 172, height: LOGO_MAX_HEIGHT })
    expect(findText(withLogo.ops, 'EG Kost')?.x).toBe(PAGE_PADDING + 172 + 28)
    // the rule under the header clears the logo
    const firstRule = withLogo.ops.find((o) => o.kind === 'line')
    expect(firstRule && firstRule.kind === 'line' ? firstRule.y1 : 0).toBeGreaterThan(PAGE_PADDING + LOGO_MAX_HEIGHT)
  })

  it('shows the parties, period, due and issue dates', () => {
    for (const label of ['Penyewa', 'Kamar', 'Periode', 'Jatuh tempo', 'Tanggal terbit']) expect(findText(layout.ops, label)?.color).toBe(COLORS.muted)
    expect(findText(layout.ops, 'Budi Santoso')).toBeDefined()
    expect(findText(layout.ops, 'A1')).toBeDefined()
    // check-in – check-out day (SPEC 7.3), never the stored last night
    expect(findText(layout.ops, '1 Okt 2026 – 1 Nov 2026')).toBeDefined()
    expect(texts(layout.ops).some((o) => o.text.includes('31 Okt'))).toBe(false)
    expect(findText(layout.ops, '1 bulan · Bulanan')).toBeDefined()
    expect(findText(layout.ops, '1 Okt 2026')).toBeDefined()
    expect(findText(layout.ops, '13 Okt 2026')).toBeDefined()
    // values sit under their label, labels of one row share a baseline
    expect(findText(layout.ops, 'Budi Santoso')!.y).toBeGreaterThan(findText(layout.ops, 'Penyewa')!.y)
    expect(findText(layout.ops, 'Kamar')!.y).toBe(findText(layout.ops, 'Penyewa')!.y)
    expect(findText(layout.ops, 'Kamar')!.x).toBeGreaterThan(PAGE_WIDTH / 2)
  })

  it('prints a 2-night stay up to its check-out day', () => {
    const twoNights = layoutInvoice(
      { ...doc, period: { start: '2026-10-15', end: '2026-10-16', checkout: '2026-10-17', quantity: 2, unit: 'malam', typeLabel: 'Harian' } },
      measure,
      { generatedOn: '2026-10-13' },
    )
    expect(findText(twoNights.ops, '15 Okt 2026 – 17 Okt 2026')).toBeDefined()
    expect(findText(twoNights.ops, '2 malam · Harian')).toBeDefined()
  })

  it('lists the lines with right-aligned amounts and details under the labels', () => {
    const sewa = findText(layout.ops, 'Sewa kamar A1')!
    const amount = texts(layout.ops).find((o) => o.text === 'Rp 1.200.000')!
    expect(amount).toMatchObject({ align: 'right', y: sewa.y })
    const detail = findText(layout.ops, 'Bulanan · 1 bulan · 1 Okt – 1 Nov 2026')!
    expect(detail.y).toBeGreaterThan(sewa.y)
    expect(detail.color).toBe(COLORS.muted)
    const parkir = findText(layout.ops, 'Parkir motor')!
    expect(parkir.y).toBeGreaterThan(detail.y)
    expect(findText(layout.ops, 'Diskon')).toBeUndefined()
  })

  it('prints the totals: Total bold, Sisa tagihan red while open, no Sudah dibayar at 0', () => {
    const total = findText(layout.ops, 'Total')!
    expect(total.font).toBe(font(36, 'bold'))
    expect(texts(layout.ops).filter((o) => o.text === 'Rp 1.250.000').some((o) => o.font === font(36, 'bold') && o.align === 'right')).toBe(true)
    expect(findText(layout.ops, 'Sudah dibayar')).toBeUndefined()
    expect(findText(layout.ops, 'Sisa tagihan')?.color).toBe(COLORS.red)
    // thick rule above the total
    const thick = layout.ops.find((o) => o.kind === 'line' && o.width === 4)
    expect(thick && thick.kind === 'line' ? thick.y1 : Infinity).toBeLessThan(total.y)
  })

  it('shows the payment info box only while something is owed', () => {
    expect(findText(layout.ops, 'Pembayaran ke:')).toBeDefined()
    expect(findText(layout.ops, 'BCA 1234567890 a.n. Ibu Sari')).toBeDefined()
    const box = rects(layout.ops).find((r) => r.color === COLORS.box)!
    expect(box.width).toBe(PAGE_WIDTH - 2 * PAGE_PADDING)
    const heading = findText(layout.ops, 'Pembayaran ke:')!
    expect(heading.y).toBeGreaterThan(box.y)
    expect(heading.y).toBeLessThan(box.y + box.height)

    const paid = layoutInvoice({ ...doc, statusLabel: 'LUNAS', paid: 1_250_000, remaining: 0 }, measure)
    expect(findText(paid.ops, 'Pembayaran ke:')).toBeUndefined()
    const noInfo = layoutInvoice({ ...doc, property: { ...doc.property, paymentInfo: null } }, measure)
    expect(findText(noInfo.ops, 'Pembayaran ke:')).toBeUndefined()
  })

  it('shows a discount in emerald, the paid amount, a green Rp 0 and the payments list on a paid invoice', () => {
    const paid = layoutInvoice(
      {
        ...doc,
        statusLabel: 'LUNAS',
        status: 'paid',
        discount: 50_000,
        total: 1_200_000,
        paid: 1_200_000,
        remaining: 0,
        payments: [
          { date: '2026-10-01', amount: 700_000, methodLabel: 'QRIS' },
          { date: '2026-10-05', amount: 500_000, methodLabel: 'Tunai' },
        ],
      },
      measure,
    )
    expect(findText(paid.ops, 'Diskon')?.color).toBe(COLORS.emerald)
    expect(findText(paid.ops, '- Rp 50.000')).toMatchObject({ align: 'right', color: COLORS.emerald })
    expect(findText(paid.ops, 'Sudah dibayar')).toBeDefined()
    const remaining = findText(paid.ops, 'Sisa tagihan')!
    expect(remaining.color).toBe(COLORS.emerald)
    expect(texts(paid.ops).find((o) => o.text === 'Rp 0')).toMatchObject({ color: COLORS.emerald, y: remaining.y })
    expect(findText(paid.ops, 'Pembayaran')).toBeDefined()
    expect(findText(paid.ops, '1 Okt 2026 · QRIS')).toBeDefined()
    expect(findText(paid.ops, '5 Okt 2026 · Tunai')).toBeDefined()
    expect(findText(paid.ops, 'Rp 700.000')?.align).toBe('right')
    expect(findText(paid.ops, 'LUNAS')?.color).toBe(STATUS_COLORS.LUNAS.fg)
  })

  it('replaces the remaining amount with a note on a cancelled invoice', () => {
    const cancelled = layoutInvoice({ ...doc, status: 'void', statusLabel: 'DIBATALKAN' }, measure)
    expect(findText(cancelled.ops, 'Sisa tagihan')).toBeUndefined()
    expect(findText(cancelled.ops, 'Tagihan ini dibatalkan dan tidak perlu dibayar.')).toBeDefined()
    expect(findText(cancelled.ops, 'Pembayaran ke:')).toBeUndefined()
    expect(findText(cancelled.ops, 'DIBATALKAN')?.color).toBe(STATUS_COLORS.DIBATALKAN.fg)
  })

  it('prints notes and the footer, and grows with the content', () => {
    expect(findText(layout.ops, 'Catatan')).toBeUndefined()
    const footer = findText(layout.ops, 'Dibuat 13 Okt 2026 · Woombad')!
    expect(footer.color).toBe(COLORS.faint)
    expect(layout.height).toBe(footer.y + Math.round(24 * 1.3) + PAGE_PADDING)

    const long = layoutInvoice(
      {
        ...doc,
        notes: 'Harap bayar sebelum tanggal 5.\nListrik dibayar terpisah sesuai meteran.',
        lines: [...doc.lines, ...Array.from({ length: 8 }, (_, i) => ({ label: `Tambahan ${i + 1}`, amount: 10_000 }))],
      },
      measure,
      { generatedOn: '2026-10-13' },
    )
    expect(findText(long.ops, 'Catatan')).toBeDefined()
    expect(findText(long.ops, 'Harap bayar sebelum tanggal 5.')).toBeDefined()
    expect(findText(long.ops, 'Listrik dibayar terpisah sesuai meteran.')).toBeDefined()
    expect(long.height).toBeGreaterThan(layout.height + 8 * 30)
    const longFooter = findText(long.ops, 'Dibuat 13 Okt 2026 · Woombad')!
    expect(longFooter.y).toBeGreaterThan(findText(long.ops, 'Listrik dibayar terpisah sesuai meteran.')!.y)
  })

  it('wraps a long kos name and address beside the right block', () => {
    const wide = layoutInvoice(
      { ...doc, property: { ...doc.property, name: 'Kos Putri Melati Indah Permai Asri Sejahtera', address: 'Jl. Raya Soekarno Hatta Km. 12 Blok C No. 45 RT 03 RW 07, Kelurahan Sukamaju, Kecamatan Cibeunying Kidul, Kota Bandung 40123' } },
      measure,
    )
    const nameLines = texts(wide.ops).filter((o) => o.font === font(40, 'bold'))
    expect(nameLines.length).toBeGreaterThan(1)
    const addressLines = texts(wide.ops).filter((o) => o.font === font(28) && o.color === COLORS.muted && o.x === PAGE_PADDING)
    expect(addressLines.length).toBeGreaterThan(1)
    const rightEdge = PAGE_WIDTH - PAGE_PADDING - measure('TAGIHAN', font(44, 'bold')) - 32
    for (const line of [...nameLines, ...addressLines]) expect(line.x + measure(line.text, line.font)).toBeLessThanOrEqual(rightEdge + 1)
    // the info grid starts below the whole header
    const penyewa = findText(wide.ops, 'Penyewa')!
    for (const line of [...nameLines, ...addressLines]) expect(line.y).toBeLessThan(penyewa.y)
  })

  it('never overlaps two left-aligned texts in the same column', () => {
    const paid = layoutInvoice(
      { ...doc, paid: 500_000, remaining: 750_000, statusLabel: 'DP / SEBAGIAN', payments: [{ date: '2026-10-01', amount: 500_000, methodLabel: 'QRIS' }], notes: 'Catatan singkat' },
      measure,
    )
    const left = texts(paid.ops)
      .filter((o) => o.align === 'left' && o.x === PAGE_PADDING)
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < left.length; i++) {
      const prev = left[i - 1]
      const size = Number(/(\d+)px/.exec(prev.font)?.[1])
      expect(left[i].y).toBeGreaterThanOrEqual(prev.y + size)
    }
  })
})
