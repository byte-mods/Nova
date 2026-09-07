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
    // Where Windows actually puts these. Every entry above either resolves
    // under the home directory on any platform or is a Unix absolute path, so
    // until these were added the Windows list was empty in practice and an
    // assistant was found only if the user had put npm on PATH themselves.
    ...(process.platform === 'win32'
      ? [
          path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm'),
          path.join(
            process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
            'Microsoft',
            'WindowsApps',
          ),
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
          path.join(home, 'scoop', 'shims'),
        ]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']),
  ]
  const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  return {
    ...process.env,
    ...extra,
    PATH: [...new Set([...current, ...persistentPath, ...candidates])].join(path.delimiter),
  }
}

/**
 * The PATH Windows stores rather than the one this process happens to hold.
 *
 * A process inherits its environment from whatever started it, and on Windows
 * that is usually Explorer — which read the environment when it started and does
 * not necessarily re-read it. Install a CLI, and a terminal opened afterwards
 * finds it while an app launched from the Start menu does not: the tool is on
 * the PATH the user edited and not on the one the app was handed. "It works in
 * cmd but Nova says it is not installed" is exactly that gap.
 *
 * Unix already has an answer here — the login-shell fallback further down, which
 * re-runs the user's profile. This is the same idea for Windows: ask the
 * registry, which is where the durable PATH actually lives.
 */
let persistentPath: string[] = []
let persistentPathLoaded: Promise<void> | null = null

function expandWindowsVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const found = Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === String(name).toLowerCase(),
    )
    return found?.[1] ?? whole
  })
}

async function readRegistryPath(key: string): Promise<string[]> {
  try {
    // Addressed absolutely rather than by name: the reason this function exists
    // is that PATH cannot be trusted, and looking `reg` up on it would be
    // relying on the very thing being repaired. Arguments are fixed, so nothing
    // here is built out of anything a user typed.
    const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
    const { stdout } = await exec(reg, ['query', key, '/v', 'Path'], { timeout: 5000 })
    // REG_EXPAND_SZ    C:\one;C:\two
    const match = /\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(stdout)
    if (!match) return []
    return expandWindowsVars(match[1].trim()).split(';').filter(Boolean)
  } catch {
    return []
  }
}

/** Reads the durable PATH once. Safe to call repeatedly; only the first reads. */
export function loadPersistentPath(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  persistentPathLoaded ??= (async () => {
    const [user, machine] = await Promise.all([
      readRegistryPath('HKCU\\Environment'),
      readRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    ])
    persistentPath = [...new Set([...user, ...machine])]
  })()
  return persistentPathLoaded
}

/**
 * Resolves a binary. Scans the app's own PATH first — a login shell re-reads the
 * user's profile and would discard anything we added — then falls back to a
 * login shell so version-manager shims (nvm, rbenv, pyenv) still resolve.
 */
export async function which(binary: string): Promise<string> {
  // Every tool discovery comes through here, so this is the one place that has
  // to know the durable PATH has been read. It is read once and then cached.
  await loadPersistentPath()
  const env = toolEnv()
  const windows = process.platform === 'win32'

  if (binary.includes('/') || (windows && binary.includes('\\'))) {
    return (await isExecutable(binary)) ? binary : ''
  }

  // On Windows a command is `node.exe`, not `node`, and PATHEXT is the list of
  // suffixes the shell would have tried. Without this loop the PATH scan below
  // never matched anything, the `/bin/sh` fallback did not exist, and so no
  // external tool could be found at all — every panel that needs one reported
  // it missing on a machine where it was installed.
  const suffixes = windows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']

  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const suffix of suffixes) {
      const candidate = path.join(dir, binary + suffix)
      if (await isExecutable(candidate)) return candidate
    }
    // A name that already carries its extension still has to resolve.
    if (windows && path.extname(binary)) {
      const exact = path.join(dir, binary)
      if (await isExecutable(exact)) return exact
    }
  }

  if (windows) {
    // `where` is the platform's own resolver, and passing the name as an
    // argument rather than building a command string means a name with a space
    // or a `;` in it is a name, not more command.
    try {
      const { stdout } = await exec('where', [binary], { env })
      return stdout.trim().split(/\r?\n/)[0] ?? ''
    } catch {
      return ''
    }
  }

  // The login-shell fallback exists for version-manager shims (nvm, rbenv,
  // pyenv) that only appear once a profile has run. It is a shell string, so
  // the name is checked rather than quoted — a tool name is a bare word, and
  // anything else is a config value trying to be a command.
  if (!/^[\w.+-]+$/.test(binary)) return ''
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


