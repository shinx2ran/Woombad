import { describe, expect, it } from 'vitest'
import { scaledSize, shouldShrink, shrinkReceiptImage } from './receiptImage'

describe('scaledSize', () => {
  it('keeps photos that already fit', () => {
    expect(scaledSize(1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(scaledSize(1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })
  it('scales the long edge down to the limit, landscape and portrait', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(scaledSize(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
  it('never returns a zero dimension', () => {
    expect(scaledSize(10000, 1)).toEqual({ width: 1600, height: 1 })
  })
})

describe('shouldShrink', () => {
  it('re-encodes only larger bitmap photos', () => {
    expect(shouldShrink({ type: 'image/jpeg', size: 6_000_000 })).toBe(true)
    expect(shouldShrink({ type: 'image/png', size: 2_000_000 })).toBe(true)
    expect(shouldShrink({ type: 'image/jpeg', size: 100_000 })).toBe(false)
    expect(shouldShrink({ type: 'application/pdf', size: 6_000_000 })).toBe(false)
  })
})

describe('shrinkReceiptImage', () => {
  it('returns PDFs unchanged', async () => {
    const pdf = new File([new Uint8Array(10)], 'struk.pdf', { type: 'application/pdf' })
    expect(await shrinkReceiptImage(pdf)).toBe(pdf)
  })
})
