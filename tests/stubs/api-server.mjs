/**
 * A small API the request-client suite runs against.
 *
 * Real sockets rather than a mocked `fetch`, because the things most likely to
 * be wrong are the things a mock cannot have: whether a cookie survives a
 * redirect, whether a multipart body is framed correctly, whether an SSE event
 * split across two TCP writes is reassembled. A mock would agree with the
 * implementation and prove nothing.
 */
import crypto from 'node:crypto'
import http from 'node:http'

export async function startApiServer() {
  const seen = { requests: [] }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const body = await readBody(req)
    seen.requests.push({
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      body: body.toString('utf8'),
    })

    switch (url.pathname) {
      /* Echoes what it was sent, which most assertions read back. */
      case '/echo':
        return json(res, 200, {
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
          body: body.toString('utf8'),
        })

      /* Sets a session cookie, then redirects. The cookie must be presented on
         the hop that follows, which is the whole point of the jar. */
      case '/login':
        res.setHeader('Set-Cookie', [
          'session=abc123; Path=/; HttpOnly',
          'theme=dark; Path=/; Max-Age=600',
        ])
        res.writeHead(302, { Location: '/profile' })
        return res.end()

      case '/profile':
        return json(res, 200, { cookie: req.headers.cookie ?? '', method: req.method })

      /* A 307 keeps the method and body; a 302 must not. */
      case '/redirect-307':
        res.writeHead(307, { Location: '/echo' })
        return res.end()

      case '/redirect-302':
        res.writeHead(302, { Location: '/echo' })
        return res.end()

      case '/redirect-loop':
        res.writeHead(302, { Location: '/redirect-loop' })
        return res.end()

      /* Rejects anything without the right credential, so auth is observable. */
      case '/secure': {
        const auth = req.headers.authorization ?? ''
        if (!auth) return json(res, 401, { error: 'no credential' })
        return json(res, 200, { authorization: auth })
      }

      case '/secure-key': {
        const key = req.headers['x-api-key'] ?? url.searchParams.get('api_key')
        if (!key) return json(res, 401, { error: 'no key' })
        return json(res, 200, { key })
      }

      /* An OAuth2 token endpoint, for both supported grants. */
      case '/token': {
        const form = new URLSearchParams(body.toString('utf8'))
        return json(res, 200, {
          access_token: `tok-${form.get('grant_type')}-${seen.requests.filter((r) => r.path === '/token').length}`,
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }

      case '/upload': {
        const type = req.headers['content-type'] ?? ''
        const boundary = /boundary=(.+)$/.exec(type)?.[1]
        if (!boundary) return json(res, 400, { error: 'no boundary' })
        return json(res, 200, { parts: parseMultipart(body, boundary) })
      }

      case '/events':
        return streamEvents(res)

      case '/graphql': {
        const payload = JSON.parse(body.toString('utf8') || '{}')
        if (/__schema/.test(payload.query ?? '')) return json(res, 200, INTROSPECTION)
        if (/\bboom\b/.test(payload.query ?? '')) {
          // A GraphQL failure is a 200 with errors, which is exactly the case a
          // status-only client reports as success.
          return json(res, 200, { data: null, errors: [{ message: 'boom went wrong', path: ['boom'] }] })
        }
        return json(res, 200, { data: { users: [{ id: '1', name: 'Ada' }], echo: payload.variables ?? null } })
      }

      case '/slow':
        return setTimeout(() => json(res, 200, { ok: true }), 3000)

      default:
        return json(res, 404, { error: 'not found' })
    }
  })

  server.on('upgrade', handleWebSocketUpgrade)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function json(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/**
 * Sends three events, the last one deliberately split across two writes so the
 * client's buffering is exercised rather than assumed.
 */
function streamEvents(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('event: hello\ndata: first\n\n')
  res.write('data: {"n":2}\n\n')
  setTimeout(() => {
    res.write('event: split\ndata: part-one\ndata: ')
    setTimeout(() => {
      res.write('part-two\n\n')
      res.end()
    }, 60)
  }, 60)
}

/* ---------------- multipart ---------------- */

function parseMultipart(body, boundary) {
  const parts = []
  const separator = `--${boundary}`
  const sections = body.toString('binary').split(separator).slice(1, -1)

  for (const section of sections) {
    const split = section.indexOf('\r\n\r\n')
    if (split === -1) continue
    const head = section.slice(0, split)
    const content = section.slice(split + 4, section.length - 2)
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? ''
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    const type = /Content-Type:\s*(\S+)/i.exec(head)?.[1]
    parts.push({ name, filename, type, value: Buffer.from(content, 'binary').toString('utf8') })
  }
  return parts
}

/* ---------------- WebSocket ---------------- */

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/**
 * A minimal server: enough of RFC 6455 to accept a connection and echo text
 * frames back. Node ships no WebSocket server, and pulling one in for a test
 * of the client would put a second implementation between the test and the
 * thing being tested.
 */
function handleWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key']
  if (!key) return socket.destroy()

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  socket.write(encodeFrame('welcome'))

  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const frame = decodeFrame(buffer)
      if (!frame) break
      buffer = buffer.subarray(frame.consumed)
      if (frame.opcode === 0x8) {
        socket.end(encodeFrame('', 0x8))
        return
      }
      if (frame.opcode === 0x1) socket.write(encodeFrame(`echo:${frame.payload}`))
    }
  })
  socket.on('error', () => socket.destroy())
}

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text, 'utf8')
  // Only the two shorter length forms are needed; the test never sends 64k.
  const header =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, payload.length])
      : Buffer.concat([Buffer.from([0x80 | opcode, 126]), lengthBytes(payload.length)])
  return Buffer.concat([header, payload])
}

function lengthBytes(length) {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(length)
  return bytes
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null
  const opcode = buffer[0] & 0x0f
  const masked = Boolean(buffer[1] & 0x80)
  let length = buffer[1] & 0x7f
  let offset = 2

  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    length = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }

  const maskKey = masked ? buffer.subarray(offset, offset + 4) : null
  if (masked) offset += 4
  if (buffer.length < offset + length) return null

  const payload = Buffer.from(buffer.subarray(offset, offset + length))
  // A client MUST mask its frames, so unmasking is not optional here.
  if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]

  return { opcode, payload: payload.toString('utf8'), consumed: offset + length }
}

/* ---------------- GraphQL introspection reply ---------------- */

const INTROSPECTION = {
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        {
          kind: 'OBJECT',
          name: 'Query',
          description: 'The root',
          fields: [
            {
              name: 'users',
              description: 'Every user',
              args: [{ name: 'limit', type: { kind: 'SCALAR', name: 'Int', ofType: null } }],
              type: {
                kind: 'NON_NULL',
                name: null,
                ofType: {
                  kind: 'LIST',
                  name: null,
                  ofType: { kind: 'NON_NULL', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
                },
              },
            },
          ],
          inputFields: null,
          enumValues: null,
        },
        {
          kind: 'OBJECT',
          name: 'User',
          fields: [
            { name: 'id', args: [], type: { kind: 'SCALAR', name: 'ID', ofType: null } },
            { name: 'name', args: [], type: { kind: 'SCALAR', name: 'String', ofType: null } },
          ],
          inputFields: null,
          enumValues: null,
        },
        // Meta-types are part of the protocol, not the API, and must be hidden.
        { kind: 'OBJECT', name: '__Type', fields: [], inputFields: null, enumValues: null },
      ],
    },
  },
}
