import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { LspClient } from './lspClient'
import { SERVERS, serversForLanguage, type ServerSpec } from './lspRegistry'
import { toolEnv, which, whichXcrun } from './env'
import type { LspServerStatus } from '../../shared/types'

export function pathToUri(filePath: string) {
  return pathToFileURL(filePath).toString()
}

export function uriToPath(uri: string) {
  try {
    return uri.startsWith('file:') ? fileURLToPath(uri) : uri
  } catch {
    return uri
  }
}

interface Session {
  spec: ServerSpec
  client: LspClient
  root: string
  /** Resolves once `initialize` has completed. */
  ready: Promise<void>
  capabilities: Record<string, any>
  state: 'starting' | 'ready' | 'failed' | 'stopped'
  error?: string
  /** Latest `$/progress` title, e.g. rust-analyzer's indexing. */
  progress?: string
  openDocs: Map<string, { version: number; languageId: string }>
}

interface ManagerEvents {
  onDiagnostics: (payload: { uri: string; diagnostics: unknown[] }) => void
  onStatus: () => void
  onLog: (serverId: string, text: string) => void
  onApplyEdit: (edit: unknown) => void
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  // Servers only emit `$/progress` (rust-analyzer's indexing, gopls' loading)
  // when the client advertises support for it.
  window: { workDoneProgress: true, showMessage: { messageActionItem: { additionalPropertiesSupport: false } } },
  workspace: {
    applyEdit: true,
    workspaceFolders: true,
    configuration: true,
    didChangeConfiguration: { dynamicRegistration: true },
    symbol: { dynamicRegistration: true },
    workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] },
  },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true, willSave: false },
    publishDiagnostics: { relatedInformation: true, versionSupport: false },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        insertReplaceSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      contextSupport: true,
    },
    hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      dynamicRegistration: true,
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'] },
    },
    definition: { dynamicRegistration: true, linkSupport: true },
    typeDefinition: { dynamicRegistration: true, linkSupport: true },
    implementation: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentHighlight: { dynamicRegistration: true },
    documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true },
    formatting: { dynamicRegistration: true },
    rangeFormatting: { dynamicRegistration: true },
    rename: { dynamicRegistration: true, prepareSupport: true },
    codeAction: {
      dynamicRegistration: true,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'source', 'source.organizeImports'],
        },
      },
      resolveSupport: { properties: ['edit'] },
    },
    inlayHint: { dynamicRegistration: true, resolveSupport: { properties: ['tooltip', 'label.tooltip'] } },
    callHierarchy: { dynamicRegistration: true },
    typeHierarchy: { dynamicRegistration: true },
    documentLink: { dynamicRegistration: true },
    selectionRange: { dynamicRegistration: true },
    foldingRange: { dynamicRegistration: true, lineFoldingOnly: true },
  },
}

export class LspManager {
  private sessions = new Map<string, Session>()
  private available = new Map<string, string>()
  private detected = false
  private root = ''

  constructor(private events: ManagerEvents) {}

  setRoot(root: string) {
    if (this.root === root) return
    this.root = root
    void this.stopAll()
  }

  /** Probes PATH once per app run to see which servers exist. */
  async detect(force = false): Promise<LspServerStatus[]> {
    if (!this.detected || force) {
      this.available.clear()
      await Promise.all(
        SERVERS.map(async (spec) => {
          const binary =
            (await which(spec.command)) || (spec.xcrun ? await whichXcrun(spec.command) : '')
          if (binary) this.available.set(spec.id, binary)
        }),
      )
      this.detected = true
    }
    return this.status()
  }

  status(): LspServerStatus[] {
    return SERVERS.map((spec) => {
      const session = this.sessions.get(spec.id)
      return {
        id: spec.id,
        label: spec.label,
        languages: spec.languages,
        command: spec.command,
        binary: this.available.get(spec.id) ?? '',
        installed: this.available.has(spec.id),
        state: session?.state ?? 'stopped',
        error: session?.error ?? '',
        progress: session?.progress ?? '',
        install: spec.install,
      }
    })
  }

  /** The best installed server for a language, started if needed. */
  async ensure(language: string): Promise<Session | null> {
    if (!this.root) return null
    if (!this.detected) await this.detect()

    const spec = serversForLanguage(language).find((s) => this.available.has(s.id))
    if (!spec) return null

    const existing = this.sessions.get(spec.id)
    if (existing) {
      if (existing.state === 'failed' || existing.state === 'stopped') return null
      await existing.ready.catch(() => undefined)
      return existing.state === 'ready' ? existing : null
    }
    return this.start(spec)
  }

  private async resolveRoot(spec: ServerSpec): Promise<string> {
    for (const marker of spec.rootMarkers) {
      if (marker.includes('*')) continue
      try {
        await fs.access(path.join(this.root, marker))
        return this.root
      } catch {
        /* keep looking */
      }
    }
    return this.root
  }

  private async start(spec: ServerSpec): Promise<Session | null> {
    const binary = this.available.get(spec.id)!
    const root = await this.resolveRoot(spec)
    const client = new LspClient(spec.id, binary, spec.args, root, toolEnv({ NO_COLOR: '1' }))

    let markReady: () => void = () => {}
    let markFailed: (e: Error) => void = () => {}
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      markFailed = reject
    })

    const session: Session = {
      spec,
      client,
      root,
      ready,
      capabilities: {},
      state: 'starting',
      openDocs: new Map(),
    }
    this.sessions.set(spec.id, session)
    this.events.onStatus()

    client.on('stderr', (text: string) => this.events.onLog(spec.id, text))

    client.on('notification', (method: string, params: any) => {
      if (method === 'textDocument/publishDiagnostics') {
        this.events.onDiagnostics({ uri: params.uri, diagnostics: params.diagnostics ?? [] })
      } else if (method === 'window/logMessage' || method === 'window/showMessage') {
        this.events.onLog(spec.id, String(params?.message ?? ''))
      } else if (method === '$/progress') {
        const value = params?.value ?? {}
        if (value.kind === 'end') session.progress = ''
        else session.progress = [value.title, value.message].filter(Boolean).join(' — ')
        this.events.onStatus()
      }
    })

    client.on(
      'request',
      (method: string, params: any, respond: (result: unknown, error?: any) => void) => {
        switch (method) {
          case 'workspace/configuration': {
            // Servers block on this; answer with the spec's settings per section.
            const items = (params?.items ?? []) as { section?: string }[]
            respond(items.map((item) => sectionValue(spec.settings, item.section)))
            return
          }
          case 'workspace/applyEdit':
            this.events.onApplyEdit(params?.edit)
            respond({ applied: true })
            return
          case 'window/workDoneProgress/create':
          case 'client/registerCapability':
          case 'client/unregisterCapability':
          case 'workspace/semanticTokens/refresh':
          case 'workspace/codeLens/refresh':
          case 'workspace/inlayHint/refresh':
          case 'workspace/diagnostic/refresh':
            respond(null)
            return
          default:
            respond(null, { code: -32601, message: `Unhandled request ${method}` })
        }
      },
    )

    client.on('exit', () => {
      session.state = 'stopped'
      this.events.onStatus()
    })

    try {
      client.start()
      const result = (await client.request(
        'initialize',
        {
          processId: process.pid,
          clientInfo: { name: 'Nova IDE', version: '0.1.0' },
          rootUri: pathToUri(root),
          rootPath: root,
          workspaceFolders: [{ uri: pathToUri(root), name: path.basename(root) }],
          capabilities: CLIENT_CAPABILITIES,
          initializationOptions: spec.initializationOptions ?? {},
        },
        45_000,
      )) as { capabilities?: Record<string, unknown> }

      session.capabilities = result?.capabilities ?? {}
      client.notify('initialized', {})
      if (spec.settings) {
        client.notify('workspace/didChangeConfiguration', { settings: spec.settings })
      }
      session.state = 'ready'
      markReady()
    } catch (err) {
      session.state = 'failed'
      session.error = err instanceof Error ? err.message : String(err)
      markFailed(err instanceof Error ? err : new Error(String(err)))
      ready.catch(() => undefined)
    }

    this.events.onStatus()
    return session.state === 'ready' ? session : null
  }

  /* ---------------- document sync ---------------- */

  async openDocument(file: string, language: string, text: string) {
    const session = await this.ensure(language)
    if (!session) return
    const uri = pathToUri(file)
    if (session.openDocs.has(uri)) return
    session.openDocs.set(uri, { version: 1, languageId: language })
    session.client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: language, version: 1, text },
    })
  }

  async changeDocument(file: string, language: string, text: string) {
    const session = await this.ensure(language)
    if (!session) return
    const uri = pathToUri(file)
    const doc = session.openDocs.get(uri)
    if (!doc) {
      await this.openDocument(file, language, text)
      return
    }
    doc.version += 1
    // Full-document sync: one change with no range, which every server accepts.
    session.client.notify('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    })
  }

  async closeDocument(file: string, language: string) {
    const session = this.sessions.get(
      serversForLanguage(language).find((s) => this.sessions.has(s.id))?.id ?? '',
    )
    if (!session) return
    const uri = pathToUri(file)
    if (!session.openDocs.delete(uri)) return
    session.client.notify('textDocument/didClose', { textDocument: { uri } })
  }

  async saveDocument(file: string, language: string, text: string) {
    const session = await this.ensure(language)
    if (!session) return
    session.client.notify('textDocument/didSave', {
      textDocument: { uri: pathToUri(file) },
      text,
    })
  }

  /* ---------------- requests ---------------- */

  private async send<T>(language: string, method: string, params: unknown, timeout?: number) {
    const session = await this.ensure(language)
    if (!session) return null
    try {
      return (await session.client.request<T>(method, params, timeout)) ?? null
    } catch (err) {
      this.events.onLog(session.spec.id, `${method}: ${(err as Error).message}\n`)
      return null
    }
  }

  private docPos(file: string, line: number, character: number) {
    return {
      textDocument: { uri: pathToUri(file) },
      position: { line, character },
    }
  }

  definition(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/definition', this.docPos(file, line, character))
  }

  typeDefinition(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/typeDefinition', this.docPos(file, line, character))
  }

  implementation(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/implementation', this.docPos(file, line, character))
  }

  references(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/references', {
      ...this.docPos(file, line, character),
      context: { includeDeclaration: true },
    })
  }

  hover(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/hover', this.docPos(file, line, character), 8000)
  }

  completion(file: string, language: string, line: number, character: number, trigger?: string) {
    return this.send(language, 'textDocument/completion', {
      ...this.docPos(file, line, character),
      context: trigger
        ? { triggerKind: 2, triggerCharacter: trigger }
        : { triggerKind: 1 },
    })
  }

  resolveCompletion(language: string, item: unknown) {
    return this.send(language, 'completionItem/resolve', item, 8000)
  }

  signatureHelp(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/signatureHelp', this.docPos(file, line, character), 8000)
  }

  documentSymbols(file: string, language: string) {
    return this.send(language, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToUri(file) },
    })
  }

  workspaceSymbols(language: string, query: string) {
    return this.send(language, 'workspace/symbol', { query })
  }

  prepareRename(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/prepareRename', this.docPos(file, line, character), 8000)
  }

  rename(file: string, language: string, line: number, character: number, newName: string) {
    return this.send(language, 'textDocument/rename', {
      ...this.docPos(file, line, character),
      newName,
    }, 30_000)
  }

  formatting(file: string, language: string, tabSize: number, insertSpaces: boolean) {
    return this.send(language, 'textDocument/formatting', {
      textDocument: { uri: pathToUri(file) },
      options: { tabSize, insertSpaces },
    })
  }

  codeActions(
    file: string,
    language: string,
    range: unknown,
    diagnostics: unknown[],
  ) {
    return this.send(language, 'textDocument/codeAction', {
      textDocument: { uri: pathToUri(file) },
      range,
      context: { diagnostics },
    })
  }

  resolveCodeAction(language: string, action: unknown) {
    return this.send(language, 'codeAction/resolve', action, 15_000)
  }

  inlayHints(file: string, language: string, range: unknown) {
    return this.send(language, 'textDocument/inlayHint', {
      textDocument: { uri: pathToUri(file) },
      range,
    }, 8000)
  }

  /* --- call hierarchy --- */

  prepareCallHierarchy(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/prepareCallHierarchy', this.docPos(file, line, character))
  }

  incomingCalls(language: string, item: unknown) {
    return this.send(language, 'callHierarchy/incomingCalls', { item })
  }

  outgoingCalls(language: string, item: unknown) {
    return this.send(language, 'callHierarchy/outgoingCalls', { item })
  }

  /* --- type hierarchy --- */

  prepareTypeHierarchy(file: string, language: string, line: number, character: number) {
    return this.send(language, 'textDocument/prepareTypeHierarchy', this.docPos(file, line, character))
  }

  supertypes(language: string, item: unknown) {
    return this.send(language, 'typeHierarchy/supertypes', { item })
  }

  subtypes(language: string, item: unknown) {
    return this.send(language, 'typeHierarchy/subtypes', { item })
  }

  /** Which capabilities the active server for a language advertises. */
  async capabilitiesFor(language: string) {
    const session = await this.ensure(language)
    return session ? { id: session.spec.id, capabilities: session.capabilities } : null
  }

  async restart(serverId: string) {
    const session = this.sessions.get(serverId)
    if (session) {
      await session.client.stop()
      this.sessions.delete(serverId)
    }
    this.events.onStatus()
  }

  async stopAll() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map((s) => s.client.stop().catch(() => undefined)))
    this.events.onStatus()
  }
}

/** Resolves a dotted `workspace/configuration` section against a settings tree. */
function sectionValue(settings: Record<string, unknown> | undefined, section?: string) {
  if (!settings) return {}
  if (!section) return settings
  let current: unknown = settings
  for (const part of section.split('.')) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return {}
    }
  }
  return current ?? {}
}
