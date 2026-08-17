/**
 * Optimize Imports.
 *
 * Two jobs: drop imports whose bound names never appear in the file, and put
 * what is left in a predictable order. Both need to know what a statement
 * *binds*, which is the only genuinely per-language part — `import { a as b }`
 * binds `b`, `import a.b.C` binds `C`, `import "os"` binds `os`.
 *
 * Only the contiguous block at the top of the file is reordered. An import
 * further down is deliberate (a lazy require, a conditional import) and moving
 * it could change when it runs, so those are left exactly where they are.
 *
 * Removal is skipped for languages where a bare import brings in an entire
 * namespace and the engine cannot tell whether it is used — Swift's
 * `import Foundation` is the archetype. Those still get sorted.
 */

import { maskingProfileFor } from '../refactor/profiles'
import { maskLiterals, occurrences } from '../refactor/syntax'
import type { CodeStyle } from './style'

export interface ParsedImport {
  /** 0-based, inclusive. */
  from: number
  to: number
  /** The module specifier, used for sorting. */
  module: string
  /** Names this statement binds into file scope. */
  names: string[]
  /** Imported purely for its side effects — never removed. */
  sideEffect: boolean
  /** Rebuilds the statement with a subset of names, when it can be split. */
  render: ((names: string[]) => string) | null
  raw: string[]
  group: 'external' | 'project'
}

export interface OptimizeResult {
  ok: boolean
  reason: string
  text: string
  /** Names that were dropped. */
  removed: string[]
  changed: boolean
}

/** Languages whose imports bind a whole namespace the engine cannot track. */
const SORT_ONLY = new Set(['swift', 'objective-c', 'c', 'cpp', 'ruby', 'lua', 'r'])

const LANGUAGE_FAMILY: Record<string, string> = {
  typescript: 'ts',
  typescriptreact: 'ts',
  javascript: 'ts',
  javascriptreact: 'ts',
  python: 'python',
  go: 'go',
  java: 'jvm',
  kotlin: 'jvm',
  scala: 'jvm',
  csharp: 'csharp',
  php: 'php',
  rust: 'rust',
  dart: 'dart',
  swift: 'swift',
}

export function optimizeImports(text: string, language: string, style: CodeStyle): OptimizeResult {
  const family = LANGUAGE_FAMILY[language] ?? LANGUAGE_FAMILY[language.replace(/react$/, '')]
  if (!family) {
    return { ok: false, reason: `Optimize Imports does not know how ${language} spells an import.`, text, removed: [], changed: false }
  }

  const lines = text.split('\n')
  const block = topBlock(lines, family)
  if (block.imports.length === 0) {
    return { ok: false, reason: 'No import block was found at the top of the file.', text, removed: [], changed: false }
  }

  const profile = maskingProfileFor(language)
  // Usage is measured over everything *outside* the block, so an import cannot
  // keep itself alive by mentioning its own name.
  const body = lines.map((line, index) => (index >= block.from && index <= block.to ? '' : line)).join('\n')
  const maskedBody = maskLiterals(body, profile)
  const used = (name: string) => occurrences(maskedBody, name).length > 0

  const canRemove = style.removeUnusedImports && !SORT_ONLY.has(language)
  const removed: string[] = []
  const kept: ParsedImport[] = []

  for (const entry of block.imports) {
    if (!canRemove || entry.sideEffect || entry.names.length === 0) {
      kept.push(entry)
      continue
    }
    const live = entry.names.filter(used)
    if (live.length === entry.names.length) {
      kept.push(entry)
      continue
    }
    removed.push(...entry.names.filter((name) => !live.includes(name)))
    if (live.length === 0) continue
    if (!entry.render) {
      // Cannot drop part of it, so keep the whole thing rather than guess.
      kept.push(entry)
      continue
    }
    kept.push({ ...entry, names: live, raw: [entry.render(live)] })
  }

  if (style.importOrder === 'alphabetical') {
    kept.sort((a, b) => {
      if (a.group !== b.group) return a.group === 'external' ? -1 : 1
      return a.module.localeCompare(b.module) || a.raw[0].localeCompare(b.raw[0])
    })
  }

  const rendered = renderBlock(kept, style, family)
  const next = [...lines.slice(0, block.from), ...rendered, ...lines.slice(block.to + 1)].join('\n')

  return {
    ok: true,
    reason: '',
    text: next,
    removed,
    changed: next !== text,
  }
}

function renderBlock(kept: ParsedImport[], style: CodeStyle, family: string): string[] {
  const withGaps = (render: (entry: ParsedImport) => string[]) => {
    const out: string[] = []
    let previous: ParsedImport['group'] | null = null
    for (const entry of kept) {
      if (style.groupImports && previous !== null && entry.group !== previous) out.push('')
      out.push(...render(entry))
      previous = entry.group
    }
    return out
  }

  if (family === 'go') {
    if (kept.length === 0) return []
    // Go always writes the grouped form back, which is what `gofmt` produces
    // for anything with more than one import.
    return ['import (', ...withGaps((entry) => entry.raw.map((line) => `\t${line.trim()}`)), ')']
  }

  return withGaps((entry) => entry.raw)
}

interface TopBlock {
  /** 0-based bounds of the region that will be rewritten. */
  from: number
  to: number
  imports: ParsedImport[]
}

const COMMENT_START = /^(?:\/\/|#|\/\*|\*|\*\/|--|;)/

/**
 * The contiguous run of imports at the top of the file. Scanning stops at the
 * first line that is real code.
 *
 * Comments inside the block are attached to the import that follows them, so a
 * `// eslint-disable-next-line` travels with its statement instead of being
 * stranded — or, worse, dropped — when the block is re-ordered.
 */
function topBlock(lines: string[], family: string): TopBlock {
  const imports: ParsedImport[] = []
  let index = 0
  let from = -1
  let to = -1
  let pending: string[] = []
  let pendingFrom = -1

  const isSkippable = (line: string) => {
    const trimmed = line.trim()
    return (
      trimmed === '' ||
      trimmed.startsWith('#!') ||
      COMMENT_START.test(trimmed) ||
      trimmed.startsWith('"""') ||
      /^(?:package|namespace)\b/.test(trimmed) ||
      /^['"]use (?:strict|client|server)['"];?$/.test(trimmed)
    )
  }

  while (index < lines.length) {
    const parsed = parseImport(lines, index, family)
    if (parsed && parsed.entries.length > 0) {
      const start = pending.length ? pendingFrom : index
      if (from === -1) from = start
      to = parsed.to
      // The comment block rides on the first entry of the statement.
      parsed.entries[0] = { ...parsed.entries[0], raw: [...pending, ...parsed.entries[0].raw] }
      imports.push(...parsed.entries)
      pending = []
      pendingFrom = -1
      index = parsed.to + 1
      continue
    }
    if (isSkippable(lines[index])) {
      const trimmed = lines[index].trim()
      if (trimmed && COMMENT_START.test(trimmed) && from !== -1) {
        if (pendingFrom === -1) pendingFrom = index
        pending.push(lines[index])
      } else if (!trimmed) {
        // A blank line neither belongs to a comment run nor ends the block.
        if (pending.length) pending.push(lines[index])
      } else {
        pending = []
        pendingFrom = -1
      }
      index++
      continue
    }
    break
  }

  if (from === -1) return { from: 0, to: -1, imports: [] }
  return { from, to, imports }
}

/* ---------------- per-language statement parsing ---------------- */

function groupOf(module: string): ParsedImport['group'] {
  return module.startsWith('.') || module.startsWith('/') || module.startsWith('@/') ? 'project' : 'external'
}

/**
 * One source *statement* can be several imports — Go's grouped block is the
 * only case, but it is common enough to shape the return type.
 */
interface ParsedStatement {
  /** Last line the statement occupies, 0-based inclusive. */
  to: number
  entries: ParsedImport[]
}

function one(entry: ParsedImport | null): ParsedStatement | null {
  return entry ? { to: entry.to, entries: [entry] } : null
}

function parseImport(lines: string[], index: number, family: string): ParsedStatement | null {
  switch (family) {
    case 'ts':
      return one(parseTsImport(lines, index))
    case 'python':
      return one(parsePythonImport(lines, index))
    case 'go':
      return parseGoImport(lines, index)
    case 'jvm':
      return one(parseJvmImport(lines, index))
    case 'csharp':
      return one(parseSimpleImport(lines, index, /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/, '.'))
    case 'php':
      return one(
        parseSimpleImport(lines, index, /^\s*use\s+(?:function\s+|const\s+)?([\w\\]+)\s*(?:as\s+(\w+))?\s*;/, '\\'),
      )
    case 'rust':
      return one(parseRustImport(lines, index))
    case 'dart':
      return one(parseDartImport(lines, index))
    case 'swift':
      return one(parseSimpleImport(lines, index, /^\s*import\s+([\w.]+)\s*$/, '.'))
    default:
      return null
  }
}

/** Consumes lines until the statement's brackets balance and it ends sanely. */
function statementSpan(lines: string[], index: number, opener: string, closer: string): number {
  let depth = 0
  for (let i = index; i < lines.length && i < index + 40; i++) {
    for (const ch of lines[i]) {
      if (ch === opener) depth++
      else if (ch === closer) depth--
    }
    if (depth <= 0) return i
  }
  return index
}

function parseTsImport(lines: string[], index: number): ParsedImport | null {
  const line = lines[index]
  if (!/^\s*(?:import\b|(?:const|let|var)\s+[\w{},\s:*]+=\s*require\s*\()/.test(line)) return null
  if (/^\s*import\s+[\w$]*\s*\(/.test(line)) return null // dynamic import()

  const to = line.includes('{') && !line.includes('}') ? statementSpan(lines, index, '{', '}') : index
  const raw = lines.slice(index, to + 1)
  const joined = raw.join(' ')

  const specifier = /from\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/.exec(joined)
  const module = specifier ? (specifier[1] ?? specifier[2] ?? specifier[3] ?? '') : ''
  if (!module) return null

  // `import 'polyfill'` — nothing bound, never removable.
  if (/^\s*import\s*['"]/.test(line)) {
    return { from: index, to, module, names: [], sideEffect: true, render: null, raw, group: groupOf(module) }
  }

  const typeOnly = /^\s*import\s+type\b/.test(joined)
  const clause = /^\s*import\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]/.exec(joined)
    ?? /^\s*(?:const|let|var)\s+([\s\S]*?)\s*=\s*require/.exec(joined)
  if (!clause) return null

  const text = clause[1].trim()
  const bracesAt = text.indexOf('{')
  const head = (bracesAt === -1 ? text : text.slice(0, bracesAt)).replace(/,\s*$/, '').trim()
  const braced = bracesAt === -1 ? '' : text.slice(bracesAt + 1, text.lastIndexOf('}'))

  const defaults: string[] = []
  if (head) {
    const namespace = /^\*\s*as\s+([\w$]+)$/.exec(head)
    if (namespace) defaults.push(namespace[1])
    else if (/^[\w$]+$/.test(head)) defaults.push(head)
    else return { from: index, to, module, names: [], sideEffect: true, render: null, raw, group: groupOf(module) }
  }

  const specifiers = braced
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliased = /^(?:type\s+)?([\w$]+)\s+as\s+([\w$]+)$/.exec(part)
      if (aliased) return { source: part, bound: aliased[2] }
      const bare = /^(?:type\s+)?([\w$]+)$/.exec(part)
      return bare ? { source: part, bound: bare[1] } : null
    })

  if (specifiers.some((s) => s === null)) {
    return { from: index, to, module, names: [], sideEffect: true, render: null, raw, group: groupOf(module) }
  }
  const named = specifiers as { source: string; bound: string }[]
  const isRequire = /require\s*\(/.test(joined)

  const render = (keep: string[]) => {
    const keptNamed = named.filter((s) => keep.includes(s.bound))
    const keptDefault = defaults.filter((d) => keep.includes(d))
    const parts: string[] = []
    if (keptDefault.length) parts.push(head)
    if (keptNamed.length) parts.push(`{ ${keptNamed.map((s) => s.source).join(', ')} }`)
    const clauseText = parts.join(', ')
    if (isRequire) {
      const keyword = /^\s*(const|let|var)/.exec(joined)?.[1] ?? 'const'
      return `${keyword} ${clauseText} = require('${module}')`
    }
    return `import ${typeOnly ? 'type ' : ''}${clauseText} from '${module}'`
  }

  return {
    from: index,
    to,
    module,
    names: [...defaults, ...named.map((s) => s.bound)],
    sideEffect: false,
    render,
    raw,
    group: groupOf(module),
  }
}

function parsePythonImport(lines: string[], index: number): ParsedImport | null {
  const line = lines[index]
  const fromImport = /^\s*from\s+([\w.]+)\s+import\s+(.*)$/.exec(line)
  if (fromImport) {
    const to = fromImport[2].trim().startsWith('(') && !fromImport[2].includes(')')
      ? statementSpan(lines, index, '(', ')')
      : index
    const raw = lines.slice(index, to + 1)
    const body = raw.join(' ').replace(/^\s*from\s+[\w.]+\s+import\s*/, '').replace(/[()]/g, '')
    if (body.trim() === '*') {
      return { from: index, to, module: fromImport[1], names: [], sideEffect: true, render: null, raw, group: groupOf(fromImport[1].startsWith('.') ? '.' : fromImport[1]) }
    }
    const parts = body.split(',').map((p) => p.trim()).filter(Boolean)
    const bound = parts.map((part) => {
      const aliased = /^([\w.]+)\s+as\s+(\w+)$/.exec(part)
      return { source: part, bound: aliased ? aliased[2] : part.split('.')[0] }
    })
    return {
      from: index,
      to,
      module: fromImport[1],
      names: bound.map((b) => b.bound),
      sideEffect: false,
      render: (keep) =>
        `from ${fromImport[1]} import ${bound.filter((b) => keep.includes(b.bound)).map((b) => b.source).join(', ')}`,
      raw,
      group: fromImport[1].startsWith('.') ? 'project' : 'external',
    }
  }

  const plain = /^\s*import\s+([\w., ]+)$/.exec(line)
  if (!plain) return null
  const parts = plain[1].split(',').map((p) => p.trim()).filter(Boolean)
  const bound = parts.map((part) => {
    const aliased = /^([\w.]+)\s+as\s+(\w+)$/.exec(part)
    return { source: part, bound: aliased ? aliased[2] : part.split('.')[0] }
  })
  return {
    from: index,
    to: index,
    module: parts[0] ?? '',
    names: bound.map((b) => b.bound),
    sideEffect: false,
    render: (keep) => `import ${bound.filter((b) => keep.includes(b.bound)).map((b) => b.source).join(', ')}`,
    raw: [line],
    group: (parts[0] ?? '').startsWith('.') ? 'project' : 'external',
  }
}

/**
 * Go's grouped block, flattened to one entry per path.
 *
 * Unused imports are a compile error in Go, so this is the language where the
 * refactoring earns its keep most obviously.
 */
function goEntry(line: string, index: number): ParsedImport | null {
  const match = /^\s*(?:(\w+|\.|_)\s+)?"([^"]+)"\s*$/.exec(line)
  if (!match) return null
  const alias = match[1]
  const module = match[2]
  const blank = alias === '_' || alias === '.'
  const name = alias && !blank ? alias : (module.split('/').pop() ?? module)
  return {
    from: index,
    to: index,
    module,
    names: blank ? [] : [name],
    sideEffect: blank,
    render: null,
    raw: [line.trim()],
    // A path with a dot in its first segment is a hosted module; anything else
    // is the module's own package tree.
    group: module.split('/')[0].includes('.') ? 'external' : 'project',
  }
}

function parseGoImport(lines: string[], index: number): ParsedStatement | null {
  const line = lines[index].trim()
  const single = /^import\s+((?:\w+|\.|_)\s+)?"[^"]+"$/.exec(line)
  if (single) {
    const entry = goEntry(line.replace(/^import\s+/, ''), index)
    return entry ? { to: index, entries: [entry] } : null
  }
  if (!/^import\s*\($/.test(line)) return null

  const close = lines.findIndex((l, i) => i > index && l.trim() === ')')
  if (close === -1) return null
  const entries: ParsedImport[] = []
  for (let i = index + 1; i < close; i++) {
    const entry = goEntry(lines[i], i)
    if (entry) entries.push(entry)
  }
  return { to: close, entries }
}

function parseJvmImport(lines: string[], index: number): ParsedImport | null {
  const line = lines[index]
  const match = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*(?:as\s+(\w+))?\s*;?\s*$/.exec(line)
  if (!match) {
    // Scala's `import a.b.{C, D}`.
    const braced = /^\s*import\s+([\w.]+)\.\{([^}]*)\}\s*$/.exec(line)
    if (!braced) return null
    const parts = braced[2].split(',').map((p) => p.trim()).filter(Boolean)
    const bound = parts.map((part) => {
      const aliased = /^(\w+)\s*=>\s*(\w+)$/.exec(part)
      return { source: part, bound: aliased ? aliased[2] : part }
    })
    return {
      from: index,
      to: index,
      module: braced[1],
      names: bound.map((b) => b.bound),
      sideEffect: false,
      render: (keep) =>
        `import ${braced[1]}.{${bound.filter((b) => keep.includes(b.bound)).map((b) => b.source).join(', ')}}`,
      raw: [line],
      group: 'external',
    }
  }
  const path = match[1]
  if (path.endsWith('.*')) {
    return { from: index, to: index, module: path, names: [], sideEffect: true, render: null, raw: [line], group: 'external' }
  }
  const name = match[2] ?? path.split('.').pop() ?? path
  return {
    from: index,
    to: index,
    module: path,
    names: [name],
    sideEffect: false,
    render: null,
    raw: [line],
    group: 'external',
  }
}

function parseSimpleImport(
  lines: string[],
  index: number,
  pattern: RegExp,
  separator: string,
): ParsedImport | null {
  const line = lines[index]
  const match = pattern.exec(line)
  if (!match) return null
  const path = match[1]
  const name = match[2] ?? path.split(separator).pop() ?? path
  return {
    from: index,
    to: index,
    module: path,
    names: [name],
    sideEffect: false,
    render: null,
    raw: [line],
    group: 'external',
  }
}

function parseRustImport(lines: string[], index: number): ParsedImport | null {
  const line = lines[index]
  if (!/^\s*(?:pub\s+)?use\s+/.test(line)) return null
  const to = line.includes('{') && !line.includes('}') ? statementSpan(lines, index, '{', '}') : index
  const raw = lines.slice(index, to + 1)
  const joined = raw.join(' ').replace(/;\s*$/, '')
  const path = /use\s+([\w:]+)/.exec(joined)?.[1] ?? ''
  const braced = /\{([^}]*)\}/.exec(joined)
  if (braced) {
    const parts = braced[1].split(',').map((p) => p.trim()).filter(Boolean)
    // A nested group (`a::{b::{c}}`) is beyond what this can safely split.
    if (parts.some((part) => part.includes('{'))) {
      return { from: index, to, module: path, names: [], sideEffect: true, render: null, raw, group: 'external' }
    }
    const bound = parts.map((part) => {
      const aliased = /^([\w:]+)\s+as\s+(\w+)$/.exec(part)
      return { source: part, bound: aliased ? aliased[2] : part.split('::').pop() ?? part }
    })
    return {
      from: index,
      to,
      module: path,
      names: bound.map((b) => b.bound).filter((n) => n !== 'self' && n !== '*'),
      sideEffect: parts.includes('*'),
      render: (keep) =>
        `use ${path}::{${bound.filter((b) => keep.includes(b.bound)).map((b) => b.source).join(', ')}};`,
      raw,
      group: path.startsWith('crate') || path.startsWith('super') || path.startsWith('self') ? 'project' : 'external',
    }
  }
  const aliased = /use\s+[\w:]+\s+as\s+(\w+)/.exec(joined)
  const name = aliased ? aliased[1] : path.split('::').pop() ?? path
  if (name === '*') {
    return { from: index, to, module: path, names: [], sideEffect: true, render: null, raw, group: 'external' }
  }
  return {
    from: index,
    to,
    module: path,
    names: [name],
    sideEffect: false,
    render: null,
    raw,
    group: path.startsWith('crate') || path.startsWith('super') || path.startsWith('self') ? 'project' : 'external',
  }
}

function parseDartImport(lines: string[], index: number): ParsedImport | null {
  const line = lines[index]
  const match = /^\s*(?:import|export)\s+'([^']+)'(.*);\s*$/.exec(line)
  if (!match) return null
  const module = match[1]
  const tail = match[2]
  const alias = /\bas\s+(\w+)/.exec(tail)?.[1]
  const shown = /\bshow\s+([\w,\s]+)/.exec(tail)?.[1]
  const names = alias ? [alias] : shown ? shown.split(',').map((n) => n.trim()).filter(Boolean) : []
  return {
    from: index,
    to: index,
    module,
    names,
    // A plain `import 'x.dart';` pulls in every top-level name; not removable.
    sideEffect: names.length === 0,
    render: null,
    raw: [line],
    group: module.startsWith('package:') || module.startsWith('dart:') ? 'external' : 'project',
  }
}
