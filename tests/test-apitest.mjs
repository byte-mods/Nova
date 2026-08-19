import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'
import { startApiServer } from './stubs/api-server.mjs'

/**
 * API test automation: scripts, assertions, chaining, data-driven runs,
 * OpenAPI import, contract validation and the mock server.
 *
 * The runner checks go through a real server for the same reason the request
 * suite does — chaining is only meaningfully tested when the second request
 * actually carries what the first one captured.
 */
const { runHttpFile, parseCsv } = await import(pathToFileURL(`${BUILD}/httpRunner.js`).href)
const { runPostScript, runPreScript } = await import(pathToFileURL(`${BUILD}/httpScript.js`).href)
const { parseHttpFile } = await import(pathToFileURL(`${BUILD}/httpFile.js`).href)
const { validate } = await import(pathToFileURL(`${BUILD}/jsonSchema.js`).href)
const { importSpec, checkContract, loadSpec } = await import(pathToFileURL(`${BUILD}/openapi.js`).href)
const { MockServer } = await import(pathToFileURL(`${BUILD}/mockServer.js`).href)
const { CookieJar } = await import(pathToFileURL(`${BUILD}/cookieJar.js`).href)

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

const workspace = path.join(TMP, 'api-tests')
await fs.rm(workspace, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })

const server = await startApiServer()
const jar = new CookieJar()
await jar.open(path.join(workspace, 'jar'))

/* ------------------------------------------------------------------ */
console.log('\n-- script blocks in the file --')
/* ------------------------------------------------------------------ */

{
  const file = parseHttpFile(`### Login
POST https://api.test/login

{ "user": "ada" }

> {%
  nova.test('ok', () => nova.expect(nova.response.status).toBe(200))
%}
`)
  equal('the body keeps only the payload', file.requests[0].body, {
    kind: 'text',
    text: '{ "user": "ada" }',
  })
  check(
    'the response script is pulled out',
    file.requests[0].postScript?.includes("nova.test('ok'"),
    file.requests[0].postScript,
  )
}

{
  const file = parseHttpFile(`### Traced
GET https://api.test/x

< {%
  nova.request.headers['X-Trace'] = 'abc'
%}
`)
  check('a pre-request script is pulled out', file.requests[0].preScript?.includes('X-Trace'), file.requests[0].preScript)
  equal('a request with only a script has no body', file.requests[0].body, { kind: 'none' })
}

// `< ./file.json` and `< {% %}` share an opening character, and confusing the
// two would silently turn a body include into a script.
{
  const file = parseHttpFile(`### Included
POST https://api.test/x

< ./payload.json
`)
  equal('a file-included body is not mistaken for a script', file.requests[0].body, {
    kind: 'file',
    path: './payload.json',
  })
}

/* ------------------------------------------------------------------ */
console.log('\n-- assertions --')
/* ------------------------------------------------------------------ */

const response = {
  requestId: 'r',
  protocol: 'http',
  status: 200,
  statusText: 'OK',
  headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
  body: JSON.stringify({ id: 7, name: 'Ada', tags: ['a', 'b'], nested: { deep: true } }),
  durationMs: 12,
  size: 40,
  contentType: 'application/json',
  at: 0,
  redirects: [],
  cookies: [],
}

function script(source) {
  return runPostScript(source, response, {})
}

{
  const out = script(`
    nova.test('status', () => nova.expect(nova.response.status).toBe(200))
    nova.test('json', () => nova.expect(nova.response.json().name).toBe('Ada'))
    nova.test('array', () => nova.expect(nova.response.json().tags).toEqual(['a','b']))
    nova.test('contains', () => nova.expect(nova.response.json().tags).toContain('b'))
    nova.test('property', () => nova.expect(nova.response.json()).toHaveProperty('nested.deep', true))
    nova.test('regex', () => nova.expect(nova.response.json().name).toMatch(/^A/))
    nova.test('length', () => nova.expect(nova.response.json().tags).toHaveLength(2))
    nova.test('numeric', () => nova.expect(nova.response.time).toBeLessThan(1000))
    nova.test('negated', () => nova.expect(nova.response.status).not.toBe(500))
  `)
  equal('every matcher passes on a matching response', out.tests.filter((t) => t.passed).length, 9)
  check('no script error', !out.error, out.error)
}

{
  const out = script(`
    nova.test('first fails', () => nova.expect(nova.response.status).toBe(404))
    nova.test('second still runs', () => nova.expect(nova.response.status).toBe(200))
  `)
  equal('a failing assertion does not abort the rest', out.tests.map((t) => t.passed), [false, true])
  check(
    'the failure message carries both sides',
    out.tests[0].message === 'expected 404, got 200',
    out.tests[0].message,
  )
}

{
  const out = script(`nova.test('bad', () => nova.expect(nova.response.status).not.toBe(200))`)
  check('a negated matcher fails when the check would pass', !out.tests[0].passed, out.tests[0].message)
}

{
  // Headers are case-insensitive on the wire, so a script must not have to
  // guess how the server spelled them.
  const out = script(`nova.test('h', () => nova.expect(nova.response.headers['x-trace']).toBe('abc'))`)
  check('headers are readable in lower case', out.tests[0].passed, out.tests[0].message)
}

{
  const out = script(`nova.log('one', { two: 3 })`)
  equal('log output is captured', out.logs, ['"one" {"two":3}'])
}

{
  const out = script(`nova.vars.set('token', nova.response.json().id)`)
  equal('a captured number is stored as text', out.variables, { token: '7' })
}

{
  const out = script(`throw new Error('boom')`)
  check('a script that throws is reported', out.error === 'boom', out.error)
}

{
  const out = script(`nova.test('t', () => nova.expect(1).toBe(1)); while (true) {}`)
  check('a runaway script is stopped', /did not finish/.test(out.error ?? ''), out.error)
  equal('assertions before the hang are kept', out.tests.length, 1)
}

{
  // The sandbox has no reach beyond what it was given; a script that tries is
  // an error rather than a hole.
  const out = script(`nova.vars.set('leak', typeof require + '/' + typeof process)`)
  equal('there is no require or process in scope', out.variables.leak, 'undefined/undefined')
}

{
  const out = runPreScript(
    `nova.request.headers['X-Trace'] = 'abc'; nova.request.url = nova.request.url + '?x=1'`,
    { method: 'GET', url: 'https://api.test/a', headers: {}, body: '' },
    {},
  )
  equal('a pre-request script can add a header', out.request.headers, { 'X-Trace': 'abc' })
  equal('a pre-request script can rewrite the url', out.request.url, 'https://api.test/a?x=1')
}

/* ------------------------------------------------------------------ */
console.log('\n-- running a file --')
/* ------------------------------------------------------------------ */

const context = { jar, baseDir: workspace, defaultTimeoutMs: 8000, maxBodyBytes: 1024 * 1024 }

async function runSource(name, source, options = {}) {
  const file = path.join(workspace, name)
  await fs.writeFile(file, source.replaceAll('{{base}}', server.base))
  return runHttpFile(file, { environment: {}, context, ...options })
}

{
  const result = await runSource(
    'basic.http',
    `### Echo
POST {{base}}/echo

{ "a": 1 }

> {%
  nova.test('ok', () => nova.expect(nova.response.status).toBe(200))
  nova.test('echoed', () => nova.expect(nova.response.json().body).toContain('"a": 1'))
%}
`,
  )
  equal('a run counts its assertions', [result.passed, result.failed], [2, 0])
  equal('a step records its status', result.steps[0].status, 200)
}

// The whole point of the run scope: what one request learns, the next uses.
{
  const result = await runSource(
    'chain.http',
    `### Get a token
POST {{base}}/token

grant_type=client_credentials

> {%
  nova.vars.set('token', nova.response.json().access_token)
  nova.test('has a token', () => nova.expect(nova.vars.get('token')).toBeTruthy())
%}

### Use it
GET {{base}}/echo
Authorization: Bearer {{token}}

> {%
  nova.test('the token was sent', () =>
    nova.expect(nova.response.json().headers.authorization).toMatch(/^Bearer tok-/))
%}
`,
  )
  equal('a chained run passes both steps', [result.passed, result.failed], [2, 0])
  check('the captured variable is reported', Boolean(result.variables.token), JSON.stringify(result.variables))
}

{
  await fs.writeFile(
    path.join(workspace, 'cases.csv'),
    'name,expected\nada,ada\ngrace,grace\n"with, comma",ok\n',
  )
  const result = await runSource(
    'data.http',
    `### Per row
# @data ./cases.csv
POST {{base}}/echo

{ "name": "{{name}}" }

> {%
  nova.test('name went through', () =>
    nova.expect(nova.response.json().body).toContain(nova.env.get('name')))
%}
`,
  )
  equal('a data file runs one step per row', result.steps.length, 3)
  equal('every row passes', [result.passed, result.failed], [3, 0])
  equal('rows are numbered', result.steps.map((s) => s.dataRow), [0, 1, 2])
}

equal('csv keeps a quoted comma in one field', parseCsv('a,b\n"x, y",z\n'), [{ a: 'x, y', b: 'z' }])
equal('csv unescapes a doubled quote', parseCsv('a\n"say ""hi"""\n'), [{ a: 'say "hi"' }])

{
  const result = await runSource(
    'bail.http',
    `### One
GET {{base}}/echo

> {% nova.test('fails', () => nova.expect(nova.response.status).toBe(500)) %}

### Two
GET {{base}}/echo

> {% nova.test('never runs', () => nova.expect(1).toBe(1)) %}
`,
    { bail: true },
  )
  equal('bail stops at the first failure', result.steps.length, 1)
}

{
  const result = await runSource(
    'skip.http',
    `### A socket
WEBSOCKET ws://127.0.0.1:1/x

### A request
GET {{base}}/echo

> {% nova.test('ok', () => nova.expect(nova.response.status).toBe(200)) %}
`,
  )
  equal('a stream is skipped rather than hanging the run', result.steps.length, 2)
  check('the skip is explained', /stream/.test(result.steps[0].logs[0] ?? ''), result.steps[0].logs[0])
  equal('the request after it still runs', result.passed, 1)
}

{
  const result = await runSource(
    'onlyone.http',
    `### First
GET {{base}}/echo

### Second
GET {{base}}/secure
`,
    { only: 'req-1' },
  )
  equal('a single request can be run on its own', result.steps.length, 1)
  equal('and it is the one asked for', result.steps[0].status, 401)
}

/* ------------------------------------------------------------------ */
console.log('\n-- the schema validator --')
/* ------------------------------------------------------------------ */

const userSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'integer' },
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['admin', 'user'] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    deleted: { type: 'string', nullable: true },
  },
}

equal(
  'a matching object validates',
  validate({ id: 1, name: 'Ada', role: 'admin', deleted: null }, userSchema).errors,
  [],
)
equal(
  'a missing required field is reported',
  validate({ id: 1 }, userSchema).errors,
  ['`name`: required, but missing'],
)
equal(
  'a wrong type is reported with both sides',
  validate({ id: '1', name: 'Ada' }, userSchema).errors,
  ['`id`: expected integer, got string ("1")'],
)
// A float is not an integer, which `typeof` alone would not catch.
equal(
  'a float is not an integer',
  validate({ id: 1.5, name: 'Ada' }, userSchema).errors,
  ['`id`: expected integer, got number (1.5)'],
)
equal(
  'a value outside an enum is reported',
  validate({ id: 1, name: 'Ada', role: 'root' }, userSchema).errors,
  ['`role`: "root" is not one of ["admin","user"]'],
)
equal(
  'a bad format is reported',
  validate({ id: 1, name: 'Ada', email: 'not-an-email' }, userSchema).errors,
  ['`email`: not a valid email'],
)
equal(
  'an over-long array is reported',
  validate({ id: 1, name: 'Ada', tags: ['a', 'b', 'c', 'd'] }, userSchema).errors,
  ['`tags`: has 4 items, allows at most 3'],
)
check(
  'a null in a non-nullable field is caught',
  validate({ id: null, name: 'Ada' }, userSchema).errors[0]?.includes('got null'),
  JSON.stringify(validate({ id: null, name: 'Ada' }, userSchema).errors),
)

{
  const withRef = {
    type: 'object',
    properties: { user: { $ref: '#/components/schemas/User' } },
    components: { schemas: { User: userSchema } },
  }
  equal('a local $ref resolves', validate({ user: { id: 1, name: 'Ada' } }, withRef, withRef).errors, [])
}

// Silently skipping an unknown keyword would report "valid" for a document
// that was never really checked.
{
  const outcome = validate({ a: 1 }, { type: 'object', patternProperties: { '^a': { type: 'string' } } })
  equal('an unsupported keyword is reported, not ignored', outcome.unsupportedKeywords, ['patternProperties'])
}

{
  const cyclic = { $ref: '#/self' }
  cyclic.self = cyclic
  check(
    'a $ref cycle is stopped rather than hanging',
    validate({}, cyclic, cyclic).errors.some((e) => /nests too deeply/.test(e)),
    JSON.stringify(validate({}, cyclic, cyclic).errors),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- OpenAPI --')
/* ------------------------------------------------------------------ */

const SPEC = `openapi: 3.0.0
info:
  title: Orders API
  version: "1.0"
servers:
  - url: https://api.example.com/v1
paths:
  /users:
    get:
      summary: List users
      parameters:
        - name: limit
          in: query
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/User" }
    post:
      summary: Create a user
      security:
        - bearerAuth: []
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/User" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/User" }
  /users/{id}:
    get:
      summary: Read one user
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/User" }
              example: { id: 42, name: "Ada" }
components:
  schemas:
    User:
      type: object
      required: [id, name]
      properties:
        id: { type: integer }
        name: { type: string }
`

const specFile = path.join(workspace, 'openapi.yaml')
await fs.writeFile(specFile, SPEC)

{
  const imported = await importSpec(specFile)
  check('a YAML spec imports', !imported.error, imported.error)
  equal('every operation becomes a request', imported.operations, 3)
  equal('the server becomes the base variable', imported.servers, ['https://api.example.com/v1'])
  check('the base is written out', imported.source.includes('@base = https://api.example.com/v1'), '')
  check('a path parameter becomes a variable', imported.source.includes('GET {{base}}/users/{{id}}'), imported.source)
  check('a required query parameter is included', imported.source.includes('/users?limit='), imported.source)
  check('a secured operation gets an auth directive', imported.source.includes('# @auth bearer'), '')
  check('a status assertion is generated', imported.source.includes("nova.expect(nova.response.status).toBe(201)"), '')

  // The generated file has to be valid input to the parser it was written for.
  const reparsed = parseHttpFile(imported.source)
  equal('the generated file parses cleanly', reparsed.errors, [])
  equal('and yields the same number of requests', reparsed.requests.length, 3)
}

{
  const spec = await loadSpec(specFile)
  equal(
    'a conforming body passes the contract',
    checkContract(spec, 'get', 'https://x/users/42', 200, '{"id":1,"name":"Ada"}', 'application/json').errors,
    [],
  )
  equal(
    'a contract violation is reported',
    checkContract(spec, 'get', 'https://x/users/42', 200, '{"id":"nope"}', 'application/json').errors,
    ['`name`: required, but missing', '`id`: expected integer, got string ("nope")'],
  )
  check(
    'a templated route is matched for a concrete url',
    checkContract(spec, 'get', 'https://x/users/99', 200, '{"id":1,"name":"A"}', 'application/json').errors.length === 0,
    '',
  )
  check(
    'an undeclared status is reported',
    /does not declare a 500/.test(
      checkContract(spec, 'get', 'https://x/users/42', 500, '{}', 'application/json').errors[0] ?? '',
    ),
    '',
  )
  check(
    'an unknown path is noted rather than failed',
    Boolean(checkContract(spec, 'get', 'https://x/nope', 200, '{}', 'application/json').note),
    '',
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- the mock server --')
/* ------------------------------------------------------------------ */

{
  const mock = new MockServer()
  const status = await mock.start(specFile)
  check('the mock starts', status.running && status.port > 0, JSON.stringify(status))

  const one = await fetch(`${status.url}/users/42`).then((r) => r.json())
  equal('a declared example is served verbatim', one, { id: 42, name: 'Ada' })

  const list = await fetch(`${status.url}/users`)
  equal('a schema without an example is fabricated', await list.json(), [{ id: 1, name: 'string' }])

  const created = await fetch(`${status.url}/users`, { method: 'POST', body: '{}' })
  equal('the first success status is used', created.status, 201)

  const missing = await fetch(`${status.url}/nope`)
  equal('an unknown path is a 404', missing.status, 404)

  // A mock that can only ever return 200 cannot exercise an error path.
  const forced = await fetch(`${status.url}/users/42?__status=200`)
  equal('a status can be asked for', forced.status, 200)

  const stopped = await mock.stop()
  check('the mock stops', !stopped.running, JSON.stringify(stopped))
}

/* ------------------------------------------------------------------ */
console.log('\n-- contract checking inside a run --')
/* ------------------------------------------------------------------ */

// A spec that claims /echo returns a User. The route really returns the echo
// object, so the contract must fail even though the status is a good 200 —
// which is the entire reason to check a body against a schema.
await fs.writeFile(
  path.join(workspace, 'echo-spec.yaml'),
  `openapi: 3.0.0
info: { title: Echo, version: "1.0" }
paths:
  /echo:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id: { type: integer }
                  name: { type: string }
`,
)

{
  const result = await runSource(
    'contract.http',
    `### Echo, checked against a contract it does not match
# @spec ./echo-spec.yaml
GET {{base}}/echo

> {% nova.test('status ok', () => nova.expect(nova.response.status).toBe(200)) %}
`,
  )
  const step = result.steps[0]
  check('a 200 can still fail its contract', result.failed > 0, JSON.stringify(step.tests))
  check('the violation names the missing fields', (step.contract ?? []).join(' ').includes('required, but missing'), JSON.stringify(step.contract))
  check('the status assertion still passed', step.tests.some((t) => t.passed), '')
}

{
  // A conforming response must not be flagged, or the check is noise.
  const result = await runSource(
    'contract-ok.http',
    `### A body that does match
# @spec ./echo-spec.yaml
GET {{base}}/nope
`,
  )
  check('a path the spec does not cover is not failed', result.failed === 0, JSON.stringify(result.steps[0].contract))
}

await server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
