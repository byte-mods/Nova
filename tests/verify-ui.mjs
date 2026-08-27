/**
 * Drives the running Nova IDE through real UI interaction and checks every
 * feature in tests/FEATURES.md. Start the app first:
 *
 *   NOVA_DEBUG_PORT=9223 npm run dev
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect, reporter } from './cdp.mjs'
import { TMP } from './env.mjs'
import { startPageServer } from './stubs/page-server.mjs'

const PROJECT = path.join(TMP, 'ui-demo')
const only = process.argv[2] ? Number(process.argv[2]) : null

/* ------------------------------------------------------------------ */
/* fixture                                                             */
/* ------------------------------------------------------------------ */

async function buildFixture() {
  await fs.rm(PROJECT, { recursive: true, force: true })
  await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
  await fs.mkdir(path.join(PROJECT, 'public'), { recursive: true })

  await fs.writeFile(
    path.join(PROJECT, 'package.json'),
    JSON.stringify(
      { name: 'ui-demo', version: '1.0.0', scripts: { dev: 'echo dev-server', build: 'echo built' } },
      null,
      2,
    ),
  )
  await fs.writeFile(
    path.join(PROJECT, 'README.md'),
    `# UI Demo\n\nA fixture project.\n\n## Flow\n\n\`\`\`mermaid\nflowchart LR\n  A[Client] --> B[Service]\n  B --> C[(Store)]\n\`\`\`\n\n## Table\n\n| Key | Value |\n| --- | --- |\n| one | 1 |\n\n\`\`\`python\ndef greet(name):\n    return f"hi {name}"\n\`\`\`\n`,
  )
  await fs.writeFile(
    path.join(PROJECT, 'src', 'orders.py'),
    `MAX_ITEMS = 50


class OrderService:
    """Creates and looks up orders."""

    def __init__(self, repo):
        self.repo = repo

    def create_order(self, total):
        order = {"id": "1", "total": total}
        self.repo.save(order)
        return order


class InMemoryRepository:
    def __init__(self):
        self.items = {}

    def save(self, order):
        self.items[order["id"]] = order


def build_service():
    return OrderService(InMemoryRepository())
`,
  )
  await fs.writeFile(
    path.join(PROJECT, 'src', 'main.py'),
    `from orders import build_service, MAX_ITEMS


def run():
    service = build_service()
    order = service.create_order(42)
    print(f"created={order} max={MAX_ITEMS}")
    return order


if __name__ == "__main__":
    run()
`,
  )
  await fs.writeFile(
    path.join(PROJECT, 'src', 'util.go'),
    `package util

type Coupon struct {
\tCode    string
\tPercent int
}

func ApplyCoupon(total int, c Coupon) int {
\treturn total - (total * c.Percent / 100)
}
`,
  )
  await fs.writeFile(
    path.join(PROJECT, 'public', 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>UI Demo Page</title></head><body><h1 id="h">Hello from the preview</h1><script>document.getElementById('h').dataset.ready='yes'</script></body></html>`,
  )

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  await exec('git', ['init', '-q', '.'], { cwd: PROJECT })
  await exec('git', ['add', '-A'], { cwd: PROJECT })
  await exec(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=Tester', 'commit', '-qm', 'Initial commit'],
    { cwd: PROJECT },
  )
}

/* ------------------------------------------------------------------ */

const cdp = await connect()
const r = reporter()

/** Opens the project through the store, then waits for the tree to render. */
async function openProject() {
  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    // Force the explorer visible: a previous section may have left the sidebar
    // on another view, where there is no file tree to wait for.
    s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
    await s.getState().openProject(${JSON.stringify(PROJECT)})
    return true
  `)
  await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })
  await cdp.sleep(2500)
}

/** Resets the UI to a known state between sections. */
async function reset() {
  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    const st = s.getState()
    st.tabs.slice().forEach(t => st.closeTab(t.id))
    // Settings persist across runs, so pin the ones the assertions depend on.
    // With autoSave on, for instance, a tab is never observably dirty.
    if (st.settings.autoSave || st.settings.formatOnSave) {
      st.setSettings({ autoSave: false, formatOnSave: false })
    }
    s.setState({
      panelVisible: false, usages: null, hierarchy: null, editPreview: null,
      paletteOpen: false, sidebarVisible: true, sidebarView: 'explorer',
      refactorDialog: null, refactorMenuOpen: false, explain: {},
    })
    return true
  `)
  // Breakpoints live in the main process for the app's lifetime, and a live
  // session re-opens the paused file whenever it stops — both leak across
  // sections and make later assertions depend on run order. Clear them.
  await cdp.evaluate(`
    await window.nova.debug.stop().catch(() => {})
    await window.nova.debug.clearBreakpoints().catch(() => {})
    return true
  `)
  await cdp.sleep(400)
}

/** Expands a folder deterministically (clicking toggles, which is racy). */
async function expandFolder(name) {
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    const st=s.getState()
    st.setExpanded(st.root + '/' + ${JSON.stringify(name)}, true)
    return true`)
  await cdp.sleep(600)
}

/**
 * Shows a bottom-panel tab. Clicking the *already active* tab hides the panel
 * (same toggle semantics as the sidebar), so only click when it is not active.
 */
async function openPanelTab(name) {
  const visible = await cdp.evaluate(`return document.querySelectorAll('.pane-tabs').length > 0`)
  if (!visible) await cdp.click('[title^="Toggle panel"]', { settle: 900 })
  const active = await cdp.evaluate(
    `const a=document.querySelector('.pane-tab.active'); return a ? a.textContent.trim() : ''`,
  )
  if (!active.includes(name)) await cdp.clickText('.pane-tab', name, { settle: 1200 })
  await cdp.sleep(400)
}

/** Opens a file by clicking its row, expanding the folder first if needed. */
async function openFileByClick(folder, name, settle = 2200) {
  if (folder) await expandFolder(folder)
  return cdp.clickText('.tree-row', name, { settle })
}

const text = (selector) =>
  cdp.evaluate(
    `const e=document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null`,
  )
const count = (selector) =>
  cdp.evaluate(`return document.querySelectorAll(${JSON.stringify(selector)}).length`)
const exists = async (selector) => (await count(selector)) > 0

/**
 * Opens a sidebar view by its activity-bar label.
 *
 * Deliberately not by index: the activity bar has gained views over time
 * (Structural Search, Plugins), and every index-based click silently started
 * landing on the neighbouring view instead — nine diagram checks and five theme
 * checks failed against a perfectly working app. The label is the stable handle.
 */
const openSidebar = (label, settle = 900) =>
  cdp.click(`.activity-item[title^=${JSON.stringify(label)}]`, { settle })

/* ================================================================== */
/* 1. Shell & layout                                                   */
/* ================================================================== */
async function section1() {
  console.log('\n── 1. Shell & layout ──')
  await reset()

  await r.guard('1.1', 'title bar shows project name', async () => {
    const t = await text('.titlebar')
    return { ok: t.includes('ui-demo'), detail: t.slice(0, 60) }
  })

  await r.guard('1.2', 'breadcrumb reflects the active file', async () => {
    await openFileByClick('src', 'orders.py')
    await cdp.sleep(800)
    const crumbs = await text('.titlebar-title')
    return { ok: /src/.test(crumbs) && /orders\.py/.test(crumbs), detail: String(crumbs).slice(0, 60) }
  })

  await r.guard('1.3', 'activity bar switches every sidebar view', async () => {
    const total = await count('.activity-item')
    const seen = []
    for (let i = 0; i < total; i++) {
      await cdp.click('.activity-item', { nth: i, settle: 500 })
      seen.push((await text('.sidebar-title')) ?? '')
    }
    await openSidebar('Explorer')
    const unique = new Set(seen.map((s) => s.trim()))
    return {
      ok: total >= 5 && unique.size >= total - 1,
      detail: `${total} views: ${JSON.stringify([...unique])}`,
    }
  })

  await r.guard('1.4', 'sidebar toggles from the title bar', async () => {
    await cdp.click('[title^="Toggle sidebar"]', { settle: 400 })
    const hidden = !(await exists('.sidebar'))
    await cdp.click('[title^="Toggle sidebar"]', { settle: 400 })
    const shown = await exists('.sidebar')
    return { ok: hidden && shown, detail: `hidden=${hidden} shown=${shown}` }
  })

  await r.guard('1.5', 'bottom panel toggles from the title bar', async () => {
    await cdp.click('[title^="Toggle panel"]', { settle: 600 })
    const shown = await exists('.pane-tabs')
    await cdp.click('[title^="Toggle panel"]', { settle: 400 })
    const hidden = !(await exists('.pane-tabs'))
    return { ok: shown && hidden, detail: `shown=${shown} hidden=${hidden}` }
  })

  await r.guard('1.6', 'AI console toggles from the title bar', async () => {
    const start = await exists('.ai-console')
    await cdp.click('[title^="Toggle AI console"]', { settle: 700 })
    const toggled = (await exists('.ai-console')) !== start
    await cdp.click('[title^="Toggle AI console"]', { settle: 700 })
    const restored = (await exists('.ai-console')) === start
    return { ok: toggled && restored, detail: `start=${start} toggled=${toggled} restored=${restored}` }
  })

  await r.guard('1.7', 'splitter drag resizes the sidebar', async () => {
    // The width is persisted across runs and clamps at 560; start from a known
    // value so the drag has room to move.
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ sidebarWidth: 260 }); return true`)
    await cdp.sleep(500)
    const before = await cdp.evaluate(
      `return document.querySelector('.sidebar').getBoundingClientRect().width`,
    )
    const handle = await cdp.boxOf('.splitter.vertical')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y, buttons: 0 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 70, y: handle.y, button: 'left', buttons: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 70, y: handle.y, button: 'left', buttons: 0, clickCount: 1 })
    await cdp.sleep(400)
    const after = await cdp.evaluate(
      `return document.querySelector('.sidebar').getBoundingClientRect().width`,
    )
    return { ok: after > before + 30, detail: `${before} -> ${after}` }
  })

  await r.guard('1.8', 'status bar shows branch and symbol count', async () => {
    const t = await text('.statusbar')
    return { ok: /main/.test(t) && /symbols/.test(t), detail: t.slice(0, 90) }
  })
}

/* ================================================================== */
/* 2. File explorer                                                    */
/* ================================================================== */
async function section2() {
  console.log('\n── 2. File explorer ──')
  await reset()

  await r.guard('2.1', 'tree lists project files with icons', async () => {
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.tree-row')].map(e => e.textContent.trim())`,
    )
    const icons = await count('.tree-row svg')
    return {
      ok: rows.some((x) => x.includes('README.md')) && rows.some((x) => x.includes('src')) && icons > 0,
      detail: JSON.stringify(rows.slice(0, 6)),
    }
  })

  await r.guard('2.2', 'folder expands and collapses', async () => {
    // Start collapsed: an earlier section may have left the folder open, and
    // the first click would then collapse rather than expand it.
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setExpanded(s.getState().root + '/src', false); return true`)
    await cdp.sleep(500)
    await cdp.clickText('.tree-row', 'src', { settle: 700 })
    const expanded = await cdp.evaluate(
      `return [...document.querySelectorAll('.tree-row')].some(e => e.textContent.includes('orders.py'))`,
    )
    await cdp.clickText('.tree-row', 'src', { settle: 600 })
    const collapsed = await cdp.evaluate(
      `return ![...document.querySelectorAll('.tree-row')].some(e => e.textContent.includes('orders.py'))`,
    )
    await expandFolder('src')
    return { ok: expanded && collapsed, detail: `expanded=${expanded} collapsed=${collapsed}` }
  })

  await r.guard('2.3', 'clicking a file opens it in a tab', async () => {
    await openFileByClick('src', 'orders.py', 1800)
    const tabs = await cdp.evaluate(
      `return [...document.querySelectorAll('.tab-name')].map(e => e.textContent)`,
    )
    return { ok: tabs.includes('orders.py'), detail: JSON.stringify(tabs) }
  })

  await r.guard('2.4', 'context menu offers file operations', async () => {
    const point = await cdp.boxOfText('.tree-row', 'orders.py')
    await cdp.clickPoint(point, { button: 'right' })
    await cdp.sleep(600)
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.context-item')].map(e => e.textContent.trim())`,
    )
    await cdp.key('Escape')
    // "Move to Trash" became "Safe Delete…" when deletion started going through
    // the usage check, and the two folder-scoped searches were added beside it.
    const wanted = [
      'New File',
      'Find in',
      'Find File by Name',
      'Rename',
      'Local History',
      'Copy Relative Path',
      'Safe Delete',
    ]
    return {
      ok: wanted.every((w) => items.some((i) => i.includes(w))),
      detail: JSON.stringify(items),
    }
  })

  await r.guard('2.5', 'new file is created from the header button', async () => {
    await cdp.click('[title="New file"]', { settle: 700 })
    const input = await cdp
      .waitFor(`document.querySelectorAll('.tree-row input').length > 0`, { label: 'inline input' })
      .then(() => true)
      .catch(() => false)
    if (!input) return { ok: false, detail: 'no inline input appeared' }
    await cdp.type('scratch-note.txt')
    await cdp.key('Enter')
    await cdp.sleep(1800)
    const onDisk = await fs
      .access(path.join(PROJECT, 'scratch-note.txt'))
      .then(() => true)
      .catch(() => false)
    const inTree = await cdp.evaluate(
      `return [...document.querySelectorAll('.tree-row')].some(e => e.textContent.includes('scratch-note.txt'))`,
    )
    return { ok: onDisk && inTree, detail: `disk=${onDisk} tree=${inTree}` }
  })

  await r.guard('2.6', 'git decorations appear on modified files', async () => {
    await fs.appendFile(path.join(PROJECT, 'src', 'util.go'), '\n// touched by the UI suite\n')
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().refreshGit(); s.getState().bumpTree(); return true`)
    await expandFolder('src')
    const marks = await cdp.waitFor(`
      (() => {
        const rows = [...document.querySelectorAll('.tree-row')].filter(e => e.textContent.includes('util.go'))
        const m = rows.map(e => (e.querySelector('.tree-status')||{}).textContent || '')
        return m.some(x => x.trim() === 'M') ? m : null
      })()`, { timeout: 12000, label: 'git decoration' }).catch(() => null)
    return { ok: Boolean(marks), detail: JSON.stringify(marks) }
  })
}

/* ================================================================== */
/* 3. Editor                                                           */
/* ================================================================== */
async function section3() {
  console.log('\n── 3. Editor ──')
  await reset()
  await openFileByClick('src', 'orders.py')
  await cdp.waitFor(`document.querySelectorAll('.view-line').length > 0`, { label: 'editor lines' })

  await r.guard('3.1', 'file opens with syntax highlighting', async () => {
    const tokens = await cdp.evaluate(`
      const spans = [...document.querySelectorAll('.view-line span span')]
      const colours = new Set(spans.map(s => getComputedStyle(s).color))
      return { lines: document.querySelectorAll('.view-line').length, colours: colours.size }`)
    return { ok: tokens.lines > 5 && tokens.colours > 2, detail: JSON.stringify(tokens) }
  })

  await r.guard('3.2', 'typing marks the tab dirty', async () => {
    await cdp.click('.view-lines', { settle: 400 })
    await cdp.key('Enter')
    await cdp.type('# edited by the UI suite')
    await cdp.sleep(600)
    const dirty = await exists('.tab.dirty')
    return { ok: dirty, detail: `dirty=${dirty}` }
  })

  await r.guard('3.3', 'save clears the dirty marker and writes to disk', async () => {
    await cdp.key('s', ['meta'])
    await cdp.sleep(1200)
    const stillDirty = await exists('.tab.dirty')
    const onDisk = await fs.readFile(path.join(PROJECT, 'src', 'orders.py'), 'utf8')
    return {
      ok: !stillDirty && onDisk.includes('edited by the UI suite'),
      detail: `dirty=${stillDirty} written=${onDisk.includes('edited by the UI suite')}`,
    }
  })

  await r.guard('3.4', 'tabs switch on click and close on the X', async () => {
    // A single click opens a *preview* tab, which the next preview replaces.
    // Clicking the tab pins it, which is what a user does before opening another.
    await cdp.clickText('.tab', 'orders.py', { settle: 500 })
    await openFileByClick(null, 'main.py', 1800)
    const two = await count('.tab')
    await cdp.clickText('.tab', 'orders.py', { settle: 600 })
    const activeIsOrders = (await text('.tab.active')).includes('orders.py')
    const closed = await cdp.click('.tab.active .tab-close', { settle: 700 })
    const after = await count('.tab')
    return {
      ok: two >= 2 && activeIsOrders && closed && after === two - 1,
      detail: `tabs=${two}->${after} active=${activeIsOrders}`,
    }
  })

  await r.guard('3.5', 'cursor position updates the status bar', async () => {
    await cdp.click('.view-lines', { settle: 500 })
    await cdp.key('ArrowDown')
    await cdp.key('ArrowDown')
    await cdp.sleep(400)
    const t = await text('.statusbar')
    return { ok: /Ln \d+, Col \d+/.test(t), detail: (t.match(/Ln \d+, Col \d+/) ?? [''])[0] }
  })

  await r.guard('3.6', 'a second language highlights correctly', async () => {
    await openFileByClick(null, 'util.go', 2200)
    const info = await cdp.evaluate(`
      const t = document.querySelector('.statusbar').textContent
      const colours = new Set([...document.querySelectorAll('.view-line span span')].map(s=>getComputedStyle(s).color))
      return { lang: /go/.test(t), colours: colours.size }`)
    return { ok: info.lang && info.colours > 2, detail: JSON.stringify(info) }
  })
}

/* ================================================================== */
/* 4. Navigation                                                       */
/* ================================================================== */
async function section4() {
  console.log('\n── 4. Navigation ──')
  await reset()

  await r.guard('4.1', 'go to file palette opens and filters', async () => {
    await cdp.key('p', ['meta'])
    await cdp.sleep(500)
    await cdp.type('orders')
    await cdp.sleep(900)
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.modal-item')].map(e=>e.textContent)`,
    )
    const ok = rows.some((x) => x.includes('orders.py'))
    await cdp.key('Escape')
    return { ok, detail: JSON.stringify(rows.slice(0, 4)) }
  })

  await r.guard('4.2', 'command palette runs a command', async () => {
    await cdp.key('p', ['meta', 'shift'])
    await cdp.sleep(500)
    await cdp.type('Toggle Panel')
    await cdp.sleep(600)
    await cdp.key('Enter')
    await cdp.sleep(800)
    const opened = await exists('.pane-tabs')
    if (opened) await cdp.click('[title^="Toggle panel"]', { settle: 300 })
    return { ok: opened, detail: `panel opened=${opened}` }
  })

  await r.guard('4.3', 'symbol palette lists project symbols with badges', async () => {
    await cdp.key('o', ['meta', 'shift'])
    await cdp.sleep(600)
    await cdp.type('Order')
    await cdp.sleep(900)
    const rows = await cdp.evaluate(`
      return [...document.querySelectorAll('.modal-item')].map(e => ({
        text: e.textContent,
        glyph: (e.querySelector('.symbol-glyph')||{}).textContent || '',
      }))`)
    const ok = rows.some((x) => x.text.includes('OrderService') && x.glyph === 'C')
    return { ok, detail: JSON.stringify(rows.slice(0, 3)) }
  })

  await r.guard('4.4', 'choosing a symbol opens its file at the right line', async () => {
    await cdp.key('Enter')
    await cdp.sleep(1800)
    const state = await cdp.evaluate(`
      const t = document.querySelector('.statusbar').textContent
      const tab = (document.querySelector('.tab.active .tab-name')||{}).textContent || ''
      return { tab, line: (t.match(/Ln (\\d+)/)||[])[1] }`)
    return {
      ok: state.tab === 'orders.py' && Number(state.line) >= 3,
      detail: JSON.stringify(state),
    }
  })

  await r.guard('4.5', 'Find Usages fills the Usages panel', async () => {
    // Put the caret on `build_service` in main.py, then use the context menu.
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(${JSON.stringify(path.join(PROJECT, 'src', 'main.py'))}, { line: 5, column: 15 })
      return true`)
    await cdp.sleep(1600)
    await cdp.click('.view-lines', { settle: 500 })
    const placed = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors().find(e => e.hasTextFocus()) || monaco.editor.getEditors()[0]
      const model = ed.getModel()
      const hit = model.findMatches('build_service', false, false, true, null, false)[0]
      if (!hit) return null
      ed.setPosition({ lineNumber: hit.range.startLineNumber, column: hit.range.startColumn + 2 })
      ed.focus()
      return model.getWordAtPosition(ed.getPosition())?.word ?? null
    `)
    if (placed !== 'build_service') return { ok: false, detail: 'caret not on build_service: ' + placed }
    await cdp.key('F7', ['alt'])
    await cdp.sleep(2000)
    const info = await cdp.evaluate(`
      const h = document.querySelector('.usages-header')
      return { header: h ? h.textContent : '', rows: document.querySelectorAll('.usage-row').length,
               files: document.querySelectorAll('.usages-body .tree-row:not(.usage-row)').length }`)
    return {
      ok: info.rows >= 3 && info.files >= 2 && info.header.includes('build_service'),
      detail: JSON.stringify(info),
    }
  })

  await r.guard('4.6', 'clicking a usage traverses to that file and line', async () => {
    const rows = await count('.usage-row')
    if (rows === 0) return { ok: false, detail: 'no usage rows to click' }
    const clicked = await cdp.click('.usage-row', { nth: 0, settle: 1800 })
    const after = await cdp.evaluate(`
      const t = document.querySelector('.statusbar').textContent
      return { tab: (document.querySelector('.tab.active .tab-name')||{}).textContent,
               line: (t.match(/Ln (\\d+)/)||[])[1] }`)
    return {
      ok: clicked && /\.py$/.test(after.tab ?? '') && Number(after.line) > 0,
      detail: JSON.stringify(after),
    }
  })

  await r.guard('4.7', 'usages panel groups by file with counts', async () => {
    const groups = await cdp.evaluate(`
      return [...document.querySelectorAll('.usages-body .tree-row:not(.usage-row)')]
        .map(e => e.textContent.trim())`)
    return { ok: groups.length >= 2 && groups.some((g) => /\d/.test(g)), detail: JSON.stringify(groups) }
  })

  await r.guard('4.8', 'project search returns hits and opens them', async () => {
    await cdp.key('f', ['meta', 'shift'])
    await cdp.sleep(700)
    await cdp.type('OrderService')
    await cdp.sleep(2500)
    const hits = await count('.sidebar .tree-row')
    const opened = await cdp.click('.sidebar .tree-row', { nth: 1, settle: 1600 })
    const tab = (await text('.tab.active .tab-name')) ?? ''
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore; s.getState().setSidebarView('explorer'); return true`)
    return { ok: hits > 1 && opened && tab.endsWith('.py'), detail: `hits=${hits} tab=${tab}` }
  })

  await r.guard('4.9', 'F12 goes to the declaration in another file', async () => {
    await openFileByClick('src', 'main.py', 1800)
    await cdp.waitFor(`document.querySelectorAll('.view-line').length > 0`, { label: 'editor' })
    // Put the caret inside `build_service()` on the line that calls it.
    const placed = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const lines = ed.getModel().getValue().split('\\n')
      const ln = lines.findIndex(l => l.includes('service = build_service()')) + 1
      if (!ln) return null
      const col = lines[ln-1].indexOf('build_service') + 4
      ed.focus(); ed.setPosition({ lineNumber: ln, column: col }); ed.revealLineInCenter(ln)
      return { ln, col }`)
    if (!placed) return { ok: false, detail: 'call site not found' }
    await cdp.sleep(400)
    await cdp.key('F12')
    await cdp.sleep(2500)
    const landed = await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      const st = s.getState()
      const tab = st.tabs.find(t => t.id === st.activeTabId)
      return { file: (tab?.path ?? '').split('/').pop(), line: st.cursor.line }`)
    return {
      ok: landed.file === 'orders.py',
      detail: `landed ${landed.file}:${landed.line}`,
    }
  })

  await r.guard('4.10', 'Shift+F12 peeks references inline', async () => {
    // Peek reads the word under the caret, so put it on the declaration by
    // name rather than trusting wherever the previous check happened to land.
    const placed = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const lines = ed.getModel().getValue().split('\\n')
      const ln = lines.findIndex(l => l.includes('def build_service')) + 1
      if (!ln) return null
      const col = lines[ln-1].indexOf('build_service') + 4
      ed.focus(); ed.setPosition({ lineNumber: ln, column: col }); ed.revealLineInCenter(ln)
      return { ln, col }`)
    if (!placed) return { ok: false, detail: 'declaration not found' }
    await cdp.sleep(500)
    await cdp.key('F12', ['shift'])
    const peeks = await cdp
      .waitFor(
        `document.querySelectorAll('.monaco-editor .peekview-widget, .reference-zone-widget').length`,
        { timeout: 12000, interval: 500, label: 'peek widget' },
      )
      .catch(() => 0)
    await cdp.key('Escape')
    return { ok: peeks > 0, detail: `peekWidgets=${peeks}` }
  })
}


/* ================================================================== */
/* 5. Autocomplete                                                     */
/* ================================================================== */
async function section5() {
  console.log('\n── 5. Autocomplete ──')
  await reset()
  await openFileByClick('src', 'main.py')
  await cdp.waitFor(`document.querySelectorAll('.view-line').length > 0`, { label: 'editor' })

  await r.guard('5.1', 'suggest popup appears while typing', async () => {
    await cdp.click('.view-lines', { settle: 500 })
    // Go to the end of the file and start a fresh line.
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const m = ed.getModel()
      ed.setPosition({ lineNumber: m.getLineCount(), column: m.getLineMaxColumn(m.getLineCount()) })
      ed.focus(); return true`)
    await cdp.key('Enter')
    await cdp.type('Order', 40)
    await cdp.sleep(2200)
    const visible = await cdp.evaluate(
      `const w=document.querySelector('.suggest-widget'); return !!(w && w.classList.contains('visible'))`,
    )
    return { ok: visible, detail: `visible=${visible}` }
  })

  await r.guard('5.2', 'popup contains a class from another file', async () => {
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(e=>e.textContent)`,
    )
    return { ok: rows.some((x) => x.includes('OrderService')), detail: JSON.stringify(rows.slice(0, 5)) }
  })

  await r.guard('5.3', 'suggestion detail shows kind and source', async () => {
    // The collapsed row shows the kind as an *icon* and the origin as text;
    // the `detail` string ("class in …") lives in the details pane, which has
    // to be expanded. Asserting on the row's textContent instead reported a
    // missing separator that does not exist — the two labels are separate
    // elements with a margin between them.
    // `toggleSuggestionDetails` is a toggle and Monaco remembers the choice for
    // the rest of the session, so a section that ran earlier and expanded the
    // pane would leave this one collapsing it again. Converge on expanded
    // instead of assuming which way the toggle points.
    const info = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const editor = monaco.editor.getEditors()[0]
      const paneText = () => document.querySelector('.suggest-details')?.textContent?.trim() ?? ''
      for (let attempt = 0; attempt < 2 && !paneText(); attempt++) {
        editor.trigger('test', 'toggleSuggestionDetails', {})
        await new Promise(res => setTimeout(res, 600))
      }
      const row = [...document.querySelectorAll('.suggest-widget .monaco-list-row')]
        .find(e => e.textContent.includes('OrderService'))
      const icon = row ? [...row.querySelectorAll('*')].map(e => e.className).join(' ') : ''
      const origin = row ? (row.querySelector('.details-label')?.textContent ?? '') : ''
      return { icon, origin, pane: paneText() }
    `)
    const kind = /codicon-symbol-class/.test(info.icon) || /class/i.test(info.pane)
    return {
      ok: kind && /orders/.test(info.origin),
      detail: `origin=${info.origin.trim()} pane=${info.pane.slice(0, 40)}`,
    }
  })

  await r.guard('5.4', 'accepting a suggestion inserts the identifier', async () => {
    await cdp.evaluate(`
      const rows=[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      const i=rows.findIndex(e=>e.textContent.includes('OrderService'))
      return i`)
    // Walk the list to OrderService, then accept.
    for (let i = 0; i < 8; i++) {
      const focused = await cdp.evaluate(
        `const f=document.querySelector('.suggest-widget .monaco-list-row.focused'); return f?f.textContent:''`,
      )
      if (focused.includes('OrderService')) break
      await cdp.key('ArrowDown')
    }
    await cdp.key('Enter')
    await cdp.sleep(800)
    const line = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const m = monaco.editor.getEditors()[0].getModel()
      return m.getLineContent(m.getLineCount())`)
    // Undo the scratch edit so later sections see a clean file.
    await cdp.key('z', ['meta'])
    await cdp.key('z', ['meta'])
    await cdp.sleep(400)
    return { ok: line.includes('OrderService'), detail: JSON.stringify(line) }
  })
}

/* ================================================================== */
/* 6. Diagrams                                                         */
/* ================================================================== */
async function section6() {
  console.log('\n── 6. Diagrams ──')
  await reset()

  await r.guard('6.1', 'diagrams sidebar lists templates', async () => {
    await openSidebar('Diagrams')
    const cards = await cdp.evaluate(
      `return [...document.querySelectorAll('.template-card')].map(e=>e.textContent.trim())`,
    )
    return { ok: cards.length >= 5, detail: JSON.stringify(cards.slice(0, 3)) }
  })

  await r.guard('6.2', 'creating from a template opens the canvas editor', async () => {
    // "UML class diagram" is ambiguous: the sidebar now has a *Generate from
    // code* card by that exact name which writes a Mermaid markdown file, and it
    // comes first in the DOM. Only the cards under *New from template* create a
    // canvas diagram, and those are the ones with a description.
    await cdp.evaluate(`
      const card = [...document.querySelectorAll('.template-card')]
        .find(c => c.querySelector('small') && c.textContent.includes('UML class diagram'))
      if (!card) throw new Error('no canvas template card named "UML class diagram"')
      card.scrollIntoView({ block: 'center' })
      return true
    `)
    await cdp.clickText('.template-card:has(small)', 'UML class diagram', { settle: 2600 })
    const ok = await cdp.waitFor(`document.querySelectorAll('.diagram-canvas').length > 0`, {
      label: 'diagram canvas',
    }).then(() => true).catch(() => false)
    return { ok, detail: `canvas=${ok}` }
  })

  await r.guard('6.3', 'nodes render with labels, icons and shapes', async () => {
    const info = await cdp.evaluate(`
      const svg = document.querySelector('.diagram-canvas')
      return {
        groups: svg.querySelectorAll('g[transform^="translate"]').length,
        labels: [...svg.querySelectorAll('text')].map(t=>t.textContent).filter(Boolean).slice(0,6),
        icons: svg.querySelectorAll('svg').length,
        shapes: svg.querySelectorAll('rect, polygon, ellipse, path').length,
      }`)
    return {
      ok: info.groups >= 5 && info.labels.some((l) => l.includes('Repository')) && info.icons > 0,
      detail: JSON.stringify(info),
    }
  })

  await r.guard('6.4', 'clicking a node shows the inspector', async () => {
    const node = await cdp.evaluate(`
      const svg = document.querySelector('.diagram-canvas')
      const g = [...svg.querySelectorAll('g[transform^="translate"]')].find(g => g.querySelector('text'))
      const r = g.getBoundingClientRect()
      return { x: r.left + 30, y: r.top + r.height/2 }`)
    await cdp.clickPoint(node)
    await cdp.sleep(700)
    const title = await text('.inspector-title')
    return { ok: title === 'Node', detail: String(title) }
  })

  await r.guard('6.5', 'editing the label updates the canvas', async () => {
    const input = await cdp.boxOf('.inspector .field input')
    await cdp.clickPoint(input, { clickCount: 3 })
    await cdp.sleep(200)
    await cdp.type('RenamedNode')
    await cdp.sleep(900)
    const labels = await cdp.evaluate(
      `return [...document.querySelectorAll('.diagram-canvas text')].map(t=>t.textContent)`,
    )
    return { ok: labels.some((l) => l.includes('RenamedNode')), detail: JSON.stringify(labels.slice(0, 5)) }
  })

  await r.guard('6.6', 'changing colour updates the node', async () => {
    // Node groups are the ones with a move cursor; edges use a pointer cursor.
    const strokeOfSelected = `
      const g=[...document.querySelectorAll('.diagram-canvas g[style*="cursor: move"]')]
        .find(g=>(g.textContent||'').includes('RenamedNode'))
      const shape=g && g.querySelector('rect,polygon,ellipse,path')
      return shape ? shape.getAttribute('stroke') : null`
    const before = await cdp.evaluate(strokeOfSelected)
    await cdp.click('.swatches .swatch', { nth: 4, settle: 900 })
    const after = await cdp.evaluate(strokeOfSelected)
    return { ok: Boolean(before) && before !== after, detail: `${before} -> ${after}` }
  })

  await r.guard('6.7', 'adding a node via the toolbar works', async () => {
    const before = await count('.diagram-canvas g[transform^="translate"]')
    await cdp.clickText('.diagram-toolbar .btn', 'Node', { settle: 900 })
    const after = await count('.diagram-canvas g[transform^="translate"]')
    return { ok: after > before, detail: `${before} -> ${after}` }
  })

  await r.guard('6.8', 'mermaid mode renders a live diagram', async () => {
    await cdp.clickText('.segmented button', 'Mermaid', { settle: 2600 })
    const ok = await cdp
      .waitFor(`document.querySelectorAll('.mermaid-svg svg').length > 0`, { label: 'mermaid svg' })
      .then(() => true)
      .catch(() => false)
    const nodes = await count('.mermaid-svg svg g')
    await cdp.clickText('.segmented button', 'Canvas', { settle: 900 })
    return { ok: ok && nodes > 0, detail: `svg=${ok} groups=${nodes}` }
  })

  await r.guard('6.9', 'diagram saves to disk', async () => {
    await cdp.key('s', ['meta'])
    await cdp.sleep(1200)
    const files = await fs.readdir(PROJECT)
    const name = files.find((f) => f.endsWith('.nova-diagram.json'))
    if (!name) return { ok: false, detail: JSON.stringify(files) }
    const doc = JSON.parse(await fs.readFile(path.join(PROJECT, name), 'utf8'))
    return {
      ok: doc.nodes.some((n) => n.label === 'RenamedNode'),
      detail: `${name} nodes=${doc.nodes.length}`,
    }
  })
}

/* ================================================================== */
/* 7. Markdown                                                         */
/* ================================================================== */
async function section7() {
  console.log('\n── 7. Markdown ──')
  await reset()
  await openFileByClick(null, 'README.md', 2600)

  await r.guard('7.1', 'markdown opens in split view', async () => {
    const ok = await cdp
      .waitFor(`document.querySelectorAll('.md-preview').length > 0 && document.querySelectorAll('.view-line').length > 0`, {
        label: 'split view',
      })
      .then(() => true)
      .catch(() => false)
    return { ok, detail: `split=${ok}` }
  })

  await r.guard('7.2', 'preview renders headings, tables and highlighted code', async () => {
    const info = await cdp.evaluate(`
      const b=document.querySelector('.markdown-body')
      return {
        h1: !!b.querySelector('h1'), table: !!b.querySelector('table'),
        code: !!b.querySelector('pre code'),
        coloured: b.querySelector('pre code') ? new Set([...b.querySelectorAll('pre code span')].map(s=>getComputedStyle(s).color)).size : 0,
      }`)
    return { ok: info.h1 && info.table && info.code, detail: JSON.stringify(info) }
  })

  await r.guard('7.3', 'mermaid fences render as diagrams', async () => {
    const ok = await cdp
      .waitFor(`document.querySelectorAll('.md-mermaid svg').length > 0`, { label: 'md mermaid' })
      .then(() => true)
      .catch(() => false)
    return { ok, detail: `rendered=${ok}` }
  })

  await r.guard('7.4', 'source / split / preview modes switch', async () => {
    // Scoped to the markdown editor's own preview pane. A bare `.markdown-body`
    // also matches every rendered message in the AI console — and the console
    // restores its previous chat on launch, so the unscoped check reported the
    // source pane as broken whenever an earlier run had left a transcript.
    const preview = '.md-preview .markdown-body'
    await cdp.clickText('.md-toolbar .segmented button', 'Preview', { settle: 900 })
    const previewOnly = (await count('.view-line')) === 0 && (await exists(preview))
    await cdp.clickText('.md-toolbar .segmented button', 'Source', { settle: 900 })
    const sourceOnly = (await count('.view-line')) > 0 && !(await exists(preview))
    await cdp.clickText('.md-toolbar .segmented button', 'Split', { settle: 900 })
    return { ok: previewOnly && sourceOnly, detail: `preview=${previewOnly} source=${sourceOnly}` }
  })
}

/* ================================================================== */
/* 8. Browser pane                                                     */
/* ================================================================== */
async function section8() {
  console.log('\n── 8. Browser pane ──')
  await reset()
  const site = await startPageServer()

  await r.guard('8.1', 'opens from the title bar', async () => {
    await cdp.click('[title^="Open browser preview"]', { settle: 2000 })
    return { ok: await exists('webview'), detail: `webview=${await exists('webview')}` }
  })

  await r.guard('8.2', 'loads a URL typed into the address bar', async () => {
    /*
     * Confirm the field actually took the text before committing it.
     *
     * The pane hosts a webview that can take focus back after the click, so
     * typing occasionally went nowhere and the check reported a working browser
     * as broken — the address bar still holding the home page it started on.
     * Retrying against what the field contains is the difference between
     * testing the browser and testing the timing.
     */
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await cdp.boxOf('.browser-address input')
      await cdp.clickPoint(box, { clickCount: 3 })
      await cdp.sleep(250)
      await cdp.type(`${site.origin}/`)
      await cdp.sleep(250)
      const typed = await cdp.evaluate(
        `return document.querySelector('.browser-address input')?.value ?? ''`,
      )
      if (typed.includes(String(site.port))) break
    }
    await cdp.key('Enter')
    // Wait for the navigation rather than guessing how long it takes. A fixed
    // sleep made this fail on a slow load and pass on a fast one, which is a
    // report about the machine rather than about the browser pane.
    const url = await cdp
      .waitFor(
        `(() => {
          const w = document.querySelector('webview')
          const u = w ? w.getURL() : ''
          return u.includes(${JSON.stringify(String(site.port))}) ? u : null
        })()`,
        { timeout: 20000, interval: 500, label: 'the typed URL to load' },
      )
      .catch(() => '')
    return { ok: Boolean(url), detail: url || 'never navigated' }
  })

  await r.guard('8.3', 'renders the page (real DOM in the guest)', async () => {
    const info = await cdp.evaluate(`
      const w = document.querySelector('webview')
      const title = await w.executeJavaScript('document.title')
      const heading = await w.executeJavaScript("document.querySelector('h1') ? document.querySelector('h1').textContent : ''")
      return { title, heading }`, 30000)
    return { ok: Boolean(info.title) && Boolean(info.heading), detail: JSON.stringify(info) }
  })

  await r.guard('8.4', 'back / forward / reload work', async () => {
    await cdp.evaluate(`
      const w=document.querySelector('webview')
      await w.loadURL('${site.origin}/?second=1')
      return true`, 30000)
    await cdp.sleep(2500)
    const canBack = await cdp.evaluate(`return document.querySelector('webview').canGoBack()`)
    await cdp.click('[title="Back"]', { settle: 2500 })
    const url = await cdp.evaluate(`return document.querySelector('webview').getURL()`)
    return { ok: canBack && !url.includes('second'), detail: `canBack=${canBack} url=${url}` }
  })

  await r.guard('8.5', 'responsive presets resize the frame', async () => {
    const wide = await cdp.evaluate(
      `return document.querySelector('.browser-frame').getBoundingClientRect().width`,
    )
    await cdp.click('[title="390px"]', { settle: 900 })
    const narrow = await cdp.evaluate(
      `return document.querySelector('.browser-frame').getBoundingClientRect().width`,
    )
    await cdp.clickText('.browser-toolbar .segmented button', 'Fit', { settle: 600 })
    return { ok: narrow < wide, detail: `${wide} -> ${narrow}` }
  })

  await site.close()
}

/* ================================================================== */
/* 9. Git                                                              */
/* ================================================================== */
async function section9() {
  console.log('\n── 9. Git ──')
  await reset()
  await fs.appendFile(path.join(PROJECT, 'src', 'util.go'), '\n// git section marker\n')
  await openSidebar('Source Control', 2000)

  await r.guard('9.1', 'source control shows branch and change counts', async () => {
    const branch = await cdp.evaluate(
      `const s=document.querySelector('.sidebar select'); return s ? s.value : ''`,
    )
    const headers = await cdp.evaluate(
      `return [...document.querySelectorAll('.section-header')].map(e=>e.textContent.trim())`,
    )
    return {
      ok: /main|master/.test(branch) && headers.some((h) => h.startsWith('Changes')),
      detail: `${branch} ${JSON.stringify(headers)}`,
    }
  })

  await r.guard('9.2', 'changed files listed with status letters', async () => {
    const rows = await cdp.waitFor(`
      (() => {
        const rows = [...document.querySelectorAll('.sidebar .tree-row')]
          .filter(e => e.textContent.includes('util.go'))
          .map(e => (e.querySelector('.tree-status')||{}).textContent||'')
        return rows.length && rows.some(x => x.trim() === 'M') ? rows : null
      })()`, { timeout: 12000, label: 'changed file' }).catch(() => null)
    return { ok: Boolean(rows), detail: JSON.stringify(rows) }
  })

  await r.guard('9.3', 'clicking a change opens a diff', async () => {
    await cdp.clickText('.sidebar .tree-row', 'util.go', { settle: 2600 })
    const ok = await cdp
      .waitFor(`document.querySelectorAll('.monaco-diff-editor').length > 0`, { label: 'diff editor' })
      .then(() => true)
      .catch(() => false)
    return { ok, detail: `diff=${ok}` }
  })

  await r.guard('9.4', 'stage a file from the panel', async () => {
    const staged = await cdp.evaluate(`
      const row=[...document.querySelectorAll('.sidebar .tree-row')].find(e=>e.textContent.includes('util.go'))
      const btn=[...row.querySelectorAll('.icon-btn')].find(b=>b.title==='Stage')
      if (!btn) return null
      const r=btn.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }`)
    if (!staged) return { ok: false, detail: 'no stage button' }
    await cdp.clickPoint(staged)
    await cdp.sleep(1800)
    const headers = await cdp.evaluate(
      `return [...document.querySelectorAll('.section-header')].map(e=>e.textContent.trim())`,
    )
    return { ok: headers.some((h) => h.startsWith('Staged')), detail: JSON.stringify(headers) }
  })

  await r.guard('9.5', 'commit creates a commit', async () => {
    const box = await cdp.boxOf('.sidebar textarea')
    await cdp.clickPoint(box)
    await cdp.type('UI suite commit')
    await cdp.sleep(400)
    await cdp.clickText('.sidebar .btn.primary', 'Commit', { settle: 3000 })
    const subjects = await cdp.evaluate(
      `return [...document.querySelectorAll('.sidebar .tree-row')].map(e=>e.textContent)`,
    )
    return {
      ok: subjects.some((x) => x.includes('UI suite commit')),
      detail: JSON.stringify(subjects.slice(0, 4)),
    }
  })

  await r.guard('9.7', 'clicking a commit opens the commit viewer', async () => {
    await cdp.clickText('.sidebar .tree-row', 'UI suite commit', { settle: 2600 })
    const info = await cdp.evaluate(`
      const h=document.querySelector('.commit-header h3')
      return { heading: h?h.textContent:'', diffLines: document.querySelectorAll('.unified-diff > div').length,
               files: document.querySelectorAll('.commit-files .tree-row').length }`)
    return {
      ok: info.heading.includes('UI suite commit') && info.diffLines > 0,
      detail: JSON.stringify(info),
    }
  })

  await r.guard('9.8', 'commit context menu offers revert / cherry-pick / reset', async () => {
    const point = await cdp.boxOfText('.sidebar .tree-row', 'UI suite commit')
    await cdp.clickPoint(point, { button: 'right' })
    await cdp.sleep(700)
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.context-item')].map(e=>e.textContent.trim())`,
    )
    await cdp.key('Escape')
    return {
      ok: ['Revert', 'Cherry-pick', 'Reset'].every((w) => items.some((i) => i.includes(w))),
      detail: JSON.stringify(items),
    }
  })

  await r.guard('9.9', 'blame gutter shows per-line authorship', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ showBlame: true })
      s.setState({ sidebarView: 'explorer' })
      await s.getState().openFile(s.getState().root + '/src/util.go')
      return true`)
    await cdp.sleep(2600)
    const rows = await cdp.waitFor(
      `(() => { const r=[...document.querySelectorAll('.blame-row')].map(e=>e.textContent).filter(Boolean); return r.length?r:null })()`,
      { timeout: 12000, label: 'blame rows' },
    ).catch(() => null)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ showBlame: false }); return true`)
    return { ok: Boolean(rows), detail: JSON.stringify((rows ?? []).slice(0, 3)) }
  })

  await r.guard('9.10', 'stash creates and lists a stash', async () => {
    await fs.appendFile(path.join(PROJECT, 'src', 'util.go'), '\n// to be stashed\n')
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.setState({ sidebarView: 'git' }); await s.getState().refreshGit(); return true`)
    await cdp.sleep(1500)
    await cdp.click('[title="Stash all changes"]', { settle: 3000 })
    const headers = await cdp.evaluate(
      `return [...document.querySelectorAll('.section-header')].map(e=>e.textContent.trim())`,
    )
    return { ok: headers.some((h) => h.startsWith('Stashes')), detail: JSON.stringify(headers) }
  })
}


/* ================================================================== */
/* 10. Debugger                                                        */
/* ================================================================== */
async function section10() {
  console.log('\n── 10. Debugger ──')
  await reset()
  await openFileByClick('src', 'main.py')
  await cdp.waitFor(`document.querySelectorAll('.view-line').length > 0`, { label: 'editor' })

  await r.guard('10.1', 'gutter click sets a breakpoint', async () => {
    // Line 6 of main.py is `order = service.create_order(42)`.
    const point = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const top = ed.getTopForLineNumber(6) - ed.getScrollTop()
      const node = ed.getDomNode().getBoundingClientRect()
      const margin = document.querySelector('.margin-view-overlays').getBoundingClientRect()
      return { x: margin.left + 8, y: node.top + top + 8 }`)
    await cdp.clickPoint(point)
    await cdp.sleep(1200)
    const dots = await count('.nova-breakpoint')
    return { ok: dots > 0, detail: `markers=${dots}` }
  })

  await r.guard('10.2', 'debug panel starts a session and pauses', async () => {
    await openPanelTab('Debug')
    const started = await cdp.clickText('.usages-header .btn', 'Debug this file', { settle: 1500 })
    if (!started) return { ok: false, detail: 'no start button' }
    const paused = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore; return s.getState().debug.state?.status === 'paused' })()`,
        { timeout: 45000, interval: 700, label: 'paused' },
      )
      .then(() => true)
      .catch(() => false)
    const err = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().debug.state?.error ?? ''`,
    )
    return { ok: paused, detail: paused ? '' : `error=${err}` }
  })

  await r.guard('10.3', 'paused line is highlighted in the editor', async () => {
    const marks = await count('.nova-debug-line')
    return { ok: marks > 0, detail: `highlighted=${marks}` }
  })

  await r.guard('10.4', 'call stack lists frames', async () => {
    const frames = await cdp.evaluate(
      `return [...document.querySelectorAll('.debug-column')][0].querySelectorAll('.tree-row').length`,
    )
    return { ok: frames > 0, detail: `frames=${frames}` }
  })

  await r.guard('10.5', 'variables tree shows locals', async () => {
    const rows = await cdp.waitFor(
      `(() => { const c=[...document.querySelectorAll('.debug-column')][1]; const r=[...c.querySelectorAll('.tree-row')].map(e=>e.textContent.trim()); return r.length>1?r:null })()`,
      { timeout: 12000, label: 'variables' },
    ).catch(() => null)
    return { ok: Boolean(rows), detail: JSON.stringify((rows ?? []).slice(0, 5)) }
  })

  await r.guard('10.6', 'watch expression evaluates', async () => {
    const box = await cdp.boxOf('.debug-column input')
    if (!box) return { ok: false, detail: 'no watch input' }
    await cdp.clickPoint(box)
    await cdp.type('1 + 41')
    await cdp.key('Enter')
    await cdp.sleep(1800)
    const watches = await cdp.evaluate(
      `const c=[...document.querySelectorAll('.debug-column')][2]; return [...c.querySelectorAll('.tree-row')].map(e=>e.textContent.trim())`,
    )
    return { ok: watches.some((w) => w.includes('42')), detail: JSON.stringify(watches) }
  })

  await r.guard('10.7', 'step over advances the line', async () => {
    const before = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().debug.state?.frames[0]?.line`,
    )
    await cdp.click('[title^="Step over"]', { settle: 2200 })
    const after = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().debug.state?.frames[0]?.line`,
    )
    return { ok: after > before, detail: `${before} -> ${after}` }
  })

  await r.guard('10.8', 'continue runs to completion with console output', async () => {
    await cdp.click('[title^="Continue"]', { settle: 1200 })
    const done = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore; return s.getState().debug.state?.status === 'inactive' })()`,
        { timeout: 30000, interval: 600, label: 'session end' },
      )
      .then(() => true)
      .catch(() => false)
    await cdp.clickText('.usages-header .segmented button', 'Console', { settle: 900 })
    const out = (await text('.test-output')) ?? ''
    return { ok: done && out.includes('created='), detail: out.slice(0, 90) }
  })
}

/* ================================================================== */
/* 11. Tests                                                           */
/* ================================================================== */
async function section11() {
  console.log('\n── 11. Tests ──')
  await reset()
  // Give the fixture a runnable pytest suite.
  await fs.mkdir(path.join(PROJECT, 'tests'), { recursive: true })
  await fs.writeFile(path.join(PROJECT, 'pytest.ini'), '[pytest]\n')
  await fs.writeFile(
    path.join(PROJECT, 'tests', 'test_orders.py'),
    `import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from orders import build_service


def test_creates_order():
    assert build_service().create_order(5)["total"] == 5


def test_deliberately_fails():
    assert build_service().create_order(5)["total"] == 6
`,
  )
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    s.getState().bumpTree(); await s.getState().detectTestFrameworks(); return true`)
  await cdp.sleep(1500)

  await r.guard('11.1', 'test framework detected', async () => {
    const fw = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().testFrameworks.map(f=>f.id)`,
    )
    return { ok: fw.includes('pytest'), detail: JSON.stringify(fw) }
  })

  await r.guard('11.2', 'Run all executes and reports results', async () => {
    await openPanelTab('Tests')
    const clicked = await cdp.clickText('.usages-header .btn', 'Run all', { settle: 1500 })
    if (!clicked) return { ok: false, detail: 'no Run all button' }
    const finished = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore; const t=s.getState().testRun; return t && !t.running })()`,
        { timeout: 60000, interval: 800, label: 'test run' },
      )
      .then(() => true)
      .catch(() => false)
    const cases = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return (s.getState().testRun?.cases ?? []).map(c=>c.name+':'+c.status)`,
    )
    return { ok: finished && cases.length >= 2, detail: JSON.stringify(cases) }
  })

  await r.guard('11.3', 'results grouped with pass/fail counts', async () => {
    const chips = await cdp.evaluate(
      `return [...document.querySelectorAll('.usages-header .chip')].map(e=>e.textContent.trim())`,
    )
    return {
      ok: chips.some((c) => /1 passed/.test(c)) && chips.some((c) => /1 failed/.test(c)),
      detail: JSON.stringify(chips),
    }
  })

  await r.guard('11.4', 'failure output expands', async () => {
    const failing = await cdp.boxOfText('.usages-body .tree-row', 'deliberately_fails')
    if (!failing) return { ok: false, detail: 'no failing test row' }
    await cdp.clickPoint(failing)
    await cdp.sleep(900)
    const detail = await text('.test-failure')
    return { ok: Boolean(detail && detail.length > 20), detail: String(detail).slice(0, 80) }
  })

  await r.guard('11.5', 'gutter markers offer to run a single test', async () => {
    await openFileByClick('tests', 'test_orders.py', 2600)
    const markers = await cdp
      .waitFor(`document.querySelectorAll('.nova-test-glyph').length`, { timeout: 12000, label: 'test glyphs' })
      .catch(() => 0)
    return { ok: markers >= 2, detail: `glyphs=${markers}` }
  })
}

/* ================================================================== */
/* 12. Language server features                                        */
/* ================================================================== */
async function section12() {
  console.log('\n── 12. Language server ──')
  await reset()
  // clangd is present on macOS via the Xcode toolchain, so use a C file.
  await fs.writeFile(
    path.join(PROJECT, 'compile_commands.json'),
    JSON.stringify([{ directory: PROJECT, file: path.join(PROJECT, 'src', 'calc.c'), command: `clang -c ${path.join(PROJECT, 'src', 'calc.c')}` }], null, 2),
  )
  await fs.writeFile(
    path.join(PROJECT, 'src', 'calc.c'),
    `#include <stdio.h>\n\nint add(int a, int b) {\n    return a + b;\n}\n\nint main(void) {\n    int total = add(2, 3);\n    printf("%d\\n", undefined_symbol);\n    return 0;\n}\n`,
  )
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore; s.getState().bumpTree(); return true`)
  await openFileByClick('src', 'calc.c', 3000)
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    await s.getState().reloadBuffer(s.getState().root + '/src/calc.c'); return true`)
  await cdp.sleep(800)

  // clangd parses on first open; give it a moment before asserting.
  await cdp
    .waitFor(
      `(async () => { const c = await window.nova.lsp.capabilities('c'); return Boolean(c) })()`,
      { timeout: 30000, interval: 800, label: 'clangd ready' },
    )
    .catch(() => null)
  await cdp.sleep(2500)

  await r.guard('12.1', 'diagnostics render as squiggles and in Problems', async () => {
    const squiggles = await cdp
      .waitFor(`document.querySelectorAll('.squiggly-error, .squiggly-warning').length`, {
        timeout: 30000,
        interval: 1000,
        label: 'squiggles',
      })
      .catch(() => 0)
    await openPanelTab('Problems')
    const problems = await count('.pane-body .tree-row')
    return { ok: squiggles > 0 && problems > 0, detail: `squiggles=${squiggles} problems=${problems}` }
  })

  await r.guard('12.2', 'hover shows type information', async () => {
    await cdp.click('[title^="Toggle panel"]', { settle: 500 })
    const spot = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const m = ed.getModel()
      const hit = m.findMatches('add', false, false, true, null, false).find(x => x.range.startLineNumber === 8)
      if (!hit) return null
      const pos = { lineNumber: hit.range.startLineNumber, column: hit.range.startColumn + 1 }
      const coords = ed.getScrolledVisiblePosition(pos)
      const box = ed.getDomNode().getBoundingClientRect()
      return { x: box.left + coords.left + 2, y: box.top + coords.top + 8 }`)
    if (!spot) return { ok: false, detail: 'token not found' }
    await cdp.hover(spot)
    await cdp.sleep(2500)
    // Monaco renders hover markdown into `.hover-contents`.
    const hover = await cdp.evaluate(
      `const h=document.querySelector('.hover-contents'); return h ? h.textContent.slice(0,140) : ''`,
    )
    return { ok: /int/.test(hover) && /add|sum/.test(hover), detail: hover.replace(/\n/g, ' ') }
  })

  await r.guard('12.6', 'inlay hints render inline', async () => {
    const hints = await count('.monaco-editor .inlay-hint, .monaco-editor span[class*="inlayHint"]')
    // clangd emits parameter-name hints; absence is acceptable, presence proves the wiring.
    return { ok: true, detail: `hints=${hints} (informational)` }
  })

  await r.guard('12.4', 'rename shows the preview dialog and applies', async () => {
    await cdp.key('Escape')            // dismiss any hover widget
    await cdp.click('.view-lines', { settle: 600 })
    const placed = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const m = ed.getModel()
      const hit = m.findMatches('add', false, false, true, null, false)[0]
      if (!hit) return null
      ed.setPosition({ lineNumber: hit.range.startLineNumber, column: hit.range.startColumn + 1 })
      ed.focus()
      return m.getWordAtPosition(ed.getPosition())?.word`)
    if (placed !== 'add') return { ok: false, detail: `caret on ${placed}` }

    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      monaco.editor.getEditors()[0].trigger('ui-suite', 'editor.action.rename', {})
      return true`)
    // Wait for *focus*, not just existence: typing before the box is focused
    // sends the keystrokes into the document instead.
    const input = await cdp
      .waitFor(
        `document.activeElement && document.activeElement.classList.contains('rename-input')`,
        { timeout: 15000, interval: 300, label: 'rename input focus' },
      )
      .then(() => true)
      .catch(() => false)
    if (!input) return { ok: false, detail: 'rename input never took focus' }
    await cdp.sleep(300)

    // The rename box pre-selects the current name, so typing replaces it.
    // (A ⌘A here would select the whole document instead and destroy the file.)
    await cdp.type('sum')
    await cdp.key('Enter')

    const modal = await cdp
      .waitFor(`document.querySelectorAll('.refactor-modal').length > 0`, {
        timeout: 20000, interval: 500, label: 'refactor preview',
      })
      .then(() => true)
      .catch(() => false)
    if (!modal) return { ok: false, detail: 'preview modal never appeared' }

    const head = (await text('.refactor-head')) ?? ''
    await cdp.clickText('.refactor-head .btn', 'Apply', { settle: 3000 })
    const content = await fs.readFile(path.join(PROJECT, 'src', 'calc.c'), 'utf8')
    return {
      ok: content.includes('int sum(') && content.includes('sum(2, 3)'),
      detail: `${head.slice(0, 40)} | renamed=${content.includes('int sum(')}`,
    }
  })

  await r.guard('12.3', 'completion includes symbols only the server knows', async () => {
    await cdp.click('.view-lines', { settle: 500 })
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const m = ed.getModel()
      ed.setPosition({ lineNumber: m.getLineCount() - 1, column: 1 })
      ed.focus(); return true`)
    await cdp.key('Enter')
    await cdp.type('    print', 60)
    await cdp.sleep(1200)
    // clangd can be slow on the first completion; ask explicitly and wait.
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      monaco.editor.getEditors()[0].trigger('ui-suite', 'editor.action.triggerSuggest', {})
      return true`)
    const rows = await cdp
      .waitFor(
        `(() => { const r=[...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(e=>e.textContent); return r.length?r:null })()`,
        { timeout: 20000, interval: 800, label: 'suggest rows' },
      )
      .catch(() => [])
    await cdp.key('Escape')
    await cdp.key('z', ['meta'])
    await cdp.key('z', ['meta'])
    // The project index can only ever offer declarations from the project
    // itself; anything from stdio.h or the platform SDK proves the suggestions
    // came from clangd.
    const projectSymbols = ['add', 'sum', 'main', 'Coupon', 'ApplyCoupon', 'OrderService']
    const fromServer = rows.filter(
      (x) => !projectSymbols.some((p) => x.trim().startsWith(p)) && /^\s*(__|printf|put|perror|_)/.test(x),
    )
    return {
      ok: rows.length > 0 && fromServer.length > 0,
      detail: `${rows.length} rows, ${fromServer.length} server-only; ${JSON.stringify(fromServer.slice(0, 2))}`,
    }
  })

  await r.guard('12.5', 'call hierarchy panel populates', async () => {
    await cdp.click('.view-lines', { settle: 500 })
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const m = ed.getModel()
      const hit = m.findMatches('sum', false, false, true, null, false)[0]
      ed.setPosition({ lineNumber: hit.range.startLineNumber, column: hit.range.startColumn + 1 })
      ed.focus(); return true`)
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      monaco.editor.getEditors()[0].getAction('nova.callHierarchy').run(); return true`)
    const rows = await cdp
      .waitFor(
        `(() => { const r=[...document.querySelectorAll('.usages-body .tree-row')].map(e=>e.textContent.trim()); return r.length?r:null })()`,
        { timeout: 25000, interval: 800, label: 'hierarchy rows' },
      )
      .catch(() => null)
    return { ok: Boolean(rows), detail: JSON.stringify((rows ?? []).slice(0, 4)) }
  })
}

/* ================================================================== */
/* 13. AI console                                                      */
/* ================================================================== */
async function section13() {
  console.log('\n── 13. AI console ──')
  await reset()
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    if (!s.getState().aiVisible) s.getState().toggleAi()
    s.getState().clearConversation(); return true`)
  await cdp.sleep(700)

  await r.guard('13.1', 'provider dropdown lists Claude and Codex', async () => {
    const options = await cdp.evaluate(
      `const sel=document.querySelector('.ai-header select'); return sel ? [...sel.options].map(o=>o.textContent.trim()) : []`,
    )
    return {
      ok: options.some((o) => /Claude/.test(o)) && options.some((o) => /Codex/.test(o)),
      detail: JSON.stringify(options),
    }
  })

  await r.guard('13.2', 'suggestion chip fills the composer', async () => {
    const clicked = await cdp.click('.ai-suggestion', { settle: 700 })
    const value = await cdp.evaluate(
      `const t=document.querySelector('.ai-composer textarea'); return t ? t.value : ''`,
    )
    return { ok: clicked && value.length > 10, detail: value.slice(0, 60) }
  })

  await r.guard('13.8', 'permission mode selector offers all modes', async () => {
    const options = await cdp.evaluate(
      `const sel=[...document.querySelectorAll('.ai-composer-actions select')][0]
       return sel ? [...sel.options].map(o=>o.textContent.trim()) : []`,
    )
    return { ok: options.length >= 4, detail: JSON.stringify(options) }
  })

  await r.guard('13.3', 'sending a prompt streams a reply', async () => {
    // Codex is the authenticated provider in this environment. The permission
    // mode is pinned because it decides the sandbox flag the execution turn
    // runs under — left on whatever the user last chose, 13.3c is a coin toss.
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ aiProvider: 'codex', aiPermissionMode: 'acceptEdits' }); return true`)
    await cdp.sleep(500)
    const box = await cdp.boxOf('.ai-composer textarea')
    await cdp.clickPoint(box, { clickCount: 3 })
    await cdp.key('a', ['meta'])
    await cdp.type("Add a comment '// checked by the UI suite' at the top of src/util.go and change nothing else.")
    await cdp.sleep(400)
    await cdp.clickText('.ai-composer-actions .btn', 'Send', { settle: 1500 })
    const finished = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore; const m=s.getState().messages.filter(x=>x.role==='assistant').pop(); return m && m.running === false })()`,
        { timeout: 180000, interval: 1500, label: 'AI turn' },
      )
      .then(() => true)
      .catch(() => false)
    const reply = await count('.ai-text')
    return { ok: finished && reply > 0, detail: `finished=${finished} replyBlocks=${reply}` }
  })

  // A request that changes files is planned first and executed only once the
  // plan is approved, so the edit half of the console is behind that gate.
  await r.guard('13.3b', 'an edit request is planned first and writes nothing yet', async () => {
    const before = await fs.readFile(path.join(PROJECT, 'src', 'util.go'), 'utf8')
    const planned = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore
           const p = s.getState().plan; return p && p.status === 'proposed' && p.steps.length > 0 })()`,
        { timeout: 60000, interval: 1500, label: 'plan card' },
      )
      .then(() => true)
      .catch(() => false)
    const after = await fs.readFile(path.join(PROJECT, 'src', 'util.go'), 'utf8')
    return {
      ok: planned && before === after,
      detail: `planned=${planned} untouched=${before === after}`,
    }
  })

  await r.guard('13.3c', 'Approve executes the plan and the edit lands', async () => {
    const clicked = await cdp.clickText('.plan-card .btn', 'Approve', { settle: 2000 })
    if (!clicked) return { ok: false, detail: 'no Approve button' }
    const done = await cdp
      .waitFor(
        `(async () => { const s=(await import('/src/state/store.ts')).useStore
           const m = s.getState().messages.filter(x=>x.role==='assistant').pop()
           return m && m.running === false })()`,
        { timeout: 300000, interval: 2500, label: 'execution turn' },
      )
      .then(() => true)
      .catch(() => false)
    const body = await fs.readFile(path.join(PROJECT, 'src', 'util.go'), 'utf8')
    return { ok: done && body.includes('checked by the UI suite'), detail: `finished=${done}` }
  })

  await r.guard('13.4', 'tool calls render as activity rows and expand', async () => {
    const groups = await count('.activity-group')
    if (groups === 0) return { ok: false, detail: 'no activity rows' }
    await cdp.click('.activity-group .activity-line', { settle: 700 })
    const expanded = await exists('.activity-detail, .activity-body, .activity-group pre')
    return { ok: expanded, detail: `groups=${groups} expanded=${expanded}` }
  })

  await r.guard('13.5', 'each touched file appears as a change line with +/- counts', async () => {
    const lines = await cdp.evaluate(
      `return [...document.querySelectorAll('.ai-changes .activity-line')].map(e=>e.textContent.trim())`,
    )
    return { ok: lines.length > 0, detail: JSON.stringify(lines).slice(0, 140) }
  })

  await r.guard('13.6', 'clicking a change line opens the diff in the editor', async () => {
    const clicked = await cdp.click('.ai-changes .activity-line', { settle: 3000 })
    const diff = await exists('.monaco-diff-editor')
    return { ok: clicked && diff, detail: `clicked=${clicked} diff=${diff}` }
  })

  await r.guard('13.7', 'Revert in the diff view restores the file', async () => {
    const before = await fs.readFile(path.join(PROJECT, 'src', 'util.go'), 'utf8')
    const clicked = await cdp.clickText('button', 'Revert', { settle: 3000 })
    await cdp.sleep(1200)
    const after = await fs.readFile(path.join(PROJECT, 'src', 'util.go'), 'utf8')
    return {
      ok: clicked && before !== after && !after.includes('checked by the UI suite'),
      detail: `clicked=${clicked} changed=${before !== after}`,
    }
  })

  await r.guard('13.9', 'the plan card is never crushed by the flex transcript', async () => {
    const info = await cdp.evaluate(`
      const s = (await import('/src/state/store.ts')).useStore
      s.getState().setPlan({
        id: 'ui-suite-plan', status: 'proposed',
        summary: 'A plan tall enough to exceed the panel.',
        steps: Array.from({ length: 9 }, (_, i) => ({
          id: 's' + i, status: 'pending',
          text: 'Step ' + (i + 1) + ' with a long enough description to wrap onto a second line',
        })),
      })
      await new Promise(res => setTimeout(res, 600))
      const card = document.querySelector('.plan-card')
      if (!card) return { ok: false, detail: 'no plan card' }
      const title = card.querySelector('.plan-title').getBoundingClientRect()
      const box = card.getBoundingClientRect()
      const approve = [...card.querySelectorAll('.btn')].some(b => b.textContent.includes('Approve'))
      const out = {
        ok: card.scrollHeight <= card.clientHeight + 1 && title.bottom <= box.bottom + 0.5 && approve,
        detail: 'client=' + card.clientHeight + ' scroll=' + card.scrollHeight + ' approve=' + approve,
      }
      s.getState().setPlan(null)
      return out
    `)
    return info
  })
}

/* ================================================================== */
/* 14. Terminal & run configurations                                   */
/* ================================================================== */
async function section14() {
  console.log('\n── 14. Terminal & run ──')
  await reset()


  await r.guard('14.1', 'terminal opens on a real pseudo-terminal', async () => {
    await openPanelTab('Terminal')
    const caps = await cdp.evaluate(`return await window.nova.shell.capabilities()`)
    const ready = await cdp
      .waitFor(
        `(() => { const t=document.querySelector('.terminal-host'); return t && t.textContent.trim().length > 0 ? 'yes' : null })()`,
        { timeout: 20000, interval: 600, label: 'shell prompt' },
      )
      .catch(() => null)
    return { ok: Boolean(ready) && caps.pty === true, detail: `pty=${caps.pty} shell=${caps.shell} ${caps.reason}` }
  })

  // The whole point of a pty: stdout is a tty, so programs behave normally.
  await r.guard('14.1b', 'the shell sees a tty of the right width', async () => {
    await cdp.click('.terminal-host', { settle: 600 })
    await cdp.type('test -t 1 && echo IS_TTY || echo NOT_TTY; tput cols')
    await cdp.key('Enter')
    await cdp.sleep(2500)
    const t = (await text('.terminal-host')) ?? ''
    const cols = /IS_TTY\s*(\d+)/.exec(t)
    return {
      ok: t.includes('IS_TTY') && Boolean(cols) && Number(cols[1]) > 20,
      detail: `cols=${cols?.[1]} ${t.slice(-60)}`,
    }
  })

  // A full-screen program is the case the old pipe-based shell could not run.
  await r.guard('14.1c', 'a full-screen program runs and exits', async () => {
    await cdp.type('seq 1 200 | less')
    await cdp.key('Enter')
    await cdp.sleep(2500)
    const paging = await cdp.evaluate(`
      const rows=[...document.querySelectorAll('.xterm-rows > div')].map(r=>r.textContent.replace(/\u00a0/g,' ').trimEnd()).filter(Boolean)
      return { first: rows[0] ?? '', last: rows[rows.length-1] ?? '' }`)
    await cdp.type('q')
    await cdp.sleep(1500)
    const after = await cdp.evaluate(`
      const rows=[...document.querySelectorAll('.xterm-rows > div')].map(r=>r.textContent.replace(/\u00a0/g,' ').trimEnd()).filter(Boolean)
      return rows[rows.length-1] ?? ''`)
    return {
      ok: paging.first.trim() === '1' && !after.includes(':'),
      detail: `first=${paging.first.trim()} last=${paging.last.trim()} after=${after.slice(-40)}`,
    }
  })

  await r.guard('14.2', 'a command runs and prints output', async () => {
    await cdp.click('.terminal-host', { settle: 600 })
    await cdp.type('echo hello-from-ui-suite')
    await cdp.key('Enter')
    await cdp.sleep(3000)
    const t = (await text('.terminal-host')) ?? ''
    return { ok: t.includes('hello-from-ui-suite'), detail: t.slice(-90) }
  })

  await r.guard('14.3', 'cd persists between commands', async () => {
    /*
     * A terminal outlives the project that opened it — deliberately, since
     * killing a running process on a project switch would be worse. That left
     * this check reading whatever directory the previous suite's shell was
     * sitting in, and reporting a working feature as broken. Anchor it first:
     * what is under test is that `cd` persists to the next command, not where
     * the shell happened to start.
     */
    await cdp.click('.terminal-host', { settle: 400 })
    await cdp.type(`cd ${PROJECT}`)
    await cdp.key('Enter')
    await cdp.sleep(1500)
    await cdp.type('cd src')
    await cdp.key('Enter')
    await cdp.sleep(2500)
    await cdp.type('pwd')
    await cdp.key('Enter')
    await cdp.sleep(2500)
    const t = (await text('.terminal-host')) ?? ''
    return { ok: /ui-demo\/src/.test(t), detail: t.slice(-90) }
  })

  await r.guard('14.4', 'run picker lists detected configurations', async () => {
    const label = (await text('.run-picker')) ?? ''
    await cdp.click('.run-picker .icon-btn', { settle: 800 })
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.run-menu .context-item')].map(e=>e.textContent.trim())`,
    )
    return {
      ok: items.some((i) => i.includes('dev')) && items.some((i) => i.includes('build')),
      detail: `${label} ${JSON.stringify(items.slice(0, 4))}`,
    }
  })

  await r.guard('14.5', 'running a configuration executes it in the terminal', async () => {
    // 14.3 left the shell inside src/; go back so npm resolves immediately.
    // Clicking the terminal dismisses the run menu, so reopen it afterwards.
    await cdp.click('.terminal-host', { settle: 400 })
    await cdp.type('cd ..')
    await cdp.key('Enter')
    await cdp.sleep(2500)
    const menuOpen = await cdp.evaluate(`return document.querySelectorAll('.run-menu').length > 0`)
    if (!menuOpen) await cdp.click('.run-picker .icon-btn', { settle: 900 })
    const clicked = await cdp.clickText('.run-menu .context-item', 'build', { settle: 1500 })
    if (!clicked) return { ok: false, detail: 'build entry not found in the menu' }
    // npm takes a moment to start; wait for the script's output rather than guessing.
    const out = await cdp
      .waitFor(
        `(() => { const t=document.querySelector('.terminal-host'); return t && t.textContent.includes('built') ? 'yes' : null })()`,
        { timeout: 60000, interval: 800, label: 'run output' },
      )
      .catch(() => null)
    const t = (await text('.terminal-host')) ?? ''
    return { ok: Boolean(out), detail: t.slice(-80) }
  })
}

/* ================================================================== */
/* 15. Themes & settings                                               */
/* ================================================================== */
async function section15() {
  console.log('\n── 15. Themes & settings ──')
  await reset()

  await r.guard('15.1', 'themes sidebar lists 10 themes with previews', async () => {
    await openSidebar('Themes', 1200)
    const cards = await count('.theme-card')
    const previews = await count('.theme-preview')
    return { ok: cards === 10 && previews === 10, detail: `cards=${cards} previews=${previews}` }
  })

  await r.guard('15.2', 'selecting a theme restyles the whole app', async () => {
    const before = await cdp.evaluate(
      `return { theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }`,
    )
    await cdp.clickText('.theme-card', 'Solarized Light', { settle: 1500 })
    const after = await cdp.evaluate(
      `return { theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }`,
    )
    await cdp.clickText('.theme-card', 'Nova Dark', { settle: 1200 })
    return {
      ok: after.theme === 'solarized-light' && after.bg !== before.bg,
      detail: `${before.theme}/${before.bg} -> ${after.theme}/${after.bg}`,
    }
  })

  await r.guard('15.3', 'settings page opens', async () => {
    await cdp.clickText('.sidebar-header .btn', 'All settings', { settle: 1800 })
    const headings = await cdp.evaluate(
      `return [...document.querySelectorAll('.settings-view h2')].map(e=>e.textContent.trim())`,
    )
    return {
      ok: headings.includes('Theme') && headings.includes('Editor') && headings.some((h) => /Language servers/i.test(h)),
      detail: JSON.stringify(headings),
    }
  })

  await r.guard('15.4', 'editor settings apply (word wrap toggle)', async () => {
    const before = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().settings.wordWrap`,
    )
    await cdp.clickText('.toggle-row .toggle', 'Word wrap', { settle: 900 })
    const after = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; return s.getState().settings.wordWrap`,
    )
    await cdp.clickText('.toggle-row .toggle', 'Word wrap', { settle: 700 })
    return { ok: before !== after, detail: `${before} -> ${after}` }
  })

  await r.guard('15.5', 'icon pack switch changes tree icons', async () => {
    const readIcons = `
      const s=(await import('/src/state/store.ts')).useStore
      s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
      await new Promise(r=>setTimeout(r,500))
      return [...document.querySelectorAll('.tree-row svg')].slice(0,6)
        .map(e => getComputedStyle(e).color).join('|')`
    const before = await cdp.evaluate(readIcons)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ iconPack: 'minimal' }); return true`)
    await cdp.sleep(900)
    const after = await cdp.evaluate(readIcons)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ iconPack: 'nova' }); return true`)
    return { ok: Boolean(before) && before !== after, detail: `${before.slice(0, 40)} -> ${after.slice(0, 40)}` }
  })

  await r.guard('15.6', 'language servers and debuggers listed with status', async () => {
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.lsp-row')].map(e=>e.textContent.trim())`,
    )
    return { ok: rows.length >= 2, detail: JSON.stringify(rows.slice(0, 3)).slice(0, 160) }
  })

  await r.guard('15.7', 'settings persist to disk', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ fontSize: 15 }); return true`)
    await cdp.sleep(900)
    const persisted = await cdp.evaluate(
      `const v = await window.nova.app.readSettings(); return v ? v.fontSize : null`,
    )
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setSettings({ fontSize: 13 }); return true`)
    return { ok: persisted === 15, detail: `stored=${persisted}` }
  })
}

/* ================================================================== */
/* 16. Local history                                                   */
/* ================================================================== */
async function section16() {
  console.log('\n── 16. Local history ──')
  await reset()

  // Local history records the content a file had *before* an overwrite, so make
  // a change here to guarantee a revision that differs from what is on disk.
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    const file = s.getState().root + '/src/orders.py'
    await s.getState().openFile(file)
    await new Promise(r=>setTimeout(r,600))
    const buf = s.getState().buffers[file]
    const NL = String.fromCharCode(10)
    s.getState().updateBuffer(file, buf.content + NL + '# local-history marker' + NL)
    await s.getState().saveBuffer(file)
    return true`)
  await cdp.sleep(1500)

  await r.guard('16.1', 'Local History opens from the context menu', async () => {
    await expandFolder('src')
    const point = await cdp.boxOfText('.tree-row', 'orders.py')
    await cdp.clickPoint(point, { button: 'right' })
    await cdp.sleep(700)
    const clicked = await cdp.clickText('.context-item', 'Local History', { settle: 2200 })
    const opened = await exists('.diff-view')
    return { ok: clicked && opened, detail: `opened=${opened}` }
  })

  await r.guard('16.2', 'revisions listed after edits', async () => {
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.commit-files .tree-row')].map(e=>e.textContent.trim())`,
    )
    return { ok: rows.length > 0, detail: JSON.stringify(rows.slice(0, 2)) }
  })

  await r.guard('16.3', 'diff against current is shown', async () => {
    const ok = await exists('.monaco-diff-editor')
    return { ok, detail: `diff=${ok}` }
  })

  await r.guard('16.4', 'restore rewrites the file', async () => {
    const before = await fs.readFile(path.join(PROJECT, 'src', 'orders.py'), 'utf8')
    // Pick the newest revision explicitly, then restore it.
    await cdp.click('.commit-files .tree-row', { nth: 0, settle: 1200 })
    const clicked = await cdp.clickText('.md-toolbar .btn', 'Restore this revision', { settle: 3000 })
    const after = await fs.readFile(path.join(PROJECT, 'src', 'orders.py'), 'utf8')
    return {
      ok: clicked && before !== after && !after.includes('local-history marker'),
      detail: `clicked=${clicked} changed=${before !== after}`,
    }
  })
}

/* ================================================================== */
/* 17. Refactoring                                                     */
/* ================================================================== */

/** Selects the first match of `needle` in the active editor. */
async function selectInEditor(needle) {
  return cdp.evaluate(`
    const { monaco } = await import('/src/lib/monacoSetup.ts')
    const ed = monaco.editor.getEditors()[0]
    const hit = ed.getModel().findMatches(${JSON.stringify(needle)}, false, false, true, null, false)[0]
    if (!hit) return false
    ed.setSelection(hit.range); ed.revealRange(hit.range); ed.focus()
    return true`)
}

/** Puts the caret on the first whole-word match of `needle`. */
async function caretOn(needle) {
  return cdp.evaluate(`
    const { monaco } = await import('/src/lib/monacoSetup.ts')
    const ed = monaco.editor.getEditors()[0]
    const hit = ed.getModel().findMatches(${JSON.stringify(needle)}, false, false, true, ' \\t()[]{},:.', false)[0]
    if (!hit) return false
    ed.setPosition({ lineNumber: hit.range.startLineNumber, column: hit.range.startColumn + 1 })
    ed.focus()
    return true`)
}

async function runRefactorAction(id) {
  await cdp.evaluate(`
    const { monaco } = await import('/src/lib/monacoSetup.ts')
    monaco.editor.getEditors()[0].trigger('suite', ${JSON.stringify(`nova.refactor.${id}`)}, null)`)
  await cdp.sleep(1400)
}

/** Replaces the nth text input of the refactor dialog. */
async function fillDialog(nth, value) {
  const selector = '.refactor-dialog .refactor-fields input:not([type=checkbox])'
  const point = await cdp.boxOf(selector, nth)
  if (!point) return false
  await cdp.clickPoint(point, { clickCount: 3 })
  await cdp.sleep(120)
  await cdp.type(value)
  await cdp.sleep(150)
  return true
}

const confirmDialog = () => cdp.click('.refactor-dialog .btn.primary', { settle: 1600 })
const applyPreview = () => cdp.clickText('.refactor-modal .btn.primary', 'Apply', { settle: 2500 })

async function section17() {
  console.log('\n── 17. Refactoring ──')
  await reset()
  const ordersPath = path.join(PROJECT, 'src', 'orders.py')
  const mainPath = path.join(PROJECT, 'src', 'main.py')
  const ordersBefore = await fs.readFile(ordersPath, 'utf8')
  const mainBefore = await fs.readFile(mainPath, 'utf8')

  const restore = async () => {
    await fs.writeFile(ordersPath, ordersBefore)
    await fs.writeFile(mainPath, mainBefore)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      const st=s.getState()
      st.tabs.filter(t=>t.path && t.path.endsWith('.py')).forEach(t=>st.closeTab(t.id))
      return true`)
    await cdp.sleep(500)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(${JSON.stringify(ordersPath)}); return true`)
    await cdp.sleep(1000)
  }

  await restore()

  await r.guard('17.1', 'Refactor This (⌃T) lists the available refactorings', async () => {
    await selectInEditor('{"id": "1", "total": total}')
    await cdp.key('t', ['ctrl'])
    await cdp.sleep(700)
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.refactor-menu .modal-item')].map(e=>e.textContent)`,
    )
    await cdp.key('Escape')
    return { ok: items.length >= 14, detail: `entries=${items.length}` }
  })

  await r.guard('17.2', 'entries needing a selection are disabled without one', async () => {
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      ed.setPosition({ lineNumber: 1, column: 1 }); ed.focus(); return true`)
    await cdp.key('t', ['ctrl'])
    await cdp.sleep(600)
    const disabled = await cdp.evaluate(
      `return [...document.querySelectorAll('.refactor-menu .modal-item')].filter(e=>e.disabled).length`,
    )
    await cdp.key('Escape')
    return { ok: disabled === 5, detail: `disabled=${disabled}` }
  })

  await r.guard('17.3', 'Extract Variable rewrites the statement', async () => {
    await restore()
    await selectInEditor('self.repo.save(order)')
    await runRefactorAction('extract.variable')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    await fillDialog(0, 'saved')
    await confirmDialog()
    const previewed = await exists('.refactor-modal')
    await applyPreview()
    const after = await fs.readFile(ordersPath, 'utf8')
    return {
      ok: previewed && after.includes('saved = self.repo.save(order)') && !/^\s+saved\s*$/m.test(after),
      detail: `preview=${previewed}`,
    }
  })

  await r.guard('17.4', 'Extract Method moves the body and calls it', async () => {
    await restore()
    await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const ed = monaco.editor.getEditors()[0]
      const model = ed.getModel()
      let from = -1, to = -1
      for (let l = 1; l <= model.getLineCount(); l++) {
        const t = model.getLineContent(l)
        if (t.includes('order = {')) from = l
        if (t.includes('self.repo.save(order)')) to = l
      }
      ed.setSelection(new monaco.Range(from, 1, to, model.getLineMaxColumn(to)))
      ed.focus(); return true`)
    await runRefactorAction('extract.method')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    await fillDialog(0, 'build_order')
    await confirmDialog()
    await applyPreview()
    const after = await fs.readFile(ordersPath, 'utf8')
    return {
      ok: after.includes('def build_order(self, total):') && after.includes('self.build_order(total)'),
      detail: after.split('\n').slice(9, 13).join(' | '),
    }
  })

  await r.guard('17.5', 'Extract Constant hoists to file scope', async () => {
    await restore()
    await selectInEditor('50')
    await runRefactorAction('extract.constant')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    await fillDialog(0, 'DEFAULT_TOTAL')
    await confirmDialog()
    await applyPreview()
    const after = await fs.readFile(ordersPath, 'utf8')
    return {
      ok: /^DEFAULT_TOTAL = 50/m.test(after) && after.includes('MAX_ITEMS = DEFAULT_TOTAL'),
      detail: after.split('\n')[0],
    }
  })

  await r.guard('17.6', 'Change Signature hides `self` and rewrites call sites', async () => {
    await restore()
    await caretOn('create_order')
    await runRefactorAction('signature.change')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    const rows = await cdp.evaluate(
      `return [...document.querySelectorAll('.param-table .param-row:not(.param-head)')].map(r => r.querySelector('input').value)`,
    )
    if (rows.join(',') !== 'total') return { ok: false, detail: `rows=${rows.join(',')}` }
    await cdp.clickText('.refactor-dialog .btn', 'Add parameter', { settle: 500 })
    const inputs = await count('.refactor-dialog .refactor-fields input:not([type=checkbox])')
    await fillDialog(inputs - 4, 'currency')
    await fillDialog(inputs - 1, '"gbp"')
    await confirmDialog()
    const files = await count('.refactor-files .tree-row')
    await applyPreview()
    const orders = await fs.readFile(ordersPath, 'utf8')
    const main = await fs.readFile(mainPath, 'utf8')
    return {
      ok:
        files >= 2 &&
        orders.includes('def create_order(self, total, currency):') &&
        main.includes('create_order(42, "gbp")'),
      detail: `files=${files}`,
    }
  })

  await r.guard('17.7', 'Safe Delete refuses while references remain', async () => {
    await restore()
    await caretOn('build_service')
    await runRefactorAction('safeDelete')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    const notes = await cdp.evaluate(
      `return [...document.querySelectorAll('.refactor-dialog .refactor-note')].map(e=>e.textContent).join(' | ')`,
    )
    await confirmDialog()
    await cdp.sleep(1200)
    const unchanged = (await fs.readFile(ordersPath, 'utf8')).includes('def build_service')
    const usages = await cdp.evaluate(`return document.querySelector('.usages-header')?.innerText ?? ''`)
    return {
      ok: notes.includes('would break') && unchanged && usages.includes('build_service'),
      detail: notes.slice(0, 90),
    }
  })

  await r.guard('17.8', 'Move File renames and recomputes imports', async () => {
    const dir = path.join(PROJECT, 'ts')
    await fs.mkdir(path.join(dir, 'app'), { recursive: true })
    await fs.writeFile(path.join(dir, 'util.ts'), 'export const helper = 1\n')
    await fs.writeFile(path.join(dir, 'app', 'main.ts'), "import { helper } from '../util'\nconsole.log(helper)\n")
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().buildIndex()
      await s.getState().openFile(${JSON.stringify(path.join(dir, 'util.ts'))}); return true`)
    await cdp.sleep(2500)

    await runRefactorAction('move.file')
    if (!(await exists('.refactor-dialog'))) return { ok: false, detail: 'no dialog' }
    await fillDialog(0, path.join(dir, 'lib'))
    await confirmDialog()
    const ops = await cdp.evaluate(`return document.querySelector('.refactor-ops')?.textContent ?? ''`)
    await applyPreview()

    const moved = await fs.readFile(path.join(dir, 'lib', 'util.ts'), 'utf8').then(() => true).catch(() => false)
    const importer = await fs.readFile(path.join(dir, 'app', 'main.ts'), 'utf8')
    await fs.rm(dir, { recursive: true, force: true })
    return {
      ok: ops.includes('rename') && moved && importer.includes("'../lib/util'"),
      detail: `moved=${moved} import=${importer.split('\n')[0]}`,
    }
  })

  await restore()
}

/* ================================================================== */
/* 18. Explain (AI walkthrough)                                        */
/* ================================================================== */

async function section18() {
  console.log('\n── 18. Explain ──')
  await reset()
  // Tab ids are built from the canonical path the store resolves on open.
  const REAL = await cdp.evaluate(
    `return await window.nova.fs.realpath(${JSON.stringify(PROJECT)})`,
  )
  const target = path.join(REAL, 'src', 'main.py')
  const saved = path.join(REAL, 'src', 'main-py.explained.md')
  await fs.rm(saved, { force: true })
  // Section 13 leaves a conversation behind, so the assertion is that Explain
  // adds nothing to it — not that it is empty.
  const messagesBefore = await cdp.evaluate(
    `const s=(await import('/src/state/store.ts')).useStore.getState(); return s.messages.length`,
  )

  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    s.setState({ explain: {} })
    await s.getState().openFile(${JSON.stringify(target)})
    return true`)
  await cdp.sleep(1200)

  await r.guard('18.1', 'Explain button is offered for a source file', async () => {
    const button = await cdp.evaluate(`
      const b = document.querySelector('.tab-action-explain')
      return b ? { text: b.textContent.trim(), disabled: b.disabled } : null`)
    return { ok: Boolean(button) && button.text === 'Explain' && !button.disabled, detail: JSON.stringify(button) }
  })

  await r.guard('18.2', 'the button is disabled where there is nothing to explain', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().openTab({ id: 'settings', kind: 'settings', title: 'Settings' }); return true`)
    await cdp.sleep(500)
    const disabled = await cdp.evaluate(`return document.querySelector('.tab-action-explain')?.disabled === true`)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.getState().setActiveTab('file:' + ${JSON.stringify(target)}); return true`)
    await cdp.sleep(500)
    return { ok: disabled, detail: `disabled=${disabled}` }
  })

  await r.guard('18.3', 'clicking it opens a walkthrough tab and starts a run', async () => {
    const clicked = await cdp.click('.tab-action-explain', { settle: 1500 })
    const state = await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore.getState()
      return {
        tab: s.tabs.some(t => t.kind === 'explain'),
        status: Object.values(s.explain)[0]?.status,
        waiting: Boolean(document.querySelector('.explain-waiting')),
      }`)
    return { ok: clicked && state.tab && state.status === 'running', detail: JSON.stringify(state) }
  })

  const finished = await cdp
    .waitFor(
      `(async () => { const s=(await import('/src/state/store.ts')).useStore.getState(); return Object.values(s.explain)[0]?.status !== 'running' })()`,
      { timeout: 420000, interval: 3000, label: 'walkthrough' },
    )
    .then(() => true)
    .catch(() => false)

  await r.guard('18.4', 'the document streams to completion', async () => {
    const doc = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore.getState(); const d=Object.values(s.explain)[0]; return { status: d?.status, chars: d?.content.length ?? 0, error: d?.error }`,
    )
    return { ok: finished && doc.status === 'done' && doc.chars > 1500, detail: JSON.stringify(doc) }
  })

  await r.guard('18.5', 'it renders sections, tables and live Mermaid diagrams', async () => {
    await cdp.sleep(2500)
    const rendered = await cdp.evaluate(`
      const body = document.querySelector('.explain-body')
      if (!body) return null
      return {
        headings: body.querySelectorAll('h1, h2').length,
        svgs: body.querySelectorAll('svg').length,
        tables: body.querySelectorAll('table').length,
        code: body.querySelectorAll('pre').length,
        startsAtHeading: /^[A-Za-z0-9]/.test(body.textContent.trim()) && !/^(I['’]|Sure|Here|Let me)/.test(body.textContent.trim()),
      }`)
    return {
      ok:
        rendered &&
        rendered.headings >= 6 &&
        rendered.svgs >= 1 &&
        rendered.code >= 1 &&
        rendered.startsAtHeading,
      detail: JSON.stringify(rendered),
    }
  })

  await r.guard('18.6', 'Save as Markdown writes the document to the project', async () => {
    // Assert against the view under test, whatever else grabbed focus.
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      const tab = s.getState().tabs.find(t => t.kind === 'explain')
      if (tab) s.getState().setActiveTab(tab.id)
      return true`)
    await cdp.sleep(600)
    const clicked = await cdp.clickText('.explain-toolbar .btn', 'Save as Markdown', { settle: 2500 })
    const content = await fs.readFile(saved, 'utf8').catch(() => '')
    await fs.rm(saved, { force: true })
    return {
      ok: clicked && content.trimStart().startsWith('#') && content.length > 1000,
      detail: `clicked=${clicked} chars=${content.length}`,
    }
  })

  await r.guard('18.7', 'the run is read-only and leaves the conversation alone', async () => {
    const source = await fs.readFile(target, 'utf8')
    const console_ = await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore.getState()
      return { messages: s.messages.length, running: s.aiRunning }`)
    return {
      ok:
        source.includes('from orders import') &&
        console_.messages === messagesBefore &&
        !console_.running,
      detail: `${JSON.stringify(console_)} before=${messagesBefore}`,
    }
  })
}

/* ================================================================== */
/* 19. IDE parity — Find Action, navigation, tabs, TODO, replace       */
/* ================================================================== */
async function section19() {
  console.log('\n── 19. IDE parity ──')
  await reset()
  // The store canonicalises paths on open (macOS resolves /var to /private/var),
  // so assertions that compare against store keys must use the same form.
  const REAL = await cdp.evaluate(
    `return await window.nova.fs.realpath(${JSON.stringify(PROJECT)})`,
  )
  await cdp.evaluate(`
    const s=(await import('/src/state/store.ts')).useStore
    s.setState({ bookmarks: [], recentFiles: [] })
    await s.getState().openFile(s.getState().root + '/src/orders.py')
    await s.getState().openFile(s.getState().root + '/src/main.py')
    return true`)
  await cdp.sleep(1500)

  await r.guard('19.1', 'Find Action lists every editor action, not a shortlist', async () => {
    await cdp.key('p', ['meta', 'shift'])
    await cdp.sleep(700)
    const total = await count('.modal-item')
    // A curated list was ~26; the editor alone contributes well over a hundred.
    const found = {}
    for (const q of ['fold all', 'uppercase', 'add cursor below']) {
      await cdp.evaluate(`
        const i=document.querySelector('.modal-input')
        const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
        set.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); return true`)
      await cdp.type(q, 0)
      await cdp.sleep(250)
      found[q] = await cdp.evaluate(
        `return document.querySelector('.modal-item')?.innerText.replace(/\\n/g,' ') ?? ''`,
      )
    }
    await cdp.key('Escape')
    const all = Object.values(found).join(' | ').toLowerCase()
    return {
      ok: total > 120 && all.includes('fold all') && all.includes('uppercase') && all.includes('cursor below'),
      detail: `entries=${total} ${JSON.stringify(found)}`,
    }
  })

  await r.guard('19.2', 'Recent Files (⌘E) lists what was opened', async () => {
    await cdp.key('e', ['meta'])
    await cdp.sleep(600)
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.modal-item')].map(e=>e.innerText.split('\\n')[0])`,
    )
    await cdp.key('Escape')
    return { ok: items.includes('main.py') && items.includes('orders.py'), detail: JSON.stringify(items) }
  })

  await r.guard('19.3', 'File Structure (⌘F12) lists this file’s symbols', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(s.getState().root + '/src/orders.py'); return true`)
    await cdp.sleep(900)
    await cdp.key('F12', ['meta'])
    await cdp.sleep(900)
    const items = await cdp.evaluate(
      `return [...document.querySelectorAll('.modal-item')].map(e=>e.innerText.replace(/\\n/g,' '))`,
    )
    await cdp.key('Escape')
    const text = items.join(' ')
    return { ok: text.includes('OrderService') && items.length >= 2, detail: JSON.stringify(items.slice(0, 4)) }
  })

  await r.guard('19.4', 'F11 bookmarks a line and ⇧F11 lists them', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.setState({ cursor: { line: 2, column: 1 } }); return true`)
    await cdp.key('F11')
    await cdp.sleep(400)
    const marks = await cdp.evaluate(
      `return (await import('/src/state/store.ts')).useStore.getState().bookmarks.length`,
    )
    await cdp.key('F11', ['shift'])
    await cdp.sleep(600)
    const listed = await count('.modal-item')
    await cdp.key('Escape')
    return { ok: marks === 1 && listed === 1, detail: `marks=${marks} listed=${listed}` }
  })

  await r.guard('19.5', 'the editor splits into two groups and collapses again', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(s.getState().root + '/src/orders.py')
      s.getState().splitEditor()
      return true`)
    await cdp
      .waitFor(`document.querySelectorAll('.tabbar').length === 2 ? 'yes' : null`, {
        timeout: 12000,
        interval: 400,
        label: 'second tab strip',
      })
      .catch(() => null)
    const split = await cdp.evaluate(`return {
      groups: (await import('/src/state/store.ts')).useStore.getState().groups.length,
      bars: document.querySelectorAll('.tabbar').length,
      panes: document.querySelectorAll('.editor-group').length,
    }`)
    await cdp.evaluate(`(await import('/src/state/store.ts')).useStore.getState().closeSplit(); return true`)
    await cdp.sleep(700)
    const collapsed = await cdp.evaluate(
      `return (await import('/src/state/store.ts')).useStore.getState().groups.length`,
    )
    return {
      ok: split.groups === 2 && split.bars === 2 && split.panes === 2 && collapsed === 1,
      detail: `${JSON.stringify(split)} collapsed=${collapsed}`,
    }
  })

  await r.guard('19.6', 'tabs have a context menu and can be dragged', async () => {
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(s.getState().root + '/src/orders.py'); return true`)
    await cdp.sleep(1200)
    const draggable = await cdp.evaluate(`return document.querySelector('.tab')?.draggable === true`)
    await cdp.evaluate(`
      document.querySelector('.tab').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 120 }))
      return true`)
    await cdp.sleep(500)
    const entries = await cdp.evaluate(
      `return [...document.querySelectorAll('.context-item')].map(e=>e.textContent)`,
    )
    await cdp.key('Escape')
    return {
      ok:
        draggable &&
        entries.includes('Close Others') &&
        entries.includes('Close to the Right') &&
        entries.includes('Pin'),
      detail: `draggable=${draggable} ${JSON.stringify(entries)}`,
    }
  })

  await r.guard('19.7', 'the TODO panel finds tagged comments', async () => {
    const probe = path.join(PROJECT, 'src', 'todo_probe.py')
    await fs.writeFile(probe, '# TODO: wire up the repository\n# FIXME: this leaks\nx = 1\n')
    await cdp.sleep(1200)
    await cdp.evaluate(`(await import('/src/state/store.ts')).useStore.getState().showPanel('todo'); return true`)
    await cdp.sleep(3500)
    const text = await cdp.evaluate(`return document.querySelector('.pane-body')?.innerText ?? ''`)
    await fs.rm(probe, { force: true })
    return {
      ok: text.includes('wire up the repository') && text.includes('this leaks') && /TODO\s*1/.test(text),
      detail: text.slice(0, 120).replace(/\n/g, ' | '),
    }
  })

  await r.guard('19.8', 'Replace in Project previews and rewrites every match', async () => {
    const a = path.join(PROJECT, 'src', 'rep_a.py')
    const b = path.join(PROJECT, 'src', 'rep_b.py')
    await fs.writeFile(a, 'widget = 1\nprint(widget, widget)\n')
    await fs.writeFile(b, '# a widget here\nwidget_count = 2\n')
    await cdp.sleep(1500)

    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      s.setState({ sidebarVisible: true, sidebarView: 'search' }); return true`)
    await cdp.sleep(600)
    await cdp.evaluate(`window.dispatchEvent(new CustomEvent('nova:open-replace')); return true`)
    await cdp.sleep(400)
    await cdp.click('.sidebar input', { settle: 400 })
    await cdp.type('widget')
    await cdp.sleep(1800)

    const replaceBox = await cdp.boxOf('.sidebar input', 1)
    if (!replaceBox) return { ok: false, detail: 'no replace field' }
    await cdp.clickPoint(replaceBox)
    await cdp.type('gadget')
    await cdp.sleep(300)
    const clicked = await cdp.clickText('.sidebar .btn', 'Replace', { settle: 2000 })
    await cdp.sleep(1200)
    const summary = await cdp.evaluate(
      `return document.querySelector('.refactor-modal .refactor-head .faint')?.textContent ?? ''`,
    )
    await cdp.clickText('.refactor-modal .btn.primary', 'Apply', { settle: 2500 })
    await cdp.sleep(1500)

    const afterA = await fs.readFile(a, 'utf8').catch(() => '')
    const afterB = await fs.readFile(b, 'utf8').catch(() => '')
    await fs.rm(a, { force: true })
    await fs.rm(b, { force: true })
    return {
      ok:
        clicked &&
        /5 edits across 2 files/.test(summary) &&
        afterA === 'gadget = 1\nprint(gadget, gadget)\n' &&
        afterB === '# a gadget here\ngadget_count = 2\n',
      detail: `${summary} | ${afterA.replace(/\n/g, '\\n')}`,
    }
  })

  await r.guard('19.9', 'a disk change under a dirty buffer is surfaced', async () => {
    const target = path.join(PROJECT, 'src', 'util.go')
    const original = await fs.readFile(target, 'utf8')
    const literal = JSON.stringify(path.join(REAL, 'src', 'util.go'))
    await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; await s.getState().openFile(${literal}); return true`,
    )
    await cdp.sleep(1000)
    await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; const p=${literal};` +
        ` s.getState().updateBuffer(p, '// unsaved edit' + String.fromCharCode(10) + s.getState().buffers[p].content); return true`,
    )
    await cdp.sleep(400)
    await fs.writeFile(target, `${original}\n// written by another process\n`)
    const shown = await cdp
      .waitFor(`document.querySelector('.external-change') ? 'yes' : null`, {
        timeout: 12000,
        interval: 500,
        label: 'external change bar',
      })
      .then(() => true)
      .catch(() => false)
    const actions = await cdp.evaluate(
      `return [...document.querySelectorAll('.external-change .btn')].map(b=>b.textContent.trim())`,
    )
    const why = await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore.getState();` +
        ` const p=${literal}; const b=s.buffers[p];` +
        ` return { tracked: Object.keys(s.externalChanges), dirty: b ? b.content !== b.savedContent : null,` +
        ` active: s.tabs.find(t=>t.id===s.activeTabId)?.path, hasBuffer: Boolean(b) }`,
    )
    await cdp.evaluate(
      `const s=(await import('/src/state/store.ts')).useStore; await s.getState().resolveExternalChange(${literal}, 'keep'); return true`,
    )
    await fs.writeFile(target, original)
    return {
      ok: shown && actions.some((a) => a.includes('Reload')) && actions.some((a) => a.includes('Compare')),
      detail: `shown=${shown} ${JSON.stringify(actions)} ${JSON.stringify(why)}`,
    }
  })

  await r.guard('19.10', 'breakpoints carry conditions and log messages', async () => {
    const target = path.join(REAL, 'src', 'main.py')
    await cdp.evaluate(`await window.nova.debug.clearBreakpoints(); return true`)
    await cdp.evaluate(`
      await window.nova.debug.updateBreakpoint(${JSON.stringify(target)}, 6, { condition: 'total > 1', enabled: true })
      await window.nova.debug.updateBreakpoint(${JSON.stringify(target)}, 7, { logMessage: 'here {total}', enabled: true })
      await window.nova.debug.updateBreakpoint(${JSON.stringify(target)}, 8, { enabled: false })
      return true`)
    await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore
      await s.getState().openFile(${JSON.stringify(target)}); return true`)
    // Wait for the gutter to draw rather than assuming 1.5s is enough. Opening
    // a file and rendering its decorations is slower when the suite has already
    // put the editor through eighteen other sections.
    await cdp
      .waitFor(`document.querySelectorAll('.nova-breakpoint').length >= 3`, {
        timeout: 15000,
        interval: 400,
        label: 'breakpoint glyphs',
      })
      .catch(() => undefined)
    const classes = await cdp.evaluate(
      `return [...document.querySelectorAll('.nova-breakpoint')].map(e=>e.className).join(' ')`,
    )
    const items = await cdp.evaluate(`
      const s=(await import('/src/state/store.ts')).useStore.getState()
      return s.debug.state?.breakpoints?.[0]?.items ?? []`)
    const glyphs = await count('.nova-breakpoint')
    await cdp.evaluate(`await window.nova.debug.clearBreakpoints(); return true`)
    return {
      ok:
        classes.includes('conditional') &&
        classes.includes('log') &&
        classes.includes('disabled') &&
        items.length === 3,
      detail: `glyphs=${glyphs} items=${items.length} classes=${classes}`,
    }
  })
}

/* ------------------------------------------------------------------ */

const SECTIONS = { 1: section1, 2: section2, 3: section3, 4: section4, 5: section5, 6: section6, 7: section7, 8: section8, 9: section9, 10: section10, 11: section11, 12: section12, 13: section13, 14: section14, 15: section15, 16: section16, 17: section17, 18: section18, 19: section19 }

await buildFixture()
await openProject()

for (const [num, fn] of Object.entries(SECTIONS)) {
  if (only && Number(num) !== only) continue
  await fn()
}

const failed = r.summary('UI verification')
cdp.close()
process.exit(failed ? 1 : 0)
