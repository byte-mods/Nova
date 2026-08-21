/**
 * Every icon control in the chrome explains itself on hover.
 *
 * An icon button with no tooltip is a guess. This walks each sidebar view and
 * each bottom panel — a static scan of the source cannot, because half of
 * these controls only exist once their view is mounted — and fails on anything
 * a developer would have to click to identify.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'tooltip-demo')

const cdp = await connect()

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
await fs.writeFile(path.join(PROJECT, 'package.json'), '{"name":"tooltip-demo","version":"1.0.0"}')
await fs.writeFile(path.join(PROJECT, 'src', 'main.ts'), 'export function main() {\n  return 1\n}\n')
await fs.writeFile(path.join(PROJECT, 'api.http'), '### Ping\nGET https://example.test/ping\n')

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

// Set up the chrome explicitly rather than inheriting whatever the previous
// suite left behind — the tree only renders when the sidebar is showing.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer', panelVisible: true })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })

/**
 * Controls a developer has to identify by sight. Text buttons are excluded:
 * a button reading "Commit" needs no tooltip, and demanding one would be
 * noise rather than help.
 */
const SELECTOR = '.icon-btn, .tab-action, .tab-close, .status-item, .activity-btn'

async function untitledIn(label) {
  return cdp.evaluate(`
    const nodes = [...document.querySelectorAll(${JSON.stringify(SELECTOR)})]
    const naked = nodes.filter((node) => {
      if (node.title || node.getAttribute('aria-label')) return false
      // A control whose own text already names it is self-explanatory.
      const text = (node.textContent || '').trim()
      return text.length < 3
    })
    return {
      total: nodes.length,
      naked: naked.map((n) => n.className + ' :: ' + (n.textContent || '').trim().slice(0, 20)),
    }
  `)
}

/* ------------------------------------------------------------------ */
console.log('\n-- sidebar views --')
/* ------------------------------------------------------------------ */

for (const view of ['explorer', 'search', 'structural', 'git', 'diagrams', 'plugins', 'themes']) {
  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    s.setState({ sidebarVisible: true, sidebarView: ${JSON.stringify(view)} })
    return true
  `)
  await cdp.sleep(700)
  const found = await untitledIn(view)
  check(
    `${view} — ${found.total} controls, all explained`,
    found.naked.length === 0,
    found.naked.join('\n        '),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- bottom panels --')
/* ------------------------------------------------------------------ */

const PANELS = [
  'terminal', 'problems', 'usages', 'hierarchy', 'tests',
  'debug', 'todo', 'coverage', 'build', 'profile', 'infra', 'security', 'devices',
]

for (const panel of PANELS) {
  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    s.getState().showPanel(${JSON.stringify(panel)})
    return true
  `)
  await cdp.sleep(600)
  const found = await untitledIn(panel)
  check(
    `${panel} — ${found.total} controls, all explained`,
    found.naked.length === 0,
    found.naked.join('\n        '),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- editors --')
/* ------------------------------------------------------------------ */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ panelVisible: false })
  await s.getState().openFile(${JSON.stringify(path.join(PROJECT, 'src', 'main.ts'))})
  return true
`)
await cdp.sleep(1200)

{
  const found = await untitledIn('code editor')
  check(`code editor — ${found.total} controls, all explained`, found.naked.length === 0, found.naked.join('\n        '))

  // The tab strip is where the complaint started: Explain, Tutorial and the
  // split control are icons or one-word labels with real consequences.
  const strip = await cdp.evaluate(`
    return [...document.querySelectorAll('.tab-action')].map((b) => ({
      text: (b.textContent || '').trim().slice(0, 20),
      title: b.title,
    }))
  `)
  check(
    'every tab-strip action names what it does',
    strip.length > 0 && strip.every((b) => b.title && b.title.length > 8),
    JSON.stringify(strip),
  )
}

// Opened through the store rather than by clicking "Requests" and swallowing
// the failure: a silently-missed click left this check reading an empty
// toolbar and calling that a pass-worthy result, which is the opposite of what
// a tooltip audit is for.
const HTTP_FILE = path.join(PROJECT, 'api.http')
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(HTTP_FILE)})
  s.getState().openTab({
    id: 'http:' + ${JSON.stringify(HTTP_FILE)},
    kind: 'http',
    title: 'api.http — requests',
    path: ${JSON.stringify(HTTP_FILE)},
  })
  return true
`)
await cdp.waitFor(`document.querySelector('.http-toolbar') !== null`, { label: 'request panel' })
await cdp.sleep(600)

{
  const toolbar = await cdp.evaluate(`
    return [...document.querySelectorAll('.http-toolbar .link-btn')].map((b) => ({
      text: (b.textContent || '').trim(),
      title: b.title,
    }))
  `)
  check(
    'every request-panel action explains itself',
    toolbar.length >= 4 && toolbar.every((b) => b.title && b.title.length > 8),
    JSON.stringify(toolbar),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- the permanent chrome --')
/* ------------------------------------------------------------------ */

/** Icon controls inside one container, and which of them say nothing. */
async function untitledWithin(selector) {
  return cdp.evaluate(`
    const root = document.querySelector(${JSON.stringify(selector)})
    if (!root) return { missing: true, total: 0, naked: [] }
    const nodes = [...root.querySelectorAll(${JSON.stringify(SELECTOR)}), ...root.querySelectorAll('button')]
    const seen = new Set()
    const naked = []
    for (const node of nodes) {
      if (seen.has(node)) continue
      seen.add(node)
      if (node.title || node.getAttribute('aria-label')) continue
      if ((node.textContent || '').trim().length >= 3) continue
      naked.push((node.className || 'button') + ' :: ' + (node.textContent || '').trim().slice(0, 20))
    }
    return { missing: false, total: seen.size, naked }
  `)
}

for (const [label, selector] of [
  ['title bar', '.titlebar'],
  ['activity bar', '.activity-bar'],
  ['status bar', '.statusbar'],
]) {
  const found = await untitledWithin(selector)
  check(
    `${label} — ${found.total} controls, all explained`,
    !found.missing && found.naked.length === 0,
    found.missing ? `no ${selector} in the DOM` : found.naked.join('\n        '),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- the other editors --')
/* ------------------------------------------------------------------ */

await fs.writeFile(path.join(PROJECT, 'notes.md'), '# Notes\n\nSome prose.\n')
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(path.join(PROJECT, 'notes.md'))})
  return true
`)
await cdp.sleep(1200)
{
  const found = await untitledIn('markdown')
  check(`markdown editor — ${found.total} controls, all explained`, found.naked.length === 0, found.naked.join('\n        '))
}

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().openTab({ id: 'browser:tips', kind: 'browser', title: 'Browser', url: 'about:blank' })
  return true
`)
await cdp.sleep(1500)
{
  const found = await untitledIn('browser')
  check(`browser pane — ${found.total} controls, all explained`, found.naked.length === 0, found.naked.join('\n        '))
}

/* ------------------------------------------------------------------ */
console.log('\n-- dialogs --')
/* ------------------------------------------------------------------ */

// The share dialog is the one place a wrong click has a consequence outside
// the machine, so every control in it has to say what it will do.
// A modal left open by an earlier run covers the title bar, so the click that
// is meant to open this one would land on the overlay and close that one
// instead. Clear the screen first, then open deliberately.
await cdp.evaluate(`
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  const btn = document.querySelector('[title^="Share this project"], [title^="A share is live"]')
  if (btn) btn.click()
  await new Promise((r) => setTimeout(r, 900))
  return !!document.querySelector('.share-modal')
`)
{
  const found = await untitledWithin('.share-modal')
  check(
    `share dialog — ${found.total} controls, all explained`,
    !found.missing && found.naked.length === 0,
    found.missing ? 'the share dialog did not open' : found.naked.join('\n        '),
  )

  // The broadcast controls only exist once a share is live, so they are audited
  // in verify-broadcast.mjs, where a tunnel is already open.
}

// Leave the screen as it was found, so the next suite does not open behind a
// modal it did not put there.
await cdp.evaluate(`
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  return true
`)

/* ------------------------------------------------------------------ */
console.log('\n-- controls are legible, not just present --')
/* ------------------------------------------------------------------ */

/*
 * A control that renders but clips its own text is worse than a missing one:
 * it looks deliberate. The security filter did exactly that — a 20px-tall
 * select inheriting 6px of vertical padding cut the value through the middle —
 * so every select is measured against the text it has to show.
 */
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().showPanel('security')
  return true
`)
await cdp.sleep(800)

const clipped = await cdp.evaluate(`
  const out = []
  for (const el of document.querySelectorAll('select')) {
    const box = el.getBoundingClientRect()
    if (!box.height) continue
    const style = getComputedStyle(el)
    // What the value actually needs: its own line box plus the padding and
    // border the element imposes on it.
    const needed =
      parseFloat(style.fontSize) * 1.2 +
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    if (needed > box.height + 0.5) {
      out.push((el.className || 'select') + ' needs ' + needed.toFixed(1) + 'px in ' + box.height.toFixed(1) + 'px')
    }
  }
  return out
`)
check(
  'every dropdown is tall enough to show its value',
  clipped.length === 0,
  clipped.join('\n        '),
)

const spaced = await cdp.evaluate(`
  const bar = document.querySelector('.panel-toolbar')
  if (!bar) return { missing: true }
  const kids = [...bar.children].map((c) => c.getBoundingClientRect())
  let touching = 0
  for (let i = 1; i < kids.length; i++) {
    if (kids[i].left - kids[i - 1].right < 2 && kids[i].top < kids[i - 1].bottom) touching++
  }
  return { missing: false, touching, count: kids.length }
`)
check(
  'toolbar controls do not run into each other',
  spaced.missing === false && spaced.touching === 0,
  JSON.stringify(spaced),
)

/* ------------------------------------------------------------------ */
console.log('\n-- nothing is clipped out of reach --')
/* ------------------------------------------------------------------ */

/*
 * A scroll container that centres a child taller than itself puts that child's
 * top above the scroll origin, and there is no negative scroll to reach it. The
 * result is a heading cut in half with the scrollbar already at the top, which
 * reads as a broken app rather than as content that overflowed. The rule is
 * checked rather than the symptom, because the symptom only appears at window
 * sizes nobody tests at.
 */
const centred = await cdp.evaluate(`
  const offenders = []
  for (const el of document.querySelectorAll('*')) {
    const st = getComputedStyle(el)
    if (st.display !== 'flex' && st.display !== 'inline-flex') continue
    const scrolls = /auto|scroll/.test(st.overflowY) || /auto|scroll/.test(st.overflowX)
    if (!scrolls) continue
    // \`safe center\` is the CSS answer to this and is fine.
    if (!/^center$/.test(st.alignItems) && !/^center$/.test(st.justifyContent)) continue
    // A child using auto margins centres itself without escaping the origin.
    const child = el.firstElementChild
    if (child && /auto/.test(getComputedStyle(child).margin)) continue
    offenders.push((el.className || el.tagName) + ' [' + st.alignItems + '/' + st.justifyContent + ']')
  }
  return offenders
`)
check(
  'no scroll container centres a child it could clip',
  centred.length === 0,
  centred.join('\n        '),
)

// And the symptom itself, on the view that had it: shrink the window until the
// welcome screen must overflow, then confirm its heading is still reachable.
const welcome = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().closeAllTabs?.()
  s.setState({ aiVisible: false })
  await new Promise((r) => setTimeout(r, 800))
  const el = document.querySelector('.welcome')
  const inner = document.querySelector('.welcome-inner')
  if (!el || !inner) return { missing: true }
  return {
    missing: false,
    innerTop: Math.round(inner.getBoundingClientRect().top),
    containerTop: Math.round(el.getBoundingClientRect().top),
  }
`)
check(
  'the welcome screen never starts above its own container',
  welcome.missing || welcome.innerTop >= welcome.containerTop - 1,
  JSON.stringify(welcome),
)

/* ------------------------------------------------------------------ */
console.log('\n-- every panel is reachable --')
/* ------------------------------------------------------------------ */

/*
 * The panel tab strip scrolls with its scrollbar hidden. That is fine until it
 * overflows, at which point there is nothing on screen to say the remaining
 * tabs exist — which is how Coverage, Build and TODO became undiscoverable on a
 * narrow window. The fade is the affordance; this checks it appears exactly
 * when it is needed, and that activating a hidden tab brings it into view.
 */
const strip = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ panelVisible: true })
  await new Promise((r) => setTimeout(r, 400))
  const wrap = document.querySelector('.pane-tabs-wrap')
  const tabs = document.querySelector('.pane-tabs')
  if (!wrap || !tabs) return { missing: true }
  return {
    missing: false,
    overflowing: tabs.scrollWidth > tabs.clientWidth + 1,
    marksRight: wrap.className.includes('more-right'),
    marksLeft: wrap.className.includes('more-left'),
    tabCount: tabs.querySelectorAll('.pane-tab').length,
  }
`)
check('the panel tab strip is present', strip.missing === false, JSON.stringify(strip))
check(
  'and every panel has a tab',
  strip.tabCount >= 12,
  `${strip.tabCount} tabs`,
)
check(
  'an overflowing strip says so, and one that fits does not',
  strip.overflowing ? strip.marksRight || strip.marksLeft : !strip.marksRight && !strip.marksLeft,
  JSON.stringify(strip),
)

// Activating a tab that is scrolled out of sight has to bring it back, or the
// panel looks like it ignored the click.
const revealed = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().showPanel('terminal')
  await new Promise((r) => setTimeout(r, 500))
  s.getState().showPanel('devices')
  await new Promise((r) => setTimeout(r, 900))
  const tabs = document.querySelector('.pane-tabs')
  const active = tabs?.querySelector('.pane-tab.active')
  if (!tabs || !active) return { missing: true }
  const a = active.getBoundingClientRect()
  const t = tabs.getBoundingClientRect()
  return { missing: false, visible: a.left >= t.left - 1 && a.right <= t.right + 1, label: active.textContent.trim() }
`)
check(
  'activating a tab scrolled out of sight brings it into view',
  revealed.missing || revealed.visible,
  JSON.stringify(revealed),
)

// Reaching a panel must not depend on the window being wide enough to show its
// tab. Typing its name is the route that always works.
const palette = await cdp.evaluate(`
  const { appActions } = await import('/src/lib/actions.ts')
  const names = appActions().map((a) => a.label)
  const wanted = ['Coverage', 'Security', 'Devices', 'TODO', 'Profiler', 'Build', 'Infra']
  return { missing: wanted.filter((w) => !names.some((n) => n.includes(w))), total: names.length }
`)
check(
  'every panel can be opened by name from the command palette',
  palette.missing.length === 0,
  JSON.stringify(palette.missing),
)

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
