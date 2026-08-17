/**
 * Replace in Path: turns a set of search hits into a `WorkspaceEdit`.
 *
 * The search backend reports one hit per matching *line*, not per occurrence,
 * so the replacement is recomputed here against the real file contents. That
 * also means the result goes through the same preview and applier every
 * refactoring uses, rather than a separate write path.
 */

import type { SearchHit } from '@shared/types'
import type { TextEdit, WorkspaceEdit } from '@/lib/refactor/types'

export interface ReplaceOptions {
  query: string
  replacement: string
  caseSensitive: boolean
  regex: boolean
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches a glob-ish mask against a path: `*.ts`, `src/**`, `**\/*.test.*`. */
export function matchesMask(path: string, mask: string): boolean {
  const patterns = mask
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (patterns.length === 0) return true
  return patterns.some((pattern) => {
    const expression = pattern
      .split('**')
      .map((part) => part.split('*').map(escapeRegExp).join('[^/]*'))
      .join('.*')
    // A bare `*.ts` should match at any depth, so anchor on the end only.
    const anchored = pattern.includes('/') ? `^.*${expression}$` : `(^|/)${expression}$`
    try {
      return new RegExp(anchored).test(path)
    } catch {
      return true
    }
  })
}

export function applyMask(hits: SearchHit[], mask: string): SearchHit[] {
  if (!mask.trim()) return hits
  // `!pattern` entries exclude; the rest include. An all-exclude mask keeps
  // everything the exclusions do not reject.
  const parts = mask.split(',').map((part) => part.trim()).filter(Boolean)
  const includes = parts.filter((part) => !part.startsWith('!')).join(',')
  const excludes = parts.filter((part) => part.startsWith('!')).map((part) => part.slice(1)).join(',')
  return hits.filter(
    (hit) =>
      (!includes || matchesMask(hit.path, includes)) &&
      (!excludes || !matchesMask(hit.path, excludes)),
  )
}

/** Reads each affected file and computes every replacement in it. */
export async function buildReplaceEdit(
  hits: SearchHit[],
  options: ReplaceOptions,
): Promise<WorkspaceEdit> {
  const files = [...new Set(hits.map((hit) => hit.path))]
  const changes: Record<string, TextEdit[]> = {}

  let matcher: RegExp
  try {
    matcher = new RegExp(
      options.regex ? options.query : escapeRegExp(options.query),
      options.caseSensitive ? 'g' : 'gi',
    )
  } catch {
    return {}
  }

  for (const file of files) {
    let text: string
    try {
      const result = await window.nova.fs.read(file)
      if (result.binary) continue
      text = result.content
    } catch {
      continue
    }

    const edits: TextEdit[] = []
    const lines = text.split('\n')
    for (let line = 0; line < lines.length; line++) {
      matcher.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = matcher.exec(lines[line]))) {
        // `$1` and friends only mean anything when the pattern was a regex.
        const replacement = options.regex
          ? expand(options.replacement, match)
          : options.replacement
        edits.push({
          range: {
            start: { line, character: match.index },
            end: { line, character: match.index + match[0].length },
          },
          newText: replacement,
        })
        // A zero-length match would spin forever.
        if (match[0].length === 0) matcher.lastIndex++
      }
    }
    if (edits.length) changes[file] = edits
  }

  return Object.keys(changes).length ? { changes } : {}
}

/** Substitutes `$1`…`$9` and `$&` from a match, like String.replace does. */
function expand(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d|&|\$)/g, (_full, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return match[0]
    return match[Number(token)] ?? ''
  })
}
