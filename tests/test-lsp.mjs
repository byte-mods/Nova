import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'
/** Drives the real LspManager against clangd and rust-analyzer. */
import fs from 'node:fs/promises'
import path from 'node:path'
const { LspManager, pathToUri } = await import(pathToFileURL(`${BUILD}/lspManager.js`).href)

const SB = `${TMP}/lsptest`

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label} ${detail}`)
  }
}

const diagnostics = new Map()
const manager = new LspManager({
  onDiagnostics: ({ uri, diagnostics: d }) => diagnostics.set(uri, d),
  onStatus: () => {},
  onLog: () => {},
  onApplyEdit: () => {},
})

/* ---------------- clangd ---------------- */
const cRoot = path.join(SB, 'cproj')
await fs.rm(cRoot, { recursive: true, force: true })
await fs.mkdir(cRoot, { recursive: true })
const cFile = path.join(cRoot, 'main.c')
const cText = `#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int main(void) {
    int total = add(2, 3);
    printf("%d\\n", total);
    return 0;
}
`
await fs.writeFile(cFile, cText)
await fs.writeFile(
  path.join(cRoot, 'compile_commands.json'),
  JSON.stringify([{ directory: cRoot, file: cFile, command: `clang -c ${cFile}` }], null, 2),
)

manager.setRoot(cRoot)
const detected = await manager.detect()
const clangd = detected.find((s) => s.id === 'clangd')
check('clangd is detected on PATH', clangd?.installed, JSON.stringify(clangd))

await manager.openDocument(cFile, 'c', cText)
await new Promise((r) => setTimeout(r, 2500))

const status = manager.status().find((s) => s.id === 'clangd')
check('clangd session reaches ready', status?.state === 'ready', `state=${status?.state} err=${status?.error}`)

// `add` is used on line 7 (0-based), col 16 -> definition should be line 2.
const def = await manager.definition(cFile, 'c', 7, 17)
const defArr = Array.isArray(def) ? def : def ? [def] : []
const target = defArr[0]
check(
  'go to definition of add() resolves to its declaration',
  target && (target.targetRange ?? target.range).start.line === 2,
  JSON.stringify(defArr).slice(0, 200),
)

const refs = await manager.references(cFile, 'c', 2, 4)
check('references to add() include declaration + call', Array.isArray(refs) && refs.length >= 2, `${refs?.length} refs`)

const hover = await manager.hover(cFile, 'c', 7, 17)
check('hover returns type info for add()', Boolean(hover?.contents), JSON.stringify(hover).slice(0, 160))

const completion = await manager.completion(cFile, 'c', 7, 17)
const items = Array.isArray(completion) ? completion : completion?.items
check('completion returns items', Array.isArray(items) && items.length > 0, `${items?.length} items`)

const syms = await manager.documentSymbols(cFile, 'c')
check(
  'document symbols list add and main',
  Array.isArray(syms) && syms.some((s) => s.name === 'add') && syms.some((s) => s.name === 'main'),
  JSON.stringify(syms?.map?.((s) => s.name)),
)

// Rename add -> sum across the file.
const renameEdit = await manager.rename(cFile, 'c', 2, 4, 'sum')
const changed = renameEdit?.changes?.[pathToUri(cFile)] ?? renameEdit?.documentChanges?.[0]?.edits
check('rename produces edits for every occurrence', Array.isArray(changed) && changed.length >= 2, `${changed?.length} edits`)

// Introduce an error and confirm diagnostics arrive.
const broken = cText.replace('return a + b;', 'return a + c;')
await manager.changeDocument(cFile, 'c', broken)
await new Promise((r) => setTimeout(r, 2500))
const diags = diagnostics.get(pathToUri(cFile)) ?? []
check(
  'diagnostics report the undefined identifier',
  diags.some((d) => /undeclared|undefined|'c'/i.test(d.message)),
  JSON.stringify(diags.map((d) => d.message)).slice(0, 200),
)

const actions = await manager.codeActions(
  cFile,
  'c',
  { start: { line: 3, character: 15 }, end: { line: 3, character: 16 } },
  diags,
)
console.log(`  info  clangd offered ${Array.isArray(actions) ? actions.length : 0} code actions`)

await manager.stopAll()

/* ---------------- rust-analyzer ---------------- */
const rustRoot = path.join(SB, 'rustproj')
await fs.rm(rustRoot, { recursive: true, force: true })
await fs.mkdir(path.join(rustRoot, 'src'), { recursive: true })
await fs.writeFile(
  path.join(rustRoot, 'Cargo.toml'),
  '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
)
const rsFile = path.join(rustRoot, 'src', 'main.rs')
const rsText = `fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn main() {
    let total = add(2, 3);
    println!("{}", total);
}
`
await fs.writeFile(rsFile, rsText)

manager.setRoot(rustRoot)
await manager.openDocument(rsFile, 'rust', rsText)
// `ready` only means initialize finished; rust-analyzer answers queries once
// it has loaded the crate graph, so poll until definitions resolve.
let rsDefPoll = null
for (let i = 0; i < 45; i++) {
  rsDefPoll = await manager.definition(rsFile, 'rust', 5, 17)
  if ((Array.isArray(rsDefPoll) ? rsDefPoll : rsDefPoll ? [rsDefPoll] : []).length) break
  await new Promise((r) => setTimeout(r, 2000))
}

const rsStatus = manager.status().find((s) => s.id === 'rust-analyzer')
check('rust-analyzer session reaches ready', rsStatus?.state === 'ready', `state=${rsStatus?.state}`)

const rsDef = rsDefPoll
const rsArr = Array.isArray(rsDef) ? rsDef : rsDef ? [rsDef] : []
check(
  'rust go-to-definition finds fn add',
  rsArr.length > 0 && (rsArr[0].targetRange ?? rsArr[0].range).start.line === 0,
  JSON.stringify(rsArr).slice(0, 200),
)

const rsHover = await manager.hover(rsFile, 'rust', 5, 17)
const hoverText = JSON.stringify(rsHover?.contents ?? '')
check('rust hover shows the signature', /fn add/.test(hoverText), hoverText.slice(0, 160))

// End-to-end rename applied to disk via the same applier the renderer uses.
const { applyEdits } = await import(pathToFileURL(`${BUILD}/applyEdits.js`).href)
const rsRename = await manager.rename(rsFile, 'rust', 0, 3, 'sum')
const rsEdits = rsRename?.documentChanges?.[0]?.edits ?? Object.values(rsRename?.changes ?? {})[0]
const renamed = applyEdits(rsText, rsEdits ?? [])
check(
  'applying the rename edits rewrites every occurrence',
  /fn sum\(/.test(renamed) && /= sum\(2, 3\)/.test(renamed) && !/add/.test(renamed),
  JSON.stringify(renamed),
)

await manager.stopAll()

console.log(failures ? `\n${failures} failed` : '\nall LSP checks passed')
process.exit(failures ? 1 : 0)
