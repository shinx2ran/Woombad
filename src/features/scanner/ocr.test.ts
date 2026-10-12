import { describe, expect, it } from 'vitest'
import { mrzCheckDigit } from '../../domain/passport'
import { describeUnsupportedImage, fitWithin, grayscaleContrastStretch, interpretOcrText, mapOcrProgress, MAX_IMAGE_WIDTH, repairMrzText } from './ocr'

const NOW = new Date(2026, 9, 12)

/** Self-consistent TD3 line 2 (every check digit computed). */
function mrzLine2(number: string, nationality: string, birth: string, sex: 'M' | 'F', expiry: string): string {
  const num = number.padEnd(9, '<')
  const pers = ''.padEnd(14, '<')
  const head = num + mrzCheckDigit(num)
  const birthPart = birth + mrzCheckDigit(birth)
  const tail = expiry + mrzCheckDigit(expiry) + pers + mrzCheckDigit(pers)
  return head + nationality + birthPart + sex + tail + mrzCheckDigit(head + birthPart + tail)
}

const PASSPORT_TEXT = `PASSPORT AUSTRALIA
P<AUSSMITH<<JOHN<ROBERT<<<<<<<<<<<<<<<<<<<<<
${mrzLine2('N1234567', 'AUS', '900101', 'M', '300101')}`

const KTP_TEXT = `PROVINSI JAWA BARAT
KOTA BANDUNG
NIK : 3273010503900001
Nama : BUDI SANTOSO
Tempat/Tgl Lahir : BANDUNG, 05-03-1990
Jenis Kelamin : LAKI-LAKI Gol. Darah : O
Alamat : JL. MELATI NO. 12
Agama : ISLAM`

describe('interpretOcrText', () => {
  it('detects a passport, maps the MRZ to id_type passport + id_number + nationality and reports check digits', () => {
    const out = interpretOcrText(PASSPORT_TEXT, NOW)
    expect(out.kind).toBe('passport')
    expect(out.prefill).toMatchObject({ id_type: 'passport', id_number: 'N1234567', nationality: 'AUS', full_name: 'John Robert Smith', gender: 'L', birth_date: '1990-01-01' })
    expect(out.prefill.nik).toBeUndefined()
    expect(out.passport?.checks.number).toBe(true)
    expect(out.confidence).toBe(1)
    expect(out.ktp).toBeNull()
    expect(out.lines.length).toBe(3)
  })

  it('detects a KTP and maps it to id_type ktp with the NIK', () => {
    const out = interpretOcrText(KTP_TEXT, NOW)
    expect(out.kind).toBe('ktp')
    expect(out.prefill).toMatchObject({ id_type: 'ktp', nik: '3273010503900001', full_name: 'Budi Santoso', gender: 'L', birth_date: '1990-03-05', religion: 'Islam' })
    expect(out.prefill.id_number).toBeUndefined()
    expect(out.ktp?.confidence).toBe(1)
    expect(out.passport).toBeNull()
    expect(out.confidence).toBe(1)
  })

  it('returns unknown with an empty prefill for unrelated text', () => {
    const out = interpretOcrText('Struk belanja\nTotal 25.000', NOW)
    expect(out.kind).toBe('unknown')
    expect(out.prefill).toEqual({ id_type: 'ktp' })
    expect(out.confidence).toBe(0)
    expect(out.lines).toEqual(['Struk belanja', 'Total 25.000'])
  })

  it('repairs filler misread as K/L runs and over-long first lines (real tesseract output of a Courier MRZ)', () => {
    const ocr = `PASSPORT AUSTRALIA
Passport No: N1234567
P<AUSSMITH<<JOHN<ROBERT<<<<<<<<<<<KLKLKLLLLKLKL<
N1234567<7AUS9001011M3001019<<<<<<<<<<<<O2`
    const repaired = repairMrzText(ocr).split('\n')
    expect(repaired[2]).toBe('P<AUSSMITH<<JOHN<ROBERT<<<<<<<<<<<<<<<<<<<<<')
    expect(repaired[3]).toBe('N1234567<7AUS9001011M3001019<<<<<<<<<<<<O2')
    expect(repaired[0]).toBe('PASSPORT AUSTRALIA') // untouched
    const out = interpretOcrText(ocr, NOW)
    expect(out.kind).toBe('passport')
    expect(out.prefill).toMatchObject({ id_type: 'passport', id_number: 'N1234567', nationality: 'AUS', full_name: 'John Robert Smith', birth_date: '1990-01-01' })
    expect(out.passport?.checks.number).toBe(true)
    expect(out.lines[0]).toBe('PASSPORT AUSTRALIA')
  })

  it('never changes correctly read names that contain K / L / I next to a filler', () => {
    const cases: [string, string][] = [
      ['HILL<<JOHN', 'John Hill'],
      ['SMITH<<LILY', 'Lily Smith'],
      ['MALIK<<ALI', 'Ali Malik'],
      ['WILLI<<KIKI', 'Kiki Willi'],
      ['NIKKI<<ANNA', 'Anna Nikki'],
      ['TAN<<LI<KAI', 'Li Kai Tan'],
      ['KILL<<LIKI<ILI', 'Liki Ili Kill'],
    ]
    const line2 = mrzLine2('N1234567', 'AUS', '900101', 'M', '300101')
    for (const [names, expected] of cases) {
      const line1 = `P<AUS${names}`.padEnd(44, '<')
      const text = `${line1}\n${line2}`
      expect(repairMrzText(text)).toBe(text)
      const out = interpretOcrText(text, NOW)
      expect(out.kind).toBe('passport')
      expect(out.prefill.full_name).toBe(expected)
      expect(out.confidence).toBe(1)
    }
  })

  it('never changes a passport number, nationality or dates in line 2 (even ending in K / L / I or starting with P)', () => {
    for (const number of ['AB12KL', 'X1234LI', 'P1234567K', 'PKLI']) {
      const line1 = 'P<AUSSMITH<<JOHN'.padEnd(44, '<')
      const line2 = mrzLine2(number, 'AUS', '900101', 'M', '300101')
      const text = `${line1}\n${line2}`
      expect(repairMrzText(text)).toBe(text)
      const out = interpretOcrText(text, NOW)
      expect(out.prefill.id_number).toBe(number)
      expect(out.passport?.checks.number).toBe(true)
    }
  })

  it('repairs an empty personal number misread as K / L / I but keeps a real one', () => {
    const line1 = 'P<AUSSMITH<<JOHN'.padEnd(44, '<')
    const good = mrzLine2('N1234567', 'AUS', '900101', 'M', '300101')
    const misread = good.slice(0, 28) + '<<KLKLLK<<<<<<' + good.slice(42)
    expect(repairMrzText(`${line1}\n${misread}`).split('\n')[1]).toBe(good)
    const withPersonal = good.slice(0, 28) + 'AB1234KL<<<<<<' + good.slice(42)
    expect(repairMrzText(`${line1}\n${withPersonal}`).split('\n')[1]).toBe(withPersonal)
  })

  it('leaves KTP text and short lines alone', () => {
    expect(repairMrzText(KTP_TEXT)).toBe(KTP_TEXT)
    expect(repairMrzText('KLKL<<<')).toBe('KLKL<<<')
  })

  it('flags a passport number whose check digit fails', () => {
    const bad = PASSPORT_TEXT.replace('N1234567', 'N1234568')
    const out = interpretOcrText(bad, NOW)
    expect(out.kind).toBe('passport')
    expect(out.passport?.checks.number).toBe(false)
    expect(out.prefill.id_number).toBe('N1234568')
    expect(out.confidence).toBeLessThan(1)
  })
})

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
