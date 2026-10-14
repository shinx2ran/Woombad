/**
 * The kos logo (bucket `logos`, 1 MB limit) is drawn about 150 px tall on the invoice image, so anything
 * larger than 600 px on its long edge is scaled down in the browser before the upload. PNG and WebP sources
 * are re-encoded as PNG (keeps transparency), photos (JPEG) as JPEG. Mirrors expenses/receiptImage.ts.
 */

export const LOGO_MAX_EDGE = 600
/** a logo at most this big and within the edge limit is uploaded as picked */
export const LOGO_KEEP_BYTES = 300 * 1024
const JPEG_QUALITY = 0.9

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp'

export type LogoOutputType = 'image/png' | 'image/jpeg'

export function isLogoType(type: string): boolean {
  return /^image\/(png|jpeg|webp)$/i.test(type)
}

/** Target size with the long edge at most `maxEdge`; never enlarges. */
export function logoScaledSize(width: number, height: number, maxEdge: number = LOGO_MAX_EDGE): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge || longEdge <= 0) return { width, height }
  const scale = maxEdge / longEdge
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** PNG for sources that may be transparent (PNG, WebP), JPEG for photos. */
export function logoOutputType(sourceType: string): LogoOutputType {
  return /^image\/(png|webp)$/i.test(sourceType) ? 'image/png' : 'image/jpeg'
}

/** File extension for the storage path. */
export function logoExtension(type: string): 'png' | 'jpg' | 'webp' {
  if (/^image\/png$/i.test(type)) return 'png'
  if (/^image\/webp$/i.test(type)) return 'webp'
  return 'jpg'
}

/** True when the picked file can be uploaded as is: already within the edge limit and small. */
export function shouldKeepLogo(file: Pick<File, 'size'>, width: number, height: number, maxEdge: number = LOGO_MAX_EDGE): boolean {
  return Math.max(width, height) <= maxEdge && file.size <= LOGO_KEEP_BYTES
}

/**
 * Shrinks a picked logo for the upload (see the file comment). Returns the original file when it is
 * already small, or when the browser cannot decode it (the upload size check decides then).
 */
export async function shrinkLogoImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  const bitmap = await createImageBitmap(file)
  try {
    if (shouldKeepLogo(file, bitmap.width, bitmap.height)) return file
    const { width, height } = logoScaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const type = logoOutputType(file.type)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined))
    return blob ?? file
  } finally {
    bitmap.close()
  }
}
