/**
 * The recorder, against a real page in the browser pane.
 *
 * This is the half no offline test can reach: whether the injected script
 * attaches, whether its reports come back over the console channel, whether
 * the selector engine picks sensible locators from a real DOM, and whether the
 * saved file is a Playwright test someone could run.
 *
 * The page is driven through the webview's own `executeJavaScript`, because a
 * webview renders in its own WebContents and input dispatched at the host page
 * never reaches it.
 *
 * Start the app first:  bash tests/restart-app.sh
 *
 * The visual-regression checks capture the guest's compositor, which produces
 * no frames while the window is fully occluded — so leave the IDE window on
 * screen for the run, or those five checks time out rather than fail honestly.
 */
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'e2e-demo')

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" placeholder="you@example.com">

    <label for="password">Password</label>
    <input id="password" name="password" type="password">

    <label><input type="checkbox" id="remember"> Remember me</label>

    <select id="tenant">
      <option value="acme">Acme</option>
      <option value="globex">Globex</option>
    </select>

    <button type="button" data-testid="submit">Sign in</button>
    <button type="button" class="secondary">Cancel</button>
  </form>
  <p id="status">Not signed in</p>
</body></html>`

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(PAGE)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(PROJECT, { recursive: true })
await fs.writeFile(path.join(PROJECT, 'package.json'), '{"name":"e2e-demo","version":"1.0.0"}')

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

/** Runs code inside the page the browser pane is showing. */
const inPage = (code) =>
  cdp.evaluate(`
    const view = document.querySelector('webview')
    if (!view) return { error: 'no webview' }
    return await view.executeJavaScript(${JSON.stringify(code)})
  `)

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: false })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
// The sidebar is hidden here, so the tree is not a usable readiness signal.
await cdp.waitFor(
  `(await import('/src/state/store.ts')).useStore.getState().root !== ''`,
  { label: 'project open' },
)

// Opening a project clears the tab strip, so the browser tab has to come after
// it has settled rather than in the same call.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().openTab({ id: 'browser:e2e', kind: 'browser', title: 'Browser', url: ${JSON.stringify(origin)} })
  return true
`)
await cdp.waitFor(`document.querySelector('webview') !== null`, { label: 'browser pane' })
await cdp.sleep(2500)

check('the page loaded in the pane', (await inPage('document.title')) === 'Sign in')

/* ------------------------------------------------------------------ */
console.log('\n-- the picker --')
/* ------------------------------------------------------------------ */

{
  const clicked = await cdp.clickText('.browser-toolbar button', '', { settle: 300 }).catch(() => false)
  void clicked
  // Click the picker control by its tooltip, which is also what a user reads.
  await cdp.evaluate(`
    const btn = [...document.querySelectorAll('.browser-toolbar .icon-btn')]
      .find((b) => (b.title || '').startsWith('Point at an element'))
    btn?.click()
    return true
  `)
  await cdp.sleep(800)

  // A click in picker mode must inspect without acting.
  await inPage(`
    document.querySelector('[data-testid="submit"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    'ok'
  `)
  await cdp.sleep(600)

  const shown = await cdp.evaluate(`return document.querySelector('.browser-locator')?.textContent ?? ''`)
  check('the picker resolves a test id', shown.startsWith('testid: submit'), shown)

  await inPage(`
    document.querySelector('.secondary').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    'ok'
  `)
  await cdp.sleep(600)
  const second = await cdp.evaluate(`return document.querySelector('.browser-locator')?.textContent ?? ''`)
  // No test id on that one, so the accessible name is what identifies it.
  check('an element without a test id falls back to its role and name', second.startsWith('role: button "Cancel"'), second)
}

/* ------------------------------------------------------------------ */
console.log('\n-- recording --')
/* ------------------------------------------------------------------ */

await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.browser-toolbar .icon-btn')]
    .find((b) => (b.title || '').startsWith('Record what you do'))
  btn?.click()
  return true
`)
await cdp.waitFor(`document.querySelector('.browser-record-dot') !== null`, { label: 'recording' })

// Drive the page the way a user would: focus, type, change, click.
await inPage(`
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }))
  const email = document.getElementById('email')
  email.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  email.value = 'ada@example.com'
  fire(email, 'change')

  const password = document.getElementById('password')
  password.value = 'hunter2'
  fire(password, 'change')

  // No pre-setting: a click on a checkbox toggles it during pre-click
  // activation, so assigning .checked first would make this an uncheck.
  const remember = document.getElementById('remember')
  remember.dispatchEvent(new MouseEvent('click', { bubbles: true }))

  const tenant = document.getElementById('tenant')
  tenant.value = 'globex'
  fire(tenant, 'change')

  document.querySelector('[data-testid="submit"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  'ok'
`)
await cdp.sleep(1200)

{
  const strip = await cdp.evaluate(`return document.querySelector('.browser-record-bar')?.textContent ?? ''`)
  check('the strip counts the steps as they happen', /Recording — [1-9]/.test(strip), strip)
}

// Stop, then save.
await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.browser-toolbar .icon-btn')]
    .find((b) => (b.title || '').startsWith('Stop recording'))
  btn?.click()
  return true
`)
await cdp.sleep(500)

await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.browser-toolbar .icon-btn')]
    .find((b) => (b.title || '').startsWith('Save the recording'))
  btn?.click()
  return true
`)
await cdp.sleep(1800)

{
  const dir = path.join(PROJECT, 'e2e')
  const written = await fs.readdir(dir).catch(() => [])
  const spec = written.find((name) => name.endsWith('.spec.ts'))
  check('a spec file was written', Boolean(spec), written.join(', '))

  if (spec) {
    const source = await fs.readFile(path.join(dir, spec), 'utf8')
    console.log('\n' + source.split('\n').map((l) => `        ${l}`).join('\n'))

    check('it imports Playwright', source.includes("from '@playwright/test'"), '')
    check('the navigation is relative to the origin', source.includes("page.goto('/')"), '')
    check(
      'the email field is located by its label',
      source.includes("page.getByLabel('Email').fill('ada@example.com')"),
      '',
    )
    check('the checkbox renders as a check', source.includes('.check()'), '')
    check(
      'the checkbox is located by its label, not a bare role',
      source.includes("getByLabel('Remember me')"),
      '',
    )
    check("the select renders as selectOption", source.includes("selectOption('globex')"), '')
    check('the submit uses its test id', source.includes("page.getByTestId('submit').click()"), '')
    // The click that focused the email field must not survive tidying.
    check(
      'the focus click before typing was dropped',
      !source.includes("page.getByLabel('Email').click()"),
      '',
    )
    check('every step is awaited', !/^\s+page\./m.test(source), '')
  }
}

/* ------------------------------------------------------------------ */
console.log('\n-- visual regression --')
/* ------------------------------------------------------------------ */

// Saving the spec opened it in the editor, which hides the browser pane — and
// a hidden webview produces no frames to capture. Bring it back to the front.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().setActiveTab('browser:e2e')
  return true
`)
await cdp.waitFor(`document.querySelector('webview') !== null`, { label: 'browser pane again' })
await cdp.sleep(1500)

const clickCamera = () =>
  cdp.evaluate(`
    const btn = [...document.querySelectorAll('.browser-toolbar .icon-btn')]
      .find((b) => (b.title || '').startsWith('Compare this page'))
    btn?.click()
    return true
  `)

{
  await clickCamera()
  await cdp.sleep(2500)
  const first = await cdp.evaluate(`return document.querySelector('.browser-record-bar')?.textContent ?? ''`)
  check('the first capture becomes the baseline', first.includes('baseline captured'), first)

  const baselines = await fs.readdir(path.join(PROJECT, 'e2e', '__screenshots__')).catch(() => [])
  check('the baseline is stored in the project', baselines.some((f) => f.endsWith('.png')), baselines.join(', '))

  await clickCamera()
  await cdp.sleep(2500)
  const second = await cdp.evaluate(`return document.querySelector('.browser-record-bar')?.textContent ?? ''`)
  check('an unchanged page matches its baseline', second.includes('matches'), second)

  // Change the page substantially, then compare again.
  await inPage(`
    document.body.style.background = '#101010'
    document.getElementById('status').textContent = 'Signed in as Ada'
    'ok'
  `)
  await cdp.sleep(500)
  await clickCamera()
  await cdp.sleep(2500)
  const third = await cdp.evaluate(`return document.querySelector('.browser-record-bar')?.textContent ?? ''`)
  check('a changed page is reported with how much changed', /px changed/.test(third), third)

  const after = await fs.readdir(path.join(PROJECT, 'e2e', '__screenshots__')).catch(() => [])
  check('a diff image is written for review', after.some((f) => f.endsWith('.diff.png')), after.join(', '))
}

server.close()
console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
