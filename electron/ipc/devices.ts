/**
 * Android emulators and iOS simulators over IPC.
 *
 * The two platforms are kept behind one surface so the panel does not branch on
 * them. Where a platform genuinely cannot do something — iOS has no tap through
 * simctl — that is reported as a capability rather than hidden, because a
 * control that silently does nothing is worse than one that is visibly absent.
 *
 * Mirroring is a poll, not a stream. `adb exec-out screencap` and `simctl io
 * screenshot` are both one-shot commands; there is no frame callback to
 * subscribe to. A timer per device asks for a frame, and slow devices are
 * allowed to be slow — a new capture is never started while the previous one is
 * still running, which is what stops a stuck device queueing hundreds of them.
 */
import { ipcMain } from 'electron'
import type {
  DeviceCapabilities,
  DeviceFrame,
  DeviceInput,
  DevicePlatform,
  DeviceToolStatus,
  MobileDevice,
} from '../../shared/devices'
import {
  androidStatus,
  bootAndroid,
  captureAndroid,
  inputAndroid,
  installAndroid,
  listAndroidDevices,
  logcatAndroid,
  shutdownAndroid,
  type LogcatChild,
} from '../lib/androidTools'
import {
  bootIos,
  captureIos,
  inputIos,
  installIos,
  iosStatus,
  launchIos,
  listIosDevices,
  shutdownIos,
} from '../lib/iosTools'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

/** One mirror per device: its timer, and whether a capture is in flight. */
interface Mirror {
  platform: DevicePlatform
  timer: NodeJS.Timeout
  busy: boolean
}

const mirrors = new Map<string, Mirror>()
const logs = new Map<string, LogcatChild>()

/** How often a frame is asked for. Fast enough to feel live, slow enough that
 *  a screencap costing ~150ms does not saturate the device. */
const FRAME_INTERVAL_MS = 400

export function registerDeviceHandlers(ctx: Ctx) {
  ipcMain.handle('devices:status', async (): Promise<DeviceToolStatus[]> =>
    Promise.all([androidStatus(), iosStatus()]),
  )

  ipcMain.handle('devices:list', async (): Promise<MobileDevice[]> => {
    const [android, ios] = await Promise.all([listAndroidDevices(), listIosDevices()])
    return [...android, ...ios]
  })

  ipcMain.handle('devices:capabilities', (_e, platform: DevicePlatform): DeviceCapabilities =>
    platform === 'android'
      ? { mirror: true, input: true, install: true, logs: true }
      : {
          mirror: true,
          input: false,
          install: true,
          logs: false,
          note: 'simctl cannot send taps or read a device log. Those need Apple’s XCUITest or the third-party `idb`.',
        },
  )

  ipcMain.handle('devices:boot', async (_e, device: MobileDevice) =>
    device.platform === 'android'
      ? bootAndroid(device.avd ?? device.name)
      : bootIos(device.id),
  )

  ipcMain.handle('devices:shutdown', async (_e, device: MobileDevice) => {
    stopMirror(device.id)
    stopLogs(device.id)
    if (device.platform === 'android') await shutdownAndroid(device.id)
    else await shutdownIos(device.id)
  })

  /* ---------------- mirroring ---------------- */

  ipcMain.handle('devices:startMirror', (_e, device: MobileDevice) => {
    stopMirror(device.id)

    const tick = async () => {
      const mirror = mirrors.get(device.id)
      // Never overlap captures. A device that takes longer than the interval
      // would otherwise accumulate work it can never catch up on.
      if (!mirror || mirror.busy) return
      mirror.busy = true
      // Identity, not just presence. Stopping clears the timer but cannot
      // cancel a capture already in flight, and a frame delivered after the
      // stop paints a stale screen onto a pane the user has already moved
      // away from — or worse, onto a different device's view. Comparing the
      // object rather than the id also covers stop-then-start on the same
      // device, where the old capture must not feed the new mirror.
      const owner = mirror
      try {
        const png =
          device.platform === 'android' ? await captureAndroid(device.id) : await captureIos(device.id)

        const frame: DeviceFrame = png
          ? {
              deviceId: device.id,
              image: `data:image/png;base64,${png.toString('base64')}`,
              ...readPngSize(png),
              capturedAt: Date.now(),
            }
          : {
              deviceId: device.id,
              image: '',
              width: 0,
              height: 0,
              capturedAt: Date.now(),
              error: 'The device did not return a frame. It may still be booting.',
            }
        if (mirrors.get(device.id) === owner) ctx.broadcast('devices:frame', frame)
      } finally {
        const current = mirrors.get(device.id)
        if (current) current.busy = false
      }
    }

    mirrors.set(device.id, {
      platform: device.platform,
      timer: setInterval(() => void tick(), FRAME_INTERVAL_MS),
      busy: false,
    })
    void tick()
  })

  ipcMain.handle('devices:stopMirror', (_e, deviceId: string) => stopMirror(deviceId))

  /* ---------------- input, install, logs ---------------- */

  ipcMain.handle('devices:input', async (_e, device: MobileDevice, input: DeviceInput): Promise<boolean> => {
    if (device.platform === 'android') {
      await inputAndroid(device.id, input)
      return true
    }
    return inputIos(device.id, input)
  })

  ipcMain.handle('devices:install', async (_e, device: MobileDevice, file: string) =>
    device.platform === 'android' ? installAndroid(device.id, file) : installIos(device.id, file),
  )

  ipcMain.handle('devices:launch', async (_e, device: MobileDevice, bundleId: string) =>
    device.platform === 'ios'
      ? launchIos(device.id, bundleId)
      : { ok: false, output: 'Launching by bundle id is an iOS concept; install the APK instead.' },
  )

  ipcMain.handle('devices:startLogs', async (_e, device: MobileDevice) => {
    stopLogs(device.id)
    if (device.platform !== 'android') return false
    const child = await logcatAndroid(device.id, (text) =>
      ctx.broadcast('devices:log', { deviceId: device.id, text, at: Date.now() }),
    )
    if (!child) return false
    logs.set(device.id, child)
    return true
  })

  ipcMain.handle('devices:stopLogs', (_e, deviceId: string) => stopLogs(deviceId))

  return {
    /** Nothing should outlive the window that asked for it. */
    dispose() {
      for (const id of [...mirrors.keys()]) stopMirror(id)
      for (const id of [...logs.keys()]) stopLogs(id)
    },
  }
}

function stopMirror(deviceId: string) {
  const mirror = mirrors.get(deviceId)
  if (!mirror) return
  clearInterval(mirror.timer)
  mirrors.delete(deviceId)
}

function stopLogs(deviceId: string) {
  const child = logs.get(deviceId)
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  logs.delete(deviceId)
}

/**
 * Width and height straight out of the PNG header.
 *
 * The renderer needs the device's pixel dimensions to turn a click in the pane
 * into a tap on the device. Decoding the image to find out would mean carrying
 * it through a canvas; the IHDR chunk is at a fixed offset and is 8 bytes.
 */
function readPngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24) return { width: 0, height: 0 }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

export type DeviceIpc = ReturnType<typeof registerDeviceHandlers>
