/**
 * PTY loading, with a fallback that keeps the app usable when the native
 * module is missing.
 *
 * `node-pty` ships N-API prebuilds, so the same binary loads under Node and
 * Electron with no rebuild step. What it does need is an executable
 * `spawn-helper` beside the prebuild — npm does not preserve the bit reliably
 * when install scripts are gated, and without it every spawn fails with
 * `posix_spawnp failed`. Fixing it here means a fresh clone works whether or
 * not the postinstall script ran.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export interface PtyProcess {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void
}

export interface PtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: NodeJS.ProcessEnv
      encoding?: string
    },
  ): PtyProcess
}

let cached: PtyModule | null | undefined
let loadError = ''

/** Marks `spawn-helper` executable, which node-pty needs to fork on macOS/Linux. */
function repairSpawnHelper(moduleDir: string) {
  const prebuilds = path.join(moduleDir, 'prebuilds')
  const candidates: string[] = [path.join(moduleDir, 'build', 'Release', 'spawn-helper')]
  try {
    for (const entry of fs.readdirSync(prebuilds)) {
      candidates.push(path.join(prebuilds, entry, 'spawn-helper'))
    }
  } catch {
    /* no prebuilds directory: a source build, handled by the first candidate */
  }
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      // 0o111 is the executable bit for user, group and other.
      if ((stat.mode & 0o111) === 0) fs.chmodSync(candidate, stat.mode | 0o755)
    } catch {
      /* not present on this platform */
    }
  }
}

/** The pty module, or null when this install has no usable native binary. */
export function loadPty(): PtyModule | null {
  if (cached !== undefined) return cached
  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve('node-pty')
    repairSpawnHelper(path.dirname(path.dirname(resolved)))
    cached = require('node-pty') as PtyModule
  } catch (error) {
    loadError = (error as Error).message
    cached = null
  }
  return cached
}

export function ptyUnavailableReason(): string {
  return loadError
}

/** True when the terminal will be a real tty. */
export function hasPty(): boolean {
  return loadPty() !== null
}
