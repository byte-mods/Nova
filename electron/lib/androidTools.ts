/**
 * Driving Android emulators through the SDK the developer already has.
 *
 * Nothing is bundled and nothing is installed. The SDK is found, its tools are
 * run, and when it is absent the caller is told which piece is missing and the
 * command that fixes it — the same contract the language servers follow.
 *
 * Finding the SDK is most of the work. `adb` is very often not on `PATH`, even
 * on machines with a complete Android Studio install, because the SDK lives in
 * a per-user directory that nothing adds to the shell profile. Refusing to work
 * in that case would report "Android is not installed" to someone who is
 * looking at Android Studio, so the standard locations are checked too.
 */
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DeviceInput, DeviceToolStatus, MobileDevice } from '../../shared/devices'

const exec = promisify(execFile)

/** Where an SDK ends up when nobody chose anything unusual. */
function candidateRoots(): string[] {
  const home = os.homedir()
  return [
    process.env.ANDROID_HOME ?? '',
    process.env.ANDROID_SDK_ROOT ?? '',
    path.join(home, 'Library', 'Android', 'sdk'),
    path.join(home, 'Android', 'Sdk'),
    path.join(home, 'AppData', 'Local', 'Android', 'Sdk'),
    '/usr/local/share/android-sdk',
    '/opt/android-sdk',
  ].filter(Boolean)
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

export interface AndroidSdk {
  root: string
  adb: string
  emulator: string
}

let cached: AndroidSdk | null = null

/**
 * Locates `adb` and `emulator`.
 *
 * Cached because this runs before every device operation and the answer does
 * not change while the app is open. A failed lookup is *not* cached: someone
 * who installs the SDK and comes back should not have to restart the editor.
 */
export async function findAndroidSdk(): Promise<AndroidSdk | null> {
  if (cached) return cached

  for (const root of candidateRoots()) {
    const adb = path.join(root, 'platform-tools', 'adb')
    const emulator = path.join(root, 'emulator', 'emulator')
    if (await isFile(adb)) {
      cached = { root, adb, emulator: (await isFile(emulator)) ? emulator : '' }
      return cached
    }
  }

  // Last resort: whatever the shell can find, for unusual installs.
  try {
    const { stdout } = await exec('/bin/sh', ['-lc', 'command -v adb'])
    const adb = stdout.trim().split('\n')[0]
    if (adb) {
      cached = { root: path.dirname(path.dirname(adb)), adb, emulator: '' }
      return cached
    }
  } catch {
    /* not on PATH either */
  }
  return null
}

export async function androidStatus(): Promise<DeviceToolStatus> {
  const sdk = await findAndroidSdk()
  if (!sdk) {
    return {
      platform: 'android',
      available: false,
      binary: '',
      version: '',
      detail:
        'No Android SDK found. Install Android Studio, or set ANDROID_HOME to an existing SDK.',
    }
  }

  let version = ''
  try {
    const { stdout } = await exec(sdk.adb, ['version'], { timeout: 8000 })
    version = stdout.trim().split('\n')[0] ?? ''
  } catch {
    /* reported as unavailable below */
  }

  if (!sdk.emulator) {
    return {
      platform: 'android',
      available: false,
      binary: sdk.adb,
      version,
      detail: `Found adb at ${sdk.adb}, but no emulator. Install it from Android Studio › SDK Manager › SDK Tools › Android Emulator.`,
    }
  }

  return { platform: 'android', available: true, binary: sdk.adb, version, detail: '' }
}

/** AVDs that exist on disk, whether or not they are running. */
async function listAvds(sdk: AndroidSdk): Promise<string[]> {
  if (!sdk.emulator) return []
  try {
    const { stdout } = await exec(sdk.emulator, ['-list-avds'], { timeout: 15000 })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      // The emulator prints diagnostics to stdout on some installs, so anything
      // that looks like prose rather than an AVD name is dropped.
      .filter((line) => line && !line.includes(' ') && !line.startsWith('INFO'))
  } catch {
    return []
  }
}

/** Emulators currently attached to adb, with the AVD each one is running. */
async function runningDevices(sdk: AndroidSdk): Promise<Map<string, { avd: string; ready: boolean }>> {
  const out = new Map<string, { avd: string; ready: boolean }>()
  let stdout = ''
  try {
    ;({ stdout } = await exec(sdk.adb, ['devices'], { timeout: 10000 }))
  } catch {
    return out
  }

  for (const line of stdout.split('\n').slice(1)) {
    const [id, state] = line.trim().split(/\s+/)
    if (!id || !state || state === 'offline') continue

    let avd = ''
    let ready = false
    try {
      const { stdout: name } = await exec(sdk.adb, ['-s', id, 'emu', 'avd', 'name'], { timeout: 5000 })
      avd = name.split('\n')[0]?.trim() ?? ''
    } catch {
      /* a physical device has no AVD name */
    }
    try {
      // `sys.boot_completed` is the difference between adb answering and the
      // device being usable. Mirroring before this shows a black screen.
      const { stdout: boot } = await exec(sdk.adb, ['-s', id, 'shell', 'getprop', 'sys.boot_completed'], {
        timeout: 5000,
      })
      ready = boot.trim() === '1'
    } catch {
      /* still booting */
    }
    out.set(id, { avd, ready })
  }
  return out
}

/**
 * Every emulator, running or not.
 *
 * An AVD that is not running is still listed, as `shutdown`, because the point
 * of the panel is to start one — offering only what is already running would
 * make it a status display rather than a control.
 */
export async function listAndroidDevices(): Promise<MobileDevice[]> {
  const sdk = await findAndroidSdk()
  if (!sdk) return []

  const running = await runningDevices(sdk)
  const devices: MobileDevice[] = []
  const claimed = new Set<string>()

  for (const [id, info] of running) {
    if (info.avd) claimed.add(info.avd)
    let api = ''
    try {
      const { stdout } = await exec(sdk.adb, ['-s', id, 'shell', 'getprop', 'ro.build.version.sdk'], {
        timeout: 5000,
      })
      if (stdout.trim()) api = `API ${stdout.trim()}`
    } catch {
      /* not up yet */
    }
    devices.push({
      id,
      name: info.avd || id,
      platform: 'android',
      state: info.ready ? 'booted' : 'booting',
      api,
      kind: id.startsWith('emulator-') ? 'emulator' : 'physical',
      avd: info.avd || undefined,
    })
  }

  for (const avd of await listAvds(sdk)) {
    if (claimed.has(avd)) continue
    devices.push({ id: `avd:${avd}`, name: avd, platform: 'android', state: 'shutdown', api: '', kind: 'emulator', avd })
  }

  return devices
}

/**
 * Starts an AVD.
 *
 * Detached and unref'd on purpose: the emulator outlives any single request,
 * and a child tied to this process would die with a reload. Its output is
 * discarded rather than piped, because a pipe nobody drains fills and blocks
 * the emulator once it has written enough.
 */
export async function bootAndroid(avd: string): Promise<{ ok: boolean; error?: string }> {
  const sdk = await findAndroidSdk()
  if (!sdk?.emulator) return { ok: false, error: 'No Android emulator binary was found.' }

  try {
    const child = spawn(sdk.emulator, ['-avd', avd, '-netdelay', 'none', '-netspeed', 'full'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function shutdownAndroid(deviceId: string): Promise<void> {
  const sdk = await findAndroidSdk()
  if (!sdk) return
  await exec(sdk.adb, ['-s', deviceId, 'emu', 'kill'], { timeout: 10000 }).catch(() => undefined)
}

/**
 * One frame of the device screen as PNG bytes.
 *
 * `exec-out` rather than `shell`, because `shell` mangles binary output by
 * translating line endings — the classic corrupted-screenshot bug. The buffer
 * is raised well past the default for the same reason a phone screenshot is
 * about a megabyte.
 */
export async function captureAndroid(deviceId: string): Promise<Buffer | null> {
  const sdk = await findAndroidSdk()
  if (!sdk) return null
  try {
    const { stdout } = await execFileBuffer(sdk.adb, ['-s', deviceId, 'exec-out', 'screencap', '-p'])
    return stdout.length ? stdout : null
  } catch {
    return null
  }
}

function execFileBuffer(file: string, args: string[]): Promise<{ stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve({ stdout: stdout as unknown as Buffer })
    })
  })
}

const KEYCODES: Record<string, string> = {
  home: 'KEYCODE_HOME',
  back: 'KEYCODE_BACK',
  menu: 'KEYCODE_MENU',
  power: 'KEYCODE_POWER',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
  appswitch: 'KEYCODE_APP_SWITCH',
}

export async function inputAndroid(deviceId: string, input: DeviceInput): Promise<void> {
  const sdk = await findAndroidSdk()
  if (!sdk) return
  const run = (args: string[]) =>
    exec(sdk.adb, ['-s', deviceId, 'shell', ...args], { timeout: 15000 }).catch(() => undefined)

  switch (input.kind) {
    case 'tap':
      await run(['input', 'tap', String(Math.round(input.x)), String(Math.round(input.y))])
      return
    case 'swipe':
      await run([
        'input', 'swipe',
        String(Math.round(input.x)), String(Math.round(input.y)),
        String(Math.round(input.toX)), String(Math.round(input.toY)),
        String(input.durationMs ?? 250),
      ])
      return
    case 'text':
      // `input text` takes one shell word and reads %s as a space; anything
      // else unescaped would be interpreted by the device's shell.
      await run(['input', 'text', JSON.stringify(input.text.replace(/ /g, '%s'))])
      return
    case 'key':
      await run(['input', 'keyevent', KEYCODES[input.key] ?? 'KEYCODE_HOME'])
      return
  }
}

export async function installAndroid(deviceId: string, apk: string): Promise<{ ok: boolean; output: string }> {
  const sdk = await findAndroidSdk()
  if (!sdk) return { ok: false, output: 'No Android SDK found.' }
  try {
    const { stdout, stderr } = await exec(sdk.adb, ['-s', deviceId, 'install', '-r', apk], {
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const output = `${stdout}${stderr}`.trim()
    return { ok: /Success/i.test(output), output }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, output: (e.stderr || e.stdout || e.message || String(err)).trim() }
  }
}

/** stdin is `ignore`, so the child exposes only stdout and stderr. */
export type LogcatChild = ChildProcessByStdio<null, Readable, Readable>

/** Streams logcat. The caller owns the child and must kill it. */
export async function logcatAndroid(
  deviceId: string,
  onLine: (line: string) => void,
): Promise<LogcatChild | null> {
  const sdk = await findAndroidSdk()
  if (!sdk) return null

  // `-T 200` starts from the recent tail rather than replaying the whole
  // buffer, which on a long-running emulator is tens of thousands of lines.
  const child = spawn(sdk.adb, ['-s', deviceId, 'logcat', '-T', '200', '-v', 'brief'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as LogcatChild

  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onLine(line)
  })
  return child
}
