/**
 * Starting and stopping a share.
 *
 * One share at a time, deliberately. Two live tunnels would mean two public
 * URLs to keep track of, and the failure mode of forgetting about one is that
 * a project stays readable by anyone holding a link.
 */
import { app, desktopCapturer, ipcMain, screen } from 'electron'
import path from 'node:path'
import type {
  ShareAgentState,
  ShareBroadcastSelection,
  ShareBroadcastStatus,
  ShareMediaChannel,
  ShareOptions,
  SharePresence,
  ShareScreenSource,
  ShareStatus,
} from '../../shared/share'
import { startShareServer, type ShareServerHandle } from '../lib/shareServer'
import { findCloudflared, openTunnel, TunnelError, type TunnelHandle } from '../lib/tunnel'
import { onShutdown } from '../lib/shutdown'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

let server: ShareServerHandle | null = null
let tunnel: TunnelHandle | null = null
let current: ShareStatus = blank()

function idleBroadcast(): ShareBroadcastStatus {
  return { active: false, screen: false, camera: false, microphone: false, startedAt: 0 }
}

function blank(): ShareStatus {
  return {
    state: 'stopped',
    mode: 'project',
    url: '',
    localUrl: '',
    sharing: '',
    viewers: 0,
    startedAt: 0,
    excluded: [],
    broadcast: idleBroadcast(),
  }
}

export function registerShareHandlers(ctx: Ctx) {
  const publish = () => {
    current = { ...current, viewers: server?.viewers() ?? 0, excluded: server?.excluded ?? [] }
    ctx.broadcast('share:status', current)
    return current
  }

  ipcMain.handle('share:status', () => publish())

  ipcMain.handle('share:available', async () => Boolean(await findCloudflared()))

  ipcMain.handle(
    'share:start',
    async (_e, root: string, options: ShareOptions): Promise<ShareStatus> => {
      if (!root) {
        current = { ...blank(), state: 'error', error: 'Open a project first.' }
        return publish()
      }
      // Restarting rather than refusing: the user asked for a share, and the
      // old URL is the thing they no longer want.
      await stop()

      current = {
        ...blank(),
        state: 'starting',
        mode: options.mode,
        startedAt: Date.now(),
        sharing:
          options.mode === 'collection'
            ? path.basename(options.file ?? '')
            : path.basename(root),
      }
      publish()

      try {
        server = await startShareServer({
          root,
          mode: options.mode,
          file: options.file,
          projectName: path.basename(root),
        })
      } catch (err) {
        current = { ...current, state: 'error', error: `Could not start the share server: ${(err as Error).message}` }
        return publish()
      }

      current = { ...current, localUrl: `http://127.0.0.1:${server.port}/s/${server.token}/` }
      publish()

      try {
        tunnel = await openTunnel(server.port, (line) => ctx.broadcast('share:log', line))
      } catch (err) {
        const error = err as TunnelError
        await stop()
        current = {
          ...blank(),
          state: 'error',
          error: error.hint ? `${error.message} ${error.hint}` : error.message,
        }
        return publish()
      }

      // The token is in the path, so the public URL is the whole credential.
      current = {
        ...current,
        state: 'live',
        url: `${tunnel.url}/s/${server.token}/`,
      }
      return publish()
    },
  )

  ipcMain.handle('share:stop', async (): Promise<ShareStatus> => {
    await stop()
    current = blank()
    return publish()
  })

  /** The renderer pushes where the editor is; viewers follow. */
  ipcMain.handle('share:presence', (_e, presence: SharePresence) => {
    server?.update(presence)
    return publish()
  })

  /* ---------------- live audio and video ---------------- */

  /**
   * The screens and windows the presenter can pick from.
   *
   * Thumbnails are sized to the display's aspect ratio rather than a fixed box
   * so the picker does not letterbox every entry into something unrecognisable.
   */
  ipcMain.handle('share:screenSources', async (): Promise<ShareScreenSource[]> => {
    const { width } = screen.getPrimaryDisplay().size
    const height = screen.getPrimaryDisplay().size.height
    const scale = 320 / Math.max(width, 1)
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: Math.round(height * scale) || 180 },
      fetchWindowIcons: false,
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    }))
  })

  /**
   * Records what is being broadcast and tells viewers.
   *
   * Capture itself stays in the renderer: `MediaRecorder` and the media stream
   * live there, and moving frames through IPC only to send them straight back
   * out would buy nothing. What the main process owns is the fan-out, because
   * that is where the server is.
   */
  ipcMain.handle(
    'share:broadcast',
    (_e, selection: ShareBroadcastSelection | null, error?: string): ShareStatus => {
      const next: ShareBroadcastStatus =
        selection && (selection.screen || selection.camera || selection.microphone)
          ? {
              active: true,
              screen: selection.screen,
              camera: selection.camera,
              microphone: selection.microphone,
              startedAt: current.broadcast.active ? current.broadcast.startedAt : Date.now(),
              error,
            }
          : { ...idleBroadcast(), error }

      current = { ...current, broadcast: next }
      server?.setBroadcast(next)
      return publish()
    },
  )

  /**
   * One MediaRecorder chunk on its way to the viewers.
   *
   * `send` rather than `handle`: at a chunk every second or two this is the
   * hottest path in the feature, and a reply the renderer discards would double
   * the traffic across the boundary for nothing.
   */
  ipcMain.on('share:media', (_e, channel: ShareMediaChannel, chunk: ArrayBuffer) => {
    server?.pushMedia(channel, Buffer.from(chunk))
  })

  /**
   * What the agent is doing, on its way to the viewers.
   *
   * Only in project mode. Someone sent a request collection was given a
   * collection; the fact that an agent is editing the source behind it is not
   * part of what they were shown, and quietly widening a share is the one thing
   * this feature must never do.
   */
  ipcMain.handle('share:agent', (_e, state: ShareAgentState) => {
    if (current.mode !== 'project') return
    server?.setAgent(state)
  })

  /** A new recorder is starting, so the old header must not be handed out. */
  ipcMain.handle('share:mediaReset', (_e, channel: ShareMediaChannel) => {
    server?.resetMedia(channel)
  })

  // A share that outlives the window is a URL nobody is watching — and this is
  // a *public* URL, so the teardown is awaited rather than fired off into a
  // process that is about to disappear.
  onShutdown('share', stop)
}

async function stop() {
  const closing = [tunnel?.stop(), server?.close()]
  tunnel = null
  server = null
  await Promise.all(closing.map((p) => p?.catch(() => undefined)))
}
