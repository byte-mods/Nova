/**
 * The formatting entry points the app calls.
 *
 * `resolveStyle` is the important one: the code-style scheme from Settings is
 * the baseline, `.editorconfig` overrides it, and the result is what both the
 * formatter and Optimize Imports run with. Everything below it is pure and
 * testable in Node.
 */

import type * as monacoNs from 'monaco-editor'
import { useStore } from '@/state/store'
import { languageForPath } from '@/lib/language'
import { formatText } from './format'
import { optimizeImports } from './imports'
import { applyEditorConfig, defaultCodeStyle, type CodeStyle } from './style'

export * from './style'
export * from './format'
export * from './imports'

/** Settings scheme + `.editorconfig` for this particular file. */
export async function resolveStyle(file: string): Promise<CodeStyle> {
  const base: CodeStyle = { ...defaultCodeStyle, ...useStore.getState().settings.codeStyle }
  const root = useStore.getState().root ?? ''
  const properties = await window.nova.editorconfig.resolve(file, root).catch(() => null)
  return applyEditorConfig(base, properties)
}

/** Full-document format, used by ⌥⌘L and by format-on-save. */
export async function formatFile(file: string, text: string): Promise<string> {
  const style = await resolveStyle(file)
  return formatText(text, { style, language: languageForPath(file) })
}

/**
 * Optimize Imports on the active editor.
 *
 * Applied straight to the model rather than through the WorkspaceEdit preview:
 * it is a single-file, fully reversible edit, and IntelliJ's ⌃⌥O does not ask
 * either. The toast says what was dropped so the change is never silent.
 */
export async function optimizeImportsIn(
  editor: monacoNs.editor.ICodeEditor,
  file: string,
): Promise<void> {
  const store = useStore.getState()
  const model = editor.getModel()
  if (!model) return

  const style = await resolveStyle(file)
  const result = optimizeImports(model.getValue(), languageForPath(file), style)
  if (!result.ok) {
    store.notify(result.reason, 'error')
    return
  }
  if (!result.changed) {
    store.notify('Imports are already optimal.', 'info')
    return
  }

  // One edit over the whole document keeps it a single undo step.
  editor.pushUndoStop()
  editor.executeEdits('nova.optimizeImports', [
    { range: model.getFullModelRange(), text: result.text, forceMoveMarkers: true },
  ])
  editor.pushUndoStop()

  store.notify(
    result.removed.length
      ? `Optimized imports — removed ${result.removed.length} unused (${result.removed.slice(0, 6).join(', ')}${result.removed.length > 6 ? '…' : ''})`
      : 'Optimized imports — reordered',
    'success',
  )
}

/** Format the active editor's document in place with the built-in formatter. */
export async function formatEditor(
  editor: monacoNs.editor.ICodeEditor,
  file: string,
): Promise<void> {
  const store = useStore.getState()
  const model = editor.getModel()
  if (!model) return
  const next = await formatFile(file, model.getValue())
  if (next === model.getValue()) {
    store.notify('Already formatted.', 'info')
    return
  }
  editor.pushUndoStop()
  editor.executeEdits('nova.format', [
    { range: model.getFullModelRange(), text: next, forceMoveMarkers: true },
  ])
  editor.pushUndoStop()
}

/** Languages whose formatting Monaco itself does better than we can. */
const MONACO_FORMATS = new Set([
  'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
  'json', 'css', 'scss', 'less', 'html',
])

/**
 * ⌥⌘L.
 *
 * A real formatter beats a normaliser, so the order is: the language server's,
 * then Monaco's own (which is a genuine printer for the web languages it
 * bundles), then the built-in one. The built-in path is what makes the shortcut
 * do *something* for Go, Rust, Java and the rest with no tooling installed —
 * which is the promise the LSP-only version was breaking.
 */
export async function formatDocument(
  editor: monacoNs.editor.ICodeEditor,
  file: string,
): Promise<void> {
  const language = languageForPath(file)
  const server = await window.nova.lsp.capabilities(language).catch(() => null)
  if (server?.capabilities?.documentFormattingProvider || MONACO_FORMATS.has(language)) {
    editor.trigger('nova', 'editor.action.formatDocument', null)
    return
  }
  await formatEditor(editor, file)
}
