/**
 * The channel that lets the assistant look at the app it is changing.
 *
 * An agent editing a UI is working blind. It can read the source and it can run
 * the tests, but the one question that matters — *does the thing look and behave
 * the way it should* — it has no way to ask. So it guesses, and the user becomes
 * the eyes: run it, screenshot it, paste it back, describe what is wrong.
 *
 * This is that loop, handed to the agent. Nova already has a browser pane, a
 * screenshot path that works on an unfocused guest, device mirroring and run
 * configurations; none of it was reachable from the console. A small MCP server
 * exposes them as tools, and this is what that server talks to.
 *
 * **Why a loopback HTTP server rather than something tidier.** The MCP server is
 * spawned by the vendor's CLI, not by Nova — it is a grandchild process with no
 * IPC channel home and no shared memory. A socket is the only thing both ends
 * can hold. It binds to 127.0.0.1 so nothing off this machine can reach it, and
 * every request carries a token generated per session, because "only local" is
 * not an access control on a machine with other users or other agents on it.
 *
 * Anything touching the browser pane has to be answered by the renderer, which
 * is where the `<webview>` lives. Those requests are broadcast with a
 * correlation id and awaited; a renderer that never answers times out rather
 * than leaving the agent hanging on a tool call forever.
 */
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'

/** A renderer round-trip that never answers must not hang the agent. */
const RENDERER_TIMEOUT_MS = 20_000

/** Screenshots the agent asked for, kept where it can read them back. */
const REVIEW_DIR = path.join('.nova', 'review')

/** How many screenshots to keep before the oldest are dropped. */
const MAX_SHOTS = 30

export interface ReviewContext {
  broadcast: (channel: string, payload: unknown) => void
  getRoot: () => string
  /** Captures a webview by its `webContents` id — the e2e screenshot path. */
  capture: (contentsId: number) => Promise<Buffer | null>
  /** Main-process tools that need no renderer round-trip. */
  listDevices: () => Promise<unknown>
  launchOnDevice: (deviceId: string, bundleId: string) => Promise<unknown>
  listRunConfigs: (root: string) => Promise<unknown>
  /** Overridable so the suite can prove the timeout without waiting it out. */
  rendererTimeoutMs?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let server: http.Server | null = null
let token = ''
let url = ''
const pending = new Map<string, Pending>()

/** Answers a request the renderer was asked to handle. */
export function settleReviewRequest(id: string, result: unknown, error?: string): void {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timer)
  if (error) entry.reject(new Error(error))
  else entry.resolve(result)
}

/** Asks the renderer something and waits for it to answer. */
function askRenderer(ctx: ReviewContext, action: string, args: unknown): Promise<unknown> {
  const id = randomBytes(8).toString('hex')
  return new Promise((resolve, reject) => {
    const wait = ctx.rendererTimeoutMs ?? RENDERER_TIMEOUT_MS
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(
        new Error(
          `The editor did not answer in ${wait / 1000}s. The browser pane may not be open — ask the user to open it, or use a tool that does not need it.`,
        ),
      )
    }, wait)
    pending.set(id, { resolve, reject, timer })
    ctx.broadcast('review:request', { id, action, args })
  })
}

/** Trims the screenshot directory so a long session cannot fill a disk. */
async function trimShots(dir: string): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.startsWith('shot-')).sort()
  for (const stale of names.slice(0, Math.max(0, names.length - MAX_SHOTS))) {
    await fs.rm(path.join(dir, stale), { force: true }).catch(() => undefined)
  }
}

/**
 * Runs one tool.
 *
 * Every failure is returned as a message rather than thrown, because the caller
 * is a language model: "the browser pane is not open" is something it can act
 * on, and a stack trace is not.
 */
async function callTool(ctx: ReviewContext, tool: string, args: Record<string, unknown>) {
  const root = ctx.getRoot()

  switch (tool) {
    case 'open_app': {
      const target = String(args.url ?? '')
      if (!/^https?:\/\//i.test(target)) {
        return { error: 'open_app needs an http or https URL.' }
      }
      await askRenderer(ctx, 'open', { url: target })
      return { ok: true, url: target }
    }

    case 'screenshot_app': {
      if (!root) return { error: 'No project is open.' }
      const view = (await askRenderer(ctx, 'contentsId', {})) as { contentsId?: number }
      if (!view?.contentsId) {
        return { error: 'The browser pane is not open, so there is nothing to capture.' }
      }
      const png = await ctx.capture(view.contentsId)
      if (!png) {
        return {
          error:
            'The capture produced no frame. The pane has to be visible, and DevTools must not be open on it.',
        }
      }
      const dir = path.join(root, REVIEW_DIR)
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, `shot-${Date.now()}.png`)
      await fs.writeFile(file, png)
      await trimShots(dir)
      // The path, not the bytes: the agent reads images from disk, and a
      // base64 PNG through a tool result would burn its context for nothing.
      return { ok: true, path: path.relative(root, file), bytes: png.length }
    }

    case 'read_console': {
      const messages = await askRenderer(ctx, 'console', { limit: Number(args.limit ?? 100) })
      return { ok: true, messages }
    }

    case 'list_devices':
      return { ok: true, devices: await ctx.listDevices() }

    case 'launch_on_device': {
      const deviceId = String(args.deviceId ?? '')
      const bundleId = String(args.bundleId ?? '')
      if (!deviceId || !bundleId) {
        return { error: 'launch_on_device needs both deviceId and bundleId.' }
      }
      return { ok: true, result: await ctx.launchOnDevice(deviceId, bundleId) }
    }

    case 'list_run_configs': {
      if (!root) return { error: 'No project is open.' }
      return { ok: true, configs: await ctx.listRunConfigs(root) }
    }

    default:
      return { error: `Unknown tool "${tool}".` }
  }
}

/** Reads a request body, refusing one large enough to be an attack. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Starts the bridge, or returns the one already running.
 *
 * One per session rather than one per run: the port and token go into the MCP
 * config the CLI reads at spawn time, and a server that moved between runs
 * would leave every already-spawned server pointing at a closed socket.
 */
export async function startReviewBridge(
  ctx: ReviewContext,
): Promise<{ url: string; token: string }> {
  if (server && url) return { url, token }

  token = randomBytes(24).toString('hex')

  server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body)
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(text),
      })
      res.end(text)
    }

    // Compared in full rather than by prefix, and before anything is parsed.
    if (req.headers.authorization !== `Bearer ${token}`) {
      send(401, { error: 'unauthorised' })
      return
    }
    if (req.method !== 'POST' || req.url !== '/call') {
      send(404, { error: 'not found' })
      return
    }

    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          tool?: string
          args?: Record<string, unknown>
        }
        if (!body.tool) {
          send(400, { error: 'a tool name is required' })
          return
        }
        send(200, await callTool(ctx, body.tool, body.args ?? {}))
      } catch (err) {
        send(200, { error: (err as Error).message })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    // Loopback only. A bridge that can drive the user's editor has no business
    // being reachable from anywhere but this machine.
    server!.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address() as AddressInfo
  url = `http://127.0.0.1:${address.port}`
  return { url, token }
}

export function stopReviewBridge(): void {
  for (const [id] of pending) settleReviewRequest(id, null, 'the editor is shutting down')
  server?.close()
  server = null
  url = ''
  token = ''
}
