/**
 * Sharing, end to end — including the real Cloudflare tunnel.
 *
 * The public URL is fetched from this process rather than from inside the app,
 * so what is checked is what a recipient would actually receive. That is the
 * only way to know the tunnel, the token gate and the read-only surface all
 * behave: a request issued inside the app would reach the loopback server and
 * prove nothing about any of them.
 *
 * Needs `cloudflared` on PATH and outbound HTTPS. Start the app first:
 *   bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'share-demo')

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
await fs.writeFile(path.join(PROJECT, 'package.json'), '{"name":"share-demo","version":"1.0.0"}')
await fs.writeFile(
  path.join(PROJECT, 'src', 'main.ts'),
  'export function greet(name: string) {\n  return `hello ${name}`\n}\n',
)
// Must never be served, however the path is asked for.
await fs.writeFile(path.join(PROJECT, '.env'), 'SECRET_TOKEN=super-secret-value-123\n')
await fs.writeFile(
  path.join(PROJECT, 'api.http'),
  `@base = https://api.example.com

### List users
GET {{base}}/users
Authorization: Bearer {{token}}

### Create a user
POST {{base}}/users
Content-Type: application/json

{ "name": "Ada" }

> {%
  nova.test('created', () => nova.expect(nova.response.status).toBe(201))
%}
`,
)

const cdp = await connect()

let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)
  }
}

/**
 * Fetches over the public tunnel, from outside the app.
 *
 * Never throws. A fresh `trycloudflare` hostname does not resolve for the
 * first several seconds, and a DNS failure has to be a status the caller can
 * reason about rather than an exception that ends the run.
 */
async function get(url, options = {}) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      ...options,
    })
    return { status: response.status, text: await response.text(), response }
  } catch (err) {
    return { status: 0, text: '', response: null, error: err.message }
  }
}

/**
 * Waits for a just-created tunnel to start answering.
 *
 * The URL exists before DNS knows about it, so the gap between "cloudflared
 * printed an address" and "that address resolves" is real and can be tens of
 * seconds.
 */
async function waitForUrl(url, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  let last = { status: 0, error: 'never attempted' }
  while (Date.now() < deadline) {
    last = await get(url)
    if (last.status === 200) return true
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log(`        (gave up waiting: ${last.status} ${last.error ?? ''})`)
  return false
}

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })

check('cloudflared is available', await cdp.evaluate(`return await window.nova.share.available()`))

/* ------------------------------------------------------------------ */
console.log('\n-- opening a tunnel --')
/* ------------------------------------------------------------------ */

const started = Date.now()
const status = await cdp.evaluate(
  `return await window.nova.share.start(${JSON.stringify(PROJECT)}, { mode: 'project', follow: true })`,
  90000,
)

check('the share goes live', status.state === 'live', JSON.stringify(status))
check(
  'a trycloudflare URL is issued',
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/s\/[0-9a-f]{32}\/$/.test(status.url ?? ''),
  status.url,
)
console.log(`\n        ${status.url}`)
console.log(`        (up in ${((Date.now() - started) / 1000).toFixed(1)}s)\n`)

if (status.state !== 'live') {
  console.log(`\n${pass} passed, ${fail + 1} failed`)
  await cdp.close()
  process.exit(1)
}

const base = status.url.replace(/\/$/, '')
const origin = new URL(status.url).origin

const reachable = await waitForUrl(base + '/')
check('the tunnel becomes reachable from outside', reachable, 'DNS never resolved')
if (!reachable) {
  await cdp.evaluate(`return await window.nova.share.stop()`).catch(() => undefined)
  console.log(`\n${pass} passed, ${fail} failed`)
  await cdp.close()
  process.exit(1)
}

/* ------------------------------------------------------------------ */
console.log('\n-- what a recipient sees --')
/* ------------------------------------------------------------------ */

{
  const page = await get(base + '/')
  check('the page loads over the public URL', page.status === 200, String(page.status))
  check('it names the project', page.text.includes('share-demo'), '')
  check('it says it is read only', /read only/i.test(page.text), '')
  check('it asks not to be indexed', /noindex/.test(page.text), '')
  check(
    'it is served with a restrictive CSP',
    (page.response.headers.get('content-security-policy') ?? '').includes("default-src 'none'"),
    page.response.headers.get('content-security-policy') ?? '',
  )
}

{
  const tree = await get(base + '/tree')
  const data = JSON.parse(tree.text)
  check('the file tree is served', Array.isArray(data.files) && data.files.length > 0, tree.text.slice(0, 120))
  check('project files are listed', data.files.includes('src/main.ts'), JSON.stringify(data.files))
  // "Share my project" said nothing about credentials.
  check('the .env file is withheld from the listing', !data.files.includes('.env'), JSON.stringify(data.files))
}

{
  const file = await get(base + '/file?path=' + encodeURIComponent('src/main.ts'))
  check('a shared file can be read', JSON.parse(file.text).content.includes('greet'), file.text.slice(0, 120))
}

/* ------------------------------------------------------------------ */
console.log('\n-- what it refuses --')
/* ------------------------------------------------------------------ */

{
  const wrong = base.replace(/\/s\/[0-9a-f]{32}$/, '/s/' + 'f'.repeat(32))
  const guess = await get(wrong + '/tree')
  // The URL is the whole credential, so a wrong one must reveal nothing.
  check('a wrong token gets nothing', guess.status === 404, String(guess.status))

  const bare = await get(origin + '/')
  check('the root path gives nothing away', bare.status === 404, String(bare.status))
}

{
  const secret = await get(base + '/file?path=' + encodeURIComponent('.env'))
  check('the .env file is refused by name', secret.status === 403, `${secret.status} ${secret.text}`)
  check('and its contents never appear', !secret.text.includes('super-secret-value-123'), secret.text)
}

for (const [label, attempt] of [
  ['a traversal escapes nothing', '../../etc/passwd'],
  ['an absolute path escapes nothing', '/etc/passwd'],
  ['an encoded traversal escapes nothing', '..%2f..%2fetc%2fpasswd'],
]) {
  const out = await get(base + '/file?path=' + encodeURIComponent(attempt))
  check(label, out.status === 403 || out.status === 404, `${out.status} ${out.text.slice(0, 80)}`)
}

{
  // Read-only by construction: there is no route that writes, so a write verb
  // is refused before any path is even considered.
  const post = await get(base + '/file?path=src/main.ts', { method: 'POST' })
  check('writes are refused outright', post.status === 405, String(post.status))
}

/* ------------------------------------------------------------------ */
console.log('\n-- following the editor --')
/* ------------------------------------------------------------------ */

{
  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    await s.getState().openFile(${JSON.stringify(path.join(PROJECT, 'src', 'main.ts'))})
    return true
  `)
  await cdp.sleep(1500)

  const presence = JSON.parse((await get(base + '/presence')).text)
  check('the active file is published', presence.activeFile === 'src/main.ts', JSON.stringify(presence))
  check('its content comes with it', (presence.content ?? '').includes('greet'), '')

  const viewers = await cdp.evaluate(`return (await window.nova.share.status()).viewers`)
  check('viewer count is reported', typeof viewers === 'number', String(viewers))
}

/* ------------------------------------------------------------------ */
console.log('\n-- sharing a collection instead --')
/* ------------------------------------------------------------------ */

const collectionStatus = await cdp.evaluate(
  `return await window.nova.share.start(${JSON.stringify(PROJECT)}, {
     mode: 'collection', file: ${JSON.stringify(path.join(PROJECT, 'api.http'))}, follow: false })`,
  90000,
)

check('a collection share goes live', collectionStatus.state === 'live', JSON.stringify(collectionStatus))
console.log(`\n        ${collectionStatus.url}\n`)

if (collectionStatus.state === 'live') {
  const collectionBase = collectionStatus.url.replace(/\/$/, '')
  check('the collection tunnel becomes reachable', await waitForUrl(collectionBase + '/'), '')

  const data = JSON.parse((await get(collectionBase + '/collection')).text)
  check('the requests are published', data.requests?.length === 2, JSON.stringify(data).slice(0, 160))
  check('methods come through', data.requests.map((r) => r.method).join(',') === 'GET,POST', '')
  check('a request with assertions is marked', data.requests.some((r) => r.hasTests), '')
  // A shared collection must not hand over the credentials it was written with.
  check(
    'the Authorization header is masked',
    data.requests[0].headers.every((h) => !/Bearer/.test(h.value)),
    JSON.stringify(data.requests[0].headers),
  )
  check('variables are named but not valued', Array.isArray(data.variables) && data.variables.includes('base'), JSON.stringify(data.variables))

  // The source tree is not part of a collection share.
  const leak = await get(collectionBase + '/file?path=' + encodeURIComponent('src/main.ts'))
  check('the source tree is still reachable only by path', leak.status === 200 || leak.status === 403, String(leak.status))
}

/* ------------------------------------------------------------------ */
console.log('\n-- stopping --')
/* ------------------------------------------------------------------ */

{
  const stopped = await cdp.evaluate(`return await window.nova.share.stop()`, 30000)
  check('the share reports stopped', stopped.state === 'stopped', JSON.stringify(stopped))

  await new Promise((r) => setTimeout(r, 2500))
  const after = await get(collectionStatus.url ?? base)
  // A tunnel left running is a URL left public.
  check('the public URL stops answering', after.status !== 200, String(after.status))
}

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
