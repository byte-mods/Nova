/**
 * Parameter lists: reading them off a declaration, and reading argument lists
 * off call sites. Shared by Extract Parameter, Change Signature and Introduce
 * Parameter Object.
 */

import type { LanguageProfile } from './profiles'
import { matchForward, occurrences, splitTopLevel, type Masked } from './syntax'

export interface ParsedParam {
  /** Exactly as written, including type, default and any annotations. */
  raw: string
  name: string
  type: string
  initializer: string
  /** `*args`, `**kwargs`, `...rest`, `params object[]`. */
  variadic: boolean
  /**
   * The implicit receiver — `self`, `cls`, `&self`. It is written in the
   * declaration but never passed at a call site, so it must be excluded from
   * argument-index arithmetic or every reorder is off by one.
   */
  receiver: boolean
}

const RECEIVERS = new Set(['self', 'cls', '&self', '&mut self', 'mut self', 'this'])

export function isReceiverParam(raw: string): boolean {
  return RECEIVERS.has(raw.trim().replace(/\s+/g, ' '))
}

const VARIADIC = /^\s*(\*\*?|\.\.\.)/

/** Splits a parameter list and pulls a name out of each entry. */
export function parseParams(text: string, masked: Masked, start: number, end: number): ParsedParam[] {
  if (start < 0 || end < start) return []
  const inner = text.slice(start, end)
  if (!inner.trim()) return []
  return splitTopLevel(text, masked.mask, start, end)
    .filter((part) => part.text.trim())
    .map((part) => parseOneParam(part.text))
}

export function parseOneParam(raw: string): ParsedParam {
  const trimmed = raw.trim()
  const variadic = VARIADIC.test(trimmed)
  const body = trimmed.replace(VARIADIC, '')

  // Split off a default value at the first top-level `=` that is not `==`/`=>`.
  let initializer = ''
  let head = body
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '=') continue
    if (body[i + 1] === '=' || body[i + 1] === '>' || body[i - 1] === '=' || body[i - 1] === '!' ||
        body[i - 1] === '<' || body[i - 1] === '>' || body[i - 1] === ':') continue
    head = body.slice(0, i)
    initializer = body.slice(i + 1).trim()
    break
  }

  head = head.trim()
  let name = ''
  let type = ''

  // `name: Type` (TS, Python, Kotlin, Swift, Scala, Rust)
  const annotated = /^([A-Za-z_$][\w$]*)\s*\??\s*:\s*(.+)$/s.exec(head)
  if (annotated) {
    name = annotated[1]
    type = annotated[2].trim()
  } else {
    // `Type name` (Java, C, C++, C#, Go, Dart) — the last identifier is the name.
    const words = head.replace(/[*&]/g, ' $& ').trim().split(/\s+/).filter(Boolean)
    const last = words[words.length - 1] ?? ''
    const bare = /^\$?([A-Za-z_$][\w$]*)$/.exec(last)
    if (bare && words.length > 1) {
      name = bare[1]
      type = words.slice(0, -1).join(' ').replace(/\s+([*&])/g, '$1')
    } else if (bare) {
      name = bare[1]
    } else {
      name = head
    }
  }

  return { raw: trimmed, name, type, initializer, variadic, receiver: isReceiverParam(trimmed) }
}

export interface CallSite {
  file: string
  /** Offsets into that file's text. */
  openParen: number
  closeParen: number
  args: { text: string; start: number; end: number }[]
  /** 0-based line, for reporting. */
  line: number
}

/**
 * Every `name(` call in `text`, with its argument list split at top level.
 *
 * Declarations are skipped: a hit whose line also matches the declaration
 * header would otherwise be rewritten as if it were a call.
 */
export function findCallSites(
  file: string,
  text: string,
  masked: Masked,
  name: string,
  isDeclarationLine: (line: number) => boolean,
  lineOf: (offset: number) => number,
): { calls: CallSite[]; unparsed: number[] } {
  const calls: CallSite[] = []
  const unparsed: number[] = []
  for (const start of occurrences(masked, name)) {
    let cursor = start + name.length
    while (cursor < text.length && /\s/.test(masked.mask[cursor])) cursor++
    if (masked.mask[cursor] !== '(') continue
    const line = lineOf(start)
    if (isDeclarationLine(line)) continue
    // Second line of defence: `def name(`, `function name(` and friends are
    // declarations whatever the index thinks.
    if (/\b(?:def|fn|func|function|sub|proc|class|defp?)\s+$/.test(text.slice(Math.max(0, start - 12), start))) {
      continue
    }
    const close = matchForward(masked.mask, cursor)
    if (close === -1) {
      unparsed.push(line)
      continue
    }
    const args = splitTopLevel(text, masked.mask, cursor + 1, close).filter((a) => a.text.trim())
    calls.push({ file, openParen: cursor, closeParen: close, args, line })
  }
  return { calls, unparsed }
}

/** Renders a parameter for a language, from parts the dialog produced. */
export function renderParam(
  profile: LanguageProfile,
  param: { name: string; type?: string; initializer?: string },
): string {
  return profile.param(param.name, param.type || undefined, param.initializer || undefined)
}
