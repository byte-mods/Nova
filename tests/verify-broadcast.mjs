/**
 * Live audio and video over the share tunnel.
 *
 * The claim being checked is that someone who opens the public URL receives
 * actual media, so the bytes are pulled from *this* process rather than from
 * inside the app: a request issued in the renderer would reach the loopback
 * server and prove nothing about the tunnel or the fan-out.
 *
 * Real capture, not a synthetic track — the interesting failures (a codec the
 * machine cannot encode, a header the viewer never receives, a stream that
 * stalls after the first chunk) only happen with a real `MediaRecorder`. The
 * source is a canvas rather than a screen so the run needs no Screen Recording
 * grant and produces the same bytes on every machine; screen capture itself is
 * a one-line difference and is covered by the picker checks below.
 *
 * Needs `cloudflared` on PATH and outbound HTTPS. Start the app first:
 *   bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'broadcast-demo')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
await fs.writeFile(path.join(PROJECT, 'package.json'), '{"name":"broadcast-demo","version":"1.0.0"}')
await fs.writeFile(path.join(PROJECT, 'src', 'main.ts'), 'export const x = 1\n')

const cdp = await connect()
const j = (v) => JSON.stringify(v)

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openProject(${j(PROJECT)})
  return true`)
await cdp.sleep(2000)

await cdp.evaluate(`try { await window.nova.share.stop() } catch {} ; return true`)

console.log('\n-- the source picker --')

const sources = await cdp.evaluate(`return await window.nova.share.screenSources()`, 60000)
check('screens and windows are offered', Array.isArray(sources) && sources.length > 0, `${sources?.length} sources`)
check(
  'at least one is a whole screen',
  (sources ?? []).some((s) => s.kind === 'screen'),
  j((sources ?? []).slice(0, 3).map((s) => s.kind)),
)
check(
  'each one is named',
  (sources ?? []).every((s) => typeof s.name === 'string' && s.name.length > 0),
  j((sources ?? []).slice(0, 3).map((s) => s.name)),
)
check(
  'a screen carries a thumbnail to choose by',
  (sources ?? []).some((s) => s.thumbnail.startsWith('data:image/')),
  j((sources ?? [])[0]?.thumbnail?.slice(0, 24)),
)

console.log('\n-- going live --')

const started = await cdp.evaluate(
  `return await window.nova.share.start(${j(PROJECT)}, { mode: 'project', follow: true })`,
  180000,
)
let status = started
for (let i = 0; i < 90 && (!status.url || status.state === 'starting'); i++) {
  await cdp.sleep(1000)
  status = await cdp.evaluate(`return await window.nova.share.status()`)
}
check('the tunnel is up', status.state === 'live' && Boolean(status.url), `${status.state} ${status.error ?? ''}`)
check('nothing is being broadcast yet', status.broadcast?.active === false, j(status.broadcast))

const URL_BASE = status.url
console.log(`\n        ${URL_BASE}\n`)

/**
 * A fresh trycloudflare hostname is printed before DNS knows about it, and the
 * gap between "the tunnel has an address" and "that address resolves" runs to
 * tens of seconds. Waiting is not politeness: without it the first fetch fails
 * on DNS and the run reports a working feature as broken.
 */
async function waitForUrl(url, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  let last = 'never attempted'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
      last = `status ${res.status}`
    } catch (err) {
      last = String(err?.cause?.code ?? err?.message ?? err)
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log(`        (gave up waiting: ${last})`)
  return false
}

const reachable = await waitForUrl(`${URL_BASE}broadcast`)
check('the tunnel resolves from outside the app', reachable, 'DNS never resolved')
if (!reachable) {
  console.log(`\n${pass} passed, ${fail + 1} failed — the tunnel never became reachable`)
  await cdp.evaluate(`return await window.nova.share.stop()`, 60000).catch(() => {})
  await cdp.close()
  process.exit(1)
}

const before = await fetch(`${URL_BASE}broadcast`).then((r) => r.json())
check('the public page agrees there is no broadcast', before.active === false, j(before))

/*
 * Capture a canvas and drive it through exactly the path the dialog uses:
 * `startBroadcast` builds the recorder, and `share.broadcast` announces it.
 * The canvas is repainted on a timer because a still canvas produces no new
 * frames, and a VP8 encoder with nothing to encode emits nothing.
 */
const cast = await cdp.evaluate(
  `
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 200
  const ctx = canvas.getContext('2d')
  let tick = 0
  window.__castPaint = setInterval(() => {
    tick++
    ctx.fillStyle = tick % 2 ? '#204080' : '#802040'
    ctx.fillRect(0, 0, 320, 200)
    ctx.fillStyle = '#fff'
    ctx.font = '28px sans-serif'
    ctx.fillText('frame ' + tick, 20, 110)
  }, 100)

  const stream = canvas.captureStream(12)
  const { shareMediaMime } = await import('/shared/share.ts')
  const mime = shareMediaMime(true, false)
  const supported = MediaRecorder.isTypeSupported(mime)

  // Declared before the recorder runs, exactly as the dialog does it: media
  // arriving with no broadcast declared is dropped, and the first chunk is the
  // header everything else is read against.
  await window.nova.share.broadcast({ screen: true, camera: false, microphone: false, screenSourceId: 'canvas' })

  const recorder = new MediaRecorder(stream, { mimeType: mime })
  let chunks = 0
  // Chained exactly as src/lib/shareBroadcast.ts does: firing an async
  // arrayBuffer() per chunk lets a later one overtake the header.
  let tail = Promise.resolve()
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return
    chunks++
    tail = tail.then(async () => window.nova.share.media('main', await e.data.arrayBuffer())).catch(() => {})
  }
  recorder.start(500)
  window.__castStop = () => { recorder.stop(); clearInterval(window.__castPaint); stream.getTracks().forEach(t => t.stop()) }
  window.__castChunks = () => chunks

  return { mime, supported }
`,
  60000,
)
check('the machine can encode the stream type', cast.supported, cast.mime)

await cdp.sleep(3000)
const producing = await cdp.evaluate(`return window.__castChunks()`)
check('the recorder is producing chunks', producing > 0, `${producing} chunks`)

const announced = await fetch(`${URL_BASE}broadcast`).then((r) => r.json())
check('the public page is told a broadcast started', announced.active === true, j(announced))
check('and what is in it', announced.screen === true && announced.microphone === false, j(announced))

console.log('\n-- what a viewer receives --')

/**
 * Follows a channel the way the viewer page does: ask for everything after the
 * last sequence number seen, and keep asking.
 *
 * Each reply is a complete response, which is the point — this is the shape
 * that survives an intermediary that buffers until a response ends.
 */
async function followMedia(base, channel, rounds = 4) {
  let from = -1
  let bytes = 0
  let first = null
  let live = null
  let status = 0
  let type = null
  let replies = 0

  for (let i = 0; i < rounds; i++) {
    const res = await fetch(`${base}media?channel=${channel}&from=${from}`, { cache: 'no-store' })
    status = res.status
    type = res.headers.get('content-type')
    live = res.headers.get('x-live')
    if (!res.ok) break
    from = Number(res.headers.get('x-next-seq') ?? from)
    const body = new Uint8Array(await res.arrayBuffer())
    replies++
    if (body.length && !first) first = body
    bytes += body.length
    if (live === '0') break
  }
  return { status, type, bytes, first, live, replies, from }
}

const media = await followMedia(URL_BASE, 'main')
check('the media endpoint answers over the public URL', media.status === 200, `status=${media.status}`)
// Deliberately not a media type: intermediaries transform and buffer those.
check('it is served in a form the tunnel forwards unbuffered', /octet-stream/.test(media.type ?? ''), j(media.type))
check('bytes actually arrive', media.bytes > 1000, `${media.bytes} bytes over ${media.replies} replies`)
check('the viewer is told the broadcast is live', media.live === '1', j(media.live))

// 0x1A45DFA3 is the EBML magic every WebM stream opens with. A viewer joining
// late still has to receive it, which is the whole reason the header is kept.
const magic = media.first ? Array.from(media.first.slice(0, 4)) : []
check(
  'a late viewer is given the stream header first',
  magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3,
  j(magic.map((b) => b.toString(16))),
)
check(
  'each poll advances the sequence, so the media keeps coming',
  media.replies > 1 && media.from > 0,
  `${media.replies} replies, next=${media.from}`,
)

const second = await followMedia(URL_BASE, 'main', 2)
check(
  'a second viewer gets the header too',
  second.bytes > 500 && second.first?.[0] === 0x1a,
  `${second.bytes} bytes`,
)

console.log('\n-- the viewer page --')

const html = await fetch(URL_BASE).then((r) => r.text())
check('the page ships a player', html.includes('id="main-video"'), '')
check('and a place for the presenter camera', html.includes('id="cam-wrap"'), '')
check('it reads the broadcast state on load', html.includes("'/broadcast'"), '')

const csp = (await fetch(URL_BASE)).headers.get('content-security-policy') ?? ''
check('media-src is limited to blob:', /media-src blob:/.test(csp), csp)
check('and no remote origin is allowed', /default-src 'none'/.test(csp), csp)

console.log('\n-- the presenter controls --')

/*
 * Audited here rather than in verify-tooltips.mjs because these controls only
 * exist while a share is live, and this is the suite that has one. Turning on a
 * camera is not something a user should have to discover by clicking.
 */
const controls = await cdp.evaluate(`
  const btn = document.querySelector('[title^="A share is live"], [title^="Share this project"]')
  if (btn) btn.click()
  await new Promise((r) => setTimeout(r, 1200))
  const root = document.querySelector('.share-cast')
  if (!root) return { missing: true }
  return {
    missing: false,
    picks: [...root.querySelectorAll('label')].map((l) => ({ text: (l.textContent || '').trim(), title: l.title })),
    actions: [...root.querySelectorAll('button')].map((b) => ({ text: (b.textContent || '').trim(), title: b.title })),
  }
`)
check('the presenter panel is offered while a share is live', controls.missing === false, j(controls))
check(
  'each thing a broadcast can send explains what it sends',
  (controls.picks ?? []).length === 3 && (controls.picks ?? []).every((p) => p.title && p.title.length > 12),
  j(controls.picks),
)
check(
  'and every action on it says what it will do',
  (controls.actions ?? []).length > 0 && (controls.actions ?? []).every((a) => a.title && a.title.length > 12),
  j(controls.actions),
)

console.log('\n-- a viewer actually watching --')

/*
 * The checks above prove the bytes leave the machine. This one proves they can
 * be played: the public URL is opened in the IDE's own browser pane — a real
 * Chromium, going out over the real tunnel — and the video element is asked
 * whether it has decoded anything. Nothing short of this distinguishes "the
 * stream is correct" from "the stream is well-formed but unplayable", which is
 * exactly what a codec or header mistake produces.
 */
const watched = await cdp.evaluate(
  `
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().openTab({ id: 'browser:cast', kind: 'browser', title: 'Viewer', url: ${j(URL_BASE)} })
  await new Promise((r) => setTimeout(r, 3000))
  const w = document.querySelector('webview')
  if (!w) return { error: 'no browser pane' }

  // A quick tunnel refuses the odd request while it settles, and loadURL
  // rejects outright on an aborted load. Retrying here keeps a Cloudflare
  // hiccup from being reported as a broken player.
  let loaded = false
  for (let attempt = 0; attempt < 4 && !loaded; attempt++) {
    try {
      await w.loadURL(${j(URL_BASE)})
      loaded = true
    } catch (err) {
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
  if (!loaded) return { error: 'the tunnel never served the page to the pane' }
  await new Promise((r) => setTimeout(r, 12000))

  const read = () => w.executeJavaScript(\`(() => {
    const v = document.getElementById('main-video')
    return {
      shown: !!document.getElementById('live') && document.getElementById('live').className.indexOf('on') >= 0,
      readyState: v ? v.readyState : -1,
      currentTime: v ? v.currentTime : -1,
      width: v ? v.videoWidth : 0,
      height: v ? v.videoHeight : 0,
      what: (document.getElementById('live-what') || {}).textContent || '',
    }
  })()\`)

  // Sampled rather than snapshotted: a live player deliberately rides near the
  // edge of what has arrived, so readyState dips to HAVE_METADATA between
  // segments. One unlucky instant is not evidence of a stall — a clock that
  // never moves is.
  const first = await read()
  const samples = [first]
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    samples.push(await read())
  }
  const later = samples[samples.length - 1]
  return { first, later, best: Math.max(...samples.map((s) => s.readyState)) }
`,
  120000,
)

check('the viewer page shows the live player', watched.later?.shown === true, j(watched.first ?? watched.error))
check(
  'it names what is being shared',
  /screen/.test(watched.later?.what ?? ''),
  j(watched.later?.what),
)
check(
  'the video decodes to real frame dimensions',
  (watched.later?.width ?? 0) > 0 && (watched.later?.height ?? 0) > 0,
  `${watched.later?.width}x${watched.later?.height}`,
)
check(
  'it has buffered enough to play',
  (watched.best ?? 0) >= 2,
  `best readyState across samples=${watched.best}`,
)
check(
  'and playback advances, so it is genuinely live',
  (watched.later?.currentTime ?? 0) > (watched.first?.currentTime ?? 0),
  `${watched.first?.currentTime} -> ${watched.later?.currentTime}`,
)

console.log('\n-- stopping the broadcast --')

await cdp.evaluate(`
  window.__castStop()
  await window.nova.share.broadcast(null)
  return true`, 30000)
await cdp.sleep(1500)

const after = await fetch(`${URL_BASE}broadcast`).then((r) => r.json())
check('the public page is told it ended', after.active === false, j(after))

const ended = await followMedia(URL_BASE, 'main', 2)
check('and the media stream carries nothing further', ended.bytes === 0, `${ended.bytes} bytes`)
check('viewers are told it is over', ended.live === '0', j(ended.live))

const stillShared = await fetch(`${URL_BASE}tree`).then((r) => r.json())
check(
  'the shared project itself is untouched by any of it',
  Array.isArray(stillShared.files) && stillShared.files.length > 0,
  j(stillShared.files?.slice(0, 3)),
)

console.log('\n-- stopping the share --')

await cdp.evaluate(`return await window.nova.share.stop()`, 60000)
await cdp.sleep(2000)
const dead = await fetch(`${URL_BASE}media?channel=main`)
  .then((r) => r.status)
  .catch(() => 0)
check('the media endpoint dies with the share', dead !== 200, `status=${dead}`)

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
