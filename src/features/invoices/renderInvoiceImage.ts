/**
 * Draws the invoice (layoutInvoice) on a canvas and returns it as a PNG blob. Browser only: the layout
 * maths lives in invoiceLayout.ts, this file just executes the ops.
 */
import type { InvoiceDocument } from '../../domain/invoiceDocument'
import { layoutInvoice, type DrawOp } from './invoiceLayout'

export type LogoImage = ImageBitmap | HTMLImageElement

function naturalSize(logo: LogoImage): { width: number; height: number } {
  if ('naturalWidth' in logo) return { width: logo.naturalWidth, height: logo.naturalHeight }
  return { width: logo.width, height: logo.height }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function draw(ctx: CanvasRenderingContext2D, op: DrawOp, logo: LogoImage | null) {
  switch (op.kind) {
    case 'text':
      ctx.font = op.font
      ctx.fillStyle = op.color
      ctx.textAlign = op.align
      ctx.textBaseline = op.baseline
      ctx.fillText(op.text, op.x, op.y)
      break
    case 'line':
      ctx.strokeStyle = op.color
      ctx.lineWidth = op.width
      ctx.beginPath()
      ctx.moveTo(op.x1, op.y1)
      ctx.lineTo(op.x2, op.y2)
      ctx.stroke()
      break
    case 'rect':
      ctx.fillStyle = op.color
      roundedRect(ctx, op.x, op.y, op.width, op.height, op.radius)
      ctx.fill()
      break
    case 'image':
      if (logo) ctx.drawImage(logo, op.x, op.y, op.width, op.height)
      break
  }
}

/** Renders the invoice as a PNG (1080 px wide, white background); the logo is optional. */
export async function renderInvoiceImage(doc: InvoiceDocument, logo?: LogoImage | null): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Browser ini tidak mendukung pembuatan gambar.')
  const measure = (text: string, f: string) => {
    ctx.font = f
    return ctx.measureText(text).width
  }
  const layout = layoutInvoice(doc, measure, { logo: logo ? naturalSize(logo) : null })
  // resizing resets the context state, so the loop sets every style it needs on each op
  canvas.width = layout.width
  canvas.height = layout.height
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)
  for (const op of layout.ops) draw(ctx, op, logo ?? null)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Gagal membuat gambar tagihan.')
  return blob
}

/** Decodes a logo blob for drawImage: createImageBitmap when available, else an <img> from an object URL. */
export function loadLogoImage(blob: Blob): Promise<LogoImage> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Logo tidak dapat dibaca.'))
    }
    img.src = url
  })
}
