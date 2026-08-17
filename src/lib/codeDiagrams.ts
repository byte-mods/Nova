/**
 * Diagrams generated *from* code, rather than drawn by hand: UML class
 * diagrams, module dependency graphs and the dependency structure matrix.
 *
 * Everything here is pure — symbols and file texts go in, Mermaid/Markdown
 * comes out — the driver in `diagramActions.ts` feeds it from the index and
 * the file system. Inheritance is read off each class's own declaration line
 * (the index stores it as `signature`), so no file needs re-parsing for the
 * class diagram at all.
 */

import type { CodeSymbol } from '@shared/types'
import { baseClassesOf } from './refactor/members'
import { specifiersIn } from './refactor/move'

/* ================================================================== */
/* UML class diagram                                                   */
/* ================================================================== */

export interface UmlOptions {
  /** Cap on classes, keeps the diagram readable and mermaid alive. */
  maxClasses?: number
  includeMembers?: boolean
}

/** Mermaid identifiers cannot carry arbitrary punctuation; strip to word chars. */
function mermaidId(name: string): string {
  return name.replace(/[^\w]/g, '_')
}

export function generateClassDiagram(symbols: CodeSymbol[], options: UmlOptions = {}): string {
  const maxClasses = options.maxClasses ?? 60
  const includeMembers = options.includeMembers ?? true

  const classes = symbols.filter((s) =>
    ['class', 'interface', 'struct', 'trait', 'enum'].includes(s.kind),
  )
  // Rank by how much is known about each: members first, then exported.
  const memberCount = new Map<string, number>()
  for (const symbol of symbols) {
    if (!symbol.container) continue
    memberCount.set(symbol.container, (memberCount.get(symbol.container) ?? 0) + 1)
  }
  const chosen = [...classes]
    .sort(
      (a, b) =>
        (memberCount.get(b.name) ?? 0) - (memberCount.get(a.name) ?? 0) ||
        Number(b.exported) - Number(a.exported),
    )
    .slice(0, maxClasses)
  const chosenNames = new Set(chosen.map((c) => c.name))

  const lines: string[] = ['classDiagram']

  for (const cls of chosen) {
    const id = mermaidId(cls.name)
    const kindNote =
      cls.kind === 'interface' ? '<<interface>>' : cls.kind === 'trait' ? '<<trait>>' : cls.kind === 'enum' ? '<<enumeration>>' : cls.kind === 'struct' ? '<<struct>>' : ''
    const members = includeMembers
      ? symbols
          .filter((s) => s.container === cls.name && s.file === cls.file)
          .slice(0, 12)
      : []
    if (kindNote || members.length) {
      lines.push(`  class ${id} {`)
      if (kindNote) lines.push(`    ${kindNote}`)
      for (const member of members) {
        const marker = member.kind === 'method' || member.kind === 'function' ? '()' : ''
        lines.push(`    ${member.exported ? '+' : '-'}${sanitizeMember(member.name)}${marker}`)
      }
      lines.push('  }')
    } else {
      lines.push(`  class ${id}`)
    }
  }

  // Inheritance edges from each header line, resolved against the chosen set.
  const edges = new Set<string>()
  for (const cls of chosen) {
    for (const base of baseClassesOf(cls.signature, cls.language)) {
      if (!chosenNames.has(base) || base === cls.name) continue
      edges.add(`  ${mermaidId(base)} <|-- ${mermaidId(cls.name)}`)
    }
  }
  lines.push(...[...edges].sort())

  if (chosen.length === 0) lines.push('  class NoClassesFound')
  return lines.join('\n')
}

function sanitizeMember(name: string): string {
  return name.replace(/[^\w$]/g, '_')
}

/* ================================================================== */
/* Module dependency graph + DSM                                       */
/* ================================================================== */

export interface ModuleGraph {
  /** Module name -> set of modules it imports. */
  edges: Map<string, Map<string, number>>
  modules: string[]
}

/**
 * The module a file belongs to: its first path segment under the root — the
 * granularity at which people actually reason about dependencies (`src/lib` vs
 * `src/components`, or top-level packages in a monorepo).
 */
export function moduleOf(root: string, file: string): string | null {
  if (!file.startsWith(root)) return null
  const relative = file.slice(root.length).replace(/^\/+/, '')
  const parts = relative.split('/')
  if (parts.length < 2) return '(root)'
  // `src/components/editor/x.tsx` → `src/components`; `packages/web/...` → `packages/web`.
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0]
}

const IMPORTABLE = /\.(tsx?|jsx?|mts|cts|mjs|cjs|py|go|rs|java|kt|swift|rb|php)$/

/** Builds the module graph from file texts and their import statements. */
export function buildModuleGraph(
  root: string,
  files: { path: string; text: string }[],
): ModuleGraph {
  const edges = new Map<string, Map<string, number>>()
  const modules = new Set<string>()

  const resolveRelative = (fromFile: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null
    const parts = fromFile.split('/').slice(0, -1)
    for (const segment of specifier.split('/')) {
      if (segment === '.' || segment === '') continue
      if (segment === '..') parts.pop()
      else parts.push(segment)
    }
    return parts.join('/')
  }

  for (const { path, text } of files) {
    if (!IMPORTABLE.test(path)) continue
    const fromModule = moduleOf(root, path)
    if (!fromModule) continue
    modules.add(fromModule)

    const targets = new Set<string>()
    // JS-family relative specifiers.
    for (const specifier of specifiersIn(text)) {
      const resolved = resolveRelative(path, specifier.value)
      if (!resolved) continue
      const target = moduleOf(root, resolved)
      if (target) targets.add(target)
    }
    // Alias imports (`@/x` → `src/x` convention) and Python dotted imports.
    for (const match of text.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)) {
      const target = moduleOf(root, `${root}/src/${match[1]}`)
      if (target) targets.add(target)
    }
    for (const match of text.matchAll(/^\s*(?:from|import)\s+([\w.]+)/gm)) {
      const dotted = match[1]
      if (!dotted.includes('.')) continue
      const target = moduleOf(root, `${root}/${dotted.split('.').slice(0, 2).join('/')}.py`)
      if (target && target !== '(root)') targets.add(target)
    }

    for (const target of targets) {
      if (target === fromModule) continue
      modules.add(target)
      const bucket = edges.get(fromModule) ?? new Map<string, number>()
      bucket.set(target, (bucket.get(target) ?? 0) + 1)
      edges.set(fromModule, bucket)
    }
  }

  return { edges, modules: [...modules].sort() }
}

export function generateModuleDiagram(graph: ModuleGraph): string {
  const lines = ['graph LR']
  const ids = new Map<string, string>()
  graph.modules.forEach((module, index) => ids.set(module, `m${index}`))
  for (const module of graph.modules) {
    lines.push(`  ${ids.get(module)}["${module}"]`)
  }
  for (const [from, targets] of graph.edges) {
    for (const [to, count] of targets) {
      lines.push(`  ${ids.get(from)} -->|${count}| ${ids.get(to)}`)
    }
  }
  if (graph.modules.length === 0) lines.push('  empty["no modules found"]')
  return lines.join('\n')
}

/**
 * The dependency structure matrix as a Markdown table: rows depend on columns.
 *
 * A cell above the diagonal with a non-zero count is a cycle candidate — the
 * generator marks them so the matrix answers the question it exists for.
 */
export function generateDsm(graph: ModuleGraph): string {
  const modules = graph.modules
  if (modules.length === 0) return '_No modules found._'

  const index = new Map(modules.map((module, i) => [module, i]))
  const header = `| depends on → |${modules.map((_m, i) => ` ${i + 1} |`).join('')}`
  const divider = `|---|${modules.map(() => '---|').join('')}`
  const rows = modules.map((from, rowIndex) => {
    const cells = modules.map((to, colIndex) => {
      if (rowIndex === colIndex) return '·'
      const count = graph.edges.get(from)?.get(to) ?? 0
      if (count === 0) return ''
      // Above the diagonal means a dependency on something "later" — combined
      // with the mirrored cell it is a cycle.
      const reverse = graph.edges.get(to)?.get(from) ?? 0
      return reverse > 0 ? `**${count}⚠**` : String(count)
    })
    return `| **${rowIndex + 1}. ${from}** |${cells.map((cell) => ` ${cell} |`).join('')}`
  })

  const cycles: string[] = []
  for (const [from, targets] of graph.edges) {
    for (const to of targets.keys()) {
      if ((graph.edges.get(to)?.get(from) ?? 0) > 0 && (index.get(from) ?? 0) < (index.get(to) ?? 0)) {
        cycles.push(`- \`${from}\` ↔ \`${to}\``)
      }
    }
  }

  return [
    header,
    divider,
    ...rows,
    '',
    cycles.length ? `**Cyclic dependencies:**\n${cycles.join('\n')}` : '_No cyclic dependencies._',
  ].join('\n')
}
