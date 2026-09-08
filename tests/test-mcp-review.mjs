/**
 * The built-in review MCP server.
 *
 * Driven as a real child process over stdio, because the things that break an
 * MCP server are all at that boundary: a stray byte on stdout, a notification
 * that gets answered, a partial line. None of those show up when the handler is
 * called directly.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import http from 'node:http'
import { REPO } from './env.mjs'

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n-- ${t} --`)

// A stand-in for Nova's bridge, so the server can be driven with no editor.
const seen = []
const bridge = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, url: req.url, body: JSON.parse(body || '{}') })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, echoed: JSON.parse(body || '{}').tool }))
  })
})
await new Promise((r) => bridge.listen(0, '127.0.0.1', r))
const bridgeUrl = `http://127.0.0.1:${bridge.address().port}`

const server = spawn(process.execPath, [path.join(REPO, 'electron/mcp/nova-review.mjs')], {
  env: { ...process.env, NOVA_REVIEW_URL: bridgeUrl, NOVA_REVIEW_TOKEN: 'test-token' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let out = ''
let err = ''
server.stdout.on('data', (d) => (out += d))
server.stderr.on('data', (d) => (err += d))

const replies = () =>
  out.split('\n').filter(Boolean).map((l) => JSON.parse(l))

const send = (msg) => server.stdin.write(`${JSON.stringify(msg)}\n`)

/**
 * Waits for a condition rather than for a duration.
 *
 * A fixed sleep made this suite flaky on a cold start — Node's own boot is
 * sometimes slower than the sleep, and the first three checks failed against a
 * server that simply had not spoken yet. Polling for the answer removes the
 * race instead of widening the window and hoping.
 */
const until = async (predicate, what, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** For the cases that assert something did *not* happen. */
const settle = () => new Promise((r) => setTimeout(r, 300))
const reply = (id) => until(() => replies().find((m) => m.id === id), `reply ${id}`)

section('handshake')
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
let r = await reply(1)
check('initialize is answered', Boolean(r))
check('it advertises tools', r?.result?.capabilities?.tools !== undefined)
check('it names itself', r?.result?.serverInfo?.name === 'nova-review')

section('the tool list')
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
r = await reply(2)
const tools = r?.result?.tools ?? []
check('six tools are offered', tools.length === 6, `got ${tools.length}`)
for (const name of ['open_app', 'screenshot_app', 'read_console', 'list_run_configs', 'list_devices', 'launch_on_device'])
  check(`${name} is present`, tools.some((t) => t.name === name))
check('every tool has a schema', tools.every((t) => t.inputSchema?.type === 'object'))
check('every tool explains when to use it', tools.every((t) => t.description.length > 40))

section('calling a tool')
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'open_app', arguments: { url: 'http://localhost:3000' } } })
r = await reply(3)
check('the call is answered', Boolean(r?.result))
check('it reaches the bridge', seen.some((s) => s.body.tool === 'open_app'))
check('the token is sent', seen.at(-1)?.auth === 'Bearer test-token')
check('arguments are forwarded', seen.at(-1)?.body.args?.url === 'http://localhost:3000')
check('the result is text content', r?.result?.content?.[0]?.type === 'text')
check('a good result is not an error', r?.result?.isError === false)

section('protocol hygiene')
const before = replies().length
send({ jsonrpc: '2.0', method: 'notifications/initialized' })
await settle()
check('a notification is never answered', replies().length === before)

send({ jsonrpc: '2.0', id: 4, method: 'no/such/method' })
r = await reply(4)
check('an unknown method returns an error', r?.error?.code === -32601)

// A request split across two writes must still be read as one.
server.stdin.write('{"jsonrpc":"2.0","id":5,"method":"pi')
await settle()
server.stdin.write('ng"}\n')
await reply(5)
check('a request split mid-write is reassembled', true)

server.stdin.write('not json\n')
await settle()
check('a junk line does not kill the server', server.exitCode === null)
check('and it complains on stderr, not stdout', err.includes('could not parse'))
check('stdout is only ever JSON-RPC', replies().every((m) => m.jsonrpc === '2.0'))

server.kill()
bridge.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
