/**
 * Semantic highlighting for the editor.
 *
 * Monaco's Monarch grammars classify keywords, strings, numbers and comments,
 * and then give up: every remaining word is the single token `identifier`.
 * Function names, class names, parameters and locals all arrive as the same
 * token, so no theme — however many colours it defines — can tell them apart.
 * That is the whole reason function and class highlighting was missing.
 *
 * Two sources fill the gap, in order:
 *
 *  1. The language server, which has actually resolved the file and knows a
 *     name is a method rather than a field. Accurate, but only available for
 *     languages with a server installed.
 *  2. A syntactic fallback over Monaco's own tokenization, marking the two
 *     cases every language agrees on — a name being called, and a name being
 *     declared as a function or a type. Rough, but it means a Zig or Nim file
 *     with no server gets coloured instead of staying grey.
 *
 * Both feed one fixed legend, so a theme writes one rule per token type and it
 * applies to every language. The logic itself is in `semanticClassify.ts`;
 * this module is the Monaco wiring around it.
 */
import type * as monacoNs from 'monaco-editor'
import { monaco } from './monacoSetup'
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from '@shared/semantic'
import {
  classifyUnclassified,
  remapServerTokens,
  type UnclassifiedLine,
} from './semanticClassify'

const LEGEND: monacoNs.languages.SemanticTokensLegend = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
}

/**
 * Documents past this size are left to Monarch alone. The fallback walks every
 * token on every line, and on a generated file that cost is paid on each
 * keystroke for colouring nobody is reading.
 */
const MAX_FALLBACK_CHARS = 600_000

const changeEmitter = new monaco.Emitter<void>()

/**
 * Servers start lazily, so the first request for a file usually lands before
 * one is running and gets the fallback. Re-running once a server comes up is
 * what upgrades that file to real tokens without needing an edit.
 */
export function refreshSemanticTokens() {
  changeEmitter.fire()
}

/**
 * Turns semantic highlighting on for a diff editor.
 *
 * A diff editor's construction options do not accept the flag, so its two
 * inner editors are switched on after mount — otherwise the same file would be
 * coloured one way in the editor and another in a diff of it.
 */
export function enableSemanticHighlighting(editor: monacoNs.editor.IStandaloneDiffEditor) {
  for (const side of [editor.getOriginalEditor(), editor.getModifiedEditor()]) {
    side.updateOptions({ 'semanticHighlighting.enabled': true })
  }
}

export function registerSemanticTokens(language: string) {
  monaco.languages.registerDocumentSemanticTokensProvider(language, {
    onDidChange: changeEmitter.event,
    getLegend: () => LEGEND,
    releaseDocumentSemanticTokens: () => {},

    async provideDocumentSemanticTokens(model) {
      if (model.isDisposed()) return null

      const fromServer = await fromLanguageServer(model)
      if (fromServer) return { data: fromServer }
      if (model.isDisposed()) return null

      const fallback = classifyUnclassified(unclassifiedLines(model))
      return fallback.length ? { data: Uint32Array.from(fallback) } : null
    },
  })
}

async function fromLanguageServer(model: monacoNs.editor.ITextModel): Promise<Uint32Array | null> {
  const file = model.uri.fsPath || model.uri.path
  const result = await window.nova.lsp
    .semanticTokens(file, model.getLanguageId())
    .catch(() => null)
  if (!result?.data?.length) return null

  const remapped = remapServerTokens(result.data, result.legend)
  return remapped.length ? Uint32Array.from(remapped) : null
}

/**
 * Runs the grammar over the document and reports the spans it did not
 * classify — the ones the fallback is allowed to reinterpret. Anything the
 * grammar did understand, including every keyword and string, is left alone.
 */
function unclassifiedLines(model: monacoNs.editor.ITextModel): UnclassifiedLine[] {
  const text = model.getValue()
  if (text.length > MAX_FALLBACK_CHARS) return []

  let tokenized: monacoNs.Token[][]
  try {
    tokenized = monaco.editor.tokenize(text, model.getLanguageId())
  } catch {
    return []
  }

  const lineCount = model.getLineCount()
  const lines: UnclassifiedLine[] = []

  for (let index = 0; index < tokenized.length && index < lineCount; index++) {
    const lineText = model.getLineContent(index + 1)
    const tokens = tokenized[index]
    const ranges: { start: number; end: number }[] = []

    for (let t = 0; t < tokens.length; t++) {
      if (!isUnclassified(tokens[t].type)) continue
      ranges.push({
        start: tokens[t].offset,
        end: t + 1 < tokens.length ? tokens[t + 1].offset : lineText.length,
      })
    }

    lines.push({ text: lineText, ranges })
  }

  return lines
}

/**
 * Monarch appends the language to its token types (`identifier.python`), and
 * uses an empty type or `source` for text no rule matched.
 */
function isUnclassified(type: string) {
  const head = type.split('.')[0]
  return head === '' || head === 'identifier' || head === 'source' || head === 'white'
}
