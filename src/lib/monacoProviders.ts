import type * as monacoNs from 'monaco-editor'
import type { CodeSymbol, SymbolKind } from '@shared/types'
import { monaco } from './monacoSetup'
import { useStore } from '@/state/store'
import { languageForPath } from './language'
import { basename, relative } from './paths'
import {
  toCompletionItems,
  toDocumentSymbols,
  toHover,
  toLocations,
  toLspPosition,
  toLspRange,
  toMarkdown,
  toMarkers,
  toMonacoRange,
  toSignatureHelp,
  uriToPath as lspUriToPath,
} from './lspConvert'
import { applyWorkspaceEdit, type WorkspaceEdit } from './workspaceEdit'
import { requestApproval } from './editPreview'

/** Languages that get code-intelligence providers registered. */
const PROVIDER_LANGUAGES = [
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'scala',
  'groovy', 'swift', 'objective-c', 'c', 'cpp', 'csharp', 'ruby', 'php', 'dart',
  'elixir', 'lua', 'r', 'julia', 'perl', 'shell', 'powershell', 'sql', 'graphql',
  'proto', 'hcl', 'css', 'scss', 'less', 'html', 'sol', 'vb', 'fsharp', 'pascal',
  'yaml', 'json', 'haskell', 'plaintext',
]

/**
 * Monaco ships its own TypeScript worker with real type information, so LSP is
 * used there only for the things that worker cannot do across files.
 */
const MONACO_NATIVE = new Set(['typescript', 'javascript'])

const SYMBOL_KIND_MAP: Record<SymbolKind, number> = {
  class: 4, interface: 10, struct: 22, trait: 10, enum: 9, type: 5,
  function: 11, method: 5, module: 1, macro: 11, constant: 13, variable: 12,
  property: 6, field: 7, selector: 6,
}

export function uriForPath(filePath: string) {
  return monaco.Uri.file(filePath)
}

export function pathForUri(uri: monacoNs.Uri) {
  return uri.fsPath || uri.path
}

function symbolToLocation(symbol: CodeSymbol): monacoNs.languages.Location {
  return {
    uri: uriForPath(symbol.file),
    range: {
      startLineNumber: symbol.line,
      startColumn: symbol.column,
      endLineNumber: symbol.line,
      endColumn: symbol.column + symbol.name.length,
    },
  }
}

/** The identifier under the cursor, allowing `$` and language-specific suffixes. */
export function wordAt(model: monacoNs.editor.ITextModel, position: monacoNs.IPosition) {
  const word = model.getWordAtPosition(position)
  if (!word) return null
  const line = model.getLineContent(position.lineNumber)
  let start = word.startColumn - 1
  let end = word.endColumn - 1
  if (start > 0 && line[start - 1] === '$') start--
  if (end < line.length && (line[end] === '?' || line[end] === '!')) {
    if (model.getLanguageId() === 'ruby') end++
  }
  return { word: line.slice(start, end), startColumn: start + 1, endColumn: end + 1 }
}

/** True when a language server is ready for this language. */
async function hasServer(language: string) {
  const caps = await window.nova.lsp.capabilities(language).catch(() => null)
  return Boolean(caps)
}

let registered = false

export function registerCodeIntelligence() {
  if (registered) return
  registered = true

  for (const language of PROVIDER_LANGUAGES) {
    registerNavigation(language)
    if (!MONACO_NATIVE.has(language)) registerEditing(language)
    registerRefactoring(language)
    registerIndexCompletion(language)
  }

  wireDiagnostics()

  // Cmd+click and "Go to Definition" land on files that may not be open yet;
  // this is the standalone editor's hook for opening them ourselves.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const filePath = pathForUri(resource)
      const line =
        selectionOrPosition && 'startLineNumber' in selectionOrPosition
          ? selectionOrPosition.startLineNumber
          : (selectionOrPosition as monacoNs.IPosition | undefined)?.lineNumber
      const column =
        selectionOrPosition && 'startColumn' in selectionOrPosition
          ? selectionOrPosition.startColumn
          : (selectionOrPosition as monacoNs.IPosition | undefined)?.column
      void useStore.getState().openFile(filePath, { line: line ?? 1, column })
      return true
    },
  })
}

/* ---------------- navigation: LSP first, symbol index as fallback ---------------- */

function registerNavigation(language: string) {
  monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position) {
      const file = pathForUri(model.uri)
      const fromLsp = toLocations(
        await window.nova.lsp
          .definition(file, language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
      if (fromLsp.length) return fromLsp

      const hit = wordAt(model, position)
      if (!hit?.word) return null
      const symbols = await window.nova.code.definitions(hit.word, file)
      if (symbols.length === 0) return null
      const filtered = symbols.filter((s) => !(s.file === file && s.line === position.lineNumber))
      return (filtered.length ? filtered : symbols).slice(0, 20).map(symbolToLocation)
    },
  })

  monaco.languages.registerImplementationProvider(language, {
    async provideImplementation(model, position) {
      return toLocations(
        await window.nova.lsp
          .implementation(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
    },
  })

  monaco.languages.registerTypeDefinitionProvider(language, {
    async provideTypeDefinition(model, position) {
      return toLocations(
        await window.nova.lsp
          .typeDefinition(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
    },
  })

  monaco.languages.registerReferenceProvider(language, {
    async provideReferences(model, position) {
      const file = pathForUri(model.uri)
      const fromLsp = toLocations(
        await window.nova.lsp
          .references(file, language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
      if (fromLsp.length) return fromLsp

      const hit = wordAt(model, position)
      if (!hit?.word) return []
      const refs = await window.nova.code.references(hit.word, file)
      return refs
        .filter((ref) => ref.kind !== 'comment' && ref.kind !== 'string')
        .slice(0, 1000)
        .map((ref) => ({
          uri: uriForPath(ref.file),
          range: {
            startLineNumber: ref.line,
            startColumn: ref.column,
            endLineNumber: ref.line,
            endColumn: ref.column + hit.word.length,
          },
        }))
    },
  })

  monaco.languages.registerDocumentSymbolProvider(language, {
    async provideDocumentSymbols(model) {
      const file = pathForUri(model.uri)
      const fromLsp = toDocumentSymbols(
        await window.nova.lsp.documentSymbols(file, language).catch(() => null),
      )
      if (fromLsp.length) return fromLsp

      const symbols = await window.nova.code.documentSymbols(file)
      return symbols.map((symbol) => ({
        name: symbol.name,
        detail: symbol.container ? `${symbol.container} · ${symbol.kind}` : symbol.kind,
        kind: SYMBOL_KIND_MAP[symbol.kind] ?? 12,
        tags: [],
        range: {
          startLineNumber: symbol.line,
          startColumn: 1,
          endLineNumber: symbol.line,
          endColumn: Math.max(1, symbol.signature.length + 1),
        },
        selectionRange: {
          startLineNumber: symbol.line,
          startColumn: symbol.column,
          endLineNumber: symbol.line,
          endColumn: symbol.column + symbol.name.length,
        },
      })) as monacoNs.languages.DocumentSymbol[]
    },
  })
}

/* ---------------- editing features (LSP only) ---------------- */

function registerEditing(language: string) {
  monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      return toHover(
        await window.nova.lsp
          .hover(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
    },
  })

  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', ':', '>', '"', "'", '/', '@', '<', '(', ' ', '-'],
    async provideCompletionItems(model, position, context) {
      const word = model.getWordUntilPosition(position)
      const defaultRange: monacoNs.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      }
      const result = await window.nova.lsp
        .completion(
          pathForUri(model.uri),
          language,
          position.lineNumber - 1,
          position.column - 1,
          context.triggerCharacter,
        )
        .catch(() => null)
      const { items, incomplete } = toCompletionItems(result, defaultRange)
      return { suggestions: items, incomplete }
    },
    async resolveCompletionItem(item) {
      const original = (item as { __lsp?: unknown }).__lsp
      if (!original) return item
      const resolved = await window.nova.lsp
        .resolveCompletion(language, original)
        .catch(() => null)
      if (!resolved) return item
      return {
        ...item,
        detail: resolved.detail ?? item.detail,
        documentation: resolved.documentation
          ? { value: typeof resolved.documentation === 'string' ? resolved.documentation : resolved.documentation.value ?? '' }
          : item.documentation,
        additionalTextEdits: resolved.additionalTextEdits?.map((edit: any) => ({
          range: toMonacoRange(edit.range),
          text: edit.newText,
        })) ?? item.additionalTextEdits,
      }
    },
  })

  monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ['(', ','],
    async provideSignatureHelp(model, position) {
      const help = toSignatureHelp(
        await window.nova.lsp
          .signatureHelp(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1)
          .catch(() => null),
      )
      return help ? { value: help, dispose: () => {} } : null
    },
  })

  monaco.languages.registerInlayHintsProvider(language, {
    async provideInlayHints(model, range) {
      const raw = await window.nova.lsp
        .inlayHints(pathForUri(model.uri), language, toLspRange(range))
        .catch(() => null)
      if (!Array.isArray(raw)) return { hints: [], dispose: () => {} }
      const hints = raw.map((hint: any) => ({
        position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
        label: typeof hint.label === 'string'
          ? hint.label
          : (hint.label ?? []).map((part: any) => part.value ?? '').join(''),
        kind: hint.kind === 2 ? 2 : 1, // Parameter | Type
        paddingLeft: hint.paddingLeft,
        paddingRight: hint.paddingRight,
        tooltip: toMarkdown(hint.tooltip),
      })) as monacoNs.languages.InlayHint[]
      return { hints, dispose: () => {} }
    },
  })

  monaco.languages.registerDocumentFormattingEditProvider(language, {
    async provideDocumentFormattingEdits(model, options) {
      const edits = await window.nova.lsp
        .formatting(pathForUri(model.uri), language, options.tabSize, options.insertSpaces)
        .catch(() => null)
      if (!Array.isArray(edits)) return []
      return edits.map((edit: any) => ({
        range: toMonacoRange(edit.range),
        text: edit.newText,
      }))
    },
  })
}

/* ---------------- project-wide completion from the symbol index ---------------- */

/** Symbol kind -> Monaco CompletionItemKind. */
const COMPLETION_KIND: Record<SymbolKind, number> = {
  class: 6,
  interface: 8,
  struct: 7,
  trait: 8,
  enum: 16,
  type: 25,
  function: 2,
  method: 1,
  module: 9,
  macro: 2,
  constant: 15,
  variable: 5,
  property: 10,
  field: 4,
  selector: 21,
}

/**
 * Suggests classes, functions, constants and other declarations from anywhere
 * in the project. This is the completion path for languages with no language
 * server installed — without it those files would have no suggestions at all.
 * When a server *is* running it owns completion, so this stays out of the way.
 */
function registerIndexCompletion(language: string) {
  monaco.languages.registerCompletionItemProvider(language, {
    async provideCompletionItems(model, position) {
      if (await hasServer(language)) return { suggestions: [] }

      const word = model.getWordUntilPosition(position)
      const prefix = word.word
      // An empty prefix would dump the whole index into the popup.
      if (prefix.length < 1) return { suggestions: [] }

      const file = pathForUri(model.uri)
      const symbols = await window.nova.code.completions(prefix, file, 60).catch(() => [])
      if (symbols.length === 0) return { suggestions: [] }

      const range: monacoNs.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      }

      return {
        suggestions: symbols.map((symbol, index) => ({
          label: symbol.name,
          kind: (COMPLETION_KIND[symbol.kind] ?? 5) as monacoNs.languages.CompletionItemKind,
          insertText: symbol.name,
          range,
          detail: symbol.container
            ? `${symbol.kind} in ${symbol.container}`
            : `${symbol.kind} · ${basename(symbol.file)}`,
          documentation: {
            value: ['```' + symbol.language, symbol.signature, '```', '', `_${relative(useStore.getState().root ?? '', symbol.file)}:${symbol.line}_`].join('\n'),
          },
          // Sort after anything the editor itself contributes.
          sortText: `zz${String(index).padStart(3, '0')}`,
        })),
      }
    },
  })
}

/* ---------------- rename + quick fixes ---------------- */

function registerRefactoring(language: string) {
  monaco.languages.registerRenameProvider(language, {
    async resolveRenameLocation(model, position) {
      const result = await window.nova.lsp
        .prepareRename(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1)
        .catch(() => null)
      if (result?.range) {
        return { range: toMonacoRange(result.range), text: result.placeholder ?? '' }
      }
      const hit = wordAt(model, position)
      if (!hit?.word) {
        return { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'Nothing to rename here' }
      }
      return {
        range: new monaco.Range(position.lineNumber, hit.startColumn, position.lineNumber, hit.endColumn),
        text: hit.word,
      }
    },
    async provideRenameEdits(model, position, newName) {
      const edit = (await window.nova.lsp
        .rename(pathForUri(model.uri), language, position.lineNumber - 1, position.column - 1, newName)
        .catch(() => null)) as WorkspaceEdit | null

      if (!edit || (!edit.changes && !edit.documentChanges)) {
        return {
          edits: [],
          rejectReason: (await hasServer(language))
            ? 'The language server returned no edits.'
            : 'Rename needs a language server for this language — see Settings › Language servers.',
        }
      }

      // Monaco's bulk edit cannot reach files it has no model for, so apply the
      // whole WorkspaceEdit ourselves — after showing what will change.
      const approved = await requestApproval(`Rename to “${newName}”`, edit)
      if (!approved) return { edits: [], rejectReason: 'Rename cancelled' }
      const applied = await applyWorkspaceEdit(edit)
      const files = applied.filter((a) => a.edits > 0).length
      const total = applied.reduce((sum, a) => sum + a.edits, 0)
      useStore
        .getState()
        .notify(
          `Renamed to “${newName}” — ${total} edit${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`,
          'success',
        )
      void useStore.getState().buildIndex()
      return { edits: [] }
    },
  })

  monaco.languages.registerCodeActionProvider(language, {
    async provideCodeActions(model, range, context) {
      const raw = await window.nova.lsp
        .codeActions(
          pathForUri(model.uri),
          language,
          toLspRange(range),
          context.markers.map((marker) => ({
            range: toLspRange(marker),
            severity: marker.severity === 8 ? 1 : marker.severity === 4 ? 2 : 3,
            message: marker.message,
            code: marker.code,
            source: marker.source,
          })),
        )
        .catch(() => null)
      if (!Array.isArray(raw) || raw.length === 0) return { actions: [], dispose: () => {} }

      const actions = raw
        .filter((action: any) => action && (action.title || action.command))
        .map((action: any) => ({
          title: action.title ?? action.command?.title ?? 'Code action',
          kind: action.kind ?? 'quickfix',
          isPreferred: action.isPreferred,
          diagnostics: [],
          // Monaco cannot apply cross-file edits, so run it through our applier.
          command: {
            id: NOVA_APPLY_ACTION,
            title: action.title ?? 'Apply',
            arguments: [language, action],
          },
        })) as monacoNs.languages.CodeAction[]

      return { actions, dispose: () => {} }
    },
  })
}

const NOVA_APPLY_ACTION = 'nova.applyCodeAction'

monaco.editor.registerCommand(NOVA_APPLY_ACTION, async (_accessor, language: string, action: any) => {
  let resolved = action
  if (!action.edit && action.data !== undefined) {
    resolved = (await window.nova.lsp.resolveCodeAction(language, action).catch(() => null)) ?? action
  }
  if (resolved?.edit) {
    const files = Object.keys(resolved.edit.changes ?? {}).length +
      (resolved.edit.documentChanges ?? []).length
    // Single-file quick fixes apply straight away; anything wider is confirmed.
    if (files > 1) {
      const approved = await requestApproval(resolved.title ?? 'Apply code action', resolved.edit)
      if (!approved) return
    }
    const applied = await applyWorkspaceEdit(resolved.edit)
    const total = applied.reduce((sum, a) => sum + a.edits, 0)
    useStore.getState().notify(`${resolved.title} — ${total} edit${total === 1 ? '' : 's'}`, 'success')
    void useStore.getState().buildIndex()
  } else if (resolved?.command) {
    // The server does the work and pushes the result back as a
    // `workspace/applyEdit`, which the LSP layer already applies.
    const command = typeof resolved.command === 'string' ? resolved.command : resolved.command.command
    const args = (typeof resolved.command === 'string' ? resolved.arguments : resolved.command.arguments) ?? []
    try {
      await window.nova.lsp.executeCommand(language, command, args)
      useStore.getState().notify(resolved.title ?? command, 'success')
      void useStore.getState().buildIndex()
    } catch (error) {
      useStore.getState().notify(`“${resolved.title}” failed: ${(error as Error).message}`, 'error')
    }
  }
})

/* ---------------- diagnostics ---------------- */

/** Diagnostics can arrive before a file is opened, so hold them until it is. */
const pendingDiagnostics = new Map<string, monacoNs.editor.IMarkerData[]>()

function wireDiagnostics() {
  window.nova.lsp.onDiagnostics(({ path, diagnostics }) => {
    const markers = toMarkers(diagnostics as any[])
    const model = monaco.editor.getModel(uriForPath(path))
    if (model) monaco.editor.setModelMarkers(model, 'lsp', markers)
    else pendingDiagnostics.set(path, markers)
  })

  monaco.editor.onDidCreateModel((model) => {
    const file = pathForUri(model.uri)
    const pending = pendingDiagnostics.get(file)
    if (pending) {
      monaco.editor.setModelMarkers(model, 'lsp', pending)
      pendingDiagnostics.delete(file)
    }
  })

  window.nova.lsp.onApplyEdit((edit) => {
    void applyWorkspaceEdit(edit as WorkspaceEdit)
  })
}

export { lspUriToPath }
