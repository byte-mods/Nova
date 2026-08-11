import type { CodeSymbol } from '../../shared/types'
import { INDENT_SCOPED, rulesFor } from './declarations'

/**
 * Control-flow words that look like declarations to a permissive regex
 * (`if (x) {` parses as a call-shaped definition in C-family languages).
 */
const CONTROL_KEYWORDS = new Set([
  'if', 'else', 'elif', 'elsif', 'unless', 'for', 'foreach', 'while', 'until',
  'do', 'switch', 'case', 'default', 'when', 'try', 'catch', 'except',
  'finally', 'ensure', 'return', 'break', 'continue', 'goto', 'throw', 'raise',
  'yield', 'await', 'with', 'match', 'loop', 'in', 'is', 'as', 'not',
])

/** Extracts declarations from one file, tracking the enclosing container. */
export function parseSymbols(file: string, language: string, text: string): CodeSymbol[] {
  const rules = rulesFor(language)
  const indentScoped = INDENT_SCOPED.has(language)
  const lines = text.split('\n')
  const symbols: CodeSymbol[] = []

  // A container's `baseDepth` is the brace depth *before* its opening brace, so
  // its body sits strictly deeper and it closes as soon as depth returns to it.
  // `opened` defers that test until the brace actually appears, which is what
  // makes Allman style (`class Foo` then `{` on the next line) work.
  const stack: {
    name: string
    indent: number
    baseDepth: number
    opened: boolean
    line: number
  }[] = []
  let depth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const indent = line.length - line.trimStart().length
    if (indentScoped) {
      while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop()
    } else {
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.opened) {
          if (depth <= top.baseDepth) {
            stack.pop()
            continue
          }
        } else if (i - top.line > 1) {
          // The brace never arrived — a forward declaration, not a body.
          stack.pop()
          continue
        }
        break
      }
    }

    for (const rule of rules) {
      const match = rule.re.exec(line)
      if (!match) continue
      const name = match[rule.group ?? 1]
      if (!name) break
      if (CONTROL_KEYWORDS.has(name)) break
      if (rule.topLevelOnly && indent > 0) continue

      const container = stack.length ? stack[stack.length - 1].name : ''
      let kind = rule.kind
      if (rule.methodInContainer && container) kind = 'method'

      symbols.push({
        name,
        kind,
        file,
        line: i + 1,
        column: Math.max(1, line.indexOf(name) + 1),
        container,
        signature: line.trim().slice(0, 200),
        language,
        exported: isExported(line, name, language),
      })

      if (rule.opensContainer) {
        const net = countBraces(line)
        // `interface Order { id: string }` opens and closes on one line — it has
        // no body to nest into, so it must not become a container.
        const selfContained = !indentScoped && line.includes('{') && net <= 0
        if (!selfContained) {
          stack.push({ name, indent, baseDepth: depth, opened: net > 0, line: i })
        }
      }
      break // first matching rule wins
    }

    if (!indentScoped) {
      depth += countBraces(line)
      for (const entry of stack) {
        if (!entry.opened && depth > entry.baseDepth) entry.opened = true
      }
    }
  }

  return symbols
}

function countBraces(line: string) {
  let delta = 0
  for (const ch of line) {
    if (ch === '{') delta++
    else if (ch === '}') delta--
  }
  return delta
}

function isExported(line: string, name: string, language: string) {
  switch (language) {
    case 'go':
      // Go exports by capitalising the identifier.
      return /^[A-Z]/.test(name)
    case 'rust':
      return /\bpub\b/.test(line)
    case 'python':
      return !name.startsWith('_')
    case 'java':
    case 'csharp':
    case 'kotlin':
    case 'swift':
    case 'php':
      return /\b(?:public|open|internal)\b/.test(line)
    default:
      return /\bexport\b/.test(line)
  }
}
