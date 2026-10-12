import { describe, expect, it } from 'vitest'
import { describeUnsupportedImage, fitWithin, grayscaleContrastStretch, mapOcrProgress, MAX_IMAGE_WIDTH } from './ktpOcr'

describe('fitWithin', () => {
  it('never upscales and keeps the aspect ratio when shrinking', () => {
    expect(fitWithin(800, 500)).toEqual({ width: 800, height: 500 })
    expect(fitWithin(3200, 2000)).toEqual({ width: MAX_IMAGE_WIDTH, height: 1000 })
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 })
  })
  it('guards degenerate sizes', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(5000, 1, 1600).height).toBe(1)
  })
})

describe('grayscaleContrastStretch', () => {
  function rgba(...pixels: [number, number, number][]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(pixels.length * 4)
    pixels.forEach(([r, g, b], i) => {
      out[i * 4] = r
      out[i * 4 + 1] = g
      out[i * 4 + 2] = b
      out[i * 4 + 3] = 255
    })
    return out
  }

  it('converts colour to grey (r = g = b) and keeps alpha', () => {
    const px = rgba([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255])
    grayscaleContrastStretch(px, 0, 1)
    for (let i = 0; i < 4; i++) {
      expect(px[i * 4]).toBe(px[i * 4 + 1])
      expect(px[i * 4 + 1]).toBe(px[i * 4 + 2])
      expect(px[i * 4 + 3]).toBe(255)
    }
  })

  it('stretches a low-contrast grey image to the full 0..255 range', () => {
    // Dim photo: values only between 100 and 140.
    const values = [100, 110, 120, 130, 140, 100, 140, 120, 110, 130]
    const px = rgba(...values.map((v) => [v, v, v] as [number, number, number]))
    const [lo, hi] = grayscaleContrastStretch(px, 0, 1)
    expect(lo).toBe(100)
    expect(hi).toBe(140)
    const greys = values.map((_, i) => px[i * 4])
    expect(Math.min(...greys)).toBe(0)
    expect(Math.max(...greys)).toBe(255)
    // Monotonic: brighter in stays brighter out.
    expect(px[0]).toBeLessThan(px[4])
    expect(px[8]).toBeLessThan(px[12])
  })

  it('does not divide by zero on a flat image and handles an empty buffer', () => {
    const px = rgba([90, 90, 90], [90, 90, 90])
    expect(grayscaleContrastStretch(px)).toEqual([0, 255])
    expect(px[0]).toBe(90)
    expect(grayscaleContrastStretch(new Uint8ClampedArray(0))).toEqual([0, 255])
  })

  it('percentile clipping ignores a few outlier pixels', () => {
    const values = [0, ...Array.from({ length: 198 }, (_, i) => 100 + (i % 40)), 255]
    const px = rgba(...values.map((v) => [v, v, v] as [number, number, number]))
    const [lo, hi] = grayscaleContrastStretch(px)
    expect(lo).toBeGreaterThanOrEqual(100)
    expect(hi).toBeLessThanOrEqual(139)
  })
})

describe('mapOcrProgress', () => {
  it('maps tesseract statuses to an increasing 10..100 scale', () => {
    const steps = [
      mapOcrProgress('loading tesseract core', 0),
      mapOcrProgress('loading tesseract core', 1),
      mapOcrProgress('initializing tesseract', 1),
      mapOcrProgress('loading language traineddata', 0.5),
      mapOcrProgress('loaded language traineddata', 1),
      mapOcrProgress('initializing api', 1),
      mapOcrProgress('recognizing text', 0),
      mapOcrProgress('recognizing text', 0.5),
      mapOcrProgress('recognizing text', 1),
    ]
    for (let i = 1; i < steps.length; i++) expect(steps[i].percent).toBeGreaterThanOrEqual(steps[i - 1].percent)
    expect(steps[0].percent).toBe(10)
    expect(steps[steps.length - 1].percent).toBe(100)
  })

  it('flags the language download and labels phases in Indonesian', () => {
    const dl = mapOcrProgress('loading language traineddata', 0.2)
    expect(dl.downloading).toBe(true)
    expect(dl.status).toMatch(/bahasa/i)
    expect(mapOcrProgress('recognizing text', 0.3)).toMatchObject({ phase: 'recognize', downloading: false, percent: 65 })
    expect(mapOcrProgress('something unknown', NaN)).toMatchObject({ phase: 'load', percent: 10 })
    expect(mapOcrProgress('recognizing text', 7).percent).toBe(100) // clamps
  })
})

describe('describeUnsupportedImage', () => {
  it('rejects HEIC and non-images, accepts jpeg/png/unknown', () => {
    expect(describeUnsupportedImage(new Blob([], { type: 'image/heic' }))).toMatch(/HEIC/)
    expect(describeUnsupportedImage(new Blob([], { type: 'application/pdf' }))).toMatch(/bukan gambar/)
    expect(describeUnsupportedImage(new Blob([], { type: 'image/jpeg' }))).toBeNull()
    expect(describeUnsupportedImage(new Blob([], { type: 'image/png' }))).toBeNull()
    expect(describeUnsupportedImage(new Blob([]))).toBeNull()
  })
})
