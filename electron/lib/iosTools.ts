/**
 * Driving iOS simulators through `xcrun simctl`.
 *
 * `simctl` ships with Xcode, not with the Command Line Tools. A machine can
 * therefore have `xcrun`, `xcodebuild` and a working compiler and still have no
 * simulators at all — which is a confusing state to be in, because every
 * individual tool appears present. So the check here is for `simctl` itself
 * rather than for `xcrun`, and the failure names the exact `xcode-select`
 * command that fixes it.
 *
 * Simulators are macOS-only. On any other platform this reports unavailable and
 * does nothing, rather than producing errors that read like bugs.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceInput, DeviceToolStatus, MobileDevice } from '../../shared/devices'

const exec = promisify(execFile)

/** Runs a simctl subcommand. */
function simctl(args: string[], timeout = 30000) {
  return exec('xcrun', ['simctl', ...args], { timeout, maxBuffer: 32 * 1024 * 1024 })
}

export async function iosStatus(): Promise<DeviceToolStatus> {
  if (process.platform !== 'darwin') {
    return {
      platform: 'ios',
      available: false,
      binary: '',
      version: '',
      detail: 'iOS simulators only exist on macOS.',
    }
  }

  try {
    await simctl(['help'], 15000)
  } catch {
    return {
      platform: 'ios',
      available: false,
      binary: '',
      version: '',
      detail:
        'simctl was not found. It ships with Xcode, not the Command Line Tools — install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app',
    }
  }

  let version = ''
  try {
    const { stdout } = await exec('xcodebuild', ['-version'], { timeout: 15000 })
    version = stdout.trim().split('\n')[0] ?? ''
  } catch {
    /* simctl works even if xcodebuild does not answer */
  }
  return { platform: 'ios', available: true, binary: 'xcrun simctl', version, detail: '' }
}

interface SimctlDevice {
  udid: string
  name: string
  state: string
  isAvailable?: boolean
}

/**
 * Every available simulator, grouped by runtime.
 *
 * Unavailable ones — runtimes that were removed but whose devices linger — are
 * dropped. Offering to boot a simulator whose runtime is gone produces an error
 * the user cannot act on.
 */
export async function listIosDevices(): Promise<MobileDevice[]> {
  if (process.platform !== 'darwin') return []

  let parsed: { devices: Record<string, SimctlDevice[]> }
  try {
    const { stdout } = await simctl(['list', 'devices', 'available', '--json'])
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }

  const out: MobileDevice[] = []
  for (const [runtime, list] of Object.entries(parsed.devices ?? {})) {
    // "com.apple.CoreSimulator.SimRuntime.iOS-17-5" -> "iOS 17.5"
    const api = runtime
      .split('.')
      .pop()!
      .replace(/-/g, ' ')
      .replace(/^(\w+) (\d+) (\d+)$/, '$1 $2.$3')

    for (const device of list) {
      if (device.isAvailable === false) continue
      out.push({
        id: device.udid,
        name: device.name,
        platform: 'ios',
        state: device.state === 'Booted' ? 'booted' : device.state === 'Booting' ? 'booting' : 'shutdown',
        api,
        kind: 'simulator',
      })
    }
  }
  return out
}

/**
 * Boots a simulator and opens Simulator.app so it has somewhere to draw.
 *
 * A headless `simctl boot` succeeds and then produces nothing to capture,
 * because the device has no window server attached — the screenshot comes back
 * black and the feature looks broken. Opening the app is what makes the boot
 * useful rather than merely successful.
 */
export async function bootIos(udid: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await simctl(['boot', udid], 120000)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Booting something already booted is the desired end state, not a failure.
    if (!/current state: Booted|Unable to boot device in current state/i.test(message)) {
      return { ok: false, error: message }
    }
  }
  await exec('open', ['-a', 'Simulator'], { timeout: 30000 }).catch(() => undefined)
  return { ok: true }
}

export async function shutdownIos(udid: string): Promise<void> {
  await simctl(['shutdown', udid], 60000).catch(() => undefined)
}

/** One frame of the simulator screen as PNG bytes. */
export async function captureIos(udid: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      'xcrun',
      ['simctl', 'io', udid, 'screenshot', '--type=png', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20000 },
      (err, stdout) => {
        const buffer = stdout as unknown as Buffer
        resolve(err || !buffer?.length ? null : buffer)
      },
    )
  })
}

/**
 * Input, where simctl can express it.
 *
 * simctl has no tap or swipe. Apple's own tooling drives a simulator through
 * XCUITest, and the usual third-party answer is `idb`. Rather than shell out to
 * something that is probably not installed, the unsupported cases return false
 * and the panel says so — an input control that silently does nothing is worse
 * than one that is visibly unavailable.
 */
export async function inputIos(udid: string, input: DeviceInput): Promise<boolean> {
  if (input.kind === 'text') {
    // The one case simctl does handle, via the pasteboard plus a paste key.
    try {
      await simctl(['pbcopy', udid], 15000)
      return false
    } catch {
      return false
    }
  }
  if (input.kind === 'key' && input.key === 'home') {
    // Hardware keys are not exposed either; treat it as unsupported rather
    // than pretending.
    return false
  }
  return false
}

export async function installIos(udid: string, app: string): Promise<{ ok: boolean; output: string }> {
  try {
    await simctl(['install', udid, app], 180000)
    return { ok: true, output: `Installed ${app}` }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, output: (e.stderr || e.message || String(err)).trim() }
  }
}

export async function launchIos(udid: string, bundleId: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await simctl(['launch', udid, bundleId], 60000)
    return { ok: true, output: stdout.trim() }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, output: (e.stderr || e.message || String(err)).trim() }
  }
}
