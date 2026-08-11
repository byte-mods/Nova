import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * GUI apps do not inherit a login shell PATH, so rebuild the usual dev
 * locations. Without this, CLIs and language servers installed by brew, npm,
 * cargo or pipx are invisible to the app.
 */
export function toolEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'go', 'bin'),
    path.join(home, '.dotnet', 'tools'),
    path.join(home, 'flutter', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  return {
    ...process.env,
    ...extra,
    PATH: [...new Set([...current, ...candidates])].join(path.delimiter),
  }
}

/**
 * Resolves a binary. Scans the app's own PATH first — a login shell re-reads the
 * user's profile and would discard anything we added — then falls back to a
 * login shell so version-manager shims (nvm, rbenv, pyenv) still resolve.
 */
export async function which(binary: string): Promise<string> {
  const env = toolEnv()
  if (binary.includes('/')) {
    return (await isExecutable(binary)) ? binary : ''
  }

  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, binary)
    if (await isExecutable(candidate)) return candidate
  }

  try {
    const { stdout } = await exec('/bin/sh', ['-lc', `command -v ${binary}`], { env })
    return stdout.trim().split('\n')[0] ?? ''
  } catch {
    return ''
  }
}

async function isExecutable(file: string) {
  try {
    await fs.access(file, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolves developer tools that live inside the active Xcode/CLT toolchain
 * (lldb-dap, sourcekit-lsp, clangd). Those directories are deliberately not on
 * PATH — `xcrun` is the supported way to find them.
 */
export async function whichXcrun(binary: string): Promise<string> {
  if (process.platform !== 'darwin') return ''
  try {
    const { stdout } = await exec('/usr/bin/xcrun', ['--find', binary], { timeout: 4000 })
    const resolved = stdout.trim()
    return resolved && (await isExecutable(resolved)) ? resolved : ''
  } catch {
    return ''
  }
}


