/**
 * Receipt photos straight from a phone camera are often larger than the 5 MB the receipts bucket accepts.
 * Photos are scaled down in the browser (long edge <= 1600 px, JPEG) before the size check and the upload;
 * that is plenty to read a receipt. PDFs and anything the browser cannot decode are left as they are.
 */

export const RECEIPT_MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

/** Target size with the long edge at most `maxEdge`; never enlarges. */
export function scaledSize(width: number, height: number, maxEdge: number = RECEIPT_MAX_EDGE): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge || longEdge <= 0) return { width, height }
  const scale = maxEdge / longEdge
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Only bitmap photos are re-encoded; a small photo that already fits is kept unchanged. */
export function shouldShrink(file: Pick<File, 'type' | 'size'>): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(file.type) && file.size > 300 * 1024
}

export async function shrinkReceiptImage(file: File): Promise<File> {
  if (!shouldShrink(file) || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    // keep the original when re-encoding did not help (e.g. an already small, well-compressed photo)
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^./]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}
