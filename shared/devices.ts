/**
 * Android emulators and iOS simulators, from inside the editor.
 *
 * The reason this exists is that mobile work has a window-shuffling problem
 * rather than a capability problem: the emulator already runs fine, it just
 * lives in a separate application that has to be found, raised and clicked
 * into. Mirroring the screen into a pane next to the code removes the shuffle,
 * and everything else here — booting, installing, logs, input — follows from
 * having the device addressable at all.
 *
 * Neither platform is bundled. Nova drives the tools the developer already has:
 * `adb` and `emulator` from the Android SDK, `xcrun simctl` from Xcode. When
 * one is missing the panel says which, and what to install — the same contract
 * the language servers and debug adapters follow.
 */

export type DevicePlatform = 'android' | 'ios'

/**
 * `booting` is worth distinguishing from `booted`. An Android emulator answers
 * `adb devices` long before it is usable, so a mirror that starts at the first
 * sign of life shows a black rectangle for thirty seconds and looks broken.
 */
export type DeviceState = 'booted' | 'booting' | 'shutdown' | 'unknown'

export interface MobileDevice {
  /** `emulator-5554` for Android, the UDID for iOS. Stable while running. */
  id: string
  name: string
  platform: DevicePlatform
  state: DeviceState
  /** "API 34" or "iOS 17.5" — whatever the platform calls its version. */
  api: string
  kind: 'emulator' | 'simulator' | 'physical'
  /** The AVD this entry can be booted from, when it is not running yet. */
  avd?: string
}

/** Whether a platform's tooling is usable, and what to do when it is not. */
export interface DeviceToolStatus {
  platform: DevicePlatform
  available: boolean
  /** Resolved path of the binary that will run. */
  binary: string
  version: string
  /** Why it cannot be used, and the command that fixes it. */
  detail: string
}

/** A frame of the device screen, as a data URL the renderer can show. */
export interface DeviceFrame {
  deviceId: string
  /** `data:image/png;base64,…`, or empty when the capture failed. */
  image: string
  width: number
  height: number
  capturedAt: number
  error?: string
}

/**
 * Input forwarded to a device.
 *
 * Coordinates are in the device's own pixel space, not the pane's. The renderer
 * knows the pane size and the frame size, so it does the conversion — doing it
 * here would mean the main process tracking a layout it cannot see.
 */
export type DeviceInput =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x: number; y: number; toX: number; toY: number; durationMs?: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: 'home' | 'back' | 'menu' | 'power' | 'enter' | 'delete' | 'appswitch' }

export interface DeviceLogLine {
  deviceId: string
  text: string
  at: number
}

/** What a platform can actually do, so the UI offers only what will work. */
export interface DeviceCapabilities {
  mirror: boolean
  input: boolean
  install: boolean
  logs: boolean
  /** Set when a capability is missing and something can be installed for it. */
  note?: string
}
