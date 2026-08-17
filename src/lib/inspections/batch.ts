/**
 * Inspect Code — the whole project, not just open files.
 *
 * The per-editor path in `index.ts` runs rules against a Monaco model; this one
 * runs the same rules against plain text, which is what lets it sweep every
 * file in the tree without opening any of them. Pure by construction, so the
 * test suite drives it directly.
 */

import { RULES, RULES_BY_ID, type InspectionSeverity } from './rules'

export interface BatchFinding {
  file: string
  /** 1-based. */
  line: number
  column: number
  endColumn: number
  ruleId: string
  ruleName: string
  message: string
  severity: InspectionSeverity
  /** Present when the fix is a mechanical replacement Code Cleanup can apply. */
  fix?: { title: string; text: string }
  preview: string
}

export type InspectionProfile = Record<string, InspectionSeverity>

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot).toLowerCase()
}

/** Honours the same `nova-ignore` comments the live inspections do. */
function isSuppressed(lines: string[], index: number, ruleId: string): boolean {
  const check = (line: string | undefined): boolean => {
    if (!line) return false
    const match = /nova-ignore(?:\s+([\w-]+(?:\s*,\s*[\w-]+)*))?/.exec(line)
    if (!match) return false
    if (!match[1]) return true
    return match[1].split(/\s*,\s*/).includes(ruleId)
  }
  return check(lines[index]) || check(lines[index - 1])
}

/** Every enabled rule over one file's text. */
export function inspectText(file: string, text: string, profile: InspectionProfile = {}): BatchFinding[] {
  const extension = extensionOf(file)
  const lines = text.split('\n')
  const found: BatchFinding[] = []

  for (const rule of RULES) {
    const severity = profile[rule.id] ?? rule.defaultSeverity
    if (severity === 'off') continue
    if (rule.extensions.length && !rule.extensions.includes(extension)) continue

    for (let i = 0; i < lines.length; i++) {
      const matches = rule.run(lines[i], i + 1, { path: file, lines })
      if (!matches.length) continue
      if (isSuppressed(lines, i, rule.id)) continue
      for (const match of matches) {
        found.push({
          file,
          line: match.line,
          column: match.column,
          endColumn: match.endColumn,
          ruleId: rule.id,
          ruleName: rule.name,
          message: match.message,
          severity,
          fix: match.fix,
          preview: lines[i].trim().slice(0, 160),
        })
      }
    }
  }
  return found
}

/**
 * Code Cleanup: applies every mechanical fix to one file's text.
 *
 * Only `fix` replacements are applied — a delete-line fix removes a statement,
 * and doing that in bulk without eyes on each site is how cleanups eat code.
 * Fixes are applied last-first per line so columns stay valid.
 */
export function cleanupText(file: string, text: string, profile: InspectionProfile = {}): {
  text: string
  applied: number
} {
  const findings = inspectText(file, text, profile)
    .filter((finding) => finding.fix)
    .sort((a, b) => b.line - a.line || b.column - a.column)

  if (findings.length === 0) return { text, applied: 0 }
  const lines = text.split('\n')
  let applied = 0
  for (const finding of findings) {
    const line = lines[finding.line - 1]
    if (line === undefined) continue
    lines[finding.line - 1] =
      line.slice(0, finding.column - 1) + finding.fix!.text + line.slice(finding.endColumn - 1)
    applied++
  }
  return { text: lines.join('\n'), applied }
}

export { RULES_BY_ID }
