import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  'target',
  'vendor',
  'Pods',
  'DerivedData',
  'coverage',
  '.pytest_cache',
  '.mypy_cache',
  'bin',
  'obj',
])

export const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.svgz',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.dmg', '.exe', '.dll', '.so',
  '.dylib', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov',
  '.avi', '.wav', '.class', '.jar', '.pyc', '.wasm', '.bin', '.o', '.a',
])

export function looksBinary(buf: Buffer) {
  const len = Math.min(buf.length, 8192)
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true
  return false
}

export function isIgnoredPath(root: string, target: string) {
  return path
    .relative(root, target)
    .split(path.sep)
    .some((segment) => IGNORED_DIRS.has(segment))
}

/** Depth-first walk that skips build output, VCS metadata and dependency trees. */
export async function* walk(root: string, maxFiles: number): AsyncGenerator<string> {
  let count = 0
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        if (++count > maxFiles) return
        yield full
      }
    }
  }
}
