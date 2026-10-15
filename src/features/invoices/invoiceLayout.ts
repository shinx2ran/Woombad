/**
 * Layout of the invoice image (SPEC 7.2): turns an InvoiceDocument into a list of drawing ops (text, line,
 * rect, image) on a 1080 px wide page, so the layout is unit-testable without a canvas and the renderer
 * (renderInvoiceImage) is a thin loop. Text widths come from the `measure` callback the renderer provides
 * (canvas measureText with the op's font); the tests use a fake one.
 *
 * All coordinates are px from the top-left; text ops are positioned by their top edge (canvas
 * textBaseline 'top') unless `baseline` says 'middle' (the status pill).
 */
import type { InvoiceDocument } from '../../domain/invoiceDocument'
import { STATUS_LABEL_PAID, STATUS_LABEL_PARTIAL, STATUS_LABEL_UNPAID, STATUS_LABEL_VOID } from '../../domain/invoiceDocument'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'

/** 2x a 540 px phone image: crisp on a phone screen, small enough for WhatsApp. */
export const PAGE_WIDTH = 1080
export const PAGE_PADDING = 56
export const MIN_PAGE_HEIGHT = 600
export const BASE_FONT_SIZE = 30
export const LOGO_MAX_HEIGHT = 150
/** a very wide (banner-style) logo must leave room for the kos name next to it */
export const LOGO_MAX_WIDTH = 320
export const FONT_FAMILY = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
export const MONO_FONT_FAMILY = 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace'

/** Tailwind-ish palette (slate / emerald / red / amber) so the image matches the app. */
export const COLORS = {
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  rule: '#e2e8f0',
  ruleStrong: '#334155',
  box: '#f1f5f9',
  emerald: '#047857',
  red: '#b91c1c',
} as const

/** Pill colours keyed by InvoiceDocument.statusLabel. */
export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  [STATUS_LABEL_PAID]: { bg: '#d1fae5', fg: '#065f46' },
  [STATUS_LABEL_PARTIAL]: { bg: '#fef3c7', fg: '#92400e' },
  [STATUS_LABEL_UNPAID]: { bg: '#fee2e2', fg: '#991b1b' },
  [STATUS_LABEL_VOID]: { bg: '#e2e8f0', fg: '#334155' },
}

export type TextAlign = 'left' | 'right' | 'center'

export interface TextOp {
  kind: 'text'
  text: string
  x: number
  y: number
  /** canvas font string, e.g. 'bold 40px -apple-system, …' */
  font: string
  color: string
  align: TextAlign
  /** 'top' (default) positions by the top of the em box; 'middle' centres on y */
  baseline: 'top' | 'middle'
}

export interface LineOp {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface RectOp {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  color: string
  radius: number
}

/** The kos logo, scaled to fit LOGO_MAX_HEIGHT x LOGO_MAX_WIDTH (aspect kept). */
export interface ImageOp {
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
}

export type DrawOp = TextOp | LineOp | RectOp | ImageOp

export interface InvoiceLayout {
  width: number
  height: number
  ops: DrawOp[]
}

/** Width of `text` drawn with the canvas `font` string. */
export type MeasureText = (text: string, font: string) => number

export interface LayoutOptions {
  /** natural size of the logo image; null/undefined = no logo */
  logo?: { width: number; height: number } | null
  /** 'YYYY-MM-DD' printed in the footer ('Dibuat …'); defaults to today */
  generatedOn?: string
}

/** Canvas font string. */
export function font(size: number, weight: 'normal' | 'bold' = 'normal', family: string = FONT_FAMILY): string {
  return `${weight === 'bold' ? 'bold ' : ''}${size}px ${family}`
}

/** Line box height for a font size. */
export function lineHeight(size: number): number {
  return Math.round(size * 1.3)
}

/**
 * Greedy word wrap: '\n' forces a line break, a word wider than maxWidth is broken by characters, an empty
 * paragraph yields an empty line. `measure` returns the width of a string in the font being laid out.
 */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) {
        out.push(line)
        line = ''
      }
      if (measure(word) <= maxWidth) {
        line = word
        continue
      }
      // a single word wider than the column (a long account number, a URL): break it by characters
      let chunk = ''
      for (const ch of word) {
        if (chunk && measure(chunk + ch) > maxWidth) {
          out.push(chunk)
          chunk = ''
        }
        chunk += ch
      }
      line = chunk
    }
    out.push(line)
  }
  return out
}

/** Logo box: fits inside LOGO_MAX_WIDTH x LOGO_MAX_HEIGHT keeping the aspect ratio. */
export function logoSize(natural: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(LOGO_MAX_HEIGHT / natural.height, LOGO_MAX_WIDTH / natural.width)
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) }
}

export function layoutInvoice(doc: InvoiceDocument, measure: MeasureText, opts: LayoutOptions = {}): InvoiceLayout {
  const ops: DrawOp[] = []
  const P = PAGE_PADDING
  const right = PAGE_WIDTH - P
  const contentWidth = PAGE_WIDTH - 2 * P
  let y = P

  const text = (t: string, x: number, top: number, f: string, color: string, align: TextAlign = 'left', baseline: TextOp['baseline'] = 'top') =>
    ops.push({ kind: 'text', text: t, x, y: top, font: f, color, align, baseline })
  const rule = (top: number, color: string = COLORS.rule, width = 2) =>
    ops.push({ kind: 'line', x1: P, y1: top, x2: right, y2: top, color, width })
  /** Wrapped paragraph; returns the y below it. */
  const paragraph = (t: string, x: number, top: number, size: number, color: string, maxWidth: number, weight: 'normal' | 'bold' = 'normal'): number => {
    const f = font(size, weight)
    let cursor = top
    for (const line of wrapText((s) => measure(s, f), t, maxWidth)) {
      text(line, x, cursor, f, color)
      cursor += lineHeight(size)
    }
    return cursor
  }

  // ---------- header: logo + kos on the left, TAGIHAN + number + status pill on the right ----------
  const titleFont = font(44, 'bold')
  const numberFont = font(28, 'normal', MONO_FONT_FAMILY)
  const pillFont = font(26, 'bold')
  const pillPadX = 22
  const pillHeight = 48
  const pillWidth = Math.round(measure(doc.statusLabel, pillFont) + 2 * pillPadX)
  const rightWidth = Math.max(measure('TAGIHAN', titleFont), measure(doc.number, numberFont), pillWidth)
  let ry = y
  text('TAGIHAN', right, ry, titleFont, COLORS.ink, 'right')
  ry += lineHeight(44) + 2
  text(doc.number, right, ry, numberFont, COLORS.muted, 'right')
  ry += lineHeight(28) + 12
  const pill = STATUS_COLORS[doc.statusLabel] ?? STATUS_COLORS[STATUS_LABEL_UNPAID]
  ops.push({ kind: 'rect', x: right - pillWidth, y: ry, width: pillWidth, height: pillHeight, color: pill.bg, radius: pillHeight / 2 })
  text(doc.statusLabel, right - pillWidth / 2, ry + pillHeight / 2, pillFont, pill.fg, 'center', 'middle')
  ry += pillHeight

  let leftX = P
  let logoBottom = y
  if (opts.logo && opts.logo.width > 0 && opts.logo.height > 0) {
    const size = logoSize(opts.logo)
    ops.push({ kind: 'image', x: P, y, width: size.width, height: size.height })
    leftX = P + size.width + 28
    logoBottom = y + size.height
  }
  const leftWidth = right - rightWidth - 32 - leftX
  let ly = paragraph(doc.property.name, leftX, y, 40, COLORS.ink, leftWidth, 'bold')
  if (doc.property.address) ly = paragraph(doc.property.address, leftX, ly + 4, 28, COLORS.muted, leftWidth)
  y = Math.max(logoBottom, ly, ry) + 36
  rule(y)
  y += 36

  // ---------- info grid: two columns, label over value ----------
  const columnGap = 40
  const columnWidth = (contentWidth - columnGap) / 2
  const labelFont = font(26)
  const valueFont = font(30)
  const subFont = font(24)
  const cell = (x: number, top: number, label: string, value: string, sub?: string): number => {
    text(label, x, top, labelFont, COLORS.muted)
    let cursor = top + lineHeight(26) + 2
    for (const line of wrapText((s) => measure(s, valueFont), value, columnWidth)) {
      text(line, x, cursor, valueFont, COLORS.ink)
      cursor += lineHeight(30)
    }
    if (sub) {
      text(sub, x, cursor, subFont, COLORS.muted)
      cursor += lineHeight(24)
    }
    return cursor
  }
  // check-in – check-out day (SPEC 7.3): doc.period.end is the stored last night, doc.period.checkout the day after
  const period = `${formatDate(doc.period.start)} – ${formatDate(doc.period.checkout)}`
  const periodSub = `${doc.period.quantity} ${doc.period.unit} · ${doc.period.typeLabel}`
  const grid: [string, string, string?][][] = [
    [
      ['Penyewa', doc.tenant.name],
      ['Kamar', doc.room],
    ],
    [
      ['Periode', period, periodSub],
      ['Jatuh tempo', formatDate(doc.dueDate)],
    ],
    [['Tanggal terbit', formatDate(doc.issuedDate)]],
  ]
  for (const row of grid) {
    let rowBottom = y
    row.forEach(([label, value, sub], i) => {
      rowBottom = Math.max(rowBottom, cell(P + i * (columnWidth + columnGap), y, label, value, sub))
    })
    y = rowBottom + 20
  }
  y += 10
  rule(y)
  y += 32

  // ---------- items ----------
  const amountFont = font(30)
  for (const line of doc.lines) {
    const amount = formatRupiah(line.amount)
    const labelWidth = contentWidth - measure(amount, amountFont) - 32
    const top = y
    y = paragraph(line.label, P, y, 30, COLORS.ink, labelWidth)
    text(amount, right, top, amountFont, COLORS.ink, 'right')
    if (line.detail) y = paragraph(line.detail, P, y + 2, 24, COLORS.muted, labelWidth)
    y += 16
  }
  if (doc.discount > 0) {
    text('Diskon', P, y, amountFont, COLORS.emerald)
    text(`- ${formatRupiah(doc.discount)}`, right, y, amountFont, COLORS.emerald, 'right')
    y += lineHeight(30) + 16
  }
  y += 4
  rule(y, COLORS.ruleStrong, 4)
  y += 28

  // ---------- totals ----------
  const totalFont = font(36, 'bold')
  text('Total', P, y, totalFont, COLORS.ink)
  text(formatRupiah(doc.total), right, y, totalFont, COLORS.ink, 'right')
  y += lineHeight(36) + 14
  const open = doc.status !== 'void' && doc.remaining > 0
  if (doc.status === 'void') {
    text('Tagihan ini dibatalkan dan tidak perlu dibayar.', P, y, font(26), COLORS.muted)
    y += lineHeight(26)
  } else {
    if (doc.paid > 0) {
      text('Sudah dibayar', P, y, amountFont, COLORS.muted)
      text(formatRupiah(doc.paid), right, y, amountFont, COLORS.body, 'right')
      y += lineHeight(30) + 10
    }
    const remainingFont = font(34, 'bold')
    const tone = open ? COLORS.red : COLORS.emerald
    text('Sisa tagihan', P, y, remainingFont, tone)
    text(formatRupiah(doc.remaining), right, y, remainingFont, tone, 'right')
    y += lineHeight(34)
  }
  y += 32

  // ---------- payments ----------
  if (doc.payments.length > 0) {
    rule(y)
    y += 26
    text('Pembayaran', P, y, font(24, 'bold'), COLORS.muted)
    y += lineHeight(24) + 6
    const paymentFont = font(24)
    for (const p of doc.payments) {
      text(`${formatDate(p.date)} · ${p.methodLabel}`, P, y, paymentFont, COLORS.body)
      text(formatRupiah(p.amount), right, y, paymentFont, COLORS.body, 'right')
      y += lineHeight(24) + 4
    }
    y += 24
  }

  // ---------- payment info box (only while something is still owed) ----------
  if (open && doc.property.paymentInfo) {
    const pad = 24
    const headingFont = font(24, 'bold')
    const infoFont = font(26)
    const lines = wrapText((s) => measure(s, infoFont), doc.property.paymentInfo, contentWidth - 2 * pad)
    const boxHeight = pad + lineHeight(24) + 6 + lines.length * lineHeight(26) + pad
    ops.push({ kind: 'rect', x: P, y, width: contentWidth, height: boxHeight, color: COLORS.box, radius: 16 })
    let cursor = y + pad
    text('Pembayaran ke:', P + pad, cursor, headingFont, COLORS.muted)
    cursor += lineHeight(24) + 6
    for (const line of lines) {
      text(line, P + pad, cursor, infoFont, COLORS.ink)
      cursor += lineHeight(26)
    }
    y += boxHeight + 28
  }

  // ---------- notes ----------
  if (doc.notes) {
    text('Catatan', P, y, font(24, 'bold'), COLORS.muted)
    y = paragraph(doc.notes, P, y + lineHeight(24) + 4, 24, COLORS.body, contentWidth)
    y += 28
  }

  // ---------- footer ----------
  const footerFont = font(24)
  const footerTop = Math.max(y + 8, MIN_PAGE_HEIGHT - P - lineHeight(24))
  text(`Dibuat ${formatDate(opts.generatedOn ?? todayISO())} · Woombad`, P, footerTop, footerFont, COLORS.faint)
  const height = Math.max(MIN_PAGE_HEIGHT, footerTop + lineHeight(24) + P)

  return { width: PAGE_WIDTH, height, ops }
}
