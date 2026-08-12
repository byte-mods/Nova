/**
 * Name suggestion and the deliberately shallow type guess.
 *
 * `inferType` only reads what is written in the expression itself — a literal,
 * a constructor call, a cast. It never chases a variable back to its
 * declaration, because a wrong type is worse than no type: in the languages
 * that need one the dialog shows the guess in an editable field, so the user
 * corrects it before anything is written.
 */

import type { LanguageProfile } from './profiles'

const STOP_WORDS = new Set(['get', 'fetch', 'load', 'read', 'make', 'create', 'build', 'new', 'to', 'from', 'of', 'the'])

/** `service.createOrder(42)` → `order`; `user.name` → `name`; `2 + 2` → `value`. */
export function suggestName(expression: string, style: 'camel' | 'snake' | 'screaming'): string {
  const trimmed = expression.trim()

  const stringLiteral = /^["'`](.*)["'`]$/s.exec(trimmed)
  if (stringLiteral) {
    const words = stringLiteral[1].split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 3)
    if (words.length) return applyStyle(words, style)
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return applyStyle(['value'], style)

  // The last call or property in the chain carries the meaning.
  const call = /([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*$/.exec(trimmed)
  const property = /\.([A-Za-z_$][\w$]*)\s*$/.exec(trimmed)
  const bare = /^([A-Za-z_$][\w$]*)$/.exec(trimmed)
  const source = call?.[1] ?? property?.[1] ?? bare?.[1]

  if (source) {
    let words = splitWords(source)
    if (words.length > 1 && STOP_WORDS.has(words[0].toLowerCase())) words = words.slice(1)
    if (words.length) return applyStyle(words, style)
  }

  const constructor = /\bnew\s+([A-Za-z_$][\w$]*)/.exec(trimmed)
  if (constructor) return applyStyle(splitWords(constructor[1]), style)

  return applyStyle(['value'], style)
}

function splitWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function applyStyle(words: string[], style: 'camel' | 'snake' | 'screaming'): string {
  const lower = words.map((w) => w.toLowerCase())
  if (style === 'snake') return lower.join('_')
  if (style === 'screaming') return lower.join('_').toUpperCase()
  return lower[0] + lower.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

export function namingStyle(profile: LanguageProfile): 'camel' | 'snake' {
  return profile.id === 'python' || profile.id === 'ruby' || profile.id === 'rust' ? 'snake' : 'camel'
}

export function constantStyle(profile: LanguageProfile): 'screaming' | 'camel' {
  return profile.id === 'typescript' || profile.id === 'javascript' ? 'screaming' : 'screaming'
}

/** Appends `2`, `3`… until the name is not already taken in the text. */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`
    if (!taken(candidate)) return candidate
  }
  return `${base}_`
}

const NUMERIC: Record<string, string> = {
  typescript: 'number', javascript: '', python: 'int', go: 'int', java: 'int', kotlin: 'Int',
  csharp: 'int', rust: 'i64', c: 'int', cpp: 'int', swift: 'Int', ruby: '', php: 'int',
  dart: 'int', scala: 'Int',
}
const FLOATING: Record<string, string> = {
  typescript: 'number', javascript: '', python: 'float', go: 'float64', java: 'double',
  kotlin: 'Double', csharp: 'double', rust: 'f64', c: 'double', cpp: 'double', swift: 'Double',
  ruby: '', php: 'float', dart: 'double', scala: 'Double',
}
const STRING: Record<string, string> = {
  typescript: 'string', javascript: '', python: 'str', go: 'string', java: 'String',
  kotlin: 'String', csharp: 'string', rust: 'String', c: 'const char *', cpp: 'std::string',
  swift: 'String', ruby: '', php: 'string', dart: 'String', scala: 'String',
}
const BOOLEAN: Record<string, string> = {
  typescript: 'boolean', javascript: '', python: 'bool', go: 'bool', java: 'boolean',
  kotlin: 'Boolean', csharp: 'bool', rust: 'bool', c: 'int', cpp: 'bool', swift: 'Bool',
  ruby: '', php: 'bool', dart: 'bool', scala: 'Boolean',
}

/** Best-effort type for languages that demand one. Empty string means "unknown". */
export function inferType(expression: string, profile: LanguageProfile): string {
  const trimmed = expression.trim()
  const id = profile.id.replace(/react$/, '')

  if (/^-?\d+$/.test(trimmed)) return NUMERIC[id] ?? ''
  if (/^-?\d*\.\d+$/.test(trimmed)) return FLOATING[id] ?? ''
  if (/^["'`]/.test(trimmed)) return STRING[id] ?? ''
  if (/^(true|false|True|False)$/.test(trimmed)) return BOOLEAN[id] ?? ''
  if (/^\[/.test(trimmed) || /^(list|vec!)\s*[([]/.test(trimmed)) {
    return id === 'typescript' ? 'unknown[]' : id === 'python' ? 'list' : ''
  }
  if (/^\{/.test(trimmed)) return id === 'python' ? 'dict' : ''

  const constructed = /^new\s+([A-Za-z_$][\w$.<>]*)/.exec(trimmed)
  if (constructed) return constructed[1].replace(/<.*$/, id === 'java' || id === 'csharp' ? '<>' : '')

  // `Foo(...)` in Python/Rust/Swift/Kotlin is a constructor call.
  const called = /^([A-Z][\w$]*)\s*[({]/.exec(trimmed)
  if (called) return called[1]

  const cast = /^\(([A-Za-z_][\w$ *]*)\)\s*\S/.exec(trimmed)
  if (cast && (id === 'c' || id === 'cpp' || id === 'csharp' || id === 'java')) return cast[1].trim()

  return ''
}
