/**
 * Drives the Explorer's multi-select, scoped search and safe delete through real
 * UI interaction. Start the app first:
 *
 *   NOVA_DEBUG_PORT=9223 npm run dev
 *
 * The delete checks always cancel the dialog. What is under test is the *gate* —
 * that a file something still imports cannot be binned without saying so — and a
 * suite that actually deleted its fixture could not re-run.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect, reporter } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'explorer-demo')
const STORE = `(await import('/src/state/store.ts')).useStore`
const BRIDGE = `(await import('/src/lib/refactor/bridge.ts'))`

async function buildFixture() {
  await fs.rm(PROJECT, { recursive: true, force: true })
  await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
  await fs.writeFile(path.join(PROJECT, 'package.json'), '{ "name": "explorer-demo" }\n')
  await fs.writeFile(path.join(PROJECT, 'README.md'), '# explorer demo\n\nNeedle lives here.\n')
  await fs.writeFile(
    path.join(PROJECT, 'src', 'orders.py'),
    'MAX_ITEMS = 50\n\n\ndef build_service():\n    return {"max": MAX_ITEMS}\n',
  )
  await fs.writeFile(
    path.join(PROJECT, 'src', 'main.py'),
    'from orders import build_service, MAX_ITEMS\n\n\ndef run():\n    return build_service()\n',
  )
  await fs.writeFile(path.join(PROJECT, 'src', 'lonely.py'), 'def nobody_calls_me():\n    return 1\n')
  await fs.writeFile(path.join(PROJECT, 'src', 'notes.txt'), 'not an indexable language\n')
}

const cdp = await connect()
const r = reporter()

await buildFixture()
await cdp.evaluate(`
  const s = ${STORE}
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })
await cdp.sleep(1500)
await cdp.clickText('.tree-row', 'src', { settle: 1200 })

/** Resolved form, because the index stores the real path, not the symlinked one. */
const realRoot = await cdp.evaluate(`return ${STORE}.getState().root`)
const at = (...parts) => path.join(realRoot, ...parts)

const rowIndex = (name) =>
  cdp.evaluate(
    `return [...document.querySelectorAll('.tree-row[data-path]')]
       .findIndex(e => e.dataset.path.endsWith(${JSON.stringify('/' + name)}))`,
  )

/* ---------------- multi-select ---------------- */

r.check(
  'E1',
  'every row exposes its path, so ranges have a stable order',
  await cdp.evaluate(`
    const rows = [...document.querySelectorAll('.tree-row')]
    return rows.length > 0 && rows.every(e => e.dataset.path)
  `),
)

await cdp.click('.tree-row[data-path]', { nth: await rowIndex('main.py'), settle: 500 })
const afterPlain = await cdp.evaluate(`
  return JSON.stringify({
    picked: document.querySelectorAll('.tree-row.picked').length,
    tabs: ${STORE}.getState().tabs.filter(t => t.kind === 'file').length,
  })`)
r.check(
  'E2',
  'a plain click selects one row and opens it',
  JSON.parse(afterPlain).picked === 1 && JSON.parse(afterPlain).tabs === 1,
  afterPlain,
)

await cdp.click('.tree-row[data-path]', { nth: await rowIndex('orders.py'), modifiers: ['meta'], settle: 500 })
const afterMeta = await cdp.evaluate(`
  return JSON.stringify({
    picked: document.querySelectorAll('.tree-row.picked').length,
    tabs: ${STORE}.getState().tabs.filter(t => t.kind === 'file').length,
    bar: document.querySelector('.tree-selection-bar')?.textContent ?? '',
  })`)
r.check(
  'E3',
  '⌘-click adds to the selection without opening a second tab',
  JSON.parse(afterMeta).picked === 2 && JSON.parse(afterMeta).tabs === 1,
  afterMeta,
)

r.check('E4', 'a count bar appears once more than one row is selected', /2 selected/.test(JSON.parse(afterMeta).bar))

await cdp.click('.tree-row[data-path]', { nth: await rowIndex('orders.py'), modifiers: ['meta'], settle: 500 })
r.check(
  'E5',
  '⌘-click again removes that row from the selection',
  (await cdp.evaluate(`return document.querySelectorAll('.tree-row.picked').length`)) === 1,
)

// Anchor on the first file in the folder, then extend down past two others.
// The rows sort alphabetically: lonely.py, main.py, notes.txt, orders.py.
const order = await cdp.evaluate(
  `return JSON.stringify([...document.querySelectorAll('.tree-row[data-path]')].map(e => e.dataset.path.split('/').pop()))`,
)
await cdp.click('.tree-row[data-path]', { nth: await rowIndex('lonely.py'), settle: 500 })
await cdp.click('.tree-row[data-path]', { nth: await rowIndex('orders.py'), modifiers: ['shift'], settle: 600 })
const range = await cdp.evaluate(`
  return JSON.stringify([...document.querySelectorAll('.tree-row.picked')].map(e => e.dataset.path.split('/').pop()))`)
r.check(
  'E6',
  '⇧-click extends a contiguous range in visible order',
  JSON.parse(range).length === 4 &&
    ['lonely.py', 'main.py', 'notes.txt', 'orders.py'].every((f) => JSON.parse(range).includes(f)),
  `${range} of ${order}`,
)

await cdp.click('.tree-row[data-path]', { nth: await rowIndex('README.md'), settle: 500 })
r.check(
  'E7',
  'a plain click collapses the selection back to one',
  (await cdp.evaluate(`return document.querySelectorAll('.tree-row.picked').length`)) === 1,
)

/* ---------------- scoped search ---------------- */

r.check(
  'E8',
  'the context menu offers folder-scoped search',
  await cdp.evaluate(`
    const row = [...document.querySelectorAll('.tree-row[data-path]')].find(e => e.dataset.path.endsWith('/src'))
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))
    await new Promise(res => setTimeout(res, 400))
    const labels = [...document.querySelectorAll('.context-menu .context-item')].map(e => e.textContent.trim())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return labels.some(l => /Find in Folder/.test(l)) && labels.some(l => /Find File by Name/.test(l))
  `),
)

  // Switches pane and seeds the scope in one call — the case that would race a
  // DOM event, because the Search pane is not mounted yet at that moment.
r.check(
  'E9',
  'Find in Folder opens Search with the folder as the file mask',
  await cdp.evaluate(`
    const s = ${STORE}
    s.getState().setSidebarView('explorer')
    await new Promise(res => setTimeout(res, 300))
    s.getState().searchInFolder(s.getState().root + '/src')
    await new Promise(res => setTimeout(res, 700))
    const mask = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('File mask'))
    return mask?.value === 'src/**' && s.getState().pendingSearchMask === null
  `),
)

r.check(
  'E10',
  'the scoped mask actually filters results',
  await cdp.evaluate(`
    const query = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('Search across'))
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(query, 'Needle')
    query.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 1400))
    // "Needle" lives only in README.md, which the src/** mask excludes.
    const hits = document.querySelectorAll('.search-hit, .search-file').length
    return hits === 0
  `),
)

r.check(
  'E11',
  'Find File by Name seeds the palette with the folder',
  await cdp.evaluate(`
    const s = ${STORE}
    s.getState().findFileIn(s.getState().root + '/src')
    await new Promise(res => setTimeout(res, 700))
    const input = document.querySelector('.overlay input')
    const value = input?.value ?? ''
    const drained = s.getState().pendingPaletteQuery === null
    s.getState().setPalette(false)
    return value === 'src' && drained
  `),
)

r.check(
  'E11b',
  'a plain palette open afterwards still starts empty',
  await cdp.evaluate(`
    const s = ${STORE}
    s.getState().setPalette(true, 'file')
    await new Promise(res => setTimeout(res, 500))
    const value = document.querySelector('.overlay input')?.value ?? 'x'
    s.getState().setPalette(false)
    return value === ''
  `),
)

/* ---------------- safe delete ---------------- */

const imported = await cdp.evaluate(`
  const { findFileUsages } = ${BRIDGE}
  const report = await findFileUsages([${JSON.stringify(at('src', 'orders.py'))}])
  return JSON.stringify({
    usages: report.usages.map(u => u.symbol + '@' + u.file.split('/').pop() + ':' + u.line),
    unanalysed: report.unanalysed.length,
  })`)
r.check(
  'E12',
  'a file something imports reports its dangling references',
  JSON.parse(imported).usages.length >= 2 && JSON.parse(imported).usages.some((u) => u.includes('main.py')),
  imported,
)

const lonely = await cdp.evaluate(`
  const { findFileUsages } = ${BRIDGE}
  const report = await findFileUsages([${JSON.stringify(at('src', 'lonely.py'))}])
  return JSON.stringify({ usages: report.usages.length, unanalysed: report.unanalysed.length })`)
r.check(
  'E13',
  'a parsed file nothing imports reports no usages and is not called unchecked',
  JSON.parse(lonely).usages === 0 && JSON.parse(lonely).unanalysed === 0,
  lonely,
)

const opaque = await cdp.evaluate(`
  const { findFileUsages } = ${BRIDGE}
  const report = await findFileUsages([${JSON.stringify(at('src', 'notes.txt'))}])
  return JSON.stringify({ usages: report.usages.length, unanalysed: report.unanalysed.length })`)
r.check(
  'E14',
  'a file the index cannot parse is reported as unchecked, not as safe',
  JSON.parse(opaque).usages === 0 && JSON.parse(opaque).unanalysed === 1,
  opaque,
)

const blockingDialog = await cdp.evaluate(`
  const { safeDeleteFilesAt, resolveRefactorDialog } = ${BRIDGE}
  safeDeleteFilesAt([${JSON.stringify(at('src', 'orders.py'))}])
  await new Promise(res => setTimeout(res, 2000))
  const d = ${STORE}.getState().refactorDialog
  const out = { title: d?.title ?? '', notes: (d?.notes ?? []).join(' | '), fields: (d?.fields ?? []).map(f => f.key) }
  resolveRefactorDialog(null)
  return JSON.stringify(out)`)
r.check(
  'E15',
  'deleting an imported file warns and demands an explicit override',
  /dangling/.test(JSON.parse(blockingDialog).notes) &&
    JSON.parse(blockingDialog).fields.includes('force'),
  JSON.parse(blockingDialog).notes.slice(0, 110),
)

r.check(
  'E16',
  'cancelling the dialog deletes nothing',
  await fs
    .access(path.join(PROJECT, 'src', 'orders.py'))
    .then(() => true)
    .catch(() => false),
)

const cleanDialog = await cdp.evaluate(`
  const { safeDeleteFilesAt, resolveRefactorDialog } = ${BRIDGE}
  safeDeleteFilesAt([${JSON.stringify(at('src', 'lonely.py'))}])
  await new Promise(res => setTimeout(res, 2000))
  const d = ${STORE}.getState().refactorDialog
  const out = { notes: (d?.notes ?? []).join(' | '), fields: (d?.fields ?? []).map(f => f.key) }
  resolveRefactorDialog(null)
  return JSON.stringify(out)`)
r.check(
  'E17',
  'deleting an unreferenced file needs no override',
  /Nothing else in the project refers/.test(JSON.parse(cleanDialog).notes) &&
    JSON.parse(cleanDialog).fields.length === 0,
  JSON.parse(cleanDialog).notes.slice(0, 110),
)

const multi = await cdp.evaluate(`
  const { safeDeleteFilesAt, resolveRefactorDialog } = ${BRIDGE}
  safeDeleteFilesAt([${JSON.stringify(at('src', 'lonely.py'))}, ${JSON.stringify(at('src', 'notes.txt'))}])
  await new Promise(res => setTimeout(res, 2000))
  const d = ${STORE}.getState().refactorDialog
  const out = { title: d?.title ?? '', notes: (d?.notes ?? []).join(' | ') }
  resolveRefactorDialog(null)
  return JSON.stringify(out)`)
r.check(
  'E18',
  'a multi-file delete names the count and flags the unchecked one',
  /2 items/.test(JSON.parse(multi).title) && /could not be checked/.test(JSON.parse(multi).notes),
  JSON.parse(multi).title,
)

const together = await cdp.evaluate(`
  const { findFileUsages } = ${BRIDGE}
  const report = await findFileUsages([
    ${JSON.stringify(at('src', 'orders.py'))},
    ${JSON.stringify(at('src', 'main.py'))},
  ])
  return JSON.stringify({ usages: report.usages.length })`)
r.check(
  'E19',
  'deleting a module together with its only consumer is not a dangling reference',
  JSON.parse(together).usages === 0,
  together,
)

const failed = r.summary('explorer verification')
cdp.close()
process.exit(failed ? 1 : 0)
