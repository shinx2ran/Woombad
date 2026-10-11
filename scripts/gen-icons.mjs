// Generates simple PWA icons (teal rounded square with a white house + "W") as PNG, no deps.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}
const TEAL = [15, 118, 110], WHITE = [255, 255, 255]
function makeIcon(size, { padding = 0, rounded = true } = {}) {
  const s = size, c = s / 2, radius = s * 0.22
  return png(s, (x, y) => {
    // rounded square background
    const px = Math.max(0, Math.abs(x + 0.5 - c) - (c - radius)), py = Math.max(0, Math.abs(y + 0.5 - c) - (c - radius))
    const outside = rounded && px * px + py * py > radius * radius
    if (outside) return [0, 0, 0, 0]
    const u = (x + 0.5 - c) / (s / 2 - padding), v = (y + 0.5 - c) / (s / 2 - padding) // -1..1
    // house: roof triangle (apex at v=-0.62), body rectangle
    const roof = v >= -0.62 && v <= -0.12 && Math.abs(u) <= (v + 0.62) * 1.1
    const body = v > -0.12 && v <= 0.55 && Math.abs(u) <= 0.46
    const door = v > 0.18 && v <= 0.55 && Math.abs(u) <= 0.12
    if ((roof || body) && !door) return [...WHITE, 255]
    return [...TEAL, 255]
  })
}
mkdirSync('public', { recursive: true })
writeFileSync('public/pwa-192.png', makeIcon(192))
writeFileSync('public/pwa-512.png', makeIcon(512, { padding: 40 }))
writeFileSync('public/apple-touch-icon.png', makeIcon(180, { rounded: false }))
writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f766e"/><path d="M32 12 L52 30 H46 V50 H18 V30 H12 Z M28 50 V38 H36 V50 Z" fill="#fff" fill-rule="evenodd"/></svg>`)
console.log('icons written')
