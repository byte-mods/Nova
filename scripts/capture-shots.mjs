/**
 * Captures the README's feature screenshots from the running IDE.
 *
 * Kept as a script rather than done by hand because a screenshot goes stale the
 * moment the UI moves, and a stale screenshot in a README is worse than none —
 * it documents a version of the product that no longer exists. Re-running this
 * regenerates the whole set against whatever the code does today.
 *
 * Start the app first:  bash tests/restart-app.sh
 *   node scripts/capture-shots.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { connect } from '../tests/cdp.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = path.join(REPO, 'docs')
const PROJECT = path.join(os.tmpdir(), 'nova-shots')

const cdp = await connect()
const j = (v) => JSON.stringify(v)

/* ------------------------------------------------------------------ */
/* a project worth photographing                                       */
/* ------------------------------------------------------------------ */

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
await fs.writeFile(
  path.join(PROJECT, 'package.json'),
  JSON.stringify({ name: 'orders-service', version: '1.4.0', scripts: { dev: 'vite', test: 'vitest' } }, null, 2),
)
await fs.writeFile(
  path.join(PROJECT, 'src', 'orders.ts'),
  `import { Repository } from './repository'

export const MAX_ITEMS = 50

/** Creates and looks up customer orders. */
export class OrderService {
  constructor(private readonly repo: Repository) {}

  async createOrder(customerId: string, total: number) {
    if (total <= 0) throw new Error('An order needs a positive total.')
    const order = { id: crypto.randomUUID(), customerId, total, createdAt: Date.now() }
    await this.repo.save(order)
    return order
  }

  async findOrder(id: string) {
    return this.repo.get(id)
  }
}
`,
)
await fs.writeFile(
  path.join(PROJECT, 'src', 'repository.ts'),
  `export interface Order {
  id: string
  customerId: string
  total: number
  createdAt: number
}

export class Repository {
  private items = new Map<string, Order>()

  async save(order: Order) {
    this.items.set(order.id, order)
  }

  async get(id: string) {
    return this.items.get(id) ?? null
  }
}
`,
)
await fs.writeFile(
  path.join(PROJECT, 'orders.http'),
  `@baseUrl = https://api.example.com
@token = {{$processEnv API_TOKEN}}

### List every order
GET {{baseUrl}}/orders
Authorization: Bearer {{token}}

> {%
  test('comes back ok', () => expect(response.status).toBe(200))
  client.set('firstOrder', response.body[0].id)
%}

### Create an order
POST {{baseUrl}}/orders
Content-Type: application/json
Authorization: Bearer {{token}}

{ "customerId": "cus_8812", "sku": "ABC-1", "qty": 2 }

### Fetch the one we just made
GET {{baseUrl}}/orders/{{firstOrder}}
Authorization: Bearer {{token}}
`,
)
// Deliberately vulnerable, so the security panel has something real to find.
await fs.writeFile(
  path.join(PROJECT, 'src', 'legacy.js'),
  `const { exec } = require('child_process')

// Injection: the argument reaches a shell unescaped.
function backup(name) {
  exec('tar -czf /tmp/' + name + '.tgz ./data')
}

function render(input) {
  document.getElementById('out').innerHTML = input
}

module.exports = { backup, render }
`,
)

const shoot = async (name, clip) => {
  const params = { format: 'png', captureBeyondViewport: false }
  if (clip) params.clip = { ...clip, scale: 2 }
  const res = await cdp.send('Page.captureScreenshot', params)
  const file = path.join(DOCS, `${name}.png`)
  await fs.writeFile(file, Buffer.from(res.result.data, 'base64'))
  const { size } = await fs.stat(file)
  console.log(`  ${name}.png  ${(size / 1024).toFixed(0)} KB`)
}

/** The bounding box of a selector, padded, for a tighter crop. */
const boxOf = async (selector, pad = 0) =>
  cdp.evaluate(`
    const el = document.querySelector(${j(selector)})
    if (!el) return null
    const b = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.round(b.x - ${pad})),
      y: Math.max(0, Math.round(b.y - ${pad})),
      width: Math.round(b.width + ${pad} * 2),
      height: Math.round(b.height + ${pad} * 2),
    }`)

/*
 * Waited on rather than slept through. Opening a project is asynchronous and
 * the previous project stays on screen until it lands — which produced a set of
 * screenshots captioned with whatever project the last test run had left open.
 */
// The debug port answers before the renderer has mounted, so an `openProject`
// issued immediately is dropped and every shot ends up captioned with whatever
// project the last run left open. Retry until the store agrees.
await cdp.waitFor(`document.querySelector('.titlebar') ? true : null`, {
  timeout: 60000,
  label: 'the window to mount',
})

let opened = false
for (let attempt = 0; attempt < 10 && !opened; attempt++) {
  opened = await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    s.setState({ sidebarVisible: true, sidebarView: 'explorer', panelVisible: false, aiVisible: false })
    await s.getState().openProject(${j(PROJECT)})
    await new Promise((r) => setTimeout(r, 1500))
    return (s.getState().root || '').endsWith('nova-shots')`, 60000)
}
if (!opened) throw new Error('the demo project never opened')
await cdp.sleep(2500)

console.log('\ncapturing:')

/* ---------------- the editor ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${j(path.join(PROJECT, 'src', 'orders.ts'))})
  return true`)
await cdp.sleep(2500)
await shoot('shot-editor')

/* ---------------- the API client ---------------- */

const HTTP_FILE = path.join(PROJECT, 'orders.http')
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${j(HTTP_FILE)})
  s.getState().openTab({
    id: 'http:' + ${j(HTTP_FILE)},
    kind: 'http',
    title: 'orders.http — requests',
    path: ${j(HTTP_FILE)},
  })
  return true`)
await cdp.waitFor(`document.querySelector('.http-toolbar') !== null`, { label: 'request panel' })
await cdp.sleep(1500)
await shoot('shot-api-client')

/* ---------------- the security scanner ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ panelVisible: true })
  s.getState().showPanel('security')
  return true`)
await cdp.sleep(1200)
await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.panel-toolbar .btn')]
    .find((b) => (b.textContent || '').includes('Scan'))
  if (btn) btn.click()
  return true`)
await cdp.sleep(9000)
const securityBox = await boxOf('.security-view', 0)
await shoot('shot-security', securityBox)

/* ---------------- plugins ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ panelVisible: false, sidebarVisible: true, sidebarView: 'plugins' })
  return true`)
await cdp.sleep(1200)
await shoot('shot-plugins')

/* ---------------- the AI console: a plan and its history ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer', aiVisible: true })
  await s.getState().newChat()

  s.getState().setPlan({
    id: 'plan_shot_1',
    request: 'Add order cancellation and wire it into the service',
    summary: 'Cancellation needs a state field on the order plus a guard, so the repository and the service both change. Nothing else reads the order shape directly.',
    status: 'proposed',
    createdAt: Date.now(),
    steps: [
      { id: 's0', text: 'Add a status field to the Order interface', status: 'pending' },
      { id: 's1', text: 'Add cancelOrder() to OrderService with a guard on already-cancelled orders', status: 'pending' },
      { id: 's2', text: 'Reject cancellation of an order that does not exist', status: 'pending' },
      { id: 's3', text: 'Cover both paths in the test suite', status: 'pending' },
    ],
  })
  return true`)
await cdp.sleep(1500)
await shoot('shot-agent-plan')

// The same plan mid-flight, with edits and a verdict, plus a second revision
// behind it — this is the state the history panel exists to show.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().setPlan({
    id: 'plan_shot_1',
    request: 'Add order cancellation and wire it into the service',
    summary: '',
    status: 'complete',
    createdAt: Date.now() - 90000,
    approvedAt: Date.now() - 80000,
    steps: [
      { id: 's0', text: 'Add a status field to the Order interface', status: 'done' },
      { id: 's1', text: 'Add cancelOrder() to OrderService with a guard on already-cancelled orders', status: 'done' },
      { id: 's2', text: 'Reject cancellation of an order that does not exist', status: 'done' },
      { id: 's3', text: 'Cover both paths in the test suite', status: 'done' },
    ],
    edits: [
      { path: ${j(PROJECT)} + '/src/repository.ts', additions: 6, deletions: 1, kind: 'modify' },
      { path: ${j(PROJECT)} + '/src/orders.ts', additions: 21, deletions: 2, kind: 'modify' },
    ],
    verification: { state: 'passed', framework: 'vitest', passed: 9, failed: 0,
      total: 9, failures: [], durationMs: 1240, ranAt: Date.now() },
  })
  s.getState().setPlan({
    id: 'plan_shot_2',
    request: 'Also emit an event when an order is cancelled',
    summary: '',
    status: 'executing',
    createdAt: Date.now(),
    supersedes: 'plan_shot_1',
    steps: [
      { id: 's0', text: 'Add a status field to the Order interface', status: 'done' },
      { id: 's1', text: 'Add cancelOrder() to OrderService with a guard on already-cancelled orders', status: 'done' },
      { id: 's2', text: 'Publish an OrderCancelled event from cancelOrder()', status: 'running' },
    ],
  })
  await new Promise((r) => setTimeout(r, 600))
  const btn = [...document.querySelectorAll('.ai-header .icon-btn')]
    .find((b) => (b.title || '').startsWith('Plans this conversation'))
  if (btn) btn.click()
  return true`)
await cdp.sleep(1500)
await shoot('shot-agent-history')

/* ---------------- sharing, with live audio and video ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  const btn = [...document.querySelectorAll('.ai-header .icon-btn')]
    .find((b) => (b.title || '').startsWith('Plans this conversation'))
  if (btn) btn.click()
  try { await window.nova.share.stop() } catch {}
  await window.nova.share.start(${j(PROJECT)}, { mode: 'project', follow: true })
  return true`, 180000)

for (let i = 0; i < 90; i++) {
  const st = await cdp.evaluate(`return await window.nova.share.status()`)
  if (st.url) break
  await cdp.sleep(1000)
}

await cdp.evaluate(`
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  const btn = document.querySelector('[title^="A share is live"], [title^="Share this project"]')
  if (btn) btn.click()
  await new Promise((r) => setTimeout(r, 900))
  /*
   * Camera and microphone only, deliberately.
   *
   * Ticking Screen opens the source picker, which renders live thumbnails of
   * every window on the machine — other applications, their titles, and
   * whatever text happens to be on screen in them. That is fine in the product
   * and completely wrong in a screenshot destined for a public README. The
   * three toggles still show what a broadcast can carry; the picker is
   * described in prose instead.
   */
  for (const label of ['Camera', 'Microphone']) {
    const el = [...document.querySelectorAll('.share-cast-picks label')]
      .find((l) => (l.textContent || '').includes(label))
    const box = el && el.querySelector('input')
    if (box && !box.checked) box.click()
  }
  const screenBox = [...document.querySelectorAll('.share-cast-picks label')]
    .find((l) => (l.textContent || '').includes('Screen'))?.querySelector('input')
  if (screenBox && screenBox.checked) screenBox.click()
  return true`, 60000)
await cdp.sleep(2500)
const shareBox = await boxOf('.share-modal', 26)
await shoot('shot-share', shareBox)

await cdp.evaluate(`
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  try { await window.nova.share.stop() } catch {}
  return true`, 60000)

/* ---------------- settings: the six assistants ---------------- */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  // Clear any endpoint override a test run left behind, so the page shows the
  // vendors' real defaults rather than a loopback stub.
  s.getState().setSettings({ aiBaseUrls: {} })
  s.getState().openTab({ id: 'settings', kind: 'settings', title: 'Settings' })
  await new Promise((r) => setTimeout(r, 1400))
  const heading = [...document.querySelectorAll('.settings-view h2')]
    .find((h) => /AI|assistant/i.test(h.textContent || ''))
  if (heading) heading.scrollIntoView({ block: 'start' })
  return true`, 60000)
await cdp.sleep(1500)
await shoot('shot-providers')

console.log('\ndone.')
await cdp.close()
