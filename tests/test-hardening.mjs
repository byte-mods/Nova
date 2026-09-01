import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { BUILD, TMP } from './env.mjs'

/**
 * The paths that decide whether a repository can reach outside itself, and the
 * stores that decide whether the user's work survives a bad read.
 *
 * Every check here is a bug that shipped. None of these modules had a test
 * before, which is most of why they had the bugs: the suite covered the parsers
 * and the formatters, and stopped at the boundary where untrusted input arrives.
 */
const { resolveInRoot, tryResolveInRoot, isInside, PathEscapeError } = await import(
  pathToFileURL(`${BUILD}/workspacePath.js`).href
)
const { readJsonFile, readJsonFileOrQuarantine, writeJsonFile, writeFileAtomic, withFileLock } =
  await import(pathToFileURL(`${BUILD}/fileStore.js`).href)
const { ContentLengthFramer } = await import(pathToFileURL(`${BUILD}/rpcFraming.js`).href)
const { runPostScript, runPreScript } = await import(pathToFileURL(`${BUILD}/httpScript.js`).href)
const { sendHttpRequest } = await import(pathToFileURL(`${BUILD}/httpClient.js`).href)
const { decodePng } = await import(pathToFileURL(`${BUILD}/visualDiff.js`).href)
const { redactHeaders, redactUrl } = await import(pathToFileURL(`${BUILD}/httpAuth.js`).href)

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

const scratch = path.join(TMP, 'hardening')
await fs.rm(scratch, { recursive: true, force: true })
await fs.mkdir(scratch, { recursive: true })

/* ---------------- path containment ---------------- */

console.log('\n-- a repository cannot name a path outside itself --')
{
  const root = path.join(scratch, 'project')
  await fs.mkdir(path.join(root, 'sub'), { recursive: true })
  await fs.writeFile(path.join(root, 'sub', 'data.csv'), 'a,b\n1,2\n')

  const inside = await resolveInRoot(root, 'sub/data.csv')
  check('a plain relative path resolves', inside.endsWith(`sub${path.sep}data.csv`), inside)

  equal('a traversal is refused', await tryResolveInRoot(root, '../../etc/passwd'), null)
  equal('an encoded traversal is refused', await tryResolveInRoot(root, 'sub/../../../etc/passwd'), null)
  equal('an absolute path is refused by default', await tryResolveInRoot(root, '/etc/passwd'), null)

  // The one the string check could never catch.
  const outside = path.join(scratch, 'outside')
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours')
  await fs.symlink(outside, path.join(root, 'link')).catch(() => undefined)
  equal('a symlink pointing out of the project is refused', await tryResolveInRoot(root, 'link/secret.txt'), null)

  // And the one that must still work: the root itself is usually a symlink.
  const linkedRoot = path.join(scratch, 'linked-root')
  await fs.symlink(root, linkedRoot).catch(() => undefined)
  const viaLink = await tryResolveInRoot(linkedRoot, 'sub/data.csv')
  check('a project reached through a symlink still resolves', viaLink !== null, String(viaLink))

  // A file that does not exist yet still has a real location.
  const fresh = await tryResolveInRoot(root, 'sub/new/file.txt')
  check('a path that does not exist yet resolves', fresh !== null, String(fresh))
  equal('…but not when it would land outside', await tryResolveInRoot(root, 'link/new/file.txt'), null)

  check('an escape is a PathEscapeError', await resolveInRoot(root, '../x').then(() => false, (e) => e instanceof PathEscapeError))
  equal('a root contains itself', isInside(root, root), true)
}

/* ---------------- stores that lose data ---------------- */

console.log('\n-- a store that cannot be read is not a store that is empty --')
{
  const file = path.join(scratch, 'state.json')
  equal('a missing file reads as the fallback', await readJsonFile(file, { a: 1 }), { a: 1 })

  await fs.writeFile(file, '{ truncated')
  check(
    'a corrupt file throws rather than reading as empty',
    await readJsonFile(file, {}).then(() => false, (e) => e.name === 'StoreReadError'),
  )

  await fs.writeFile(file, '')
  check(
    'an empty file — what a torn write leaves — also throws',
    await readJsonFile(file, {}).then(() => false, (e) => e.name === 'StoreReadError'),
  )

  await fs.writeFile(file, '{ broken')
  equal('quarantine falls back', await readJsonFileOrQuarantine(file, { fresh: 1 }), { fresh: 1 })
  equal('and keeps the damaged copy', await fs.readFile(`${file}.corrupt`, 'utf8'), '{ broken')

  await writeJsonFile(file, { b: 2 }, { mode: 0o600 })
  equal('an atomic write round-trips', (await readJsonFile(file, null)).b, 2)
  equal('and applies the mode', (await fs.stat(file)).mode & 0o777, 0o600)
  equal(
    'and leaves no temporary file behind',
    (await fs.readdir(scratch)).filter((n) => n.endsWith('.tmp')).length,
    0,
  )
}

console.log('\n-- concurrent saves do not lose each other --')
{
  const file = path.join(scratch, 'list.json')
  await writeJsonFile(file, { n: [] })
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      withFileLock(file, async () => {
        const state = await readJsonFile(file, { n: [] })
        await new Promise((r) => setTimeout(r, 3))
        state.n.push(i)
        await writeJsonFile(file, state)
      }),
    ),
  )
  equal('25 read-modify-writes all survive', (await readJsonFile(file, { n: [] })).n.length, 25)

  let ran = false
  await withFileLock(file, async () => { throw new Error('boom') }).catch(() => {})
  await withFileLock(file, async () => { ran = true })
  equal('a failed holder does not wedge the queue', ran, true)
}

/* ---------------- the script sandbox ---------------- */

console.log('\n-- a .http script cannot reach the main process --')
{
  const response = {
    requestId: 'r', protocol: 'http', status: 200, statusText: 'OK', headers: {},
    body: '{"token":"abc"}', size: 15, contentType: 'application/json',
    durationMs: 1, at: 0, redirects: [], cookies: [],
  }
  const reach = (expr) =>
    runPostScript(`nova.vars.set('r', String(${expr}))`, response, {}).variables.r

  for (const [name, expr] of [
    ['Object.constructor', `Object.constructor('return typeof process')()`],
    ['this.constructor.constructor', `(function(){return this})().constructor.constructor('return typeof process')()`],
    ['globalThis.constructor', `globalThis.constructor.constructor('return typeof process')()`],
    ['a nova API function', `nova.log.constructor('return typeof process')()`],
    ['a matcher', `nova.expect(1).toBe.constructor('return typeof process')()`],
    ['the parsed body prototype', `Object.getPrototypeOf(nova.response.json()).constructor.constructor('return typeof process')()`],
  ]) {
    equal(`${name} reaches a realm with no process`, reach(expr), 'undefined')
  }
  equal('process is not in scope', reach('typeof process'), 'undefined')
  equal('require is not in scope', reach('typeof require'), 'undefined')

  // …and the API it is supposed to have still works.
  const out = runPostScript(
    `nova.test('status', () => nova.expect(nova.response.status).toBe(200))
     nova.test('body', () => nova.expect(nova.response.json()).toHaveProperty('token', 'abc'))
     nova.test('inverted', () => nova.expect(1).not.toBe(2))
     nova.log('hello')
     nova.vars.set('captured', nova.response.json().token)`,
    response,
    {},
  )
  equal('three assertions pass', out.tests.filter((t) => t.passed).length, 3)
  equal('a variable is captured', out.variables.captured, 'abc')
  equal('a log line is collected', out.logs.length, 1)

  const failed = runPostScript(`nova.test('t', () => nova.expect(1).toBe(2))`, response, {})
  equal('a failing assertion fails its own test', failed.tests[0].passed, false)
  check('and says both sides', /expected 2, got 1/.test(failed.tests[0].message ?? ''), failed.tests[0].message)

  const pre = runPreScript(
    `nova.request.headers['X-Trace'] = 'abc'; nova.request.url = nova.request.url + '?v=1'`,
    { method: 'GET', url: 'http://example.test/', headers: {}, body: '' },
    {},
  )
  equal('a pre-script can set a header', pre.request.headers['X-Trace'], 'abc')
  equal('and rewrite the url', pre.request.url, 'http://example.test/?v=1')

  const threw = runPostScript(`throw new Error('nope')`, response, {})
  equal('a script that throws reports its message', threw.error, 'nope')
}

/* ---------------- credentials do not follow a redirect ---------------- */

console.log('\n-- credentials are not replayed across origins --')
{
  let received = null
  const other = http.createServer((req, res) => { received = { ...req.headers }; res.end('ok') })
  await new Promise((r) => other.listen(0, '127.0.0.1', r))
  const otherPort = other.address().port

  const origin = http.createServer((req, res) => {
    const to = req.url === '/same' ? `/landed` : `http://127.0.0.1:${otherPort}/taken`
    if (req.url === '/landed') { received = { ...req.headers }; res.end('ok'); return }
    res.writeHead(302, { location: to })
    res.end()
  })
  await new Promise((r) => origin.listen(0, '127.0.0.1', r))
  const originPort = origin.address().port

  const ctx = {
    jar: { header: () => '', accept: () => [] },
    baseDir: scratch, projectRoot: scratch,
    defaultTimeoutMs: 5000, maxBodyBytes: 1 << 20,
  }
  const request = (url) => ({
    id: 'r', name: 'r', protocol: 'http', method: 'GET', url,
    headers: [
      { name: 'Authorization', value: 'Bearer SECRET' },
      { name: 'X-Trace', value: 'keep' },
    ],
    body: { kind: 'none' }, auth: { kind: 'none' },
    followRedirects: true, useCookies: false,
  })

  const across = await sendHttpRequest(request(`http://127.0.0.1:${originPort}/away`), ctx)
  equal('Authorization is dropped crossing to another origin', received.authorization, undefined)
  equal('a header that is not a credential still goes', received['x-trace'], 'keep')
  equal('and the hop records the strip', across.redirects[0].strippedCredentials, ['Authorization'])

  received = null
  await sendHttpRequest(request(`http://127.0.0.1:${originPort}/same`), ctx)
  equal('Authorization survives a same-origin redirect', received.authorization, 'Bearer SECRET')

  other.close()
  origin.close()
}

/* ---------------- a header the user named is still a credential ---------------- */

console.log('\n-- redaction follows provenance, not a name list --')
{
  const headers = { Authorization: 'Bearer abcdefghijkl', 'X-Company-Token': 'sk-abcdefghijkl', 'X-Request-Id': 'req-1' }
  const plain = redactHeaders(headers)
  check('a known name is redacted without help', !plain.Authorization.includes('abcdefghijkl'), plain.Authorization)
  equal('an unknown one is not, on its own', plain['X-Company-Token'], 'sk-abcdefghijkl')

  const told = redactHeaders(headers, ['X-Company-Token'])
  check('but is when auth says it set it', !told['X-Company-Token'].includes('abcdefghijkl'), told['X-Company-Token'])
  equal('and an ordinary header is untouched', told['X-Request-Id'], 'req-1')

  const url = redactUrl('https://api.test/v1?api_key=sk-abcdefghijkl&page=2', ['api_key'])
  check('a key in the query string is redacted', !url.includes('sk-abcdefghijkl'), url)
  check('and the rest of the query survives', url.includes('page=2'), url)
}

/* ---------------- framing is bounded and linear ---------------- */

console.log('\n-- a language server cannot exhaust the process --')
{
  const frame = (obj) => {
    const body = Buffer.from(JSON.stringify(obj))
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
  }

  let got = []
  let framer = new ContentLengthFramer()
  framer.push(Buffer.concat([frame({ a: 1 }), frame({ b: 2 })]), (b) => got.push(JSON.parse(b)))
  equal('two messages in one chunk are both read', got.length, 2)

  got = []
  framer = new ContentLengthFramer()
  const whole = frame({ hello: 'world' })
  for (const byte of whole) framer.push(Buffer.from([byte]), (b) => got.push(JSON.parse(b)))
  equal('a message split byte by byte is reassembled', got[0]?.hello, 'world')

  framer = new ContentLengthFramer()
  const refused = framer.push(Buffer.from('Content-Length: 999999999999\r\n\r\n'), () => {})
  check('an impossible length is refused rather than awaited', Boolean(refused), String(refused))

  framer = new ContentLengthFramer()
  let never = null
  for (let i = 0; i < 20 && !never; i++) never = framer.push(Buffer.alloc(1024, 0x41), () => {})
  check('a header that never ends is refused', Boolean(never), String(never))

  // The quadratic case: this took seconds before the chunks were joined once.
  const big = Buffer.alloc(16 * 1024 * 1024, 0x20)
  big.write('{"big":"')
  big.write('"}', big.length - 2)
  const message = Buffer.concat([Buffer.from(`Content-Length: ${big.length}\r\n\r\n`), big])
  framer = new ContentLengthFramer()
  got = []
  const started = Date.now()
  for (let at = 0; at < message.length; at += 65536) {
    framer.push(message.subarray(at, at + 65536), (b) => got.push(b.length))
  }
  const elapsed = Date.now() - started
  equal('a 16 MB reply is assembled', got.length, 1)
  check(`and in linear time (${elapsed} ms)`, elapsed < 2000, `${elapsed} ms`)
}

/* ---------------- an image header is not a licence to allocate ---------------- */

console.log('\n-- a baseline image cannot be a decompression bomb --')
{
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    return Buffer.concat([length, Buffer.from(type, 'ascii'), body, Buffer.alloc(4)])
  }
  const ihdr = (w, h) => {
    const b = Buffer.alloc(13)
    b.writeUInt32BE(w, 0)
    b.writeUInt32BE(h, 4)
    b[8] = 8
    b[9] = 6
    return b
  }
  const png = (w, h, idat) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr(w, h)),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ])

  const bomb = png(65535, 65535, zlib.deflateSync(Buffer.alloc(1024)))
  check(`a ${bomb.length}-byte file claiming 17 GB is refused`,
    await decodePng(bomb).then(() => false, () => true))
  check('a zero-pixel image is refused',
    await decodePng(png(0, 0, zlib.deflateSync(Buffer.alloc(0)))).then(() => false, () => true))
  check('data that does not match the header is refused',
    await decodePng(png(100, 100, zlib.deflateSync(Buffer.alloc(50)))).then(() => false, () => true))

  // A real, small image still decodes.
  const w = 2, h = 2, stride = w * 4
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) raw.fill(0x40, y * (stride + 1) + 1, (y + 1) * (stride + 1))
  const good = png(w, h, zlib.deflateSync(raw))
  const image = await decodePng(good)
  equal('a well-formed image still decodes', [image.width, image.height], [2, 2])
}

await fs.rm(scratch, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
