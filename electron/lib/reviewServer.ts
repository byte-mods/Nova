/**
 * Nova's own MCP server, described the way the plugin ones are.
 *
 * The registry in `pluginMcp` already knows how to render a server into each
 * CLI's config, so the review tools join it as one more entry rather than
 * growing a second path through `ai:start`. The only difference is that this
 * one ships with the editor, so its command is Nova's own runtime and its
 * script is beside the plugin host in the build output.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ipcMain } from 'electron'
import type { ResolvedMcpServer } from './pluginMcp'
import { settleReviewRequest, startReviewBridge } from './reviewBridge'
import { capture } from '../ipc/e2e'
import type { MobileDevice } from '../../shared/devices'
import { listAndroidDevices } from './androidTools'
import { launchIos, listIosDevices } from './iosTools'
import { detectRunConfigs } from './runConfigs'

/** Where the review server ends up, in development and in a packaged app. */
function reviewScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = process.env.APP_ROOT ?? path.join(here, '..')
  const candidates = [
    path.join(here, 'mcp', 'nova-review.mjs'),
    path.join(root, 'dist-electron', 'mcp', 'nova-review.mjs'),
    path.join(root, 'electron', 'mcp', 'nova-review.mjs'),
  ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

let registered = false

/**
 * Starts the bridge if it is not already up and describes the server.
 *
 * Returns null rather than throwing when the bridge cannot bind: the assistant
 * losing one set of tools is a smaller failure than the prompt not running.
 */
export async function resolveReviewServer(
  broadcast: (channel: string, payload: unknown) => void,
  getRoot: () => string,
): Promise<ResolvedMcpServer | null> {
  const script = reviewScriptPath()
  if (!existsSync(script)) return null

  if (!registered) {
    registered = true
    // The renderer answers the browser-pane requests; this is where those
    // answers come back in.
    ipcMain.handle('review:reply', (_e, id: string, result: unknown, error?: string) => {
      settleReviewRequest(id, result, error)
    })
  }

  let bridge: { url: string; token: string }
  try {
    bridge = await startReviewBridge({
      broadcast,
      getRoot,
      capture,
      listDevices: async () => {
        const [android, ios] = await Promise.all([listAndroidDevices(), listIosDevices()])
        return [...android, ...ios]
      },
      launchOnDevice: async (deviceId: string, bundleId: string) => {
        const [android, ios] = await Promise.all([listAndroidDevices(), listIosDevices()])
        const device = [...android, ...ios].find((d: MobileDevice) => d.id === deviceId)
        if (!device) return { error: `No device with id ${deviceId}.` }
        // Launching by bundle id is an iOS concept; Android installs an APK.
        return device.platform === 'ios'
          ? await launchIos(device.id, bundleId)
          : { error: 'Launching by bundle id is iOS-only. Install the APK on Android instead.' }
      },
      listRunConfigs: (root) => detectRunConfigs(root),
    })
  } catch {
    return null
  }

  return {
    key: 'nova__review',
    pluginId: 'nova',
    pluginName: 'Nova',
    contribution: { name: 'review', command: process.execPath, args: [script] },
    // Electron's own binary is the Node runtime; this switch makes it behave as
    // plain Node rather than booting a second copy of the editor.
    command: process.execPath,
    args: [script],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NOVA_REVIEW_URL: bridge.url,
      NOVA_REVIEW_TOKEN: bridge.token,
    },
    cwd: app.getPath('userData'),
  }
}
