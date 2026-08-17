/**
 * Structural search and replace.
 *
 * A pattern is code with `$name$` holes: `console.log($arg$)` matches any call
 * and captures the argument, so it can be rewritten as `logger.debug($arg$)`
 * without a regex that breaks on the first nested parenthesis.
 *
 * This is a *lexical* implementation, not IntelliJ's AST-based one. It cannot
 * know that two expressions are semantically the same, and it will not match
 * across reformatting. What it does do — and what regex cannot — is respect
 * nesting when capturing a hole, so `$arg$` in `f($arg$)` captures
 * `g(a, h(b))` whole instead of stopping at the first `)`.
 */

export interface StructuralMatch {
  line: number
  column: number
  endColumn: number
  text: string
  /** Hole name to captured text. */
  captures: Record<string, string>
}

/** One token of a compiled pattern. */
type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'hole'; name: string }
  | { kind: 'gap' }

/**
 * Compiles a pattern into tokens.
 *
 * Runs of whitespace in the pattern become `gap`, which matches any whitespace
 * including none — so a pattern written with one space still matches code
 * formatted with two, or with a newline.
 */
export function compilePattern(pattern: string): Token[] {
  const tokens: Token[] = []
  let buffer = ''

  const flushLiteral = () => {
    if (buffer) {
      tokens.push({ kind: 'literal', text: buffer })
      buffer = ''
    }
  }

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]

    if (char === '$') {
      const end = pattern.indexOf('$', i + 1)
      const name = end === -1 ? '' : pattern.slice(i + 1, end)
      // `$$` is a literal dollar; a hole name must be an identifier.
      if (end !== -1 && /^[A-Za-z_][\w]*$/.test(name)) {
        flushLiteral()
        tokens.push({ kind: 'hole', name })
        i = end
        continue
      }
    }

    if (/\s/.test(char)) {
      flushLiteral()
      if (tokens[tokens.length - 1]?.kind !== 'gap') tokens.push({ kind: 'gap' })
      while (i + 1 < pattern.length && /\s/.test(pattern[i + 1])) i++
      continue
    }

    buffer += char
  }

  flushLiteral()
  return tokens
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set([')', ']', '}'])

/**
 * Reads one hole's worth of text starting at `start`.
 *
 * Consumes balanced brackets and complete string literals, and stops at the
 * first character that could begin the pattern's next literal token at nesting
 * depth zero. Returns null when the hole would be empty, since a hole matching
 * nothing almost always means the pattern is wrong.
 */
function captureHole(text: string, start: number, stopAt: string | null): { value: string; end: number } | null {
  let depth = 0
  let index = start
  let quote: string | null = null

  while (index < text.length) {
    const char = text[index]

    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = null
      index++
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      index++
      continue
    }

    if (OPENERS[char]) {
      depth++
      index++
      continue
    }

    if (CLOSERS.has(char)) {
      // A closer at depth zero belongs to the enclosing pattern, not the hole.
      if (depth === 0) break
      depth--
      index++
      continue
    }

    if (depth === 0 && stopAt && text.startsWith(stopAt, index)) break
    // A comma at depth zero separates arguments, so it ends a hole unless the
    // pattern explicitly continues past one.
    if (depth === 0 && char === ',' && stopAt !== ',') break

    index++
  }

  const value = text.slice(start, index).trim()
  return value ? { value, end: index } : null
}

/** Attempts to match the compiled pattern at exactly `offset`. */
function matchAt(
  text: string,
  offset: number,
  tokens: Token[],
): { end: number; captures: Record<string, string> } | null {
  let index = offset
  const captures: Record<string, string> = {}

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]

    if (token.kind === 'literal') {
      if (!text.startsWith(token.text, index)) return null
      index += token.text.length
      continue
    }

    if (token.kind === 'gap') {
      while (index < text.length && /\s/.test(text[index])) index++
      continue
    }

    // A hole: find where it must stop by looking at the next literal token.
    let next = tokens[t + 1]
    if (next?.kind === 'gap') next = tokens[t + 2]
    const stopAt = next?.kind === 'literal' ? next.text : null

    // Leading whitespace is not part of the capture.
    while (index < text.length && /\s/.test(text[index])) index++

    const captured = captureHole(text, index, stopAt)
    if (!captured) return null

    // The same hole appearing twice must capture the same text, which is how
    // `$x$ === $x$` finds self-comparisons.
    if (captures[token.name] !== undefined && captures[token.name] !== captured.value) return null
    captures[token.name] = captured.value
    index = captured.end
  }

  return { end: index, captures }
}

/**
 * Finds every match in a document.
 *
 * Scans by offset rather than per line so a pattern can span lines, then
 * converts offsets back to line/column for the result list.
 */
export function structuralSearch(source: string, pattern: string): StructuralMatch[] {
  const tokens = compilePattern(pattern)
  if (!tokens.length) return []

  // An anchor lets the scan skip most positions instead of trying every offset.
  const anchor = tokens[0].kind === 'literal' ? tokens[0].text : null
  const matches: StructuralMatch[] = []

  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1)
  }
  const toPosition = (offset: number) => {
    // Binary search the line containing this offset.
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (lineStarts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 }
  }

  let offset = 0
  while (offset < source.length) {
    if (anchor) {
      const found = source.indexOf(anchor, offset)
      if (found === -1) break
      offset = found
    }

    const result = matchAt(source, offset, tokens)
    if (result) {
      const start = toPosition(offset)
      const end = toPosition(result.end)
      matches.push({
        line: start.line,
        column: start.column,
        // A multi-line match is reported against its first line; the panel
        // shows the full text, so the column is only used for navigation.
        endColumn: end.line === start.line ? end.column : start.column + 1,
        text: source.slice(offset, result.end),
        captures: result.captures,
      })
      offset = result.end > offset ? result.end : offset + 1
    } else {
      offset++
    }
  }

  return matches
}

/** Substitutes captured holes into a replacement template. */
export function applyStructuralReplacement(
  replacement: string,
  captures: Record<string, string>,
): string {
  return replacement.replace(/\$([A-Za-z_]\w*)\$/g, (whole, name: string) =>
    captures[name] !== undefined ? captures[name] : whole,
  )
}

/**
 * Rewrites a whole document.
 *
 * Applies from the end backwards so earlier offsets stay valid as the text
 * changes length.
 */
export function structuralReplace(source: string, pattern: string, replacement: string): string {
  const matches = structuralSearch(source, pattern)
  let out = source
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]
    const start = offsetOf(source, match.line, match.column)
    out = out.slice(0, start) + applyStructuralReplacement(replacement, match.captures) + out.slice(start + match.text.length)
  }
  return out
}

function offsetOf(source: string, line: number, column: number): number {
  let offset = 0
  for (let i = 1; i < line; i++) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return offset
    offset = next + 1
  }
  return offset + column - 1
}
