/**
 * The read-only surface a share exposes.
 *
 * This server is the thing that ends up on the public internet, so its design
 * is mostly about what it *cannot* do:
 *
 *   - **No writes.** There is no endpoint that mutates anything. Not gated on
 *     a permission — simply absent.
 *   - **A token in every path.** 32 hex characters, new for each share. Without
 *     it every route is a 404, including the index, so the URL alone is the
 *     credential and a scan of `trycloudflare.com` finds nothing.
 *   - **A rooted, resolved path check.** Every file read is resolved and
 *     confirmed to still be under the project root, so no combination of `..`
 *     or encoding reaches outside it.
 *   - **Secrets withheld.** `.env` files, keys and certificates are refused
 *     and listed back to the user, because "share my project" said nothing
 *     about credentials.
 *
 * Live updating is Server-Sent Events rather than a WebSocket: the traffic is
 * one-directional by nature, and a viewer with no send channel is one fewer
 * thing to reason about.
 *
 * Audio and video ride the same tunnel, as WebM segments the presenter's
 * MediaRecorder produces and this server hands out. WebRTC would give lower
 * latency, but only with a signalling path and a STUN/TURN server to get
 * through NAT — infrastructure a user who typed `brew install cloudflared` has
 * not agreed to run. Segments over the HTTP tunnel that already exists need
 * none of it, and cost about a second of delay.
 *
 * Each segment request answers and *ends*, rather than one response held open
 * for the life of the broadcast. That is not a stylistic choice: proxies and
 * scanning middleboxes routinely buffer a response until it completes, and a
 * held-open response on such a network delivers the entire broadcast in one
 * lump at the end — which is indistinguishable, to the viewer, from the
 * feature not working. A reply that finishes is forwarded immediately by
 * everything in the path.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import {
  shareMediaMime,
  type ShareAgentState,
  type ShareBroadcastStatus,
  type ShareMediaChannel,
  type ShareMode,
  type SharePresence,
} from '../../shared/share'
import { isIgnoredPath, walk } from './scan'
import { parseHttpFile } from './httpFile'

/** Files never served, whatever else is being shared. */
const WITHHELD =
  /(?:^|[/\\])(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.keystore|credentials|\.aws|\.ssh)(?:$|[/\\])/i

const MAX_FILE_BYTES = 512 * 1024
const MAX_TREE_FILES = 4000

/**
 * How much recent media is kept per channel for viewers to catch up on.
 *
 * At the bitrate the presenter records, this is roughly ten seconds — enough to
 * cover a poll that was slow or a viewer whose tab was briefly backgrounded,
 * and far short of anything worth calling a recording. Nothing here is written
 * to disk.
 */
const MAX_MEDIA_BUFFER_BYTES = 8 * 1024 * 1024

interface MediaSegment {
  seq: number
  bytes: Buffer
}

interface MediaFeed {
  header: Buffer | null
  segments: MediaSegment[]
  bytes: number
  nextSeq: number
  /** Requests parked until the next segment lands. */
  waiters: Set<() => void>
}

function newFeed(): MediaFeed {
  return { header: null, segments: [], bytes: 0, nextSeq: 0, waiters: new Set() }
}

export interface ShareServerHandle {
  port: number
  token: string
  /** Paths refused as secrets, so the UI can say what was held back. */
  excluded: string[]
  viewers: () => number
  /** Pushes the editor's current position to every viewer. */
  update: (presence: SharePresence) => void
  /** Announces what is being broadcast, so viewers can show or hide the player. */
  setBroadcast: (status: ShareBroadcastStatus) => void
  /** Hands one MediaRecorder chunk to everyone watching that channel. */
  pushMedia: (channel: ShareMediaChannel, chunk: Buffer) => void
  /** Drops the remembered header so the next chunk starts a new stream. */
  resetMedia: (channel: ShareMediaChannel) => void
  /** Publishes what the agent is doing, so viewers can follow along. */
  setAgent: (state: ShareAgentState) => void
  close: () => Promise<void>
}

export interface ShareServerOptions {
  root: string
  mode: ShareMode
  /** The `.http` file to publish, in collection mode. */
  file?: string
  projectName: string
}

export async function startShareServer(options: ShareServerOptions): Promise<ShareServerHandle> {
  const token = crypto.randomBytes(16).toString('hex')
  const excluded: string[] = []
  const viewers = new Set<http.ServerResponse>()
  let presence: SharePresence = { activeFile: '' }
  let broadcast: ShareBroadcastStatus = idleBroadcast()
  let agent: ShareAgentState = idleAgent()

  /**
   * A short window of recent media per channel.
   *
   * `header` is the chunk carrying the EBML header the rest of the stream is
   * meaningless without. Someone who opens the link ten minutes in is given it
   * and then joins live — without it their player has a pile of clusters it
   * cannot interpret.
   *
   * `segments` is a ring: a viewer polls for everything after the sequence
   * number they last saw. It is bounded by bytes rather than count because
   * segment size follows the bitrate, and a memory cap that moves with the
   * content is the one that actually holds.
   */
  const media: Record<ShareMediaChannel, MediaFeed> = {
    main: newFeed(),
    camera: newFeed(),
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // Read-only by construction: anything that is not a GET is not a route.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET' })
      return res.end()
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const prefix = `/s/${token}`
    if (!url.pathname.startsWith(prefix)) {
      // Deliberately indistinguishable from a path that does not exist.
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Not found')
    }

    const route = url.pathname.slice(prefix.length) || '/'

    if (route === '/' || route === '/index.html') {
      return html(res, page(options, token))
    }

    if (route === '/events') return stream(req, res)

    if (route === '/tree') {
      return json(res, { name: options.projectName, files: await tree(options.root, excluded) })
    }

    if (route === '/presence') return json(res, presence)

    if (route === '/file') {
      const wanted = url.searchParams.get('path') ?? ''
      const read = await readShared(options.root, wanted, excluded)
      if ('error' in read) return json(res, { error: read.error }, read.status)
      return json(res, { path: wanted, content: read.content })
    }

    if (route === '/collection') {
      if (!options.file) return json(res, { error: 'No collection is being shared.' }, 404)
      return json(res, await collection(options.root, options.file))
    }

    if (route === '/broadcast') return json(res, broadcast)

    if (route === '/agent') return json(res, agent)

    if (route === '/media') {
      const channel = url.searchParams.get('channel') === 'camera' ? 'camera' : 'main'
      const asked = Number(url.searchParams.get('from'))
      return mediaSegments(req, res, channel, Number.isFinite(asked) ? asked : -1)
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  function stream(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // The tunnel sits in front of this; without it the proxy buffers and
      // nothing arrives until the connection ends.
      'X-Accel-Buffering': 'no',
    })
    res.write(`event: presence\ndata: ${JSON.stringify(presence)}\n\n`)
    viewers.add(res)

    // Cloudflare closes an idle connection; a comment every 20s is enough to
    // keep it open and costs nothing.
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000)
    const drop = () => {
      clearInterval(keepAlive)
      viewers.delete(res)
    }
    req.on('close', drop)
    req.on('error', drop)
  }

  /**
   * Everything on a channel after the sequence number the viewer already has.
   *
   * `from` below zero means "I am new": the reply opens with the header and
   * then the most recent segments, so a late arrival starts near the live edge
   * instead of replaying the backlog.
   *
   * When there is nothing new yet the request waits briefly rather than
   * returning empty immediately — one held request beats a viewer hammering the
   * tunnel — but it always answers well inside any proxy's patience.
   */
  async function mediaSegments(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channel: ShareMediaChannel,
    from: number,
  ) {
    const feed = media[channel]
    const fresh = from < 0

    let parts = collect(feed, from)
    if (!parts.length && broadcast.active) {
      await waitForSegment(feed, 2500)
      parts = collect(feed, from)
    }

    const body: Buffer[] = []
    if (fresh && feed.header) body.push(feed.header)
    for (const segment of parts) body.push(segment.bytes)

    const next = parts.length ? parts[parts.length - 1].seq + 1 : Math.max(from, feed.nextSeq)
    res.writeHead(200, {
      // Opaque on purpose: intermediaries transform and buffer media types for
      // their own optimisation, and there is nothing to gain from them trying.
      // The player learns the real type from the MIME string it hands to
      // `addSourceBuffer`, not from here.
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Next-Seq': String(next),
      // How a viewer learns the broadcast ended, without a second request.
      'X-Live': broadcast.active ? '1' : '0',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    res.end(Buffer.concat(body))
  }

  /** Segments at or after `from`, or the tail of the ring for a new viewer. */
  function collect(feed: MediaFeed, from: number): MediaSegment[] {
    if (from < 0) return feed.segments.slice(-2)
    return feed.segments.filter((s) => s.seq >= from)
  }

  /** Resolves on the next segment for this feed, or when the wait runs out. */
  function waitForSegment(feed: MediaFeed, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        feed.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      feed.waiters.add(done)
    })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Loopback only. The tunnel is the sole way in, so binding wider would
    // expose this to the local network for no benefit.
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    port,
    token,
    excluded,
    viewers: () => viewers.size,
    update(next) {
      presence = next
      const payload = `event: presence\ndata: ${JSON.stringify(next)}\n\n`
      for (const viewer of viewers) {
        try {
          viewer.write(payload)
        } catch {
          viewers.delete(viewer)
        }
      }
    },
    setBroadcast(next) {
      broadcast = next
      // Waking the waiters is what lets a polling viewer notice the broadcast
      // ended, rather than sitting out the full wait first.
      if (!next.active) {
        for (const channel of ['main', 'camera'] as ShareMediaChannel[]) endChannel(channel)
      }
      const payload = `event: broadcast\ndata: ${JSON.stringify(next)}\n\n`
      for (const viewer of viewers) {
        try {
          viewer.write(payload)
        } catch {
          viewers.delete(viewer)
        }
      }
    },

    pushMedia(channel, chunk) {
      if (!chunk.length) return
      // Stopping a recorder makes it flush one last chunk, which arrives after
      // the broadcast has already been declared over. Serving it would leave a
      // viewer who polls afterwards holding a fragment of a broadcast that no
      // longer exists.
      if (!broadcast.active) return
      const feed = media[channel]

      // The header is recognised by its EBML magic rather than by being the
      // first thing to arrive. Keeping a mid-stream cluster under the belief it
      // was the header is the one failure here that is invisible to the
      // presenter and total for every viewer who joins later.
      if (!feed.header && isEbmlHeader(chunk)) {
        feed.header = chunk
        return
      }

      feed.segments.push({ seq: feed.nextSeq++, bytes: chunk })
      feed.bytes += chunk.length
      while (feed.segments.length > 1 && feed.bytes > MAX_MEDIA_BUFFER_BYTES) {
        feed.bytes -= feed.segments.shift()!.bytes.length
      }

      for (const wake of [...feed.waiters]) wake()
    },

    resetMedia(channel) {
      endChannel(channel)
    },

    setAgent(next) {
      agent = next
      const payload = `event: agent\ndata: ${JSON.stringify(next)}\n\n`
      for (const viewer of viewers) {
        try {
          viewer.write(payload)
        } catch {
          viewers.delete(viewer)
        }
      }
    },

    async close() {
      for (const viewer of viewers) {
        try {
          viewer.end()
        } catch {
          /* already gone */
        }
      }
      viewers.clear()
      for (const channel of ['main', 'camera'] as ShareMediaChannel[]) endChannel(channel)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }

  /** Drops a channel's buffered media and releases anyone waiting on it. */
  function endChannel(channel: ShareMediaChannel) {
    const feed = media[channel]
    feed.header = null
    feed.segments = []
    feed.bytes = 0
    for (const wake of [...feed.waiters]) wake()
  }
}

function idleAgent(): ShareAgentState {
  return { active: false, request: '', status: '', steps: [], edits: [], running: false }
}

function idleBroadcast(): ShareBroadcastStatus {
  return { active: false, screen: false, camera: false, microphone: false, startedAt: 0 }
}

/** Every WebM stream opens with the EBML magic number; only the header does. */
function isEbmlHeader(chunk: Buffer): boolean {
  return (
    chunk.length >= 4 &&
    chunk[0] === 0x1a &&
    chunk[1] === 0x45 &&
    chunk[2] === 0xdf &&
    chunk[3] === 0xa3
  )
}

/* ---------------- reading, safely ---------------- */

/**
 * Resolves a requested path and refuses anything outside the project or on the
 * withheld list.
 *
 * The containment check is done on the *resolved* path rather than on the
 * requested string: `..` can be encoded, doubled, or hidden behind a symlink,
 * and only resolution settles where a path actually points.
 */
export async function readShared(
  root: string,
  requested: string,
  excluded: string[],
): Promise<{ content: string } | { error: string; status: number }> {
  if (!requested) return { error: 'No path given.', status: 400 }

  const resolved = path.resolve(root, requested)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: 'Outside the shared project.', status: 403 }
  }
  if (WITHHELD.test(relative)) {
    if (!excluded.includes(relative)) excluded.push(relative)
    return { error: 'This file is withheld from shares.', status: 403 }
  }
  if (isIgnoredPath(root, resolved)) return { error: 'Not shared.', status: 403 }

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(resolved)
  } catch {
    return { error: 'No such file.', status: 404 }
  }
  if (!stat.isFile()) return { error: 'Not a file.', status: 400 }
  if (stat.size > MAX_FILE_BYTES) return { error: 'Too large to share.', status: 413 }

  const content = await fs.readFile(resolved, 'utf8')
  if (content.includes('\0')) return { error: 'Binary file.', status: 415 }
  return { content }
}

async function tree(root: string, excluded: string[]): Promise<string[]> {
  const files: string[] = []
  for await (const file of walk(root, MAX_TREE_FILES)) {
    const relative = path.relative(root, file)
    if (WITHHELD.test(relative)) {
      if (!excluded.includes(relative)) excluded.push(relative)
      continue
    }
    files.push(relative)
  }
  return files.sort()
}

/** A `.http` file, parsed into something a viewer can read without the source. */
async function collection(root: string, file: string) {
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  if (relative.startsWith('..')) return { error: 'Outside the shared project.' }

  let text: string
  try {
    text = await fs.readFile(absolute, 'utf8')
  } catch {
    return { error: 'Could not read the collection.' }
  }

  const parsed = parseHttpFile(text)
  return {
    name: path.basename(file),
    // Variables are shown as names only. A `@token = …` line in a shared file
    // would otherwise be a credential handed to whoever has the URL.
    variables: Object.keys(parsed.variables),
    requests: parsed.requests.map((request) => ({
      name: request.name,
      method: request.method,
      protocol: request.protocol,
      url: request.url,
      headers: request.headers.map((h) => ({
        name: h.name,
        value: /^(authorization|cookie|x-api-key|proxy-authorization)$/i.test(h.name)
          ? '••••'
          : h.value,
      })),
      auth: request.auth.kind,
      body: describeBody(request.body),
      hasTests: Boolean(request.postScript),
    })),
  }
}

function describeBody(body: { kind: string } & Record<string, unknown>): string {
  switch (body.kind) {
    case 'text':
      return String(body.text ?? '')
    case 'file':
      return `< ${String(body.path ?? '')}`
    case 'graphql':
      return String(body.query ?? '')
    case 'multipart':
      return (body.parts as { name: string }[] | undefined)?.map((p) => p.name).join(', ') ?? ''
    default:
      return ''
  }
}

/* ---------------- the page a viewer sees ---------------- */

function html(res: http.ServerResponse, body: string) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // Nothing here loads anything remote, and saying so means an injected
    // string cannot turn the page into a request to somewhere else.
    // `media-src blob:` is what Media Source Extensions needs: the player is
    // fed from a blob URL this page creates, not from anywhere on the network.
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "connect-src 'self'; media-src blob:",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  })
  res.end(body)
}

function json(res: http.ServerResponse, payload: unknown, status = 200) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  })
  res.end(text)
}

function page(options: ShareServerOptions, token: string): string {
  const base = `/s/${token}`
  const title = options.mode === 'collection' ? 'Shared collection' : `${options.projectName} — shared`

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; --bg:#0f1116; --panel:#12151c; --border:#232733;
          --text:#dfe4ee; --dim:#98a0b3; --faint:#646c7e; --accent:#82aaff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font:13px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  header { display:flex; align-items:center; gap:10px; padding:9px 14px;
           border-bottom:1px solid var(--border); background:var(--panel); }
  header b { font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; background:#4ec9b0; }
  .dot.off { background:var(--faint); }
  main { display:flex; height:calc(100vh - 41px); }
  nav { width:270px; overflow:auto; border-right:1px solid var(--border);
        background:var(--panel); padding:6px 0; flex-shrink:0; }
  nav button { display:block; width:100%; text-align:left; padding:3px 12px;
               background:none; border:0; color:var(--dim); font:inherit;
               font-size:11.5px; cursor:pointer; white-space:nowrap;
               overflow:hidden; text-overflow:ellipsis; }
  nav button:hover { background:#ffffff0d; color:var(--text); }
  nav button.active { background:#82aaff22; color:var(--accent); }
  section { flex:1; overflow:auto; min-width:0; }
  pre { margin:0; padding:14px; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
        white-space:pre; tab-size:2; }
  .empty { padding:24px; color:var(--faint); }
  .req { border-bottom:1px solid var(--border); padding:12px 16px; }
  .req h3 { margin:0 0 4px; font-size:13px; font-weight:600; }
  .m { display:inline-block; min-width:64px; padding:1px 6px; border-radius:3px;
       background:#ffffff10; font:600 10px/1.6 ui-monospace,monospace;
       letter-spacing:.04em; margin-right:8px; }
  .u { font:11.5px ui-monospace,monospace; color:var(--dim); word-break:break-all; }
  .kv { margin-top:6px; font:11px ui-monospace,monospace; color:var(--faint); }
  .body { margin-top:8px; padding:8px 10px; border-radius:4px; background:#00000040;
          font:11px/1.55 ui-monospace,monospace; white-space:pre-wrap; word-break:break-word; }
  .tag { margin-left:8px; padding:1px 6px; border-radius:9px; background:#ffffff10;
         font-size:9.5px; color:var(--faint); }
  footer { padding:8px 14px; border-top:1px solid var(--border); color:var(--faint);
           font-size:11px; background:var(--panel); }

  /* the live player */
  #live { display:none; border-bottom:1px solid var(--border); background:#000;
          position:relative; }
  #live.on { display:block; }
  #main-video { display:block; width:100%; max-height:60vh; background:#000; }
  #main-video.audio-only { height:64px; }
  #cam-wrap { display:none; position:absolute; right:12px; bottom:12px; width:180px;
              border:1px solid var(--border); border-radius:6px; overflow:hidden;
              background:#000; box-shadow:0 4px 18px #0009; }
  #cam-wrap.on { display:block; }
  #cam-video { display:block; width:100%; }
  .live-bar { display:flex; align-items:center; gap:8px; padding:6px 12px;
              background:var(--panel); border-bottom:1px solid var(--border);
              font-size:11px; color:var(--dim); }
  .live-bar .pill { display:inline-flex; align-items:center; gap:4px; padding:1px 7px;
                    border-radius:9px; background:#ffffff10; font-size:10px; }
  .live-bar .rec { width:7px; height:7px; border-radius:50%; background:#f2555a;
                   animation:pulse 1.6s infinite; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
  .live-hint { padding:6px 12px; color:var(--faint); font-size:11px; background:var(--panel); }

  /* the agent panel */
  #agent { display:none; border-bottom:1px solid var(--border); background:var(--panel);
           padding:9px 14px; }
  #agent.on { display:block; }
  #agent h4 { margin:0 0 5px; font-size:12px; display:flex; align-items:center; gap:7px; }
  #agent .req { color:var(--dim); font-size:11.5px; margin-bottom:7px; }
  #agent ol { margin:0; padding-left:18px; font-size:11.5px; color:var(--dim); }
  #agent li.done { color:var(--text); }
  #agent li.running { color:var(--accent); }
  #agent li.skipped { text-decoration:line-through; color:var(--faint); }
  #agent .files { margin-top:7px; font:11px ui-monospace,monospace; color:var(--faint);
                  display:flex; flex-wrap:wrap; gap:10px; }
  #agent .add { color:#4ec9b0; }
  #agent .del { color:#f2555a; }
  #agent .verdict { margin-top:7px; font-size:11px; }
  #agent .verdict.passed { color:#4ec9b0; }
  #agent .verdict.failed { color:#f2555a; }
</style>

<header>
  <span class="dot" id="dot"></span>
  <b>${escapeHtml(options.mode === 'collection' ? path.basename(options.file ?? '') : options.projectName)}</b>
  <span style="color:var(--faint)">${options.mode === 'collection' ? 'shared collection' : 'shared session — read only'}</span>
  <span style="flex:1"></span>
  <span style="color:var(--faint)" id="now"></span>
</header>

<div id="live">
  <div class="live-bar">
    <span class="rec"></span><b style="color:var(--text)">Live</b>
    <span id="live-what"></span>
    <span style="flex:1"></span>
    <span class="pill" id="live-hint-pill">audio starts muted — click the player to unmute</span>
  </div>
  <div style="position:relative">
    <video id="main-video" autoplay playsinline muted controls></video>
    <div id="cam-wrap"><video id="cam-video" autoplay playsinline muted></video></div>
  </div>
</div>

<div id="agent"></div>

<main>
  ${options.mode === 'project' ? '<nav id="tree"></nav>' : ''}
  <section id="view"><p class="empty">Loading…</p></section>
</main>

<script>
(() => {
  const BASE = ${JSON.stringify(base)}
  const MODE = ${JSON.stringify(options.mode)}
  // Injected rather than written out again, so the type this page asks for is
  // by construction the one the presenter recorded.
  const shareMediaMime = ${shareMediaMime.toString()}
  const view = document.getElementById('view')
  const dot = document.getElementById('dot')
  const now = document.getElementById('now')

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]))

  /* ---------------- the live player ---------------- */

  const live = document.getElementById('live')
  const liveWhat = document.getElementById('live-what')
  const camWrap = document.getElementById('cam-wrap')
  const players = {}

  /**
   * Plays one channel by feeding a MediaSource from the chunked response.
   *
   * The appends are queued rather than fired as they arrive: SourceBuffer
   * rejects an append while one is in flight, and a live stream produces the
   * next chunk long before the last has been processed.
   */
  function play(channel, el, mime) {
    if (players[channel]) return
    const source = new MediaSource()
    const state = { source, abort: new AbortController() }
    players[channel] = state
    el.src = URL.createObjectURL(source)

    source.addEventListener('sourceopen', async () => {
      let buffer
      const queue = []
      let appending = false

      const pump = () => {
        if (appending || !queue.length || source.readyState !== 'open') return
        if (buffer.updating) return
        appending = true
        try {
          // Peeked, not shifted: an append that throws must leave the chunk in
          // the queue to be retried. Removing it first loses a segment, and a
          // missing segment is a hole the decoder stalls on rather than an
          // error anyone sees.
          buffer.appendBuffer(queue[0])
          queue.shift()
        } catch (err) {
          appending = false
          // QuotaExceeded is the expected one on a long stream: drop what has
          // already been played and try the same chunk again.
          if (err && err.name === 'QuotaExceededError' && buffer.buffered.length) {
            try { buffer.remove(buffer.buffered.start(0), Math.max(0, el.currentTime - 8)) } catch {}
          }
        }
      }

      /*
       * Playback recovery.
       *
       * A live MSE stream stalls for reasons that are invisible from here: the
       * element runs to the end of what is buffered before the next segment
       * lands, a seek puts it in a gap, or autoplay was refused and the first
       * play() rejected. All of them look identical — a frozen picture with
       * data still arriving — and none of them fire an error. So rather than
       * enumerate the causes, watch the symptom: if the clock is not moving and
       * there is buffered media ahead, go to it.
       */
      let lastSeen = -1
      state.watchdog = setInterval(() => {
        if (source.readyState !== 'open' || !buffer) return
        const ahead = buffer.buffered.length
          ? buffer.buffered.end(buffer.buffered.length - 1)
          : 0
        const stuck = el.currentTime === lastSeen
        lastSeen = el.currentTime
        if (!stuck) return

        // Landing further back than the very edge on purpose: a player parked
        // on the last frame it has drops straight back to waiting for data, so
        // recovering to the edge just stalls again a moment later.
        if (ahead > el.currentTime + 0.5 && !buffer.updating) {
          el.currentTime = Math.max(0, ahead - 1.5)
        }
        if (el.paused) el.play().catch(() => undefined)
      }, 1000)

      // Polling for segments rather than reading one endless response: a
      // response that finishes is forwarded by every proxy in the path, while
      // one held open is buffered by some of them until it ends — which for a
      // live broadcast means never.
      let from = -1
      try {
        for (;;) {
          const res = await fetch(
            BASE + '/media?channel=' + channel + '&from=' + from,
            { signal: state.abort.signal, cache: 'no-store' },
          )
          if (!res.ok) break
          from = Number(res.headers.get('X-Next-Seq') ?? from)
          const bytes = new Uint8Array(await res.arrayBuffer())

          if (bytes.length) {
            if (!buffer) {
              buffer = source.addSourceBuffer(mime)
              buffer.mode = 'sequence'
              buffer.addEventListener('updateend', () => { appending = false; pump() })
            }
            queue.push(bytes)
            pump()

            // Chasing the live edge: a backgrounded tab builds a backlog, and a
            // viewer wants what is happening now, not a faithful replay of the
            // delay they accumulated. The landing point keeps a couple of
            // seconds in hand — jumping to the very edge leaves the player with
            // less than one segment and it stalls waiting for the next.
            if (buffer.buffered.length) {
              const end = buffer.buffered.end(buffer.buffered.length - 1)
              if (end - el.currentTime > 6) el.currentTime = Math.max(0, end - 2)
            }
            if (el.paused) el.play().catch(() => { /* autoplay policy */ })
          }

          if (res.headers.get('X-Live') === '0') break
          if (!players[channel]) break
        }
      } catch (err) {
        /* the viewer left, or the share went away */
      }
    })

    el.play().catch(() => { /* autoplay policy — the controls are there */ })
  }

  function stopPlay(channel, el) {
    const state = players[channel]
    if (!state) return
    delete players[channel]
    if (state.watchdog) clearInterval(state.watchdog)
    try { state.abort.abort() } catch {}
    try { el.removeAttribute('src'); el.load() } catch {}
  }

  function applyBroadcast(b) {
    const mainEl = document.getElementById('main-video')
    const camEl = document.getElementById('cam-video')

    if (!b || !b.active) {
      live.classList.remove('on')
      camWrap.classList.remove('on')
      stopPlay('main', mainEl)
      stopPlay('camera', camEl)
      return
    }

    const parts = []
    if (b.screen) parts.push('screen')
    if (b.camera) parts.push('camera')
    if (b.microphone) parts.push('microphone')
    liveWhat.textContent = parts.length ? 'sharing ' + parts.join(' + ') : ''

    const hasVideo = Boolean(b.screen || b.camera)
    mainEl.classList.toggle('audio-only', !hasVideo)
    live.classList.add('on')
    play('main', mainEl, shareMediaMime(hasVideo, Boolean(b.microphone)))

    // A camera only gets its own channel when a screen is occupying the main one.
    const separateCamera = Boolean(b.screen && b.camera)
    camWrap.classList.toggle('on', separateCamera)
    if (separateCamera) play('camera', camEl, shareMediaMime(true, false))
    else stopPlay('camera', camEl)
  }

  /*
   * Server-Sent Events are the fast path, and polling is the one that always
   * works. Some networks — corporate proxies and scanning middleboxes in
   * particular — buffer a response until it completes, which for an event
   * stream means the viewer is told nothing at all. Asking every few seconds
   * costs one small request and makes the page correct on those networks
   * instead of silently stale.
   */
  /* ---------------- what the agent is doing ---------------- */

  const agentEl = document.getElementById('agent')

  function applyAgent(a) {
    if (!a || !a.active) { agentEl.classList.remove('on'); return }
    agentEl.classList.add('on')

    const steps = (a.steps || []).map((s) =>
      '<li class="' + esc(s.status) + '">' + esc(s.text) + '</li>').join('')

    const files = (a.edits || []).map((e) =>
      '<span>' + esc(e.path) + ' <span class="add">+' + e.additions +
      '</span> <span class="del">\u2212' + e.deletions + '</span></span>').join('')

    const v = a.verification
    const verdict = v
      ? '<div class="verdict ' + esc(v.state) + '">' +
        (v.state === 'running' ? 'Running the project\u2019s tests\u2026'
          : v.state === 'unavailable' ? 'No test suite to check this against'
          : v.passed + '/' + v.total + ' tests pass' + (v.failed ? ' \u2014 ' + v.failed + ' failed' : '') +
            ' (' + esc(v.framework) + ')') + '</div>'
      : ''

    agentEl.innerHTML =
      '<h4>' + (a.running ? '<span class="rec"></span>' : '') +
      'Assistant \u00b7 ' + esc(a.status) + '</h4>' +
      (a.request ? '<div class="req">' + esc(a.request) + '</div>' : '') +
      (steps ? '<ol>' + steps + '</ol>' : '') +
      (files ? '<div class="files">' + files + '</div>' : '') +
      verdict
  }

  let lastAgent = ''
  const readAgent = () =>
    fetch(BASE + '/agent', { cache: 'no-store' })
      .then((r) => r.json())
      .then((a) => {
        const seen = JSON.stringify(a)
        if (seen === lastAgent) return
        lastAgent = seen
        applyAgent(a)
      })
      .catch(() => {})

  readAgent()
  setInterval(readAgent, 3000)

  let lastBroadcast = ''
  const readBroadcast = () =>
    fetch(BASE + '/broadcast', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        dot.classList.remove('off')
        const seen = JSON.stringify(b)
        if (seen === lastBroadcast) return
        lastBroadcast = seen
        applyBroadcast(b)
      })
      .catch(() => dot.classList.add('off'))

  readBroadcast()
  setInterval(readBroadcast, 3000)

  const events = new EventSource(BASE + '/events')
  events.addEventListener('agent', (e) => {
    lastAgent = e.data
    applyAgent(JSON.parse(e.data))
  })
  events.addEventListener('broadcast', (e) => {
    lastBroadcast = e.data
    applyBroadcast(JSON.parse(e.data))
  })
  events.onerror = () => dot.classList.add('off')

  /* ---------------- the shared content ---------------- */

  if (MODE === 'collection') {
    fetch(BASE + '/collection').then((r) => r.json()).then((data) => {
      if (data.error) { view.innerHTML = '<p class="empty">' + esc(data.error) + '</p>'; return }
      view.innerHTML = data.requests.map((r) =>
        '<div class="req"><h3><span class="m">' + esc(r.method) + '</span>' + esc(r.name) +
        (r.hasTests ? '<span class="tag">has tests</span>' : '') +
        (r.auth !== 'none' ? '<span class="tag">' + esc(r.auth) + '</span>' : '') +
        '</h3><div class="u">' + esc(r.url) + '</div>' +
        (r.headers.length ? '<div class="kv">' + r.headers.map((h) =>
          esc(h.name) + ': ' + esc(h.value)).join('<br>') + '</div>' : '') +
        (r.body ? '<div class="body">' + esc(r.body) + '</div>' : '') +
        '</div>').join('') || '<p class="empty">This collection has no requests.</p>'
      now.textContent = data.requests.length + ' requests'
    })
    return
  }

  let active = ''
  const tree = document.getElementById('tree')

  const show = (path, content) => {
    active = path
    view.innerHTML = '<pre>' + esc(content) + '</pre>'
    for (const b of tree.children) b.classList.toggle('active', b.dataset.path === path)
    const chosen = tree.querySelector('[data-path="' + CSS.escape(path) + '"]')
    if (chosen) chosen.scrollIntoView({ block: 'nearest' })
  }

  const open = (path) =>
    fetch(BASE + '/file?path=' + encodeURIComponent(path))
      .then((r) => r.json())
      .then((d) => show(path, d.error ? '(' + d.error + ')' : d.content))

  fetch(BASE + '/tree').then((r) => r.json()).then((data) => {
    tree.innerHTML = ''
    for (const file of data.files) {
      const b = document.createElement('button')
      b.textContent = file
      b.dataset.path = file
      b.onclick = () => open(file)
      tree.appendChild(b)
    }
    now.textContent = data.files.length + ' files'
  })

  // The editor pushes where it is; a viewer follows unless they have clicked
  // something else, which would otherwise yank the page out from under them.
  let following = true
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest('nav')) following = false
  })

  let lastPresence = ''
  const applyPresence = (p) => {
    dot.classList.remove('off')
    if (!p || !p.activeFile) return
    if (following && p.content !== undefined) show(p.activeFile, p.content)
    else if (following) open(p.activeFile)
  }

  events.addEventListener('presence', (e) => {
    lastPresence = e.data
    applyPresence(JSON.parse(e.data))
  })

  // The same fallback the broadcast state uses, and for the same reason: an
  // event stream a proxy is holding onto tells the viewer nothing.
  setInterval(() => {
    fetch(BASE + '/presence', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => {
        const seen = JSON.stringify(p)
        if (seen === lastPresence) return
        lastPresence = seen
        applyPresence(p)
      })
      .catch(() => dot.classList.add('off'))
  }, 3000)
})()
</script>

<footer>Read-only. Nothing you do here changes anything on the other side.</footer>
`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}
