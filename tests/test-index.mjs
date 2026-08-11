import { pathToFileURL } from 'node:url'
import { BUILD, REPO } from './env.mjs'
/** Builds a real index over this repo and exercises the navigation queries. */
const { ProjectIndex } = await import(pathToFileURL(`${BUILD}/projectIndex.js`).href)

const root = `${REPO}`
const index = new ProjectIndex()

let lastStatus = null
await index.build(root, (s) => (lastStatus = s))

console.log(
  `indexed ${lastStatus.files} files / ${lastStatus.symbols} symbols in ${lastStatus.durationMs} ms` +
    (lastStatus.truncated ? ' (truncated)' : ''),
)

let failures = 0
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label} — ${detail}`)
  }
}

// --- go to definition ---
const defs = index.definitions('parseSymbols', `${root}/electron/lib/projectIndex.ts`)
check(
  'definition of parseSymbols resolves to its declaring file',
  defs[0]?.file === `${root}/electron/lib/parseSymbols.ts` && defs[0]?.kind === 'function',
  `got ${defs[0]?.file}:${defs[0]?.line} (${defs[0]?.kind})`,
)

const storeDefs = index.definitions('useStore', `${root}/src/components/StatusBar.tsx`)
check(
  'definition of useStore resolves to the store module',
  storeDefs[0]?.file === `${root}/src/state/store.ts`,
  `got ${storeDefs[0]?.file}`,
)

const classDef = index.definitions('ProjectIndex', `${root}/electron/ipc/indexer.ts`)
check(
  'definition of ProjectIndex is the class',
  classDef[0]?.kind === 'class' && classDef[0]?.file.endsWith('projectIndex.ts'),
  `got ${classDef[0]?.kind} in ${classDef[0]?.file}`,
)

// Same-file declarations should outrank identically-named ones elsewhere.
const localFirst = index.definitions('basename', `${root}/src/lib/paths.ts`)
check(
  'same-file declaration ranks first',
  localFirst[0]?.file === `${root}/src/lib/paths.ts`,
  `got ${localFirst[0]?.file}`,
)

// --- find usages ---
const refs = await index.references('parseSymbols')
const files = new Set(refs.map((r) => r.file))
const hasDecl = refs.some((r) => r.kind === 'declaration')
const hasImport = refs.some((r) => r.kind === 'import')
check(
  'references to parseSymbols span declaration + importers',
  refs.length >= 3 && hasDecl && hasImport && files.size >= 2,
  `${refs.length} refs across ${files.size} files (decl=${hasDecl} import=${hasImport})`,
)

const themeRefs = await index.references('applyTheme')
check(
  'references to applyTheme found in store and themes',
  themeRefs.some((r) => r.file.endsWith('store.ts')) &&
    themeRefs.some((r) => r.file.endsWith('themes.ts')),
  `${themeRefs.length} refs: ${[...new Set(themeRefs.map((r) => r.file.split('/').pop()))].join(', ')}`,
)

// Word-boundary correctness: `walk` must not match `walkThrough` etc.
const walkRefs = await index.references('walk')
const badBoundary = walkRefs.find((r) => {
  const at = r.preview.indexOf('walk', r.column - 1)
  const after = r.preview[r.column - 1 + 4]
  return after && /[A-Za-z0-9_$]/.test(after)
})
check('reference matching respects word boundaries', !badBoundary, `bad: ${badBoundary?.preview}`)

// --- workspace symbols ---
const ws = index.workspaceSymbols('Diagram', 20)
check(
  'workspace symbol search finds diagram symbols',
  ws.length > 0 && ws.some((s) => s.name.includes('Diagram')),
  `got ${ws.map((s) => s.name).slice(0, 5).join(', ')}`,
)

const exact = index.workspaceSymbols('ProjectIndex', 10)
check(
  'exact symbol match ranks first',
  exact[0]?.name === 'ProjectIndex',
  `got ${exact[0]?.name}`,
)

// --- document symbols ---
const docSymbols = index.documentSymbols(`${root}/src/state/store.ts`)
check(
  'document symbols for store.ts include its interfaces',
  docSymbols.some((s) => s.name === 'Settings') && docSymbols.length > 5,
  `${docSymbols.length} symbols`,
)

// --- incremental refresh ---
const before = index.definitions('OrderService').length
await index.refresh(`${root}/src/state/store.ts`)
const after = index.definitions('useStore').length
check('refresh keeps the index consistent', after >= 1, `useStore defs after refresh: ${after}`)

// --- reference timing on a hot name ---
const t0 = Date.now()
await index.references('useStore')
console.log(`\n  references('useStore') took ${Date.now() - t0} ms`)

console.log(failures ? `\n${failures} failed` : '\nall navigation checks passed')
process.exit(failures ? 1 : 0)
