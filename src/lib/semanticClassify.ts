/**
 * The logic behind semantic highlighting, with no Monaco in it.
 *
 * Two jobs live here: folding a language server's token stream onto Nova's
 * legend, and inventing tokens for languages that have no server. Both produce
 * the same LSP relative encoding, and both are pure, so the encoding maths —
 * which silently shifts every colour in the file when it is wrong — can be
 * tested without an editor.
 *
 * See `semanticTokens.ts` for why any of this is needed.
 */
import { SEMANTIC_TOKEN_TYPES, type SemanticTokensLegend } from '@shared/semantic'

export const TYPE_INDEX = new Map<string, number>(
  SEMANTIC_TOKEN_TYPES.map((name, index) => [name, index]),
)

/**
 * Token types servers invent beyond the standard set, folded onto the closest
 * type Nova paints. rust-analyzer and gopls both extend the legend heavily;
 * without this their extra types come back unstyled.
 */
const TYPE_ALIASES: Record<string, string> = {
  builtinType: 'type',
  typeAlias: 'type',
  union: 'type',
  selfTypeKeyword: 'type',
  generic: 'typeParameter',
  lifetime: 'typeParameter',
  constParameter: 'parameter',
  selfKeyword: 'keyword',
  label: 'keyword',
  // Most grammars already colour `true`/`false` as keywords; matching that is
  // less jarring than giving booleans a colour of their own.
  boolean: 'keyword',
  derive: 'decorator',
  deriveHelper: 'decorator',
  attribute: 'decorator',
  attributeBracket: 'decorator',
  builtinAttribute: 'decorator',
  escapeSequence: 'string',
  formatSpecifier: 'string',
  characterLiteral: 'string',
  constant: 'enumMember',
  toolModule: 'namespace',
}

/** One source line, plus the spans in it the grammar could not classify. */
export interface UnclassifiedLine {
  text: string
  ranges: { start: number; end: number }[]
}

/**
 * Rewrites a server's token stream into Nova's legend.
 *
 * The encoding is relative, so a token that maps to nothing cannot just be
 * skipped — its deltas belong to the token after it. Decoding to absolute
 * positions, dropping, then re-encoding is what keeps the rest aligned.
 */
export function remapServerTokens(data: number[], legend: SemanticTokensLegend): number[] {
  const lookup = legend.tokenTypes.map((name) => {
    const resolved = TYPE_ALIASES[name] ?? name
    return TYPE_INDEX.get(resolved) ?? -1
  })

  const out = new Encoder()
  let line = 0
  let char = 0

  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i]
    const deltaChar = data[i + 1]
    const length = data[i + 2]
    const type = lookup[data[i + 3]] ?? -1

    line += deltaLine
    char = deltaLine === 0 ? char + deltaChar : deltaChar

    if (type >= 0 && length > 0) out.push(line, char, length, type)
  }

  return out.data
}

/**
 * Invents tokens for the two cases every language agrees on: a name being
 * called, and a name being declared as a function or a type. Only spans the
 * grammar already gave up on are considered, so a keyword or a string is never
 * reinterpreted.
 */
export function classifyUnclassified(lines: UnclassifiedLine[]): number[] {
  const out = new Encoder()

  for (let index = 0; index < lines.length; index++) {
    const { text, ranges } = lines[index]
    for (const range of ranges) {
      const slice = text.slice(range.start, range.end)
      WORD.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = WORD.exec(slice))) {
        const word = match[0]
        const at = range.start + match.index
        const type = classifyWord(word, text, at, at + word.length)
        if (type !== null) out.push(index, at, word.length, type)
      }
    }
  }

  return out.data
}

/** Words that introduce a function, across the languages Nova opens. */
const FUNCTION_KEYWORDS = new Set([
  'function', 'func', 'fn', 'def', 'defp', 'defun', 'defn', 'fun', 'sub',
  'proc', 'procedure', 'method', 'macro', 'macro_rules', 'operator',
])

/** Words that introduce a type, and the words that reference one. */
const TYPE_KEYWORDS = new Set([
  'class', 'struct', 'interface', 'enum', 'trait', 'type', 'record', 'impl',
  'object', 'module', 'namespace', 'protocol', 'extends', 'implements', 'new',
  'instanceof', 'typedef', 'data', 'newtype', 'contract', 'library', 'actor',
  'annotation', 'union', 'exception', 'mixin',
])

/**
 * Control-flow words a thin grammar may hand back as identifiers. Without this
 * guard `if (x)` paints `if` as a function, which looks worse than the bug
 * being fixed.
 */
const NEVER_A_NAME = new Set([
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'catch',
  'match', 'when', 'with', 'return', 'yield', 'await', 'throw', 'try',
  'defer', 'go', 'in', 'is', 'as', 'not', 'and', 'or', 'sizeof', 'typeof',
  'assert', 'del', 'raise', 'pass', 'end', 'then', 'loop', 'unless', 'until',
  'foreach', 'select', 'using', 'lock', 'synchronized',
])

const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g

/** The legend index this word should be painted with, or null to leave it be. */
export function classifyWord(
  word: string,
  line: string,
  start: number,
  end: number,
): number | null {
  if (NEVER_A_NAME.has(word)) return null

  const previous = wordBefore(line, start)

  // Checked before the call test so `new Foo()` reads as a type, not a call.
  if (previous && TYPE_KEYWORDS.has(previous)) return TYPE_INDEX.get('class') ?? null
  if (previous && FUNCTION_KEYWORDS.has(previous)) return TYPE_INDEX.get('function') ?? null

  const member = previousNonSpace(line, start) === '.'

  if (nextNonSpace(line, end) === '(') {
    return TYPE_INDEX.get(member ? 'method' : 'function') ?? null
  }

  // A leftover Capitalised word is a type far more often than not, in every
  // language with a naming convention at all. A word needs a lowercase letter
  // to qualify, which keeps SCREAMING_CASE constants out of it.
  if (word.length > 1 && /^[A-Z]/.test(word) && /[a-z]/.test(word)) {
    // ...unless it sits after a dot, where it is a field being read rather
    // than a type being named. Go exports fields with a capital, so without
    // this `item.Price` would come out the colour of a struct.
    return TYPE_INDEX.get(member ? 'property' : 'class') ?? null
  }

  return null
}

/** Accumulates absolute positions and emits them in LSP's relative encoding. */
class Encoder {
  readonly data: number[] = []
  private line = 0
  private char = 0

  push(line: number, char: number, length: number, type: number) {
    this.data.push(
      line - this.line,
      line === this.line ? char - this.char : char,
      length,
      type,
      // Modifiers are deliberately dropped. Monaco matches a semantic token
      // against theme rules by joining type and modifiers with dots in legend
      // order, so `variable.declaration.readonly` would never match a
      // `variable.readonly` rule anyway. Emitting the bare type keeps every
      // theme rule a single predictable name.
      0,
    )
    this.line = line
    this.char = char
  }
}

/** The identifier immediately before `start`, with only spaces in between. */
function wordBefore(line: string, start: number): string | null {
  let i = start - 1
  while (i >= 0 && (line[i] === ' ' || line[i] === '\t')) i--
  if (i < 0) return null
  const end = i + 1
  while (i >= 0 && /[A-Za-z0-9_$]/.test(line[i])) i--
  const word = line.slice(i + 1, end)
  return word && /[A-Za-z_$]/.test(word[0]) ? word : null
}

function nextNonSpace(line: string, from: number): string | null {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== ' ' && line[i] !== '\t') return line[i]
  }
  return null
}

function previousNonSpace(line: string, before: number): string | null {
  for (let i = before - 1; i >= 0; i--) {
    if (line[i] !== ' ' && line[i] !== '\t') return line[i]
  }
  return null
}
