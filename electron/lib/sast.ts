/**
 * Running the security rules over a file.
 *
 * Two things here matter more than the rules themselves. Comments are skipped,
 * because a rule firing on a line explaining the vulnerability it describes is
 * the fastest way to make a scanner look stupid. And a suppression comment is
 * honoured, because a scanner with no escape hatch gets disabled entirely the
 * first time it is wrong about something that matters.
 */
import path from 'node:path'
import type { SecurityFinding } from '../../shared/security'
import { NEARBY_LINES, SAST_RULES, type SastRule } from './sastRules'

/** `// nova-ignore` or the conventional `nosec` / `nosemgrep`. */
const SUPPRESSED = /\b(?:nova-ignore|nosec|nosemgrep|noqa\s*:\s*S\d+|eslint-disable[^\n]*security)\b/

/** A line that is only a comment. Deliberately conservative. */
const COMMENT_ONLY = /^\s*(?:\/\/|#(?!!)|\*|\/\*|<!--|--\s)/

/** Files that are not the project's own code. */
const NOT_SOURCE =
  /(?:^|[/\\])(?:node_modules|vendor|dist|build|out|coverage|\.git|__pycache__|\.venv|venv|target)[/\\]|\.min\.(?:js|css)$|\.(?:map|lock)$/

export function isScannable(relativePath: string): boolean {
  return !NOT_SOURCE.test(relativePath)
}

export function scanForVulnerabilities(
  relativePath: string,
  text: string,
  rules: SastRule[] = SAST_RULES,
): Omit<SecurityFinding, 'id' | 'file' | 'source'>[] {
  const extension = path.extname(relativePath).toLowerCase()
  const applicable = rules.filter(
    (rule) => rule.extensions.length === 0 || rule.extensions.includes(extension),
  )
  if (!applicable.length) return []

  const findings: Omit<SecurityFinding, 'id' | 'file' | 'source'>[] = []
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.length > 2000) continue
    if (COMMENT_ONLY.test(line)) continue
    if (SUPPRESSED.test(line)) continue
    // A suppression on the line above covers the line below, which is where
    // people put it when the offending line is long.
    if (index > 0 && SUPPRESSED.test(lines[index - 1])) continue

    for (const rule of applicable) {
      rule.pattern.lastIndex = 0
      const match = rule.pattern.exec(line)
      if (!match) continue
      if (rule.unless?.test(line)) continue
      if (rule.nearby && !rule.nearby.test(window(lines, index))) continue

      findings.push({
        severity: rule.severity,
        confidence: rule.confidence,
        rule: rule.id,
        title: rule.title,
        detail: rule.detail.replace('$1', match[1] ?? ''),
        remediation: rule.remediation,
        relative: relativePath,
        line: index + 1,
        column: match.index + 1,
        endColumn: match.index + match[0].length + 1,
        excerpt: line.trim().slice(0, 200),
        cwe: rule.cwe,
      })
    }
  }

  return findings
}

/**
 * The line and its neighbours, for rules whose evidence is not on one line.
 *
 * camelCase is split apart first. What tells you `Math.random()` is producing
 * a secret is usually a name like `sessionToken`, and a word-boundary match
 * for `token` does not see it — there is no boundary between `session` and
 * `Token`.
 */
function window(lines: string[], index: number): string {
  return lines
    .slice(Math.max(0, index - NEARBY_LINES), index + NEARBY_LINES + 1)
    .join('\n')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}
