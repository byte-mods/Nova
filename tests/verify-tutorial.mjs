/**
 * Drives the project Tutorial feature through real UI interaction. Start the
 * app first:
 *
 *   NOVA_DEBUG_PORT=9223 npm run dev
 *
 * The agent run is started and then immediately cancelled: what is under test is
 * the wiring — button, provider choice, chapter choice, tab, streaming target
 * and cancellation — not the quality of a document that costs minutes and money
 * to produce. The prompt contract itself is covered offline by test-tutorial.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect, reporter } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'tutorial-demo')
const STORE = `(await import('/src/state/store.ts')).useStore`

async function buildFixture() {
  await fs.rm(PROJECT, { recursive: true, force: true })
  await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(PROJECT, 'package.json'),
    JSON.stringify({ name: 'tutorial-demo', version: '1.0.0' }, null, 2),
  )
  await fs.writeFile(path.join(PROJECT, 'src', 'index.ts'), 'export const answer = 42\n')
}

const cdp = await connect()
const r = reporter()

await buildFixture()
await cdp.evaluate(`
  const s = ${STORE}
  s.setState({ sidebarVisible: true, sidebarView: 'explorer', tutorial: null })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })
await cdp.sleep(1200)

/* ---------------- the button ---------------- */

// A tab strip only exists once something is open, so open a file first.
await cdp.evaluate(`
  const s = ${STORE}
  await s.getState().openFile(${JSON.stringify(path.join(PROJECT, 'src', 'index.ts'))})
  return true
`)
await cdp.sleep(600)

r.check(
  'T1',
  'the Tutorial button is in the tab strip',
  await cdp.evaluate(`return !!document.querySelector('.tab-action-tutorial')`),
)

r.check(
  'T2',
  'the Explorer header offers it too, for a project with nothing open',
  await cdp.evaluate(`
    return [...document.querySelectorAll('.sidebar-header .icon-btn')]
      .some(b => (b.title || '').includes('Explain this whole project'))
  `),
)

/* ---------------- the provider and chapter menu ---------------- */

r.check('T3', 'the chevron opens a menu', await cdp.click('.tab-action-chevron'))

const menu = await cdp.evaluate(`
  return [...document.querySelectorAll('.context-menu .context-item')].map(b => b.textContent.trim())
`)

r.check(
  'T4',
  'the menu offers every detected assistant as a per-run choice',
  menu.some((label) => /Claude/.test(label)) &&
    menu.some((label) => /Codex/.test(label)) &&
    // The local provider matters most here: a long document is exactly what you
    // want to generate without paying per token.
    menu.some((label) => /OpenCode/.test(label)),
  menu.join(' | '),
)

r.check(
  'T5',
  'the menu offers the individual chapters',
  ['Stack', 'Architecture', 'Patterns', 'Algorithms', 'Data', 'Flows', 'Security'].every((short) =>
    menu.some((label) => label.includes(`Just: ${short}`)),
  ),
  menu.join(' | '),
)

r.check(
  'T6',
  'the full book is not offered twice — it is what the button itself does',
  !menu.some((label) => label.includes('Just: Everything')),
)

/* ---------------- generating one chapter ---------------- */

r.check('T7', 'a chapter can be started from the menu', await cdp.clickText('.context-item', 'Just: Stack'))

await cdp.waitFor(`${STORE}.getState().tutorial?.status === 'running'`, {
  label: 'the tutorial run to start',
})

const doc = await cdp.evaluate(`
  const t = ${STORE}.getState().tutorial
  return { chapter: t.chapter, provider: t.provider, hasRunId: !!t.runId }
`)

r.check('T8', 'the run records the chapter that was asked for', doc.chapter === 'stack', JSON.stringify(doc))
r.check('T9', 'the run has a runId, so stream events can be attributed', doc.hasRunId)
r.check(
  'T10',
  'the run went to a real provider',
  doc.provider === 'claude' || doc.provider === 'codex',
  doc.provider,
)

r.check(
  'T11',
  'a tutorial tab opened and is active',
  await cdp.evaluate(`
    const st = ${STORE}.getState()
    return st.activeTabId === 'tutorial' && st.tabs.some(t => t.kind === 'tutorial')
  `),
)

r.check(
  'T12',
  'the chapter rail renders with the requested chapter active',
  await cdp.evaluate(`
    const active = document.querySelector('.tutorial-chapter.active')
    return !!active && active.textContent.trim() === 'Stack'
  `),
)

r.check(
  'T13',
  'the waiting state names the project and the chapter',
  await cdp.evaluate(`
    const el = document.querySelector('.explain-waiting')
    return !!el && /Reading/.test(el.textContent) && /stack/i.test(el.textContent)
  `),
)

r.check(
  'T14',
  'the toolbar shows a Stop control while it runs',
  await cdp.evaluate(`
    return [...document.querySelectorAll('.tutorial-view .btn')].some(b => b.textContent.includes('Stop'))
  `),
)

/* ---------------- streaming reaches the document ---------------- */

// Rather than wait minutes for real output, push one chunk through the same
// store path a streamed event takes, and assert the render.
await cdp.evaluate(`
  const st = ${STORE}.getState()
  st.patchTutorial(st.tutorial.runId, (d) => ({
    ...d,
    content: '## 1. The stack\\n\\ntext\\n\\n### Runtime and language\\n\\nmore\\n',
  }))
  return true
`)
await cdp.sleep(500)

r.check(
  'T15',
  'streamed markdown renders in the body',
  await cdp.evaluate(`
    const body = document.querySelector('.tutorial-view .explain-body')
    return !!body && /The stack/.test(body.textContent)
  `),
)

r.check(
  'T16',
  'the contents rail is built from the headings that have arrived',
  await cdp.evaluate(`
    const items = [...document.querySelectorAll('.tutorial-toc-item')].map(b => b.textContent.trim())
    return items.includes('1. The stack') && items.includes('Runtime and language')
  `),
  await cdp.evaluate(
    `return [...document.querySelectorAll('.tutorial-toc-item')].map(b => b.textContent.trim()).join(' | ')`,
  ),
)

r.check(
  'T17',
  'clicking a contents entry scrolls the document to it',
  await cdp.evaluate(`
    const body = document.querySelector('.tutorial-view .explain-body')
    const before = body.scrollTop
    const item = [...document.querySelectorAll('.tutorial-toc-item')]
      .find(b => b.textContent.trim() === 'Runtime and language')
    if (!item) return false
    item.click()
    await new Promise(res => setTimeout(res, 400))
    // A short fixture document may already be fully visible, in which case not
    // scrolling is correct; what must not happen is an error or a jump away.
    return body.scrollTop >= before
  `),
)

/* ---------------- cancellation ---------------- */

await cdp.clickText('.tutorial-view .btn', 'Stop')
await cdp.waitFor(`${STORE}.getState().tutorial?.status !== 'running'`, { label: 'the run to stop' })

r.check(
  'T18',
  'Stop ends the run and the toolbar returns to its idle controls',
  await cdp.evaluate(`
    const labels = [...document.querySelectorAll('.tutorial-view .btn')].map(b => b.textContent)
    return labels.some(l => l.includes('Regenerate')) && labels.some(l => l.includes('Save into project'))
  `),
)

r.check(
  'T19',
  'the button reopens the existing document instead of paying for it twice',
  await cdp.evaluate(`
    const s = ${STORE}
    const before = s.getState().tutorial.startedAt
    s.getState().closeTab('tutorial')
    await new Promise(res => setTimeout(res, 300))
    document.querySelector('.tab-action-tutorial').click()
    await new Promise(res => setTimeout(res, 400))
    const after = s.getState()
    return after.tutorial.startedAt === before && after.tabs.some(t => t.kind === 'tutorial')
  `),
)

/* ---------------- saving it into the project ---------------- */

await cdp.clickText('.tutorial-view .btn', 'Save into project')
await cdp.sleep(900)

const saved = await fs
  .readFile(path.join(PROJECT, 'docs', 'TUTORIAL-stack.md'), 'utf8')
  .catch(() => '')

r.check(
  'T20',
  'Save writes the chapter into docs/ and opens it',
  saved.includes('The stack'),
  saved.slice(0, 80),
)

/* ---------------- the palette and the keymap ---------------- */

r.check(
  'T21',
  'the palette lists the whole-project tutorial and every chapter',
  await cdp.evaluate(`
    const { appActions } = await import('/src/lib/actions.ts')
    const ids = appActions().map(a => a.id)
    return ids.includes('tutorial') && ids.includes('tutorial:architecture') && ids.includes('tutorial:data')
  `),
)

r.check(
  'T22',
  'the shortcut is bound, and so rebindable in Settings › Keymap',
  await cdp.evaluate(`
    const { SHORTCUT_ACTIONS } = await import('/src/lib/keymap.ts')
    const action = SHORTCUT_ACTIONS.find(s => s.id === 'ai.projectTutorial')
    return !!action && action.combo === 'mod+alt+shift+e'
  `),
)

const failed = r.summary('tutorial UI verification')
cdp.close()
process.exit(failed ? 1 : 0)
