/**
 * Auto-import on completion.
 *
 * When index completion offers a symbol declared in another file, this decides
 * whether picking it should also insert an import — and produces the edit.
 * Only languages whose import path is derivable from file paths alone qualify
 * (TypeScript/JavaScript relative specifiers, Python dotted modules); anywhere
 * else the completion inserts just the name, as before.
 */

import type { CodeSymbol } from '@shared/types'
import { dirname } from './paths'
import { languageForPath } from './language'
import { dottedModule, relativeSpecifier, stripExtension } from './refactor/move'

export interface AutoImportEdit {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  text: string
  /** Shown next to the completion label, e.g. `import from './orders'`. */
  description: string
}

const TS_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'])

/** Line to insert a new import at: after the last existing import, else the top. */
function importInsertionLine(lines: string[], pattern: RegExp): number {
  let last = -1
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (pattern.test(lines[i])) last = i
  }
  return last + 1
}

export function autoImportEdit(
  file: string,
  text: string,
  symbol: CodeSymbol,
  root: string,
): AutoImportEdit | null {
  if (symbol.file === file || !symbol.exported) return null
  const language = languageForPath(file)

  if (TS_LANGUAGES.has(language) && TS_LANGUAGES.has(symbol.language)) {
    const specifier = stripExtension(relativeSpecifier(dirname(file), symbol.file))
    // Already imported from that module (any specifier ending the same way)?
    const already = new RegExp(
      `import[^\\n]*\\b${escapeRegExp(symbol.name)}\\b[^\\n]*from|\\b${escapeRegExp(symbol.name)}\\b[^\\n]*=\\s*require`,
    )
    if (already.test(text)) return null
    const lines = text.split('\n')
    const line = importInsertionLine(lines, /^\s*import\b|^\s*(?:const|let|var)\s+.*=\s*require\s*\(/)
    return {
      range: { startLineNumber: line + 1, startColumn: 1, endLineNumber: line + 1, endColumn: 1 },
      text: `import { ${symbol.name} } from '${specifier}'\n`,
      description: `import from '${specifier}'`,
    }
  }

  if (language === 'python' && symbol.language === 'python' && root) {
    const module = dottedModule(root, symbol.file)
    if (!module) return null
    const already = new RegExp(`^\\s*from\\s+[\\w.]+\\s+import\\b[^\\n]*\\b${escapeRegExp(symbol.name)}\\b|^\\s*import\\s+${escapeRegExp(module)}\\b`, 'm')
    if (already.test(text)) return null
    const lines = text.split('\n')
    const line = importInsertionLine(lines, /^\s*(?:import|from)\b/)
    return {
      range: { startLineNumber: line + 1, startColumn: 1, endLineNumber: line + 1, endColumn: 1 },
      text: `from ${module} import ${symbol.name}\n`,
      description: `from ${module}`,
    }
  }

  return null
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
