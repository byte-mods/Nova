/**
 * API test automation, driven through the running IDE.
 *
 * The offline suite proves the runner; this proves it reaches the panel — the
 * run handler, the per-step broadcast, the mock controls and the results view.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'
import { startApiServer } from './stubs/api-server.mjs'

const PROJECT = path.join(TMP, 'apitest-demo')

const cdp = await connect()
const server = await startApiServer()

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(PROJECT, { recursive: true })

const file = path.join(PROJECT, 'suite.http')
await fs.writeFile(
  file,
  `@base = ${server.base}

### Get a token
POST {{base}}/token

grant_type=client_credentials

> {%
  nova.vars.set('token', nova.response.json().access_token)
  nova.test('a token came back', () => nova.expect(nova.vars.get('token')).toBeTruthy())
%}

### Use the token
GET {{base}}/echo
Authorization: Bearer {{token}}

> {%
  nova.test('status is 200', () => nova.expect(nova.response.status).toBe(200))
  nova.test('the token was sent', () =>
    nova.expect(nova.response.json().headers.authorization).toMatch(/^Bearer tok-/))
%}

### One that fails on purpose
GET {{base}}/echo

> {%
  nova.test('deliberately wrong', () => nova.expect(nova.response.status).toBe(500))
%}

### Per row
# @data ./cases.csv
POST {{base}}/echo

{ "name": "{{name}}" }

> {%
  nova.test('the row reached the body', () =>
    nova.expect(nova.response.json().body).toContain(nova.env.get('name')))
%}
`,
)
await fs.writeFile(path.join(PROJECT, 'cases.csv'), 'name\nada\ngrace\n')

await fs.writeFile(
  path.join(PROJECT, 'openapi.yaml'),
  `openapi: 3.0.0
info: { title: Demo, version: "1.0" }
paths:
  /widgets:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              example: [{ id: 1, name: "Widget" }]
`,
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

/* ------------------------------------------------------------------ */
console.log('\n-- running a suite over the bridge --')
/* ------------------------------------------------------------------ */

{
  const result = await cdp.evaluate(`
    const steps = []
    const off = window.nova.http.onRunStep((e) => steps.push(e.step))
    const run = await window.nova.http.run(${JSON.stringify(file)}, null)
    off()
    return { run, streamed: steps.length }
  `)

  check('the run completes', !result.run.error, result.run.error)
  check(
    'assertions are counted',
    result.run.passed === 5 && result.run.failed === 1,
    `${result.run.passed} passed, ${result.run.failed} failed`,
  )
  check(
    'chaining carried the captured token',
    Boolean(result.run.variables.token),
    JSON.stringify(result.run.variables),
  )
  check(
    'the data file produced one step per row',
    result.run.steps.filter((s) => s.dataRow !== undefined).length === 2,
    JSON.stringify(result.run.steps.map((s) => s.dataRow)),
  )
  // Without the per-step broadcast a long suite is a blank panel until it ends.
  check(
    'steps were streamed as they finished',
    result.streamed === result.run.steps.length,
    `${result.streamed} streamed vs ${result.run.steps.length} steps`,
  )

  const failing = result.run.steps.find((s) => s.tests.some((t) => !t.passed))
  check(
    'a failure carries both sides of the assertion',
    failing?.tests.find((t) => !t.passed)?.message === 'expected 500, got 200',
    JSON.stringify(failing?.tests),
  )
}

{
  const single = await cdp.evaluate(`
    return await window.nova.http.run(${JSON.stringify(file)}, null, { only: 'req-1' })
  `)
  // Run alone, the second request has no token — which is the honest result,
  // and exactly why the run scope matters.
  check('one request can be run on its own', single.steps.length === 1, JSON.stringify(single.steps.length))
}

/* ------------------------------------------------------------------ */
console.log('\n-- the results panel --')
/* ------------------------------------------------------------------ */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(file)})
  return true
`)
await cdp.sleep(1200)
await cdp.clickText('button', 'Requests', { settle: 800 }).catch(() => {})
await cdp.sleep(500)

{
  const clicked = await cdp.clickText('.http-toolbar button', 'Run all', { settle: 600 })
  check('the Run all action is present', clicked, 'button not found')
  await cdp.waitFor(`document.querySelectorAll('.http-run-step').length > 0`, {
    label: 'run steps',
    timeout: 20000,
  })

  const panel = await cdp.evaluate(`
    const steps = [...document.querySelectorAll('.http-run-step')]
    return {
      steps: steps.length,
      passing: document.querySelectorAll('.http-run-test.ok').length,
      failing: document.querySelectorAll('.http-run-test.bad').length,
      head: document.querySelector('.http-response-head strong')?.textContent ?? '',
      why: document.querySelector('.http-run-why')?.textContent ?? '',
    }
  `)

  check('every step is rendered', panel.steps === 5, JSON.stringify(panel))
  check('passes and failures are distinguished', panel.passing === 5 && panel.failing === 1, JSON.stringify(panel))
  check('the header summarises the run', /5 passed, 1 failed/.test(panel.head), panel.head)
  check('the failure reason is shown', panel.why === 'expected 500, got 200', panel.why)
}

/* ------------------------------------------------------------------ */
console.log('\n-- OpenAPI and the mock --')
/* ------------------------------------------------------------------ */

{
  const imported = await cdp.evaluate(`
    return await window.nova.http.importOpenapi(${JSON.stringify(path.join(PROJECT, 'openapi.yaml'))})
  `)
  check('a spec imports through the bridge', !imported.error && imported.operations === 1, imported.error)
  check('the generated source is a request file', imported.source.includes('GET {{base}}/widgets'), imported.source)
}

{
  const status = await cdp.evaluate(`
    return await window.nova.http.mockStart(${JSON.stringify(path.join(PROJECT, 'openapi.yaml'))})
  `)
  check('the mock starts from the renderer', status.running && status.port > 0, JSON.stringify(status))

  const served = await fetch(`${status.url}/widgets`).then((r) => r.json())
  check('it serves the spec example', JSON.stringify(served) === '[{"id":1,"name":"Widget"}]', JSON.stringify(served))

  const stopped = await cdp.evaluate(`return await window.nova.http.mockStop()`)
  check('and stops again', !stopped.running, JSON.stringify(stopped))
}

await server.close()
console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
