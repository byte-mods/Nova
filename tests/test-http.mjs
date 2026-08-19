import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'
import { startApiServer } from './stubs/api-server.mjs'

/**
 * The request client, from the file format through to real sockets.
 *
 * The parser checks are pure. Everything after them runs against a local
 * server, because the parts most likely to be wrong — a cookie surviving a
 * redirect, a multipart body being framed correctly, an SSE event split across
 * two writes — are exactly the parts a mocked `fetch` cannot exercise.
 */
const { parseHttpFile, interpolateRequest, parseAuth } = await import(
  pathToFileURL(`${BUILD}/httpFile.js`).href
)
const { applyAuth, clearTokenCache, redactHeaders } = await import(
  pathToFileURL(`${BUILD}/httpAuth.js`).href
)
const { CookieJar } = await import(pathToFileURL(`${BUILD}/cookieJar.js`).href)
const { sendHttpRequest } = await import(pathToFileURL(`${BUILD}/httpClient.js`).href)
const { StreamManager } = await import(pathToFileURL(`${BUILD}/httpStream.js`).href)
const { introspect, errorsFromBody } = await import(pathToFileURL(`${BUILD}/graphql.js`).href)

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

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, `expected ${b}\n        got      ${a}`)
}

const workspace = path.join(TMP, 'http-client')
await fs.rm(workspace, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })

const server = await startApiServer()

/* ------------------------------------------------------------------ */
console.log('\n-- the file format --')
/* ------------------------------------------------------------------ */

{
  const file = parseHttpFile(`@base = https://api.test

### Create a user
# @auth bearer {{token}}
# @timeout 4500
POST {{base}}/users
Content-Type: application/json

{ "name": "Ada" }

### Plain
GET {{base}}/health
`)

  equal('reads both requests', file.requests.length, 2)
  equal('names a request from its separator', file.requests[0].name, 'Create a user')
  equal('reads the method and url', [file.requests[0].method, file.requests[0].url], ['POST', '{{base}}/users'])
  equal('reads a directive-supplied timeout', file.requests[0].timeoutMs, 4500)
  equal('reads a bearer directive', file.requests[0].auth, { kind: 'bearer', token: '{{token}}' })
  equal('keeps the body verbatim', file.requests[0].body, { kind: 'text', text: '{ "name": "Ada" }' })
  equal('defaults to following redirects', file.requests[0].followRedirects, true)
  check('reports no errors on a valid file', file.errors.length === 0, file.errors.join('; '))
}

{
  const file = parseHttpFile(`### Socket
WEBSOCKET wss://api.test/socket
# @send {"hello":true}

### Events
SSE https://api.test/events

### Query
GRAPHQL https://api.test/graphql

query Users($limit: Int) { users(limit: $limit) { id } }

--variables
{ "limit": 5 }

### Call
GRPC localhost:50051 billing.Orders/Compute
# @proto ./billing.proto

{ "items": 3 }
`)

  equal(
    'assigns a protocol per verb',
    file.requests.map((r) => r.protocol),
    ['websocket', 'sse', 'graphql', 'grpc'],
  )
  equal('collects websocket send directives', file.requests[0].initialMessages, ['{"hello":true}'])
  equal('splits a graphql query from its variables', file.requests[2].body, {
    kind: 'graphql',
    query: 'query Users($limit: Int) { users(limit: $limit) { id } }',
    variables: '{ "limit": 5 }',
    operationName: 'Users',
  })
  equal('reads a grpc address and method', [file.requests[3].url, file.requests[3].grpcMethod], [
    'localhost:50051',
    'billing.Orders/Compute',
  ])
  equal('reads a proto directive', file.requests[3].protoPath, './billing.proto')
}

{
  const file = parseHttpFile(`### Upload
POST https://api.test/files
Content-Type: multipart/form-data

--form
name: avatar
filename: ./avatar.png
type: image/png
--form
name: caption
value: My avatar

### Included
POST https://api.test/import

< ./payload.json
`)

  equal('reads multipart parts', file.requests[0].body, {
    kind: 'multipart',
    parts: [
      { name: 'avatar', filename: './avatar.png', contentType: 'image/png' },
      { name: 'caption', value: 'My avatar' },
    ],
  })
  equal('reads a file-included body', file.requests[1].body, { kind: 'file', path: './payload.json' })
}

// A body containing something that looks like a directive or a request line
// must stay untouched — this is why the parser tracks whether it is in a body.
{
  const file = parseHttpFile(`### Tricky
POST https://api.test/notes
Content-Type: application/json

{
  "note": "# @auth bearer nope",
  "next": "GET https://elsewhere.test"
}
`)
  check(
    'leaves directives and urls inside a body alone',
    file.requests[0].body.text.includes('# @auth bearer nope') && file.requests[0].auth.kind === 'none',
    JSON.stringify(file.requests[0].auth),
  )
}

equal('parses an api-key auth directive', parseAuth('apikey header X-Api-Key secret'), {
  kind: 'apikey',
  in: 'header',
  name: 'X-Api-Key',
  value: 'secret',
})
equal('parses a basic auth directive with a quoted password', parseAuth('basic ada "pass word"'), {
  kind: 'basic',
  username: 'ada',
  password: 'pass word',
})
equal(
  'parses oauth2 key=value options',
  parseAuth('oauth2 grant=client_credentials token_url=https://id.test/token client_id=abc client_secret=shh scope=read'),
  {
    kind: 'oauth2',
    grant: 'client_credentials',
    tokenUrl: 'https://id.test/token',
    clientId: 'abc',
    clientSecret: 'shh',
    username: undefined,
    password: undefined,
    scope: 'read',
    clientAuth: 'header',
  },
)
check('rejects an auth scheme it does not know', parseAuth('kerberos whatever') === null)

{
  const file = parseHttpFile(`@host = api.test
### Go
# @auth basic {{user}} {{pass}}
GET https://{{host}}/x?k={{key}}
X-Trace: {{trace}}

{ "v": "{{key}}" }
`)
  const filled = interpolateRequest(file.requests[0], file.variables, {
    user: 'ada',
    pass: 'lovelace',
    key: 'K1',
    trace: 'T9',
  })
  equal('interpolates the url', filled.url, 'https://api.test/x?k=K1')
  equal('interpolates headers', filled.headers[0].value, 'T9')
  equal('interpolates the body', filled.body.text, '{ "v": "K1" }')
  equal('interpolates auth credentials', filled.auth, {
    kind: 'basic',
    username: 'ada',
    password: 'lovelace',
  })
}

/* ------------------------------------------------------------------ */
console.log('\n-- auth --')
/* ------------------------------------------------------------------ */

equal('basic auth encodes the credential pair', (await applyAuth({ kind: 'basic', username: 'ada', password: 'lovelace' })).headers, {
  Authorization: `Basic ${Buffer.from('ada:lovelace').toString('base64')}`,
})
equal('an api key can go in the query instead of a header', (await applyAuth({ kind: 'apikey', in: 'query', name: 'api_key', value: 'K' })), {
  headers: {},
  query: { api_key: 'K' },
})
equal('credentials are redacted for display', redactHeaders({ Authorization: 'Bearer secret-token-1234', Accept: 'application/json' }), {
  Authorization: 'Bearer ••••1234',
  Accept: 'application/json',
})

{
  clearTokenCache()
  const oauth = {
    kind: 'oauth2',
    grant: 'client_credentials',
    tokenUrl: `${server.base}/token`,
    clientId: 'abc',
    clientSecret: 'shh',
  }
  const first = await applyAuth(oauth)
  const second = await applyAuth(oauth)
  check('oauth2 fetches a token', /^Bearer tok-client_credentials/.test(first.headers.Authorization ?? ''), JSON.stringify(first))
  equal('oauth2 reuses a live token rather than refetching', second.headers.Authorization, first.headers.Authorization)
  equal('only one token request was made', server.seen.requests.filter((r) => r.path === '/token').length, 1)
}

/* ------------------------------------------------------------------ */
console.log('\n-- the cookie jar --')
/* ------------------------------------------------------------------ */

{
  const jar = new CookieJar()
  await jar.open(path.join(workspace, 'jar'))

  jar.accept('https://shop.test/app/page', ['sid=1; Path=/app', 'wide=2; Domain=shop.test; Path=/'])
  equal('sends cookies whose path matches', jar.header('https://shop.test/app/page'), 'sid=1; wide=2')
  equal('withholds a cookie whose path does not match', jar.header('https://shop.test/other'), 'wide=2')
  equal('withholds cookies from another host', jar.header('https://evil.test/'), '')

  jar.accept('https://shop.test/', ['secureonly=3; Secure'])
  equal('withholds a Secure cookie over plain http', jar.header('http://shop.test/'), 'wide=2')

  jar.accept('https://shop.test/app/page', ['sid=; Path=/app; Max-Age=0'])
  equal(
    'an expiry in the past deletes the cookie',
    jar.header('https://shop.test/app/page'),
    'wide=2; secureonly=3',
  )

  const rejected = jar.accept('https://shop.test/', ['evil=1; Domain=other.test'])
  equal('refuses a cookie set for another domain', rejected, [])

  // A jar reopened on the same directory must still know the session.
  await jar.flush()
  const reopened = new CookieJar()
  await reopened.open(path.join(workspace, 'jar'))
  check('persists across a reopen', reopened.header('https://shop.test/').includes('wide=2'), reopened.header('https://shop.test/'))
}

/* ------------------------------------------------------------------ */
console.log('\n-- sending --')
/* ------------------------------------------------------------------ */

const jar = new CookieJar()
await jar.open(path.join(workspace, 'send-jar'))

const ctx = { jar, baseDir: workspace, defaultTimeoutMs: 8000, maxBodyBytes: 1024 * 1024 }

/** Parses a one-request file and sends it, so tests read as the format does. */
async function send(source, environment = {}) {
  const file = parseHttpFile(source.replaceAll('{{base}}', server.base))
  if (file.errors.length) throw new Error(file.errors.join('; '))
  const request = interpolateRequest(file.requests[0], file.variables, environment)
  return sendHttpRequest(request, ctx)
}

{
  const response = await send(`POST {{base}}/echo\nContent-Type: application/json\n\n{ "a": 1 }`)
  const echoed = JSON.parse(response.body)
  equal('sends a body and reads the response', [response.status, echoed.method, echoed.body], [200, 'POST', '{ "a": 1 }'])
  equal('reports the request as sent', response.sent.method, 'POST')
}

{
  const response = await send(`POST {{base}}/echo\n\n{ "a": 1 }`)
  equal('infers a JSON content type from the body', JSON.parse(response.body).headers['content-type'], 'application/json')
}

{
  const response = await send(`GET {{base}}/login`)
  const profile = JSON.parse(response.body)
  check('follows a redirect and lands on the target', response.status === 200, String(response.status))
  equal('records the redirect chain', response.redirects.length, 1)
  check('carries the cookie set on the redirecting hop', profile.cookie.includes('session=abc123'), profile.cookie)
  check('reports the cookies a response set', response.cookies.includes('session=abc123'), JSON.stringify(response.cookies))
}

{
  const response = await send(`POST {{base}}/redirect-302\nContent-Type: application/json\n\n{ "a": 1 }`)
  const echoed = JSON.parse(response.body)
  equal('a 302 rewrites the method to GET and drops the body', [echoed.method, echoed.body], ['GET', ''])
}

{
  const response = await send(`POST {{base}}/redirect-307\nContent-Type: application/json\n\n{ "a": 1 }`)
  const echoed = JSON.parse(response.body)
  equal('a 307 preserves the method and body', [echoed.method, echoed.body], ['POST', '{ "a": 1 }'])
}

{
  const response = await send(`GET {{base}}/redirect-loop`)
  check('stops a redirect loop with an error', /does not terminate/.test(response.error ?? ''), response.error)
}

{
  const response = await send(`### x\n# @no-redirect\nGET {{base}}/redirect-302`)
  equal('@no-redirect returns the redirect itself', response.status, 302)
}

{
  const response = await send(`### x\n# @auth basic ada lovelace\nGET {{base}}/secure`)
  equal('basic auth reaches the server', JSON.parse(response.body).authorization, `Basic ${Buffer.from('ada:lovelace').toString('base64')}`)
}

{
  const response = await send(`### x\n# @auth apikey query api_key K7\nGET {{base}}/secure-key`)
  equal('an api key in the query reaches the server', JSON.parse(response.body).key, 'K7')
}

{
  await fs.writeFile(path.join(workspace, 'payload.json'), '{"from":"a file"}')
  const response = await send(`POST {{base}}/echo\n\n< ./payload.json`)
  equal('sends a body read from a file', JSON.parse(response.body).body, '{"from":"a file"}')
}

{
  const response = await send(`POST {{base}}/echo\n\n< ./missing.json`)
  check('reports a missing body file clearly', /Could not read the request body/.test(response.error ?? ''), response.error)
}

{
  await fs.writeFile(path.join(workspace, 'avatar.png'), 'PNG-BYTES')
  const response = await send(
    `POST {{base}}/upload\n\n--form\nname: avatar\nfilename: ./avatar.png\ntype: image/png\n--form\nname: caption\nvalue: My avatar`,
  )
  const parts = JSON.parse(response.body).parts
  equal('encodes a multipart upload the server can read', parts, [
    { name: 'avatar', filename: 'avatar.png', type: 'image/png', value: 'PNG-BYTES' },
    { name: 'caption', filename: undefined, type: undefined, value: 'My avatar' },
  ])
}

{
  const response = await send(`### x\n# @timeout 400\nGET {{base}}/slow`)
  check('honours a per-request timeout', /Timed out/.test(response.error ?? ''), response.error)
}

{
  const response = await send(`GET https://{{missing}}/x`)
  check('refuses to send with an unresolved variable', /Unresolved variable/.test(response.error ?? ''), response.error)
}

/* ------------------------------------------------------------------ */
console.log('\n-- GraphQL --')
/* ------------------------------------------------------------------ */

{
  const response = await send(
    `GRAPHQL {{base}}/graphql\n\nquery Users($limit: Int) { users(limit: $limit) { id name } }\n\n--variables\n{ "limit": 5 }`,
  )
  const payload = JSON.parse(response.body)
  equal('sends a graphql query with its variables', payload.data.echo, { limit: 5 })
  equal('reads the data back', payload.data.users[0].name, 'Ada')
}

{
  const response = await send(`GRAPHQL {{base}}/graphql\n\nquery { boom }`)
  equal('a graphql failure still returns 200', response.status, 200)
  equal('the errors are extracted from the body', errorsFromBody(response.body, response.contentType), [
    'boom went wrong (at boom)',
  ])
}

{
  const schema = await introspect(`${server.base}/graphql`, {}, { kind: 'none' })
  check('introspection reads the schema', !schema.error, schema.error)
  equal('names the query root', schema.queryType, 'Query')
  check('hides introspection meta-types', !schema.types.some((t) => t.name.startsWith('__')), schema.types.map((t) => t.name).join(','))
  const users = schema.types.find((t) => t.name === 'Query')?.fields[0]
  equal('renders a nested type reference', users?.type, '[User!]!')
  equal('reads field arguments', users?.args, [{ name: 'limit', type: 'Int' }])
}

/* ------------------------------------------------------------------ */
console.log('\n-- streams --')
/* ------------------------------------------------------------------ */

/** Opens a stream and resolves once it closes, with everything it said. */
function runStream(source, { send: toSend = [], closeAfter = 0 } = {}) {
  const file = parseHttpFile(source.replaceAll('{{base}}', server.base).replaceAll('{{ws}}', server.wsBase))
  const request = interpolateRequest(file.requests[0], file.variables, {})

  return new Promise((resolve) => {
    const messages = []
    let streamId = ''
    const manager = new StreamManager({
      onMessage: (message) => {
        messages.push(message)
        const inbound = messages.filter((m) => m.direction === 'in').length
        if (closeAfter && inbound >= closeAfter) setTimeout(() => manager.close(streamId), 20)
      },
      onStatus: (status) => {
        if (status.state === 'open' && toSend.length) {
          // Drained before sending: each send reports a new status, which
          // re-enters this handler, and a queue still holding the message
          // would send it again forever.
          const queued = toSend.splice(0)
          for (const text of queued) manager.send(status.streamId, text)
        }
        if (status.state === 'closed' || status.state === 'error') {
          setTimeout(() => resolve({ status, messages }), 30)
        }
      },
    })
    streamId = manager.open(request, jar)
    // A stream that never settles must not hang the suite.
    setTimeout(() => {
      manager.close(streamId)
      resolve({ status: { state: 'timeout' }, messages })
    }, 6000)
  })
}

{
  const { messages } = await runStream(`SSE {{base}}/events`)
  const inbound = messages.filter((m) => m.direction === 'in')
  equal('receives every SSE event', inbound.length, 3)
  equal('reads the event name', inbound[0].event, 'hello')
  equal('reads the event data', inbound[0].data, 'first')
  equal('joins multi-line data', inbound[2].data, 'part-one\npart-two')
  check('reassembles an event split across writes', inbound[2].event === 'split', JSON.stringify(inbound[2]))
}

{
  const { messages } = await runStream(`WEBSOCKET {{ws}}/socket`, { send: ['ping'], closeAfter: 2 })
  const inbound = messages.filter((m) => m.direction === 'in').map((m) => m.data)
  const outbound = messages.filter((m) => m.direction === 'out').map((m) => m.data)
  equal('receives the server greeting and the echo', inbound, ['welcome', 'echo:ping'])
  equal('records what was sent', outbound, ['ping'])
}

{
  const { messages } = await runStream(`### s\nWEBSOCKET {{ws}}/socket\n# @send auto`, { closeAfter: 2 })
  const inbound = messages.filter((m) => m.direction === 'in').map((m) => m.data)
  check('@send delivers a message as soon as the socket opens', inbound.includes('echo:auto'), JSON.stringify(inbound))
}

{
  const { status } = await runStream(`WEBSOCKET ws://127.0.0.1:1/nothing`)
  equal('a socket that cannot connect ends in error', status.state, 'error')
}

await server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
