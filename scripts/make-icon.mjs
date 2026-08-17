/**
 * Generates the application icon from code, so the brand mark is reproducible
 * and reviewable as a diff rather than an opaque binary someone once exported.
 *
 * Draws a rounded-square plate in the Nova Dark background, a soft accent glow,
 * and a four-cusped star — the astroid |x|^(2/3) + |y|^(2/3) = 1, which is the
 * classic "nova" sparkle. Everything is supersampled 4x4 and written as a plain
 * PNG through zlib, so there is no image dependency to install.
 *
 *   node scripts/make-icon.mjs            # writes build/icon.png (1024px)
 *
 * On macOS the script then builds build/icon.icns with the system `sips` and
 * `iconutil`, which is what electron-builder and the dock want.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'build')
const SIZE = 1024
const SS = 4 // supersampling factor per axis

/* ---------------- palette (Nova Dark) ---------------- */

const PLATE_TOP = [0x1a, 0x1f, 0x2b]
const PLATE_BOTTOM = [0x0b, 0x0d, 0x12]
const ACCENT = [0x6e, 0xa8, 0xfe]
const CORE = [0xf2, 0xf7, 0xff]

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Signed coverage of a rounded rectangle, in 0..1 units centred on the plate. */
function insideRoundedRect(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius)
  const dy = Math.abs(y) - (half - radius)
  if (dx <= 0 || dy <= 0) return Math.abs(x) <= half && Math.abs(y) <= half
  return dx * dx + dy * dy <= radius * radius
}

/**
 * The star. An astroid has concave sides and four sharp cusps, which reads as a
 * sparkle where a straight-sided rhombus reads as a diamond.
 */
function starValue(x, y, reach) {
  const a = Math.pow(Math.abs(x) / reach, 2 / 3)
  const b = Math.pow(Math.abs(y) / reach, 2 / 3)
  return a + b
}

/* ---------------- render ---------------- */

const pixels = Buffer.alloc(SIZE * SIZE * 4)
const half = SIZE / 2
const plateHalf = SIZE * 0.5
const radius = SIZE * 0.225
// macOS plates keep their content inside roughly 80% of the square; a mark that
// runs to the corner reads as cramped next to the system icons.
const reach = SIZE * 0.355
const glowRadius = SIZE * 0.42

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0

    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS - half
        const y = py + (sy + 0.5) / SS - half

        if (!insideRoundedRect(x, y, plateHalf, radius)) continue

        // Plate: a vertical gradient, darkest at the bottom.
        const t = clamp01((y + half) / SIZE)
        let [cr, cg, cb] = mix(PLATE_TOP, PLATE_BOTTOM, t)

        // Accent glow behind the mark.
        const dist = Math.sqrt(x * x + y * y)
        const glow = Math.pow(clamp01(1 - dist / glowRadius), 2.4) * 0.30
        ;[cr, cg, cb] = mix([cr, cg, cb], ACCENT, glow)

        // The star itself, with a hot core fading to accent at the cusps.
        const v = starValue(x, y, reach)
        if (v <= 1) {
          const edge = clamp01((1 - v) / 0.06) // soft rim
          const toCore = Math.pow(clamp01(1 - dist / (reach * 0.62)), 1.5)
          const star = mix(ACCENT, CORE, toCore)
          ;[cr, cg, cb] = mix([cr, cg, cb], star, edge)
        }

        r += cr; g += cg; b += cb; a += 255
      }
    }

    const n = SS * SS
    const i = (py * SIZE + px) * 4
    // Un-premultiply against the covered samples so edges stay the plate colour.
    const cov = a / n
    pixels[i] = cov ? Math.round(r / (a / 255)) : 0
    pixels[i + 1] = cov ? Math.round(g / (a / 255)) : 0
    pixels[i + 2] = cov ? Math.round(b / (a / 255)) : 0
    pixels[i + 3] = Math.round(cov)
  }
}

/* ---------------- PNG encoding ---------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
const pngPath = path.join(OUT, 'icon.png')
writeFileSync(pngPath, encodePng(SIZE, SIZE, pixels))
process.stdout.write(`wrote ${path.relative(ROOT, pngPath)} (${SIZE}x${SIZE})\n`)

/* ---------------- .icns, via the macOS toolchain ---------------- */

if (process.platform === 'darwin') {
  const iconset = path.join(OUT, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const variants = [16, 32, 64, 128, 256, 512, 1024]
  for (const size of variants) {
    const scale = size >= 32 && variants.includes(size / 2) ? `${size / 2}x${size / 2}@2x` : null
    execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', path.join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
    if (scale) {
      execFileSync('cp', [path.join(iconset, `icon_${size}x${size}.png`), path.join(iconset, `icon_${scale}.png`)])
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  process.stdout.write(`wrote ${path.relative(ROOT, path.join(OUT, 'icon.icns'))}\n`)
}
