import { languageForPath } from './language'

/**
 * Document synchronisation with the language server. Kept free of store imports
 * so the store can call it without a circular dependency.
 */

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const opened = new Set<string>()

export function lspDidOpen(file: string, text: string) {
  if (opened.has(file)) return
  opened.add(file)
  void window.nova.lsp.didOpen(file, languageForPath(file), text).catch(() => undefined)
}

/** Debounced: servers reparse on every notification, so do not send per keypress. */
export function lspDidChange(file: string, text: string) {
  clearTimeout(changeTimers.get(file))
  changeTimers.set(
    file,
    setTimeout(() => {
      changeTimers.delete(file)
      void window.nova.lsp.didChange(file, languageForPath(file), text).catch(() => undefined)
    }, 250),
  )
}

export function lspDidSave(file: string, text: string) {
  // Cancelling the debounced change without flushing it would leave the server
  // holding stale text — every save right after an edit would silently break
  // diagnostics, hover and completion until the next keystroke.
  clearTimeout(changeTimers.get(file))
  changeTimers.delete(file)
  const language = languageForPath(file)
  void window.nova.lsp
    .didChange(file, language, text)
    .then(() => window.nova.lsp.didSave(file, language, text))
    .catch(() => undefined)
}

export function lspDidClose(file: string) {
  if (!opened.delete(file)) return
  clearTimeout(changeTimers.get(file))
  changeTimers.delete(file)
  void window.nova.lsp.didClose(file, languageForPath(file)).catch(() => undefined)
}

/**
 * Closes every open document before forgetting them. Without the `didClose`,
 * re-opening the same project would send `didOpen` for documents the server
 * still considers open, and it would keep serving the *previous* contents —
 * stale diagnostics, hover and completion until the file is edited again.
 */
export function lspResetDocuments() {
  for (const timer of changeTimers.values()) clearTimeout(timer)
  changeTimers.clear()
  for (const file of opened) {
    void window.nova.lsp.didClose(file, languageForPath(file)).catch(() => undefined)
  }
  opened.clear()
}
