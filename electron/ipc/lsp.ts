import { ipcMain } from 'electron'
import { LspManager, uriToPath } from '../lib/lspManager'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

export function registerLspHandlers(ctx: Ctx) {
  const manager = new LspManager({
    onDiagnostics: ({ uri, diagnostics }) => {
      ctx.broadcast('lsp:diagnostics', { path: uriToPath(uri), diagnostics })
    },
    onStatus: () => ctx.broadcast('lsp:status', manager.status()),
    onLog: (serverId, text) => ctx.broadcast('lsp:log', { serverId, text }),
    onApplyEdit: (edit) => ctx.broadcast('lsp:applyEdit', edit),
  })

  ipcMain.handle('lsp:setRoot', (_e, root: string) => {
    manager.setRoot(root)
  })
  ipcMain.handle('lsp:detect', (_e, force?: boolean) => manager.detect(force))
  ipcMain.handle('lsp:status', () => manager.status())
  ipcMain.handle('lsp:restart', (_e, id: string) => manager.restart(id))
  ipcMain.handle('lsp:capabilities', (_e, language: string) => manager.capabilitiesFor(language))

  ipcMain.handle('lsp:didOpen', (_e, file: string, language: string, text: string) =>
    manager.openDocument(file, language, text),
  )
  ipcMain.handle('lsp:didChange', (_e, file: string, language: string, text: string) =>
    manager.changeDocument(file, language, text),
  )
  ipcMain.handle('lsp:didClose', (_e, file: string, language: string) =>
    manager.closeDocument(file, language),
  )
  ipcMain.handle('lsp:didSave', (_e, file: string, language: string, text: string) =>
    manager.saveDocument(file, language, text),
  )

  ipcMain.handle('lsp:definition', (_e, f: string, l: string, line: number, ch: number) =>
    manager.definition(f, l, line, ch),
  )
  ipcMain.handle('lsp:typeDefinition', (_e, f: string, l: string, line: number, ch: number) =>
    manager.typeDefinition(f, l, line, ch),
  )
  ipcMain.handle('lsp:implementation', (_e, f: string, l: string, line: number, ch: number) =>
    manager.implementation(f, l, line, ch),
  )
  ipcMain.handle('lsp:references', (_e, f: string, l: string, line: number, ch: number) =>
    manager.references(f, l, line, ch),
  )
  ipcMain.handle('lsp:hover', (_e, f: string, l: string, line: number, ch: number) =>
    manager.hover(f, l, line, ch),
  )
  ipcMain.handle(
    'lsp:completion',
    (_e, f: string, l: string, line: number, ch: number, trigger?: string) =>
      manager.completion(f, l, line, ch, trigger),
  )
  ipcMain.handle('lsp:resolveCompletion', (_e, language: string, item: unknown) =>
    manager.resolveCompletion(language, item),
  )
  ipcMain.handle('lsp:signatureHelp', (_e, f: string, l: string, line: number, ch: number) =>
    manager.signatureHelp(f, l, line, ch),
  )
  ipcMain.handle('lsp:documentSymbols', (_e, f: string, l: string) =>
    manager.documentSymbols(f, l),
  )
  ipcMain.handle(
    'lsp:executeCommand',
    (_e, language: string, command: string, args: unknown[]) =>
      manager.executeCommand(language, command, args),
  )

  ipcMain.handle('lsp:workspaceSymbols', (_e, language: string, query: string) =>
    manager.workspaceSymbols(language, query),
  )
  ipcMain.handle('lsp:prepareRename', (_e, f: string, l: string, line: number, ch: number) =>
    manager.prepareRename(f, l, line, ch),
  )
  ipcMain.handle(
    'lsp:rename',
    (_e, f: string, l: string, line: number, ch: number, newName: string) =>
      manager.rename(f, l, line, ch, newName),
  )
  ipcMain.handle(
    'lsp:formatting',
    (_e, f: string, l: string, tabSize: number, insertSpaces: boolean) =>
      manager.formatting(f, l, tabSize, insertSpaces),
  )
  ipcMain.handle(
    'lsp:codeActions',
    (_e, f: string, l: string, range: unknown, diagnostics: unknown[]) =>
      manager.codeActions(f, l, range, diagnostics),
  )
  ipcMain.handle('lsp:resolveCodeAction', (_e, language: string, action: unknown) =>
    manager.resolveCodeAction(language, action),
  )
  ipcMain.handle('lsp:inlayHints', (_e, f: string, l: string, range: unknown) =>
    manager.inlayHints(f, l, range),
  )
  ipcMain.handle('lsp:prepareCallHierarchy', (_e, f: string, l: string, line: number, ch: number) =>
    manager.prepareCallHierarchy(f, l, line, ch),
  )
  ipcMain.handle('lsp:incomingCalls', (_e, l: string, item: unknown) =>
    manager.incomingCalls(l, item),
  )
  ipcMain.handle('lsp:outgoingCalls', (_e, l: string, item: unknown) =>
    manager.outgoingCalls(l, item),
  )
  ipcMain.handle('lsp:prepareTypeHierarchy', (_e, f: string, l: string, line: number, ch: number) =>
    manager.prepareTypeHierarchy(f, l, line, ch),
  )
  ipcMain.handle('lsp:supertypes', (_e, l: string, item: unknown) => manager.supertypes(l, item))
  ipcMain.handle('lsp:subtypes', (_e, l: string, item: unknown) => manager.subtypes(l, item))

  return {
    dispose: () => manager.stopAll(),
  }
}
