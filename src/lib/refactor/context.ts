/**
 * The analysis every refactoring starts from: the file split into lines, its
 * literal mask, the enclosing function and class, and the selected text.
 */

import { profileFor, type LanguageProfile } from './profiles'
import {
  detectIndentUnit,
  enclosingClass,
  enclosingFunction,
  lineStartsOf,
  maskLiterals,
  offsetAt,
  positionAt,
  type Declaration,
  type Masked,
} from './syntax'
import { fail, type Position, type RefactorFailure, type RefactorSite } from './types'

export interface RefactorContext {
  site: RefactorSite
  profile: LanguageProfile
  text: string
  lines: string[]
  starts: number[]
  masked: Masked
  /** One indentation step, sniffed from the file itself. */
  indent: string
  /** Selection offsets, trimmed to non-whitespace. */
  start: number
  end: number
  selection: string
  fn: Declaration | null
  cls: Declaration | null
  lineOf(offset: number): number
  columnOf(offset: number): number
  positionOf(offset: number): Position
}

export function analyze(site: RefactorSite): RefactorContext | RefactorFailure {
  const profile = profileFor(site.language)
  if (!profile) {
    return fail(
      `Refactoring is not available for ${site.language || 'this file type'} — the engine has no syntax profile for it.`,
    )
  }

  const text = site.text
  const lines = text.split('\n')
  const starts = lineStartsOf(text)
  const masked = maskLiterals(text, profile)

  let start = offsetAt(text, site.range.start, starts)
  let end = offsetAt(text, site.range.end, starts)
  if (end < start) [start, end] = [end, start]
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--

  const caretLine = positionAt(text, start, starts).line
  const fn = enclosingFunction(lines, masked, starts, profile, caretLine)
  const cls = enclosingClass(lines, masked, starts, profile, caretLine)

  return {
    site,
    profile,
    text,
    lines,
    starts,
    masked,
    indent: detectIndentUnit(text, profile.indent),
    start,
    end,
    selection: text.slice(start, end),
    fn,
    cls,
    lineOf: (offset: number) => positionAt(text, offset, starts).line,
    columnOf: (offset: number) => positionAt(text, offset, starts).character,
    positionOf: (offset: number) => positionAt(text, offset, starts),
  }
}

export function isFailure(value: unknown): value is RefactorFailure {
  return typeof value === 'object' && value !== null && (value as RefactorFailure).ok === false
}

/**
 * Rejects a selection that cannot be a single expression: unbalanced brackets,
 * or a top-level statement separator inside it.
 */
export function validateExpression(ctx: RefactorContext): RefactorFailure | null {
  if (!ctx.selection.trim()) return fail('Select an expression first.')
  let depth = 0
  for (let i = ctx.start; i < ctx.end; i++) {
    const ch = ctx.masked.mask[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth < 0) return fail('The selection does not contain a balanced expression.')
    } else if (depth === 0 && ch === ';') {
      return fail('The selection spans more than one statement.')
    }
  }
  if (depth !== 0) return fail('The selection does not contain a balanced expression.')
  if (/^(if|for|while|return|def|class|func|fn)\b/.test(ctx.selection.trim())) {
    return fail('The selection is a statement, not an expression.')
  }
  return null
}

/** Wraps an expression in parentheses when substituting it could rebind operators. */
export function parenthesizeIfNeeded(expression: string): string {
  const trimmed = expression.trim()
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return trimmed
  if (/^[\w$.]+(\([^()]*\))?$/.test(trimmed)) return trimmed
  if (/^["'`]/.test(trimmed) && /["'`]$/.test(trimmed)) return trimmed
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  if (/^\(.*\)$/.test(trimmed)) return trimmed
  if (/[\s+\-*/%<>=!&|?:,]/.test(trimmed)) return `(${trimmed})`
  return trimmed
}
