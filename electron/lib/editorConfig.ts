/**
 * EditorConfig support.
 *
 * A small, faithful reader rather than a dependency: walk from the file's own
 * directory up to the root (or to the first `root = true`), collect the
 * sections whose glob matches, and let nearer files win. That is the whole
 * spec's resolution model, and it is what makes a repo's `.editorconfig`
 * authoritative over the user's personal code style.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

export type EditorConfigProperties = Record<string, string>

interface Section {
  pattern: string
  properties: EditorConfigProperties
}

interface ParsedFile {
  root: boolean
  sections: Section[]
}

export function parseEditorConfig(text: string): ParsedFile {
  const sections: Section[] = []
  let root = false
  let current: Section | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const header = /^\[(.*)\]$/.exec(line)
    if (header) {
      current = { pattern: header[1], properties: {} }
      sections.push(current)
      continue
    }

    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (!current) {
      if (key === 'root') root = value.toLowerCase() === 'true'
      continue
    }
    current.properties[key] = value
  }

  return { root, sections }
}

/**
 * EditorConfig globs, translated to a regular expression.
 *
 * The dialect is its own: `**` crosses directories, `*` does not, `{a,b}`
 * alternates and `{1..9}` is a numeric range. Only the parts that appear in
 * real files are implemented; anything unrecognised is escaped literally, so a
 * pattern this does not understand simply fails to match rather than matching
 * everything.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = ''
  let braceDepth = 0

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*'
        i++
        // `**/` should also match zero directories.
        if (pattern[i + 1] === '/') {
          source += '/?'
          i++
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      source += '[^/]'
      continue
    }
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        source += '\\['
        continue
      }
      let body = pattern.slice(i + 1, close)
      if (body.startsWith('!')) body = `^${body.slice(1)}`
      source += `[${body}]`
      i = close
      continue
    }
    if (ch === '{') {
      const close = matchingBrace(pattern, i)
      if (close === -1) {
        source += '\\{'
        continue
      }
      const body = pattern.slice(i + 1, close)
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body)
      if (range) {
        source += '-?\\d+'
      } else {
        braceDepth++
        source += `(?:${body.split(',').map((part) => globToRegExp(part).source.replace(/^\^|\$$/g, '')).join('|')})`
        braceDepth--
      }
      i = close
      continue
    }
    source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }

  void braceDepth
  // A pattern with no slash matches the basename at any depth.
  const anchored = pattern.includes('/') ? `^/?${source}$` : `^(?:.*/)?${source}$`
  return new RegExp(anchored)
}

function matchingBrace(pattern: string, open: number): number {
  let depth = 0
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++
    else if (pattern[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Effective properties for `file`, or null when no `.editorconfig` applies.
 *
 * `stopAt` bounds the walk to the open project so a stray `.editorconfig` in a
 * parent of the user's home directory cannot reach in.
 */
export async function resolveEditorConfig(
  file: string,
  stopAt: string,
): Promise<EditorConfigProperties | null> {
  const chain: { dir: string; parsed: ParsedFile }[] = []
  let dir = path.dirname(file)
  const boundary = stopAt ? path.resolve(stopAt) : path.parse(dir).root

  for (;;) {
    try {
      const text = await fs.readFile(path.join(dir, '.editorconfig'), 'utf8')
      const parsed = parseEditorConfig(text)
      chain.push({ dir, parsed })
      if (parsed.root) break
    } catch {
      /* no .editorconfig here */
    }
    if (dir === boundary || dir === path.parse(dir).root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  if (chain.length === 0) return null

  // Furthest first, so nearer files overwrite what they inherit.
  const properties: EditorConfigProperties = {}
  for (const { dir: base, parsed } of chain.reverse()) {
    const relative = path.relative(base, file).split(path.sep).join('/')
    for (const section of parsed.sections) {
      if (!globToRegExp(section.pattern).test(relative)) continue
      Object.assign(properties, section.properties)
    }
  }

  // `indent_size = tab` means "whatever tab_width says".
  if (properties.indent_size === 'tab' && properties.tab_width) {
    properties.indent_size = properties.tab_width
  }
  return Object.keys(properties).length ? properties : null
}
