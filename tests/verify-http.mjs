/**
 * The request client, driven through the running IDE.
 *
 * The offline suite proves the engine; this proves the wiring. Everything here
 * goes through the real IPC bridge and the real panel, because that is where
 * the remaining ways to be broken live — a handler not registered, a preload
 * method missing, a stream that never reaches the renderer.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'
import { startApiServer } from './stubs/api-server.mjs'

const PROJECT = path.join(TMP, 'http-demo')

const cdp = await connect()
const server = await startApiServer()

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'api'), { recursive: true })

await fs.writeFile(
  path.join(PROJECT, 'api', 'requests.http'),
  `@base = ${server.base}

### Echo a payload
POST {{base}}/echo
Content-Type: application/json

{ "hello": "world" }

### Log in and follow the redirect
GET {{base}}/login

### Read a protected route
# @auth basic ada lovelace
GET {{base}}/secure

### Query the graph
GRAPHQL {{base}}/graphql

query Users($limit: Int) { users(limit: $limit) { id name } }

--variables
{ "limit": 3 }

### Watch the event stream
SSE {{base}}/events

### Talk to the socket
WEBSOCKET ${server.wsBase}/socket
# @send hello-from-nova
`,
)
await fs.writeFile(
  path.join(PROJECT, 'api', 'http-client.env.json'),
  JSON.stringify({ local: { token: 'env-token' } }, null, 2),
)

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

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })

const file = path.join(PROJECT, 'api', 'requests.http')

/* ------------------------------------------------------------------ */
console.log('\n-- the panel --')
/* ------------------------------------------------------------------ */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(file)})
  return true
`)
// The tab opens on the editor; the Requests view is the other half of it.
await cdp.clickText('.pane-tab, .tab-strip button, button', 'Requests', { settle: 900 }).catch(() => false)
await cdp.sleep(1200)

const listed = await cdp.evaluate(`
  const rows = [...document.querySelectorAll('.http-item')]
  return {
    count: rows.length,
    methods: rows.map(r => r.querySelector('.http-method')?.textContent ?? ''),
  }
`)
check('the panel lists every request', listed.count === 6, JSON.stringify(listed))
check(
  'each protocol keeps its own verb',
  JSON.stringify(listed.methods) ===
    JSON.stringify(['POST', 'GET', 'GET', 'GRAPHQL', 'SSE', 'WEBSOCKET']),
  JSON.stringify(listed.methods),
)

/* ------------------------------------------------------------------ */
console.log('\n-- requests over the bridge --')
/* ------------------------------------------------------------------ */

/** Everything below goes through the real preload bridge, as the panel does. */
const call = (expression) => cdp.evaluate(expression)

{
  const result = await call(`
    const r = await window.nova.http.send(${JSON.stringify(file)}, 'req-0', null)
    return { status: r.status, body: JSON.parse(r.body), sent: r.sent }
  `)
  check('a POST round-trips through the bridge', result.status === 200, JSON.stringify(result))
  check('the body arrives intact', result.body.body === '{ "hello": "world" }', result.body.body)
  check('the request as sent is reported back', result.sent?.method === 'POST', JSON.stringify(result.sent))
}

{
  const result = await call(`
    const r = await window.nova.http.send(${JSON.stringify(file)}, 'req-1', null)
    return { status: r.status, redirects: r.redirects.length, cookies: r.cookies, body: JSON.parse(r.body) }
  `)
  check('a redirect is followed', result.status === 200 && result.redirects === 1, JSON.stringify(result))
  check(
    'the session cookie survives the redirect',
    (result.body.cookie ?? '').includes('session=abc123'),
    result.body.cookie,
  )
}

{
  const cookies = await call(`return await window.nova.http.cookies()`)
  check(
    'the jar is readable from the renderer',
    cookies.some((c) => c.name === 'session'),
    JSON.stringify(cookies.map((c) => c.name)),
  )
}

{
  const result = await call(`
    const r = await window.nova.http.send(${JSON.stringify(file)}, 'req-2', null)
    return JSON.parse(r.body)
  `)
  check(
    'an auth directive reaches the server',
    result.authorization === 'Basic ' + Buffer.from('ada:lovelace').toString('base64'),
    result.authorization,
  )
}

{
  const result = await call(`
    const r = await window.nova.http.send(${JSON.stringify(file)}, 'req-3', null)
    return { status: r.status, data: JSON.parse(r.body).data, errors: r.graphqlErrors }
  `)
  check('a GraphQL query returns data', result.data?.users?.[0]?.name === 'Ada', JSON.stringify(result))
  check('its variables were sent', JSON.stringify(result.data?.echo) === '{"limit":3}', JSON.stringify(result.data?.echo))
}

{
  const schema = await call(`
    return await window.nova.http.graphqlSchema(${JSON.stringify(file)}, 'req-3', null)
  `)
  check('introspection works through the bridge', !schema.error && schema.queryType === 'Query', schema.error)
}

/* ------------------------------------------------------------------ */
console.log('\n-- streams reaching the renderer --')
/* ------------------------------------------------------------------ */

/**
 * Subscribes in the page, opens a stream and waits for it to settle. This is
 * the part no offline test can cover: whether main-process events actually
 * arrive at a renderer listener.
 */
async function runStream(requestId, { send = null, expect = 1, waitMs = 3500 } = {}) {
  return call(`
    const messages = []
    let status = null
    const offMessage = window.nova.http.onStreamMessage((m) => messages.push(m))
    const offStatus = window.nova.http.onStreamStatus((s) => { status = s })

    const streamId = await window.nova.http.openStream(${JSON.stringify(file)}, ${JSON.stringify(requestId)}, null)
    ${send ? `
    await new Promise((r) => setTimeout(r, 400))
    await window.nova.http.sendStream(streamId, ${JSON.stringify(send)})
    ` : ''}

    const deadline = Date.now() + ${waitMs}
    while (Date.now() < deadline) {
      if (messages.filter((m) => m.direction === 'in').length >= ${expect}) break
      await new Promise((r) => setTimeout(r, 100))
    }
    await window.nova.http.cancelStream(streamId)
    offMessage(); offStatus()
    return { messages, status }
  `)
}

{
  const { messages } = await runStream('req-4', { expect: 3 })
  const inbound = messages.filter((m) => m.direction === 'in')
  check('SSE events reach the renderer', inbound.length === 3, JSON.stringify(inbound.map((m) => m.data)))
  check('the event name comes through', inbound[0]?.event === 'hello', JSON.stringify(inbound[0]))
}

{
  const { messages } = await runStream('req-5', { send: 'from-the-panel', expect: 3 })
  const inbound = messages.filter((m) => m.direction === 'in').map((m) => m.data)
  check('the socket greeting arrives', inbound.includes('welcome'), JSON.stringify(inbound))
  check('a @send directive is delivered', inbound.includes('echo:hello-from-nova'), JSON.stringify(inbound))
  check('a message typed into the panel is echoed', inbound.includes('echo:from-the-panel'), JSON.stringify(inbound))
}

/* ------------------------------------------------------------------ */
console.log('\n-- collections and history --')
/* ------------------------------------------------------------------ */

{
  const collections = await call(`return await window.nova.http.collections(${JSON.stringify(PROJECT)})`)
  check('the project is scanned for request files', collections.length === 1, JSON.stringify(collections.map((c) => c.relative)))
  check('a collection carries its requests', collections[0]?.requests.length === 6, JSON.stringify(collections[0]?.requests.length))
  check('paths are relative to the project', collections[0]?.relative === path.join('api', 'requests.http'), collections[0]?.relative)
}

{
  const entries = await call(`return await window.nova.http.history(${JSON.stringify(file)})`)
  check('every run was recorded', entries.length >= 4, String(entries.length))
  check('history is newest first', entries[0]?.at >= entries[entries.length - 1]?.at, JSON.stringify(entries.map((e) => e.at)))

  const body = await call(`
    const list = await window.nova.http.history(${JSON.stringify(file)})
    const full = await window.nova.http.historyBody(list[list.length - 1].id)
    return full ? { status: full.status, hasBody: full.body.length > 0 } : null
  `)
  check('a stored response can be reopened', body?.hasBody === true, JSON.stringify(body))
}

await server.close()
console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
