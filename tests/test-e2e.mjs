import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'

/**
 * The UI-testing tools, in the parts that do not need a browser: locator
 * ranking, Playwright codegen, E2E framework detection, and the image diff.
 *
 * The selector engine itself runs inside a page and is covered by
 * `verify-e2e.mjs` against a real DOM — a jsdom stand-in would agree with the
 * implementation about the things most likely to be wrong.
 */
const { bestLocator, LOCATOR_RANK, parseMessage, CHANNEL } = await import(
  pathToFileURL(`${BUILD}/e2eRecorder.js`).href
)
const { toPlaywright, tidy, locate } = await import(pathToFileURL(`${BUILD}/e2eCodegen.js`).href)
const { detectFrameworks, FRAMEWORKS } = await import(pathToFileURL(`${BUILD}/testFrameworks.js`).href)
const { decodePng, encodePng, diffImages, compareToBaseline } = await import(
  pathToFileURL(`${BUILD}/visualDiff.js`).href
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

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, `expected ${b}\n        got      ${a}`)
}

const workspace = path.join(TMP, 'e2e-tools')
await fs.rm(workspace, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })

/* ------------------------------------------------------------------ */
console.log('\n-- choosing a locator --')
/* ------------------------------------------------------------------ */

const L = (kind, value, unique = true, name) => ({ kind, value, name, unique })

equal(
  'a test id beats everything else',
  bestLocator([L('css', 'div > button'), L('testid', 'submit'), L('role', 'button', true, 'Save')]).kind,
  'testid',
)
equal(
  'a role with a name beats a css path',
  bestLocator([L('css', 'div > button'), L('role', 'button', true, 'Save')]).kind,
  'role',
)

// The point of the ranking: durability, not strength on paper. A role that
// matched four buttons is a coin toss at replay time.
equal(
  'a unique weak locator beats an ambiguous strong one',
  bestLocator([L('role', 'button', false, 'Save'), L('css', '#app > button:nth-of-type(2)', true)]).kind,
  'css',
)
equal(
  'when nothing is unique the most durable is still chosen',
  bestLocator([L('css', 'button', false), L('testid', 'submit', false)]).kind,
  'testid',
)
check('an element with no candidates yields nothing', bestLocator([]) === null)

{
  const chosen = bestLocator([L('testid', 'submit'), L('role', 'button', true, 'Save'), L('css', 'button')])
  equal('the runners-up are offered as alternatives', chosen.alternatives.map((a) => a.kind), ['role', 'css'])
}

// A role only earns its place when it has a name to match on.
equal(
  'a nameless role loses to a label',
  bestLocator([L('role', 'checkbox'), L('label', 'Remember me')]).kind,
  'label',
)
equal(
  'a named role still wins',
  bestLocator([L('role', 'checkbox', true, 'Remember me'), L('label', 'Remember me')]).kind,
  'role',
)
equal(
  'a nameless role still beats a css path',
  bestLocator([L('role', 'checkbox'), L('css', 'form > input:nth-of-type(3)')]).kind,
  'role',
)

equal('the ranking is durability order', LOCATOR_RANK, [
  'testid', 'role', 'label', 'placeholder', 'text', 'id', 'css',
])

/* ------------------------------------------------------------------ */
console.log('\n-- the recorder channel --')
/* ------------------------------------------------------------------ */

equal(
  'a recorder message is read out of a console line',
  parseMessage(`${CHANNEL}{"type":"click"}`),
  { type: 'click' },
)
check('a line from the page itself is ignored', parseMessage('hello from the app') === null)
check('a malformed message is ignored rather than thrown', parseMessage(`${CHANNEL}{oops`) === null)
// A page that logs the prefix mid-line must still be readable.
equal(
  'the payload is found even with text before it',
  parseMessage(`[log] ${CHANNEL}{"type":"press","key":"Enter"}`),
  { type: 'press', key: 'Enter' },
)

/* ------------------------------------------------------------------ */
console.log('\n-- generating a test --')
/* ------------------------------------------------------------------ */

equal('a test id renders as getByTestId', locate(L('testid', 'submit')), "page.getByTestId('submit')")
equal(
  'a role renders with its accessible name',
  locate(L('role', 'button', true, 'Save changes')),
  "page.getByRole('button', { name: 'Save changes' })",
)
// Strict mode would throw at replay; picking the first is what the user did.
equal(
  'an ambiguous locator gets .first()',
  locate(L('role', 'button', false, 'Save')),
  "page.getByRole('button', { name: 'Save' }).first()",
)
equal("an apostrophe in a name is escaped", locate(L('text', "It's here")), "page.getByText('It\\'s here')")

{
  const script = toPlaywright(
    [
      { type: 'navigate', url: 'http://localhost:3000/login', at: 1 },
      { type: 'fill', locator: L('label', 'Email'), value: 'ada@example.com', at: 2 },
      { type: 'fill', locator: L('label', 'Password'), value: 'hunter2', at: 3 },
      { type: 'click', locator: L('role', 'button', true, 'Sign in'), at: 4 },
      { type: 'expectUrl', url: 'http://localhost:3000/dashboard', at: 5 },
      { type: 'expectVisible', locator: L('testid', 'welcome'), at: 6 },
    ],
    { title: 'signs in', baseUrl: 'http://localhost:3000' },
  )

  check('the script imports what it uses', script.includes("import { test, expect } from '@playwright/test'"), script)
  check('the title is used', script.includes("test('signs in'"), script)
  // A test pinned to the host it was recorded on cannot run anywhere else.
  check('the base url is factored out of navigations', script.includes("page.goto('/login')"), script)
  check('a fill renders', script.includes("page.getByLabel('Email').fill('ada@example.com')"), script)
  check('an assertion renders', script.includes("await expect(page).toHaveURL("), script)
  check('every step is awaited', script.split('\n').filter((l) => l.trim().startsWith('page.')).length === 0, script)
}

equal(
  'an empty recording still produces a runnable file',
  toPlaywright([]).includes('Nothing was recorded.'),
  true,
)

/* ------------------------------------------------------------------ */
console.log('\n-- tidying a raw recording --')
/* ------------------------------------------------------------------ */

{
  // A raw capture is a transcript: every keystroke is its own fill, and the
  // click that focused the field is in front of them.
  const raw = [
    { type: 'navigate', url: 'http://a/', at: 1 },
    { type: 'navigate', url: 'http://a/login', at: 2 },
    { type: 'click', locator: L('label', 'Email'), at: 3 },
    { type: 'fill', locator: L('label', 'Email'), value: 'a', at: 4 },
    { type: 'fill', locator: L('label', 'Email'), value: 'ad', at: 5 },
    { type: 'fill', locator: L('label', 'Email'), value: 'ada', at: 6 },
    { type: 'click', locator: L('role', 'button', true, 'Sign in'), at: 7 },
  ]
  const tidied = tidy(raw)
  equal('the transcript collapses to what a person would write', tidied.map((a) => a.type), [
    'navigate',
    'fill',
    'click',
  ])
  equal('the final typed value is kept', tidied[1].value, 'ada')
  equal('the last navigation wins', tidied[0].url, 'http://a/login')
}

{
  // A click on one thing then a fill of another is two real steps.
  const kept = tidy([
    { type: 'click', locator: L('role', 'button', true, 'Edit'), at: 1 },
    { type: 'fill', locator: L('label', 'Name'), value: 'Ada', at: 2 },
  ])
  equal('an unrelated click is not swallowed', kept.map((a) => a.type), ['click', 'fill'])
}

/* ------------------------------------------------------------------ */
console.log('\n-- E2E frameworks --')
/* ------------------------------------------------------------------ */

const ctx = (packageJson, files = []) => ({
  root: '/p',
  rootFiles: new Set(files),
  packageJson,
  relative: (f) => f.replace('/p/', ''),
})

check(
  'playwright is detected from its dependency',
  detectFrameworks(ctx({ devDependencies: { '@playwright/test': '^1.0.0' } })).some((f) => f.id === 'playwright'),
)
check(
  'playwright is detected from its config alone',
  detectFrameworks(ctx(null, ['playwright.config.ts'])).some((f) => f.id === 'playwright'),
)
check(
  'cypress is detected',
  detectFrameworks(ctx({ devDependencies: { cypress: '^13.0.0' } })).some((f) => f.id === 'cypress'),
)
check(
  'a project with neither offers neither',
  !detectFrameworks(ctx({ devDependencies: { vitest: '^1.0.0' } })).some((f) =>
    ['playwright', 'cypress'].includes(f.id),
  ),
)

{
  const playwright = FRAMEWORKS.find((f) => f.id === 'playwright')
  equal(
    'a rerun of several tests becomes one filtered run',
    playwright.command({ kind: 'names', names: ['signs in', 'signs out (fast)'] }, ctx(null)).args.slice(-2),
    ['-g', 'signs in|signs out \\(fast\\)'],
  )

  // Playwright nests project, file and describe blocks arbitrarily deep, so a
  // reader that assumed two levels would silently find nothing.
  const report = JSON.stringify({
    suites: [
      {
        title: 'chromium',
        suites: [
          {
            title: 'login.spec.ts',
            suites: [
              {
                title: 'as a new user',
                specs: [
                  { title: 'signs in', ok: true, tests: [{ results: [{ status: 'passed', duration: 120 }] }] },
                  {
                    title: 'shows an error',
                    ok: false,
                    tests: [{ results: [{ status: 'failed', duration: 90, error: { message: 'boom' } }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  const events = playwright.parseFinal(report)
  equal('a deeply nested report is flattened', events.map((e) => e.name), ['signs in', 'shows an error'])
  equal('the suite chain is preserved', events[0].suite, 'chromium › login.spec.ts › as a new user')
  equal('statuses come through', events.map((e) => e.status), ['pass', 'fail'])
  equal('a failure carries its message', events[1].message, 'boom')
}

{
  const cypress = FRAMEWORKS.find((f) => f.id === 'cypress')
  const events = cypress.parseFinal(
    JSON.stringify({
      passes: [{ title: 'loads', fullTitle: 'Home loads', duration: 30 }],
      failures: [{ title: 'submits', fullTitle: 'Form submits', duration: 40, err: { message: 'nope' } }],
      pending: [{ title: 'later', fullTitle: 'Home later' }],
    }),
  )
  equal('every mocha bucket is read', events.map((e) => e.status), ['pass', 'fail', 'skip'])
  equal('the suite is recovered from the full title', events[0].suite, 'Home')
  equal('a failure carries its message', events[1].message, 'nope')
}

/* ------------------------------------------------------------------ */
console.log('\n-- visual regression --')
/* ------------------------------------------------------------------ */

/** A solid image, so a known number of pixels can be changed by hand. */
function solid(width, height, [r, g, b]) {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return { width, height, data }
}

{
  const image = solid(20, 10, [10, 120, 200])
  const round = await decodePng(await encodePng(image))
  equal('a PNG survives a round trip', [round.width, round.height], [20, 10])
  check('every pixel survives', round.data.equals(image.data))
}

{
  const before = solid(10, 10, [255, 255, 255])
  const after = solid(10, 10, [255, 255, 255])
  // Three pixels turned black.
  for (let i = 0; i < 3; i++) {
    after.data[i * 4] = 0
    after.data[i * 4 + 1] = 0
    after.data[i * 4 + 2] = 0
  }
  const { changed, diff } = diffImages(before, after)
  equal('only the changed pixels are counted', changed, 3)
  equal('the diff is the size of the images', [diff.width, diff.height], [10, 10])
  equal('a changed pixel is marked in magenta', [diff.data[0], diff.data[1], diff.data[2]], [255, 0, 255])
}

{
  // Sub-threshold noise is what a font renderer does between runs; counting it
  // would make every baseline fail for no reason a reviewer could see.
  const before = solid(10, 10, [200, 200, 200])
  const after = solid(10, 10, [206, 206, 206])
  equal('rendering noise is not a change', diffImages(before, after).changed, 0)
}

{
  const baselineDir = path.join(workspace, 'shots')
  const png = await encodePng(solid(8, 8, [255, 255, 255]))

  const first = await compareToBaseline('home', png, baselineDir)
  check('the first run creates a baseline', first.created && first.matched, JSON.stringify(first))

  const second = await compareToBaseline('home', png, baselineDir)
  check('an unchanged page matches', !second.created && second.matched, JSON.stringify(second))

  const changed = solid(8, 8, [255, 255, 255])
  for (let i = 0; i < 20; i++) changed.data[i * 4] = 0
  const third = await compareToBaseline('home', await encodePng(changed), baselineDir)
  check('a changed page fails', !third.matched, JSON.stringify(third))
  equal('the changed pixels are counted', third.changedPixels, 20)
  check('a diff image is written', Boolean(third.diffFile), JSON.stringify(third))

  const resized = await compareToBaseline('home', await encodePng(solid(9, 8, [255, 255, 255])), baselineDir)
  check(
    'a resized page is reported as such rather than diffed',
    /9×8/.test(resized.error ?? ''),
    resized.error,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
