/**
 * Visual regression: what changed since the last time this looked right.
 *
 * The comparison itself is a pixel walk. That is a deliberate choice over a
 * perceptual metric — a perceptual diff decides for you which differences
 * matter, and the whole point of a baseline is that the *reviewer* decides.
 * What the tolerance does is absorb the differences that are never meaningful:
 * a font rendering one subpixel differently, or a gradient dithering.
 *
 * Electron's `capturePage` hands back a PNG, and PNG is the format a baseline
 * has to be stored in anyway, so decoding is done here rather than pulling in
 * an image library: zlib is in Node, and the rest is the PNG spec's filter
 * step, which is about eighty lines.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import type { VisualComparison } from '../../shared/e2e'

const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

/** Per-channel difference below this is rendering noise, not a change. */
const CHANNEL_TOLERANCE = 12
/** A run passes when fewer than this share of pixels changed. */
const DEFAULT_RATIO = 0.001

export interface RgbaImage {
  width: number
  height: number
  /** RGBA, four bytes per pixel, row-major. */
  data: Buffer
}

/**
 * Compares a capture against its baseline, creating the baseline when there
 * is none.
 *
 * A first run that silently passes is the right behaviour — there is nothing
 * to compare against — but it must say it created the baseline rather than
 * reporting a match, or a suite that never had baselines looks green forever.
 */
export async function compareToBaseline(
  name: string,
  capture: Buffer,
  baselineDir: string,
  options: { maxRatio?: number; writeDiff?: boolean } = {},
): Promise<VisualComparison> {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '-')
  const baselineFile = path.join(baselineDir, `${safe}.png`)
  const diffFile = path.join(baselineDir, `${safe}.diff.png`)
  const maxRatio = options.maxRatio ?? DEFAULT_RATIO

  let baseline: Buffer | null = null
  try {
    baseline = await fs.readFile(baselineFile)
  } catch {
    baseline = null
  }

  if (!baseline) {
    await fs.mkdir(baselineDir, { recursive: true })
    await fs.writeFile(baselineFile, capture)
    return {
      name,
      created: true,
      matched: true,
      changedPixels: 0,
      totalPixels: 0,
      ratio: 0,
      }
  }

  let before: RgbaImage
  let after: RgbaImage
  try {
    before = await decodePng(baseline)
    after = await decodePng(capture)
  } catch (err) {
    return {
      name,
      created: false,
      matched: false,
      changedPixels: 0,
      totalPixels: 0,
      ratio: 1,
      error: `Could not read the images: ${(err as Error).message}`,
    }
  }

  if (before.width !== after.width || before.height !== after.height) {
    // A size change is a change, and diffing two different shapes pixel by
    // pixel would produce a meaningless number rather than an answer.
    return {
      name,
      created: false,
      matched: false,
      changedPixels: 0,
      totalPixels: before.width * before.height,
      ratio: 1,
      error: `The page is now ${after.width}×${after.height}, the baseline is ${before.width}×${before.height}.`,
    }
  }

  const { changed, diff } = diffImages(before, after)
  const totalPixels = before.width * before.height
  const ratio = totalPixels ? changed / totalPixels : 0
  const matched = ratio <= maxRatio

  let written: string | undefined
  if (!matched && options.writeDiff !== false) {
    await fs.mkdir(baselineDir, { recursive: true })
    await fs.writeFile(diffFile, await encodePng(diff))
    written = diffFile
  }

  return { name, created: false, matched, changedPixels: changed, totalPixels, ratio, diffFile: written }
}

/** Replaces a baseline with the current capture — "yes, this is right now". */
export async function acceptBaseline(name: string, capture: Buffer, baselineDir: string) {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '-')
  await fs.mkdir(baselineDir, { recursive: true })
  await fs.writeFile(path.join(baselineDir, `${safe}.png`), capture)
  await fs.rm(path.join(baselineDir, `${safe}.diff.png`), { force: true }).catch(() => undefined)
}

/**
 * The diff image: the baseline dimmed, with changed pixels in magenta.
 *
 * Dimming rather than blanking keeps the surrounding layout legible, which is
 * what makes a diff readable — a field of magenta on white tells you something
 * moved but not what.
 */
export function diffImages(before: RgbaImage, after: RgbaImage): { changed: number; diff: RgbaImage } {
  const length = before.data.length
  const out = Buffer.allocUnsafe(length)
  let changed = 0

  for (let i = 0; i < length; i += 4) {
    const dr = Math.abs(before.data[i] - after.data[i])
    const dg = Math.abs(before.data[i + 1] - after.data[i + 1])
    const db = Math.abs(before.data[i + 2] - after.data[i + 2])
    const da = Math.abs(before.data[i + 3] - after.data[i + 3])

    if (dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE || db > CHANNEL_TOLERANCE || da > CHANNEL_TOLERANCE) {
      changed++
      out[i] = 255
      out[i + 1] = 0
      out[i + 2] = 255
      out[i + 3] = 255
    } else {
      out[i] = 255 - Math.round((255 - before.data[i]) * 0.25)
      out[i + 1] = 255 - Math.round((255 - before.data[i + 1]) * 0.25)
      out[i + 2] = 255 - Math.round((255 - before.data[i + 2]) * 0.25)
      out[i + 3] = 255
    }
  }

  return { changed, diff: { width: before.width, height: before.height, data: out } }
}

/* ---------------- PNG ---------------- */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Far past any screenshot, and short of the sizes that make the header a weapon. */
const MAX_DIMENSION = 20_000
const MAX_PIXELS = 80_000_000

/**
 * Decodes the PNG subset Electron produces: 8-bit RGB or RGBA, no interlace.
 * Anything else throws rather than being half-read, because a silently wrong
 * decode would report differences that are not there.
 */
export async function decodePng(buffer: Buffer): Promise<RgbaImage> {
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a PNG')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    // A chunk that runs past the end of the file is a truncated or hostile
    // one; reading it yields a short `subarray` and a silently wrong decode.
    if (length > buffer.length - offset - 12) throw new Error('a PNG chunk runs past the end of the file')
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (type === 'IHDR' && length < 13) throw new Error('the PNG header is too short')

    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`)

  // A baseline is a file in the repository, so its header is untrusted input.
  // The dimensions are two 32-bit numbers and nothing checked them: a 40-byte
  // PNG could claim 65535 x 65535, and the allocation below is `width * height
  // * 4` — 17 GB — decided entirely by the header. The size limit has to come
  // before the allocation rather than be discovered while filling it.
  if (width <= 0 || height <= 0) throw new Error('a PNG with no pixels')
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`the image claims ${width}x${height}, over the ${MAX_DIMENSION}px limit`)
  }
  if (width * height > MAX_PIXELS) {
    throw new Error(`the image claims ${width * height} pixels, over the ${MAX_PIXELS} limit`)
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const expected = height * (stride + 1)

  // `maxOutputLength` makes zlib stop at the limit rather than decompress a
  // gigabyte of zeros first and only then let us notice. The equality check
  // after it is the other half: a body that inflates to the wrong size is not a
  // short read to be discovered row by row, it is a file that does not describe
  // the image its header claims.
  const raw = await inflate(Buffer.concat(idat), { maxOutputLength: expected })
  if (raw.length !== expected) {
    throw new Error(`the image data is ${raw.length} bytes, not the ${expected} its header implies`)
  }

  const data = Buffer.allocUnsafe(width * height * 4)

  // Each row is prefixed with the filter that was applied to it, and undoing
  // it needs the row above — so this walks forward and cannot be parallelised.
  const line = Buffer.alloc(stride)
  const previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    raw.copy(line, 0, rowStart + 1, rowStart + 1 + stride)
    unfilter(filter, line, previous, channels)

    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 4
      data[to] = line[from]
      data[to + 1] = line[from + 1]
      data[to + 2] = line[from + 2]
      data[to + 3] = channels === 4 ? line[from + 3] : 255
    }
    line.copy(previous)
  }

  return { width, height, data }
}

/** PNG filter types 0–4, from the spec's reconstruction formulas. */
function unfilter(filter: number, line: Buffer, previous: Buffer, channels: number) {
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = channels; i < line.length; i++) line[i] = (line[i] + line[i - channels]) & 0xff
      return
    case 2:
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + previous[i]) & 0xff
      return
    case 3:
      for (let i = 0; i < line.length; i++) {
        const left = i >= channels ? line[i - channels] : 0
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff
      }
      return
    case 4:
      for (let i = 0; i < line.length; i++) {
        const left = i >= channels ? line[i - channels] : 0
        const up = previous[i]
        const upLeft = i >= channels ? previous[i - channels] : 0
        line[i] = (line[i] + paeth(left, up, upLeft)) & 0xff
      }
      return
    default:
      throw new Error(`unknown PNG filter ${filter}`)
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Writes an RGBA image back out, unfiltered — this is for humans to look at. */
export async function encodePng(image: RgbaImage): Promise<Buffer> {
  const stride = image.width * 4
  const raw = Buffer.allocUnsafe((stride + 1) * image.height)

  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
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

function crc32(buffer: Buffer): number {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}
