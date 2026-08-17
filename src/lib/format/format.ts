/**
 * The built-in formatter.
 *
 * There is no parser behind this, and that is a design decision rather than a
 * gap: a formatter that guesses at syntax rewrites code the user did not ask it
 * to touch, and the damage is invisible until review. So this one only does
 * things that are provably safe on masked text — where every string body and
 * comment has already been blanked out:
 *
 *   - indentation, computed from bracket depth
 *   - trailing whitespace, final newline, line endings
 *   - runs of blank lines
 *   - spacing around `,` and `;`
 *
 * It never wraps, never re-orders and never moves a brace. When a language
 * server is running, its formatter is better than this and gets to go first.
 */

import { maskingProfileFor } from '../refactor/profiles'
import { maskLiterals, indentOf, type Masked } from '../refactor/syntax'
import { indentUnit, type CodeStyle } from './style'

/** Languages whose blocks are defined by indentation — never re-indent those. */
const INDENT_SCOPED = new Set(['python', 'yaml', 'haskell', 'coffeescript', 'sass', 'pug', 'markdown'])

/** Languages where a line-leading `#` is a preprocessor directive at column 0. */
const PREPROCESSOR = new Set(['c', 'cpp', 'objective-c'])

export interface FormatOptions {
  style: CodeStyle
  language: string
}

export function formatText(text: string, options: FormatOptions): string {
  const { style, language } = options
  const profile = maskingProfileFor(language)
  const masked = maskLiterals(text, profile)

  const hadCrlf = text.includes('\r\n')
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const maskedLines = masked.mask.replace(/\r\n/g, '\n').split('\n')

  const canReindent =
    style.reindent && !INDENT_SCOPED.has(language) && !INDENT_SCOPED.has(language.replace(/react$/, ''))

  let out = canReindent
    ? reindentByDepth(lines, maskedLines, style, language)
    : lines.slice()

  if (style.normalizeSpacing) {
    out = out.map((line, index) => normalizeSpacing(line, maskedLines[index] ?? line))
  }
  if (style.trimTrailingWhitespace) {
    out = out.map((line) => line.replace(/[ \t]+$/, ''))
  }
  if (style.maxBlankLines > 0) {
    out = collapseBlankLines(out, style.maxBlankLines)
  }

  let result = out.join('\n')
  if (style.insertFinalNewline && result.length && !result.endsWith('\n')) result += '\n'
  if (!style.insertFinalNewline) result = result.replace(/\n+$/, '')

  const wantCrlf = style.endOfLine === 'crlf' || (style.endOfLine !== 'lf' && hadCrlf)
  return wantCrlf ? result.replace(/\n/g, '\r\n') : result
}

/**
 * Indentation from bracket depth.
 *
 * Parentheses and square brackets count as well as braces, so a wrapped
 * argument list indents one step rather than snapping back to the statement's
 * own level. A line that *starts* with a closer is dedented before it is
 * written, which is what puts `}` back under its opener.
 */
function reindentByDepth(
  lines: string[],
  maskedLines: string[],
  style: CodeStyle,
  language: string,
): string[] {
  const unit = indentUnit(style)
  const out: string[] = []
  let depth = 0
  /** True while inside a masked run that spans lines — a block comment or heredoc. */
  let continuation = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mask = maskedLines[i] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      out.push('')
      continue
    }

    // A line whose *mask* is entirely blank but whose text is not is the inside
    // of a multi-line string or comment: its whitespace is content.
    if (mask.trim() === '' && trimmed !== '') {
      out.push(line)
      continuation = true
      continue
    }
    continuation = false

    if (PREPROCESSOR.has(language) && trimmed.startsWith('#')) {
      out.push(trimmed)
      depth += net(mask)
      continue
    }

    const leadingClosers = countLeadingClosers(mask)
    const level = Math.max(0, depth - leadingClosers)
    // Labels and `case` sit one step out from the block they introduce.
    const isCase = /^(?:case\b|default\s*:)/.test(trimmed)
    const applied = isCase ? Math.max(0, level - 1) : level

    out.push(`${unit.repeat(applied)}${trimmed}`)
    depth = Math.max(0, depth + net(mask))
  }

  void continuation
  return out
}

/** Net bracket balance a masked line contributes. */
function net(mask: string): number {
  let depth = 0
  for (const ch of mask) {
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
  }
  return depth
}

/** How many closers the line opens with, before any other token. */
function countLeadingClosers(mask: string): number {
  let count = 0
  for (const ch of mask.trimStart()) {
    if (ch === '}' || ch === ')' || ch === ']') count++
    else break
  }
  return count
}

/**
 * One space after a comma, none before a comma or semicolon.
 *
 * Only applied where the mask agrees the character is real code, so a comma
 * inside `"a,b"` is untouched.
 */
export function normalizeSpacing(line: string, mask: string): string {
  const indent = indentOf(line)
  const chars = [...line]
  const out: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const isCode = mask[i] === ch
    if (isCode && (ch === ',' || ch === ';')) {
      // Drop the whitespace we just wrote before this separator.
      while (out.length > indent.length && /[ \t]/.test(out[out.length - 1])) out.pop()
      out.push(ch)
      // Insert exactly one space when something follows on the same line.
      let next = i + 1
      while (next < chars.length && /[ \t]/.test(chars[next])) next++
      if (next < chars.length) {
        out.push(' ')
        i = next - 1
      } else {
        i = chars.length
      }
      continue
    }
    out.push(ch)
  }
  return out.join('')
}

function collapseBlankLines(lines: string[], max: number): string[] {
  const out: string[] = []
  let run = 0
  for (const line of lines) {
    if (line.trim() === '') {
      run++
      if (run > max) continue
    } else {
      run = 0
    }
    out.push(line)
  }
  return out
}

/** True when formatting would change nothing, so the editor can stay untouched. */
export function isFormatted(text: string, options: FormatOptions): boolean {
  return formatText(text, options) === text
}

export type { Masked }
