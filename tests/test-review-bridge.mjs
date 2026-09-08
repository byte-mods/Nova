/**
 * The bridge the review MCP server talks to.
 *
 * Driven over real HTTP with the real server, because the things worth testing
 * here are all at that boundary: the token check, the renderer round-trip, and
 * what happens when the renderer never answers.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { BUILD } from './env.mjs'

const { startReviewBridge, stopReviewBridge, settleReviewRequest } = await import(
  pathToFileURL(`${BUILD}/reviewBridge.js`).href
)

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n-- ${t} --`)

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-'))

// A stand-in renderer: answers whatever the bridge broadcasts.
let rendererAnswers = true
let lastBroadcast = null
const ctx = {
  broadcast: (channel, payload) => {
    lastBroadcast = { channel, payload }
    if (!rendererAnswers) return
    const { id, action } = payload
    if (action === 'contentsId') settleReviewRequest(id, { contentsId: 42 })
    else if (action === 'console') settleReviewRequest(id, [{ level: 'error', text: 'boom', at: 1 }])
    else settleReviewRequest(id, { ok: true })
  },
  getRoot: () => root,
  capture: async (id) => (id === 42 ? Buffer.from('89504e470d0a1a0a', 'hex') : null),
  listDevices: async () => [{ id: 'sim-1', platform: 'ios', name: 'iPhone 17' }],
  launchOnDevice: async (deviceId, bundleId) => ({ launched: `${deviceId}:${bundleId}` }),
  listRunConfigs: async () => [{ name: 'dev', command: 'npm run dev' }],
  rendererTimeoutMs: 300,
}

const { url, token } = await startReviewBridge(ctx)
const call = (tool, args = {}, auth = `Bearer ${token}`) =>
  fetch(`${url}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ tool, args }),
  })

section('access control')
check('the bridge is loopback only', url.startsWith('http://127.0.0.1:'))
check('a missing token is refused', (await call('list_devices', {}, '')).status === 401)
check('a wrong token is refused', (await call('list_devices', {}, 'Bearer nope')).status === 401)
check('a near-miss token is refused', (await call('list_devices', {}, `Bearer ${token}x`)).status === 401)
check('an unknown route is a 404', (await (await fetch(`${url}/nope`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
})).status) === 404)

section('the tools')
let r = await (await call('list_devices')).json()
check('list_devices reaches the main process', r.devices?.[0]?.id === 'sim-1')

r = await (await call('list_run_configs')).json()
check('list_run_configs returns the project configs', r.configs?.[0]?.command === 'npm run dev')

r = await (await call('launch_on_device', { deviceId: 'sim-1', bundleId: 'com.x' })).json()
check('launch_on_device forwards both arguments', r.result?.launched === 'sim-1:com.x')
r = await (await call('launch_on_device', { deviceId: 'sim-1' })).json()
check('launch_on_device refuses a missing bundle id', Boolean(r.error))

r = await (await call('open_app', { url: 'http://localhost:3000' })).json()
check('open_app reaches the renderer', r.ok === true)
check('and asks it to navigate', lastBroadcast?.payload?.args?.url === 'http://localhost:3000')
r = await (await call('open_app', { url: 'file:///etc/passwd' })).json()
check('open_app refuses a non-http URL', Boolean(r.error))

r = await (await call('read_console', { limit: 10 })).json()
check('read_console returns the page output', r.messages?.[0]?.text === 'boom')

section('screenshots')
r = await (await call('screenshot_app')).json()
check('screenshot_app writes a file', Boolean(r.path))
check('the path is relative to the project', !path.isAbsolute(r.path ?? '/x'))
check('the file exists on disk', await fs.stat(path.join(root, r.path)).then(() => true, () => false))
check('the bytes are not returned inline', r.bytes > 0 && !r.data)

section('when the renderer does not answer')
rendererAnswers = false
const slow = await (await call('read_console')).json()
check('an unanswered request fails rather than hanging', Boolean(slow.error))
check('and the error tells the model what to do', /browser pane|not open/i.test(slow.error))
rendererAnswers = true

section('bad input')
r = await (await call('no_such_tool')).json()
check('an unknown tool is reported, not thrown', /Unknown tool/.test(r.error ?? ''))
const bad = await fetch(`${url}/call`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: 'not json',
})
check('malformed JSON does not crash the bridge', bad.status === 200)
check('the bridge still works afterwards', (await (await call('list_devices')).json()).devices?.length === 1)

stopReviewBridge()
await fs.rm(root, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
