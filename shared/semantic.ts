/**
 * Semantic highlighting.
 *
 * Monaco's Monarch grammars are regular expressions over a single line: they
 * know keywords, strings and numbers, but every other word comes back as the
 * undifferentiated token `identifier`. That is why a function name and the
 * variable next to it look identical no matter which theme is picked — the
 * grammar never told the theme they were different things.
 *
 * The fix is semantic tokens, which come from something that has actually
 * resolved the code: the language server. This module is the wire format
 * shared between the server session (main process) and the Monaco provider
 * that paints with it.
 */

/**
 * The token types Nova asks servers for, in the order Monaco's legend uses.
 * This is the standard set from LSP 3.17 — servers reply with their own
 * legend, which the renderer remaps onto this one so a single Monaco legend
 * (and therefore a single set of theme rules) covers every language.
 */
export const SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
] as const

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number]

/** The standard LSP 3.17 modifier set, likewise fixed on Nova's side. */
export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
] as const

export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number]

/** A server's own legend, which is whatever order that server chose. */
export interface SemanticTokensLegend {
  tokenTypes: string[]
  tokenModifiers: string[]
}

/**
 * A full-document response. `data` is the LSP relative encoding: groups of
 * five integers — deltaLine, deltaStartChar, length, typeIndex, modifierBits —
 * with the indices pointing into `legend`, not into the constants above.
 */
export interface SemanticTokensResult {
  legend: SemanticTokensLegend
  data: number[]
  resultId?: string
}
