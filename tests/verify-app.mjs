import { TMP } from './env.mjs'
/**
 * Drives the real Nova IDE (Electron, real IPC) over CDP and checks each
 * capability the user asked about.
 */
import { connect } from './cdp.mjs'

const SB = `${TMP}`
const P = `${SB}/demo-project`

let fails = 0
const check = (label, ok, detail = '') => {
  console.log(ok ? `  PASS  ${label}` : `  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const cdp = await connect()
const ev = (code) => cdp.evaluate(code)

/* ---------- open the project ---------- */
await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openProject(${JSON.stringify(P)})
  return true
`)
await new Promise((r) => setTimeout(r, 3500))

const idx = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  const st = s.getState()
  return { root: st.root, index: st.indexStatus, frameworks: st.testFrameworks, adapters: st.debug.adapters.filter(a=>a.installed).map(a=>a.id) }
`)
console.log('\n— project —')
check('project opens and indexes', idx.index?.ready && idx.index.symbols > 0,
  JSON.stringify(idx.index))
console.log(`  info  ${idx.index?.files} files, ${idx.index?.symbols} symbols; debug adapters: ${JSON.stringify(idx.adapters)}`)

/* ---------- 1. AI console: claude + codex CLI detection ---------- */
console.log('\n— 1. AI console (claude / codex CLIs) —')
const providers = await ev(`return await window.nova.ai.providers()`)
const claude = providers.find((p) => p.id === 'claude')
const codex = providers.find((p) => p.id === 'codex')
check('claude CLI detected by the app', claude?.available, JSON.stringify(claude))
console.log(`  info  claude: ${claude?.binary} ${claude?.version}`)
console.log(`  info  codex : ${codex?.available ? codex.binary + ' ' + codex.version : 'not installed — ' + codex?.hint}`)

/* ---------- 2. UI shown inside the IDE (webview browser) ---------- */
console.log('\n— 2. UI preview inside the IDE —')
const dev = await ev(`return await window.nova.shell.detectDevServer(${JSON.stringify(P)})`)
check('dev server detected from package.json', Boolean(dev?.command && dev?.url), JSON.stringify(dev))

const browser = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().openTab({ id:'browser:verify', kind:'browser', title:'Browser', url:'http://localhost:4173/' })
  await new Promise(r=>setTimeout(r,2500))
  const wv = document.querySelector('webview')
  return {
    tagPresent: !!wv,
    isWebviewElement: wv ? wv.tagName.toLowerCase() : '',
    canNavigate: !!(wv && typeof wv.loadURL === 'function' && typeof wv.getURL === 'function'),
    url: wv && wv.getURL ? wv.getURL() : '',
  }
`)
check('<webview> element is live in the editor area', browser.tagPresent && browser.canNavigate,
  JSON.stringify(browser))

/* ---------- 3. Reference tree / traversal ---------- */
console.log('\n— 3. Find Usages + go to definition —')
const nav = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(P + '/src/main.py')})
  await new Promise(r=>setTimeout(r,900))
  const defs = await window.nova.code.definitions('build_service', ${JSON.stringify(P + '/src/main.py')})
  await s.getState().findUsages('build_service', ${JSON.stringify(P + '/src/main.py')})
  await new Promise(r=>setTimeout(r,1200))
  const u = s.getState().usages
  return {
    defFile: defs[0]?.file, defLine: defs[0]?.line, defKind: defs[0]?.kind,
    refCount: u?.references.length,
    refFiles: [...new Set((u?.references??[]).map(r=>r.file.split('/').pop()))],
    kinds: [...new Set((u?.references??[]).map(r=>r.kind))],
    panelTab: s.getState().panelTab,
  }
`)
check('go to definition resolves cross-file', nav.defFile?.endsWith('orders.py') && nav.defKind === 'function',
  JSON.stringify(nav))
check('find usages spans declaration + import + call', nav.refCount >= 3 && nav.refFiles.length === 2 && nav.kinds.includes('declaration'),
  JSON.stringify(nav))
check('usages panel opened', nav.panelTab === 'usages', nav.panelTab)

const traverse = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  const u = s.getState().usages
  const target = u.references.find(r => r.kind === 'declaration')
  await s.getState().openFile(target.file, { line: target.line, column: target.column })
  await new Promise(r=>setTimeout(r,900))
  const tab = s.getState().tabs.find(t => t.id === s.getState().activeTabId)
  return { openedFile: tab?.path?.split('/').pop(), targetLine: target.line }
`)
check('clicking a usage traverses to that file/line', traverse.openedFile === 'orders.py',
  JSON.stringify(traverse))

/* ---------- 4. Project-wide autocomplete (any language, no LSP) ---------- */
console.log('\n— 4. Project-aware autocomplete —')
const comp = await ev(`
  const py = await window.nova.code.completions('Order', ${JSON.stringify(P + '/src/main.py')}, 20)
  const go = await window.nova.code.completions('Apply', ${JSON.stringify(P + '/src/util.go')}, 20)
  const any = await window.nova.code.completions('bui', ${JSON.stringify(P + '/src/main.py')}, 20)
  return {
    py: py.map(s=>s.name+':'+s.kind),
    go: go.map(s=>s.name+':'+s.kind),
    any: any.map(s=>s.name+':'+s.kind),
  }
`)
check('suggests project classes (Python)', comp.py.some((s) => s.startsWith('OrderService:class')),
  JSON.stringify(comp.py))
check('suggests project functions (Go)', comp.go.some((s) => s.startsWith('ApplyCoupon:')),
  JSON.stringify(comp.go))
check('prefix completion works for any identifier', comp.any.some((s) => s.startsWith('build_service:function')),
  JSON.stringify(comp.any))

const monacoComp = await ev(`
  const { monaco } = await import('/src/lib/monacoSetup.ts')
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openFile(${JSON.stringify(P + '/src/main.py')})
  await new Promise(r=>setTimeout(r,1200))
  const model = monaco.editor.getModels().find(m => m.uri.path.endsWith('main.py'))
  if (!model) return { error: 'no model' }
  // Type a prefix at the end of the file and ask Monaco's registry for suggestions.
  const last = model.getLineCount()
  model.applyEdits([{ range: new monaco.Range(last, 1, last, 1), text: 'Order\\n' }])
  const providers = monaco.languages.registerCompletionItemProvider ? true : false
  const result = await new Promise(async (resolve) => {
    const list = []
    // Ask every registered provider directly via the editor's suggest controller.
    const editor = monaco.editor.getEditors()[0]
    editor.setPosition({ lineNumber: last, column: 6 })
    editor.trigger('verify', 'editor.action.triggerSuggest', {})
    setTimeout(() => {
      const widget = document.querySelector('.suggest-widget')
      const rows = [...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(r => r.textContent)
      resolve({ visible: !!(widget && widget.classList.contains('visible')), rows: rows.slice(0,8) })
    }, 1800)
  })
  model.applyEdits([{ range: new monaco.Range(last, 1, last+1, 1), text: '' }])
  return result
`)
check('Monaco suggest popup shows project symbols', monacoComp.visible && monacoComp.rows?.some((r) => r.includes('OrderService')),
  JSON.stringify(monacoComp))

/* ---------- 5. UML / diagram creation ---------- */
console.log('\n— 5. UML / architecture diagrams —')
const diagram = await ev(`
  const { createDiagramFile } = await import('/src/components/diagram/diagramFile.ts')
  const s = (await import('/src/state/store.ts')).useStore
  const file = await createDiagramFile(${JSON.stringify(P)}, 'uml-class', 'orders-uml')
  await new Promise(r=>setTimeout(r,1500))
  const buf = s.getState().buffers[file]
  const doc = JSON.parse(buf.content)
  const svgNodes = document.querySelectorAll('.diagram-canvas g[transform]').length
  return {
    file: file.split('/').pop(),
    nodes: doc.nodes.length,
    edges: doc.edges.map(e=>e.kind),
    shapes: [...new Set(doc.nodes.map(n=>n.shape))],
    rendered: svgNodes,
    tabKind: s.getState().tabs.find(t=>t.id===s.getState().activeTabId)?.kind,
  }
`)
check('UML class diagram created and opened', diagram.tabKind === 'diagram' && diagram.nodes >= 5,
  JSON.stringify(diagram))
check('UML relationships present (implementation/composition)',
  diagram.edges?.includes('implementation') && diagram.edges?.includes('composition'),
  JSON.stringify(diagram.edges))
check('diagram renders on the canvas', diagram.rendered > 0, `${diagram.rendered} svg groups`)

const persisted = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  const tab = s.getState().tabs.find(t=>t.kind==='diagram')
  await s.getState().saveBuffer(tab.path)
  const read = await window.nova.fs.read(tab.path)
  return { onDisk: JSON.parse(read.content).nodes.length }
`)
check('diagram persists to disk', persisted.onDisk >= 5, JSON.stringify(persisted))

/* ---------- 6. Debugging ---------- */
console.log('\n— 6. Debugger —')
const dbg = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  const file = ${JSON.stringify(P + '/src/main.py')}
  await s.getState().toggleBreakpoint(file, 7)
  await window.nova.debug.launch({ language:'python', program:file, cwd:${JSON.stringify(P + '/src')}, adapterId:'debugpy' })
  for (let i=0;i<40;i++){ if (s.getState().debug.state?.status==='paused') break; await new Promise(r=>setTimeout(r,500)) }
  const st = s.getState().debug.state
  let vars = []
  let scopes = []
  if (st?.currentFrameId != null) {
    scopes = await window.nova.debug.scopes(st.currentFrameId)
    if (scopes[0]) vars = await window.nova.debug.variables(scopes[0].variablesReference)
  }
  const evald = await window.nova.debug.evaluate('order["total"] * 2', st?.currentFrameId ?? undefined)
  return {
    status: st?.status, reason: st?.stopReason, error: st?.error,
    frames: st?.frames.map(f=>f.name+':'+f.line).slice(0,4),
    verified: st?.breakpoints?.[0]?.verified,
    scopes: scopes.map(s=>s.name),
    vars: vars.map(v=>v.name+'='+v.value).slice(0,6),
    evaluated: evald.result,
    output: s.getState().debug.output.slice(0,120),
  }
`)
check('debugger pauses at a real breakpoint', dbg.status === 'paused', JSON.stringify(dbg))
check('call stack captured', (dbg.frames ?? []).length > 0, JSON.stringify(dbg.frames))
check('variables inspected', (dbg.vars ?? []).some((v) => v.startsWith('order=')), JSON.stringify(dbg.vars))
check('expression evaluated in frame', dbg.evaluated === '84', JSON.stringify(dbg.evaluated))

const stepping = await ev(`
  const s = (await import('/src/state/store.ts')).useStore
  await window.nova.debug.next()
  await new Promise(r=>setTimeout(r,1500))
  const a = s.getState().debug.state
  await window.nova.debug.continue()
  for (let i=0;i<30;i++){ if (s.getState().debug.state?.status==='inactive') break; await new Promise(r=>setTimeout(r,400)) }
  return { afterStep: a?.frames?.[0]?.line, final: s.getState().debug.state?.status, out: s.getState().debug.output }
`)
check('step over advances the line', typeof stepping.afterStep === 'number' && stepping.afterStep > 7,
  JSON.stringify(stepping.afterStep))
check('continue runs to completion with program output',
  stepping.final === 'inactive' && stepping.out.includes('created='), JSON.stringify(stepping.out.slice(0, 140)))

await ev(`await window.nova.debug.stop(); return true`)

console.log(`\n${fails ? `${fails} FAILED` : 'all live-app checks passed'}`)
cdp.close()
process.exit(fails ? 1 : 0)
