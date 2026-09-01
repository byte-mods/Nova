/**
 * Lexical analysis for the refactoring engine.
 *
 * The engine never parses a full grammar. What it does instead is *mask* every
 * string literal and comment to spaces, then scan the mask. That single step is
 * what makes the rest safe: a brace inside `"}"`, a comma inside `f("a,b")` and
 * an identifier inside `// TODO: order` all stop being traps. Slices always
 * come from the original text; only the scanning uses the mask.
 */

import type { LanguageProfile } from './profiles'
import type { Position, Range } from './types'

export interface Masked {
  /** Same length as the source; literal and comment bodies are spaces. */
  mask: string
  text: string
}

/** Replaces string and comment bodies with spaces, preserving offsets. */
export function maskLiterals(text: string, profile: LanguageProfile): Masked {
  const out = text.split('')
  const n = text.length
  let i = 0

  const startsWith = (token: string, at: number) => text.startsWith(token, at)
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }

  outer: while (i < n) {
    const ch = text[i]

    for (const token of profile.lineComments) {
      if (startsWith(token, i)) {
        const end = text.indexOf('\n', i)
        const stop = end === -1 ? n : end
        blank(i, stop)
        i = stop
        continue outer
      }
    }

    for (const [open, close] of profile.blockComments) {
      if (startsWith(open, i)) {
        const end = text.indexOf(close, i + open.length)
        const stop = end === -1 ? n : end + close.length
        blank(i, stop)
        i = stop
        continue outer
      }
    }

    if (profile.tripleQuotes && (startsWith('"""', i) || startsWith("'''", i))) {
      const token = text.slice(i, i + 3)
      const end = text.indexOf(token, i + 3)
      const stop = end === -1 ? n : end + 3
      blank(i, stop)
      i = stop
      continue
    }

    if (profile.quotes.includes(ch)) {
      const raw = ch === '`' && profile.rawBacktick
      const end = scanString(text, i, ch, raw)
      if (end === -1) {
        // An unterminated quote is far more likely to be an apostrophe, a Rust
        // lifetime or a shell glob than a real string — leave it alone.
        i++
        continue
      }
      blank(i, end + 1)
      i = end + 1
      continue
    }

    i++
  }

  return { mask: out.join(''), text }
}

/** Index of the closing quote, or -1 when the literal never closes sanely. */
function scanString(text: string, start: number, quote: string, raw: boolean): number {
  const n = text.length
  // A single-quote literal that runs past its line is not a literal.
  const limit = quote === "'" ? Math.min(n, indexOfOr(text, '\n', start + 1, n)) : n
  for (let i = start + 1; i < limit; i++) {
    const ch = text[i]
    if (!raw && ch === '\\') {
      i++
      continue
    }
    if (ch === quote) return i
    if (!raw && ch === '\n' && quote !== '`') return -1
  }
  return -1
}

function indexOfOr(text: string, needle: string, from: number, fallback: number) {
  const idx = text.indexOf(needle, from)
  return idx === -1 ? fallback : idx
}

/* ---------------- offsets and positions ---------------- */

export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

export function offsetAt(text: string, position: Position, starts = lineStartsOf(text)): number {
  if (position.line < 0) return 0
  if (position.line >= starts.length) return text.length
  const lineStart = starts[position.line]
  const lineEnd =
    position.line + 1 < starts.length ? starts[position.line + 1] - 1 : text.length
  return Math.min(lineStart + position.character, lineEnd)
}

export function positionAt(text: string, offset: number, starts = lineStartsOf(text)): Position {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= clamped) low = mid
    else high = mid - 1
  }
  return { line: low, character: clamped - starts[low] }
}

export function rangeOfOffsets(text: string, start: number, end: number): Range {
  const starts = lineStartsOf(text)
  return { start: positionAt(text, start, starts), end: positionAt(text, end, starts) }
}

/** Whole-line range covering lines `from`..`to` inclusive, including the trailing newline. */
export function lineRange(text: string, from: number, to: number): Range {
  return { start: { line: from, character: 0 }, end: { line: to + 1, character: 0 } }
}

/* ---------------- indentation ---------------- */

export function indentOf(line: string): string {
  const match = /^[ \t]*/.exec(line)
  return match ? match[0] : ''
}

export function indentWidth(indent: string, tabSize = 4): number {
  let width = 0
  for (const ch of indent) width += ch === '\t' ? tabSize : 1
  return width
}

/** Sniffs the file's own indentation so synthesized code matches it. */
export function detectIndentUnit(text: string, fallback: string): string {
  const lines = text.split('\n')
  let tabs = 0
  const spaceWidths = new Map<number, number>()
  for (const line of lines) {
    if (!line.trim()) continue
    const indent = indentOf(line)
    if (!indent) continue
    if (indent.includes('\t')) tabs++
    else spaceWidths.set(indent.length, (spaceWidths.get(indent.length) ?? 0) + 1)
  }
  if (tabs > 0 && tabs >= [...spaceWidths.values()].reduce((a, b) => a + b, 0)) return '\t'
  // The smallest indentation that actually occurs is the unit in almost every file.
  const widths = [...spaceWidths.keys()].filter((w) => w > 0).sort((a, b) => a - b)
  if (widths.length === 0) return fallback
  const unit = widths.find((w) => w === 2 || w === 4) ?? widths[0]
  return ' '.repeat(unit)
}

/** Re-indents a block of lines from `fromIndent` to `toIndent`. */
export function reindent(lines: string[], fromIndent: string, toIndent: string): string[] {
  return lines.map((line) => {
    if (!line.trim()) return ''
    return line.startsWith(fromIndent) ? toIndent + line.slice(fromIndent.length) : toIndent + line.trimStart()
  })
}

/** Strips the common leading indentation from a block. */
export function dedent(lines: string[]): { lines: string[]; indent: string } {
  const meaningful = lines.filter((l) => l.trim())
  if (meaningful.length === 0) return { lines, indent: '' }
  let common = indentOf(meaningful[0])
  for (const line of meaningful.slice(1)) {
    const indent = indentOf(line)
    let i = 0
    while (i < common.length && i < indent.length && common[i] === indent[i]) i++
    common = common.slice(0, i)
  }
  return {
    lines: lines.map((l) => (l.trim() ? l.slice(common.length) : '')),
    indent: common,
  }
}

/* ---------------- brace and bracket matching ---------------- */

const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']' }

/** Offset of the bracket closing the one at `open`, or -1. */
export function matchForward(mask: string, open: number): number {
  const opener = mask[open]
  const closer = PAIRS[opener]
  if (!closer) return -1
  let depth = 0
  for (let i = open; i < mask.length; i++) {
    const ch = mask[i]
    if (ch === opener) depth++
    else if (ch === closer) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Offset of the bracket opening the one at `close`, or -1. */
export function matchBackward(mask: string, close: number): number {
  const closer = mask[close]
  const opener = Object.keys(PAIRS).find((k) => PAIRS[k] === closer)
  if (!opener) return -1
  let depth = 0
  for (let i = close; i >= 0; i--) {
    const ch = mask[i]
    if (ch === closer) depth++
    else if (ch === opener) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Innermost `{ … }` containing `offset`, or null at top level. */
export function enclosingBraces(mask: string, offset: number): { open: number; close: number } | null {
  let depth = 0
  for (let i = offset; i >= 0; i--) {
    const ch = mask[i]
    if (ch === '}') depth++
    else if (ch === '{') {
      if (depth === 0) {
        const close = matchForward(mask, i)
        if (close > offset) return { open: i, close }
        return null
      }
      depth--
    }
  }
  return null
}

/** Splits `text[start..end)` on top-level separators, honouring nesting. */
export function splitTopLevel(
  text: string,
  mask: string,
  start: number,
  end: number,
  separator = ',',
): { text: string; start: number; end: number }[] {
  const parts: { text: string; start: number; end: number }[] = []
  let depth = 0
  let angle = 0
  let from = start
  for (let i = start; i < end; i++) {
    const ch = mask[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    // Generic parameters read as `<` `>` — track them only when balanced, so a
    // stray `a < b` comparison cannot swallow the rest of the argument list.
    else if (ch === '<') angle++
    else if (ch === '>' && angle > 0) angle--
    else if (ch === separator && depth === 0 && angle === 0) {
      parts.push({ text: text.slice(from, i), start: from, end: i })
      from = i + 1
    }
  }
  if (from < end || parts.length) parts.push({ text: text.slice(from, end), start: from, end })
  return parts.filter((p, index) => p.text.trim() !== '' || index < parts.length - 1 || parts.length === 1)
}

/* ---------------- identifiers ---------------- */

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g

export interface IdentifierHit {
  name: string
  start: number
  end: number
  /** True when preceded by `.`, `->` or `::` — a member, not a free name. */
  member: boolean
}

/** Every identifier token outside strings and comments. */
export function identifiers(masked: Masked, from = 0, to = masked.text.length): IdentifierHit[] {
  const hits: IdentifierHit[] = []
  IDENT.lastIndex = from
  let match: RegExpExecArray | null
  while ((match = IDENT.exec(masked.mask))) {
    if (match.index >= to) break
    if (match.index < from) continue
    const before = masked.mask.slice(Math.max(0, match.index - 2), match.index)
    hits.push({
      name: match[0],
      start: match.index,
      end: match.index + match[0].length,
      member: /\.$/.test(before) || /->$/.test(before) || /::$/.test(before),
    })
  }
  IDENT.lastIndex = 0
  return hits
}

function isIdentChar(ch: string | undefined) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/** Literal occurrences of `needle` at identifier boundaries, outside literals. */
export function occurrences(masked: Masked, needle: string, from = 0, to = masked.text.length): number[] {
  if (!needle) return []
  const found: number[] = []
  let index = masked.text.indexOf(needle, from)
  while (index !== -1 && index + needle.length <= to) {
    // The needle must not be masked out (i.e. inside a string or comment).
    const isLive = masked.mask.slice(index, index + needle.length) === needle
    const startsWord = /[A-Za-z0-9_$]/.test(needle[0])
    const endsWord = /[A-Za-z0-9_$]/.test(needle[needle.length - 1])
    const leftOk = !startsWord || !isIdentChar(masked.text[index - 1])
    const rightOk = !endsWord || !isIdentChar(masked.text[index + needle.length])
    if (isLive && leftOk && rightOk) found.push(index)
    index = masked.text.indexOf(needle, index + 1)
  }
  return found
}

/** The identifier under `offset`, or null. */
export function wordAtOffset(text: string, offset: number): { name: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null
  let start = offset
  while (start > 0 && isIdentChar(text[start - 1])) start--
  let end = offset
  while (end < text.length && isIdentChar(text[end])) end++
  if (start === end) return null
  const name = text.slice(start, end)
  if (!/^[A-Za-z_$]/.test(name)) return null
  return { name, start, end }
}

/* ---------------- declarations ---------------- */

export interface Declaration {
  kind: 'function' | 'class'
  name: string
  /** 0-based line of the declaration header. */
  line: number
  /** 0-based line where the body ends (inclusive). */
  endLine: number
  indent: string
  /** Offsets of the parameter list, when the header has one. */
  paramsStart: number
  paramsEnd: number
  headerStart: number
  headerEnd: number
}

/** Header patterns per profile. Group 1 is always the name. */
const FUNCTION_HEADERS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/,
    /^\s*(?:(?:public|private|protected|static|async|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;]+)?\s*\{/,
  ],
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/],
  java: [
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)+(?:<[^>]+>\s*)?[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\(/,
  ],
  kotlin: [/^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?([A-Za-z_]\w*)\s*\(/],
  csharp: [
    /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|new)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\(/,
  ],
  c: [/^\s*(?:static\s+)?[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/],
  cpp: [/^\s*(?:static\s+|virtual\s+|inline\s+)*[A-Za-z_~][\w\s*&:<>,]*?\b([A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{/],
  swift: [/^\s*(?:(?:public|private|internal|fileprivate|open|static|class|override|mutating)\s+)*func\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/],
  ruby: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/],
  php: [/^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)\s*\(/],
  dart: [/^\s*(?:(?:static|final|const)\s+)*[\w<>,\[\]? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*\*?\s*)?\{/],
  scala: [/^\s*(?:(?:private|protected|final|override|implicit)\s+)*def\s+([A-Za-z_]\w*)\s*\(/],
}

const CLASS_HEADERS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  ],
  python: [/^\s*class\s+([A-Za-z_]\w*)/],
  go: [/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)/],
  java: [/^\s*(?:(?:public|private|protected|static|final|abstract|sealed)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/],
  kotlin: [/^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|inner|value)\s+)*(?:class|object|interface)\s+([A-Za-z_]\w*)/],
  csharp: [/^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*(?:class|interface|struct|record)\s+([A-Za-z_]\w*)/],
  c: [/^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/],
  cpp: [/^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+([A-Za-z_]\w*)/],
  swift: [/^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|actor|protocol|extension|enum)\s+([A-Za-z_]\w*)/],
  ruby: [/^\s*(?:class|module)\s+([A-Z][\w:]*)/],
  php: [/^\s*(?:(?:abstract|final)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/],
  dart: [/^\s*(?:abstract\s+)?(?:class|mixin|extension)\s+([A-Za-z_]\w*)/],
  scala: [/^\s*(?:(?:private|protected|final|sealed|abstract|implicit|case)\s+)*(?:class|object|trait)\s+([A-Za-z_]\w*)/],
}

function patternsFor(table: Record<string, RegExp[]>, profile: LanguageProfile): RegExp[] {
  return table[profile.id] ?? table[profile.id.replace(/react$/, '')] ?? []
}

/**
 * Body end for a declaration on `line`.
 *
 * Brace languages match the first `{` at or after the header; indentation
 * languages take every following line indented deeper than the header (blank
 * lines belong to the block only when a deeper line follows).
 */
export function bodyEndLine(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  line: number,
): number {
  if (profile.indentScoped) {
    const base = indentWidth(indentOf(lines[line]))
    let end = line
    for (let i = line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      if (indentWidth(indentOf(lines[i])) <= base) break
      end = i
    }
    // Ruby-style `end` terminators sit at the header's own indentation.
    if (profile.id === 'ruby' && end + 1 < lines.length && lines[end + 1].trim() === 'end') end++
    return end
  }
  const from = starts[line]
  const searchEnd = starts[Math.min(lines.length - 1, line + 40)] ?? masked.mask.length
  const open = masked.mask.indexOf('{', from)
  if (open === -1 || open > searchEnd) return line
  const close = matchForward(masked.mask, open)
  if (close === -1) return lines.length - 1
  return positionAt(masked.text, close, starts).line
}

/**
 * Longer than any real declaration, and short enough that no amount of
 * backtracking over it is noticeable.
 */
const MAX_DECLARATION_LINE = 2_000

function scanDeclaration(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  patterns: RegExp[],
  kind: 'function' | 'class',
  line: number,
): Declaration | null {
  // The declaration patterns below carry the usual ambiguity of hand-written
  // language heuristics — a character class that includes a space, next to a
  // `\s+` that could match the same space. On a normal line that costs
  // nothing, and no language writes a declaration on a line this long anyway,
  // so a minified bundle is simply not looked at rather than being explored.
  if (lines[line].length > MAX_DECLARATION_LINE) return null

  for (const pattern of patterns) {
    const match = pattern.exec(lines[line])
    if (!match) continue
    const headerStart = starts[line]
    const headerEnd = headerStart + lines[line].length
    const parenOpen = masked.mask.indexOf('(', headerStart)
    const withinHeader = parenOpen !== -1 && parenOpen < headerEnd
    const parenClose = withinHeader ? matchForward(masked.mask, parenOpen) : -1
    return {
      kind,
      name: match[1],
      line,
      endLine: bodyEndLine(lines, masked, starts, profile, line),
      indent: indentOf(lines[line]),
      paramsStart: withinHeader ? parenOpen + 1 : -1,
      paramsEnd: parenClose === -1 ? -1 : parenClose,
      headerStart,
      headerEnd,
    }
  }
  return null
}

/** Nearest function declaration whose body contains `line`. */
export function enclosingFunction(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  line: number,
): Declaration | null {
  const patterns = patternsFor(FUNCTION_HEADERS, profile)
  if (patterns.length === 0) return null
  for (let i = line; i >= 0; i--) {
    const declaration = scanDeclaration(lines, masked, starts, profile, patterns, 'function', i)
    if (declaration && declaration.endLine >= line) return declaration
  }
  return null
}

/** Nearest class/struct declaration whose body contains `line`. */
export function enclosingClass(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  line: number,
): Declaration | null {
  const patterns = patternsFor(CLASS_HEADERS, profile)
  if (patterns.length === 0) return null
  for (let i = line; i >= 0; i--) {
    const declaration = scanDeclaration(lines, masked, starts, profile, patterns, 'class', i)
    if (declaration && declaration.endLine >= line) return declaration
  }
  return null
}

/** Every function declaration in the file, outermost order. */
export function allFunctions(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
): Declaration[] {
  const patterns = patternsFor(FUNCTION_HEADERS, profile)
  const found: Declaration[] = []
  for (let i = 0; i < lines.length; i++) {
    const declaration = scanDeclaration(lines, masked, starts, profile, patterns, 'function', i)
    if (declaration) found.push(declaration)
  }
  return found
}

/** Every class declaration in the file. */
export function allClasses(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
): Declaration[] {
  const patterns = patternsFor(CLASS_HEADERS, profile)
  const found: Declaration[] = []
  for (let i = 0; i < lines.length; i++) {
    const declaration = scanDeclaration(lines, masked, starts, profile, patterns, 'class', i)
    if (declaration) found.push(declaration)
  }
  return found
}

/** Declaration named `name` at `line`, function or class, without nesting checks. */
export function declarationAtLine(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  line: number,
): Declaration | null {
  return (
    scanDeclaration(lines, masked, starts, profile, patternsFor(FUNCTION_HEADERS, profile), 'function', line) ??
    scanDeclaration(lines, masked, starts, profile, patternsFor(CLASS_HEADERS, profile), 'class', line)
  )
}

/**
 * Line range of the statement containing `line`.
 *
 * Continuation lines are pulled in from both directions: upward while the
 * previous line clearly does not end a statement, downward while brackets
 * opened on the statement are still unbalanced.
 */
export function statementLines(
  lines: string[],
  masked: Masked,
  starts: number[],
  profile: LanguageProfile,
  line: number,
): { from: number; to: number } {
  /** Net `(`/`[` opened by a single line. */
  const openedBy = (index: number) => {
    let depth = 0
    const from = starts[index]
    const to = index + 1 < starts.length ? starts[index + 1] : masked.mask.length
    for (let k = from; k < to; k++) {
      const ch = masked.mask[k]
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
    }
    return depth
  }

  let from = line
  while (from > 0) {
    const previous = lines[from - 1].trim()
    if (!previous) break
    // `{`, `:` and `;` end a statement or open a *block* — the line below them
    // starts something new. Only an unclosed bracket or a trailing infix
    // operator means the statement really continues onto this line.
    if (/[{};:]$/.test(previous)) break
    if (openedBy(from - 1) > 0 || /(?:[,+\-*/%=&|.]|\\)$/.test(previous)) {
      from--
      continue
    }
    break
  }

  let to = Math.max(from, line)
  const balance = (upto: number) => {
    let depth = 0
    for (let i = starts[from]; i < (starts[upto + 1] ?? masked.mask.length); i++) {
      const ch = masked.mask[i]
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
    }
    return depth
  }
  while (to < lines.length - 1 && balance(to) > 0) to++
  return { from, to }
}
