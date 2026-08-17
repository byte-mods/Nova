/**
 * Drivers for the generated diagrams: gather what the pure generators need,
 * write the result as Markdown under `.nova/diagrams/`, open it.
 *
 * Markdown rather than a live view, deliberately: the mermaid renderer already
 * runs in Markdown files, the output is diffable and checkable into git, and
 * regenerating overwrites it — the diagram stays a build artifact of the code
 * instead of drifting into a hand-edited copy.
 */

import { useStore } from '@/state/store'
import { generateClassDiagram, generateDsm, generateModuleDiagram, buildModuleGraph } from './codeDiagrams'

async function writeAndOpen(name: string, content: string): Promise<void> {
  const store = useStore.getState()
  const root = store.root
  if (!root) return
  const path = `${root}/.nova/diagrams/${name}`
  await window.nova.fs.write(path, content)
  store.bumpTree()
  await store.openFile(path)
}

export async function generateUmlDiagram(): Promise<void> {
  const store = useStore.getState()
  if (!store.root) return
  store.notify('Generating class diagram from the symbol index…', 'info')
  // An empty query walks the whole index; the cap keeps the payload sane.
  const symbols = await window.nova.code.workspaceSymbols('', 4000)
  const mermaid = generateClassDiagram(symbols)
  await writeAndOpen(
    'classes.md',
    [
      '# UML class diagram',
      '',
      '_Generated from the symbol index — rerun “Generate UML Class Diagram” after big changes._',
      '',
      '```mermaid',
      mermaid,
      '```',
      '',
    ].join('\n'),
  )
}

/** Reads up to `cap` source files for the dependency analyses. */
async function readProjectFiles(cap = 600): Promise<{ path: string; text: string }[]> {
  const store = useStore.getState()
  const root = store.root
  if (!root) return []
  const files = await window.nova.fs.findFiles(root, '', 5000)
  const out: { path: string; text: string }[] = []
  for (const file of files) {
    if (out.length >= cap) break
    if (!/\.(tsx?|jsx?|mts|cts|mjs|cjs|py|go|rs|java|kt|swift|rb|php)$/.test(file)) continue
    try {
      const read = await window.nova.fs.read(file)
      if (!read.binary) out.push({ path: file, text: read.content })
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

export async function generateModuleDependencyDiagram(): Promise<void> {
  const store = useStore.getState()
  if (!store.root) return
  store.notify('Analysing imports…', 'info')
  const files = await readProjectFiles()
  const graph = buildModuleGraph(store.root, files)
  await writeAndOpen(
    'modules.md',
    [
      '# Module dependencies',
      '',
      `_Edges are counted imports between top-level modules, from ${files.length} files._`,
      '',
      '```mermaid',
      generateModuleDiagram(graph),
      '```',
      '',
    ].join('\n'),
  )
}

export async function generateDependencyMatrix(): Promise<void> {
  const store = useStore.getState()
  if (!store.root) return
  store.notify('Analysing imports…', 'info')
  const files = await readProjectFiles()
  const graph = buildModuleGraph(store.root, files)
  await writeAndOpen(
    'dsm.md',
    [
      '# Dependency structure matrix',
      '',
      '_Rows depend on columns. Bold cells with ⚠ are one half of a cycle._',
      '',
      generateDsm(graph),
      '',
    ].join('\n'),
  )
}
