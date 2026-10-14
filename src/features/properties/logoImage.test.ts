import { describe, expect, it } from 'vitest'
import { LOGO_KEEP_BYTES, LOGO_MAX_EDGE, isLogoType, logoExtension, logoOutputType, logoScaledSize, shouldKeepLogo, shrinkLogoImage } from './logoImage'

describe('logoScaledSize', () => {
  it('keeps logos that already fit', () => {
    expect(logoScaledSize(600, 400)).toEqual({ width: 600, height: 400 })
    expect(logoScaledSize(300, 300)).toEqual({ width: 300, height: 300 })
  })
  it('scales the long edge down to the limit, landscape and portrait', () => {
    expect(logoScaledSize(1889, 1643)).toEqual({ width: 600, height: 522 })
    expect(logoScaledSize(1000, 2000)).toEqual({ width: 300, height: 600 })
  })
  it('never returns a zero dimension', () => {
    expect(logoScaledSize(6000, 1)).toEqual({ width: LOGO_MAX_EDGE, height: 1 })
    expect(logoScaledSize(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('isLogoType / logoOutputType / logoExtension', () => {
  it('accepts png, jpeg and webp only', () => {
    expect(isLogoType('image/png')).toBe(true)
    expect(isLogoType('image/jpeg')).toBe(true)
    expect(isLogoType('image/webp')).toBe(true)
    expect(isLogoType('image/gif')).toBe(false)
    expect(isLogoType('image/svg+xml')).toBe(false)
    expect(isLogoType('application/pdf')).toBe(false)
  })
  it('re-encodes transparent sources as PNG and photos as JPEG', () => {
    expect(logoOutputType('image/png')).toBe('image/png')
    expect(logoOutputType('image/webp')).toBe('image/png')
    expect(logoOutputType('image/jpeg')).toBe('image/jpeg')
  })
  it('maps the mime type to the storage extension', () => {
    expect(logoExtension('image/png')).toBe('png')
    expect(logoExtension('image/jpeg')).toBe('jpg')
    expect(logoExtension('image/webp')).toBe('webp')
  })
})

describe('shouldKeepLogo', () => {
  it('uploads a small logo as picked, shrinks big or heavy ones', () => {
    expect(shouldKeepLogo({ size: 50_000 }, 400, 300)).toBe(true)
    expect(shouldKeepLogo({ size: LOGO_KEEP_BYTES }, 600, 600)).toBe(true)
    expect(shouldKeepLogo({ size: LOGO_KEEP_BYTES + 1 }, 400, 300)).toBe(false)
    expect(shouldKeepLogo({ size: 50_000 }, 601, 300)).toBe(false)
  })
})

describe('shrinkLogoImage', () => {
  it('returns the file unchanged where the browser cannot decode images (node)', async () => {
    const png = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
    expect(await shrinkLogoImage(png)).toBe(png)
  })
})
