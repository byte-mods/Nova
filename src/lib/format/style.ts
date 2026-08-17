/**
 * The code style scheme, and the EditorConfig rules that override it.
 *
 * Nova's formatter is deliberately conservative — it does not re-flow code, it
 * normalises it — so the scheme is small and every option maps onto something
 * the formatter can do without a parser. Anything that would need real syntax
 * knowledge (wrapping, alignment, brace placement) is left to a language
 * server's own formatter, which still wins when one is running.
 */

export interface CodeStyle {
  indentSize: number
  useTabs: boolean
  maxLineLength: number
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
  /** Collapse runs of blank lines longer than this. 0 leaves them alone. */
  maxBlankLines: number
  /** Re-indent by bracket depth. Ignored for indentation-scoped languages. */
  reindent: boolean
  /** One space after `,` and none before `,` `;`. */
  normalizeSpacing: boolean
  /** How Optimize Imports orders what it keeps. */
  importOrder: 'keep' | 'alphabetical'
  /** Drop imports whose bound names never appear in the file. */
  removeUnusedImports: boolean
  /** Blank line between the external and project import groups. */
  groupImports: boolean
  endOfLine: 'lf' | 'crlf'
}

export const defaultCodeStyle: CodeStyle = {
  indentSize: 2,
  useTabs: false,
  maxLineLength: 100,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  maxBlankLines: 2,
  reindent: true,
  normalizeSpacing: true,
  importOrder: 'alphabetical',
  removeUnusedImports: true,
  groupImports: true,
  endOfLine: 'lf',
}

/** The subset of EditorConfig properties that map onto the scheme. */
export interface EditorConfigProperties {
  indent_style?: string
  indent_size?: string
  tab_width?: string
  end_of_line?: string
  insert_final_newline?: string
  trim_trailing_whitespace?: string
  max_line_length?: string
}

/**
 * EditorConfig wins over the scheme, because a repo that ships `.editorconfig`
 * has already decided — and a file formatted against the user's personal
 * preference is a diff nobody asked for.
 */
export function applyEditorConfig(style: CodeStyle, properties: EditorConfigProperties | null): CodeStyle {
  if (!properties) return style
  const next = { ...style }
  const size = Number(properties.indent_size ?? properties.tab_width)
  if (properties.indent_style === 'tab') next.useTabs = true
  else if (properties.indent_style === 'space') next.useTabs = false
  if (Number.isFinite(size) && size > 0) next.indentSize = size
  if (properties.end_of_line === 'lf' || properties.end_of_line === 'crlf') {
    next.endOfLine = properties.end_of_line
  }
  if (properties.insert_final_newline !== undefined) {
    next.insertFinalNewline = properties.insert_final_newline === 'true'
  }
  if (properties.trim_trailing_whitespace !== undefined) {
    next.trimTrailingWhitespace = properties.trim_trailing_whitespace === 'true'
  }
  const maxLength = Number(properties.max_line_length)
  if (Number.isFinite(maxLength) && maxLength > 0) next.maxLineLength = maxLength
  return next
}

/** One indentation step, as text. */
export function indentUnit(style: CodeStyle): string {
  return style.useTabs ? '\t' : ' '.repeat(Math.max(1, style.indentSize))
}
