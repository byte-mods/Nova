import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiStartRequest,
  CodeReference,
  CodeSymbol,
  DebugAdapterStatus,
  DebugScope,
  DebugState,
  DebugVariable,
  DirEntry,
  FileReadResult,
  GitBlameLine,
  GitBranch,
  GitCommit,
  GitStashEntry,
  GitStatus,
  HistoryRevision,
  IndexStatus,
  LspDiagnosticsEvent,
  LspServerStatus,
  ProviderInfo,
  RecentProject,
  RunConfig,
  SearchHit,
  TestDeclaration,
  TestFrameworkInfo,
  TestRunUpdate,
} from '../shared/types'

/** Subscribe to a main-process push channel; returns an unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  app: {
    openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('app:openFolderDialog'),
    recents: (): Promise<RecentProject[]> => ipcRenderer.invoke('app:recents'),
    addRecent: (p: string): Promise<RecentProject[]> => ipcRenderer.invoke('app:addRecent', p),
    homeDir: (): Promise<string> => ipcRenderer.invoke('app:homeDir'),
    readSettings: <T>(): Promise<T | null> => ipcRenderer.invoke('app:readSettings'),
    writeSettings: (data: unknown): Promise<void> => ipcRenderer.invoke('app:writeSettings', data),
    revealInFinder: (p: string): Promise<void> => ipcRenderer.invoke('app:reveal', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
    windowAction: (action: string) => ipcRenderer.invoke('window:action', action),
  },
  fs: {
    list: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:list', dir),
    read: (file: string): Promise<FileReadResult> => ipcRenderer.invoke('fs:read', file),
    write: (file: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:write', file, content),
    create: (file: string, isDir: boolean): Promise<void> =>
      ipcRenderer.invoke('fs:create', file, isDir),
    rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:rename', from, to),
    trash: (file: string): Promise<void> => ipcRenderer.invoke('fs:trash', file),
    exists: (file: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', file),
    realpath: (target: string): Promise<string> => ipcRenderer.invoke('fs:realpath', target),
    search: (root: string, query: string, opts?: unknown): Promise<SearchHit[]> =>
      ipcRenderer.invoke('fs:search', root, query, opts),
    findFiles: (root: string, query: string): Promise<string[]> =>
      ipcRenderer.invoke('fs:findFiles', root, query),
    watch: (root: string): Promise<void> => ipcRenderer.invoke('fs:watch', root),
    history: (file: string): Promise<HistoryRevision[]> => ipcRenderer.invoke('history:list', file),
    historyRead: (file: string, id: string): Promise<string> =>
      ipcRenderer.invoke('history:read', file, id),
    historyClear: (file: string): Promise<void> => ipcRenderer.invoke('history:clear', file),
    onChanged: (cb: (payload: { path: string }) => void) => on('fs:changed', cb),
  },
  git: {
    status: (root: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', root),
    log: (root: string, limit?: number, branch?: string): Promise<GitCommit[]> =>
      ipcRenderer.invoke('git:log', root, limit, branch),
    commitFiles: (root: string, hash: string): Promise<{ path: string; code: string }[]> =>
      ipcRenderer.invoke('git:commitFiles', root, hash),
    diff: (root: string, file: string, staged: boolean): Promise<string> =>
      ipcRenderer.invoke('git:diff', root, file, staged),
    commitDiff: (root: string, hash: string, file?: string): Promise<string> =>
      ipcRenderer.invoke('git:commitDiff', root, hash, file),
    showFile: (root: string, rev: string, file: string): Promise<string> =>
      ipcRenderer.invoke('git:showFile', root, rev, file),
    stage: (root: string, files: string[]): Promise<void> =>
      ipcRenderer.invoke('git:stage', root, files),
    unstage: (root: string, files: string[]): Promise<void> =>
      ipcRenderer.invoke('git:unstage', root, files),
    discard: (root: string, files: string[]): Promise<void> =>
      ipcRenderer.invoke('git:discard', root, files),
    commit: (root: string, message: string, amend?: boolean): Promise<string> =>
      ipcRenderer.invoke('git:commit', root, message, amend),
    branches: (root: string): Promise<GitBranch[]> => ipcRenderer.invoke('git:branches', root),
    checkout: (root: string, branch: string, create?: boolean): Promise<void> =>
      ipcRenderer.invoke('git:checkout', root, branch, create),
    init: (root: string): Promise<void> => ipcRenderer.invoke('git:init', root),
    blame: (root: string, file: string): Promise<GitBlameLine[]> =>
      ipcRenderer.invoke('git:blame', root, file),
    fileHistory: (root: string, file: string, limit?: number): Promise<GitCommit[]> =>
      ipcRenderer.invoke('git:fileHistory', root, file, limit),
    revert: (root: string, hash: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:revert', root, hash),
    cherryPick: (root: string, hash: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:cherryPick', root, hash),
    resetTo: (root: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:resetTo', root, hash, mode),
    stash: (root: string, message: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:stash', root, message),
    stashList: (root: string): Promise<GitStashEntry[]> => ipcRenderer.invoke('git:stashList', root),
    stashApply: (root: string, ref: string, drop: boolean): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:stashApply', root, ref, drop),
    stashDrop: (root: string, ref: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:stashDrop', root, ref),
    fetch: (root: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:fetch', root),
    pull: (root: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:pull', root),
    push: (root: string, setUpstream?: boolean): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:push', root, setUpstream),
    raw: (root: string, args: string[]): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:raw', root, args),
  },
  ai: {
    providers: (): Promise<ProviderInfo[]> => ipcRenderer.invoke('ai:providers'),
    start: (req: AiStartRequest): Promise<{ runId: string }> => ipcRenderer.invoke('ai:start', req),
    ack: (runId: string): Promise<void> => ipcRenderer.invoke('ai:ack', runId),
    cancel: (runId: string): Promise<void> => ipcRenderer.invoke('ai:cancel', runId),
    onEvent: (cb: (e: unknown) => void) => on('ai:event', cb),
  },
  code: {
    build: (root: string): Promise<IndexStatus> => ipcRenderer.invoke('index:build', root),
    status: (): Promise<IndexStatus> => ipcRenderer.invoke('index:status'),
    definitions: (name: string, fromFile?: string): Promise<CodeSymbol[]> =>
      ipcRenderer.invoke('index:definitions', name, fromFile),
    references: (name: string, fromFile?: string): Promise<CodeReference[]> =>
      ipcRenderer.invoke('index:references', name, fromFile),
    documentSymbols: (file: string): Promise<CodeSymbol[]> =>
      ipcRenderer.invoke('index:documentSymbols', file),
    workspaceSymbols: (query: string, limit?: number): Promise<CodeSymbol[]> =>
      ipcRenderer.invoke('index:workspaceSymbols', query, limit),
    completions: (prefix: string, fromFile?: string, limit?: number): Promise<CodeSymbol[]> =>
      ipcRenderer.invoke('index:completions', prefix, fromFile, limit),
    onStatus: (cb: (status: IndexStatus) => void) => on('index:status', cb),
  },
  lsp: {
    setRoot: (root: string): Promise<void> => ipcRenderer.invoke('lsp:setRoot', root),
    detect: (force?: boolean): Promise<LspServerStatus[]> => ipcRenderer.invoke('lsp:detect', force),
    status: (): Promise<LspServerStatus[]> => ipcRenderer.invoke('lsp:status'),
    restart: (id: string): Promise<void> => ipcRenderer.invoke('lsp:restart', id),
    capabilities: (language: string): Promise<{ id: string; capabilities: any } | null> =>
      ipcRenderer.invoke('lsp:capabilities', language),

    didOpen: (file: string, language: string, text: string): Promise<void> =>
      ipcRenderer.invoke('lsp:didOpen', file, language, text),
    didChange: (file: string, language: string, text: string): Promise<void> =>
      ipcRenderer.invoke('lsp:didChange', file, language, text),
    didClose: (file: string, language: string): Promise<void> =>
      ipcRenderer.invoke('lsp:didClose', file, language),
    didSave: (file: string, language: string, text: string): Promise<void> =>
      ipcRenderer.invoke('lsp:didSave', file, language, text),

    definition: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:definition', f, l, line, ch),
    typeDefinition: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:typeDefinition', f, l, line, ch),
    implementation: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:implementation', f, l, line, ch),
    references: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:references', f, l, line, ch),
    hover: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:hover', f, l, line, ch),
    completion: (f: string, l: string, line: number, ch: number, trigger?: string): Promise<any> =>
      ipcRenderer.invoke('lsp:completion', f, l, line, ch, trigger),
    resolveCompletion: (language: string, item: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:resolveCompletion', language, item),
    signatureHelp: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:signatureHelp', f, l, line, ch),
    documentSymbols: (f: string, l: string): Promise<any> =>
      ipcRenderer.invoke('lsp:documentSymbols', f, l),
    workspaceSymbols: (language: string, query: string): Promise<any> =>
      ipcRenderer.invoke('lsp:workspaceSymbols', language, query),
    prepareRename: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:prepareRename', f, l, line, ch),
    rename: (f: string, l: string, line: number, ch: number, newName: string): Promise<any> =>
      ipcRenderer.invoke('lsp:rename', f, l, line, ch, newName),
    formatting: (f: string, l: string, tabSize: number, insertSpaces: boolean): Promise<any> =>
      ipcRenderer.invoke('lsp:formatting', f, l, tabSize, insertSpaces),
    codeActions: (f: string, l: string, range: unknown, diagnostics: unknown[]): Promise<any> =>
      ipcRenderer.invoke('lsp:codeActions', f, l, range, diagnostics),
    resolveCodeAction: (language: string, action: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:resolveCodeAction', language, action),
    inlayHints: (f: string, l: string, range: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:inlayHints', f, l, range),
    prepareCallHierarchy: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:prepareCallHierarchy', f, l, line, ch),
    incomingCalls: (l: string, item: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:incomingCalls', l, item),
    outgoingCalls: (l: string, item: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:outgoingCalls', l, item),
    prepareTypeHierarchy: (f: string, l: string, line: number, ch: number): Promise<any> =>
      ipcRenderer.invoke('lsp:prepareTypeHierarchy', f, l, line, ch),
    supertypes: (l: string, item: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:supertypes', l, item),
    subtypes: (l: string, item: unknown): Promise<any> =>
      ipcRenderer.invoke('lsp:subtypes', l, item),

    onDiagnostics: (cb: (e: LspDiagnosticsEvent) => void) => on('lsp:diagnostics', cb),
    onStatus: (cb: (servers: LspServerStatus[]) => void) => on('lsp:status', cb),
    onLog: (cb: (e: { serverId: string; text: string }) => void) => on('lsp:log', cb),
    onApplyEdit: (cb: (edit: unknown) => void) => on('lsp:applyEdit', cb),
  },
  debug: {
    detect: (force?: boolean): Promise<DebugAdapterStatus[]> =>
      ipcRenderer.invoke('debug:detect', force),
    state: (): Promise<DebugState> => ipcRenderer.invoke('debug:state'),
    launch: (request: unknown): Promise<void> => ipcRenderer.invoke('debug:launch', request),
    stop: (): Promise<void> => ipcRenderer.invoke('debug:stop'),
    restart: (): Promise<void> => ipcRenderer.invoke('debug:restart'),
    toggleBreakpoint: (file: string, line: number): Promise<void> =>
      ipcRenderer.invoke('debug:toggleBreakpoint', file, line),
    clearBreakpoints: (): Promise<void> => ipcRenderer.invoke('debug:clearBreakpoints'),
    continue: (): Promise<void> => ipcRenderer.invoke('debug:continue'),
    next: (): Promise<void> => ipcRenderer.invoke('debug:next'),
    stepIn: (): Promise<void> => ipcRenderer.invoke('debug:stepIn'),
    stepOut: (): Promise<void> => ipcRenderer.invoke('debug:stepOut'),
    pause: (): Promise<void> => ipcRenderer.invoke('debug:pause'),
    stepBack: (): Promise<void> => ipcRenderer.invoke('debug:stepBack'),
    scopes: (frameId: number): Promise<DebugScope[]> => ipcRenderer.invoke('debug:scopes', frameId),
    variables: (reference: number): Promise<DebugVariable[]> =>
      ipcRenderer.invoke('debug:variables', reference),
    selectFrame: (frameId: number): Promise<void> =>
      ipcRenderer.invoke('debug:selectFrame', frameId),
    evaluate: (
      expression: string,
      frameId?: number,
      context?: string,
    ): Promise<{ result: string; type?: string; variablesReference: number; error: string }> =>
      ipcRenderer.invoke('debug:evaluate', expression, frameId, context),
    onState: (cb: (state: DebugState) => void) => on('debug:state', cb),
    onOutput: (cb: (e: { text: string; category: string }) => void) => on('debug:output', cb),
    onStopped: (cb: () => void) => on('debug:stopped', cb),
  },
  tests: {
    detect: (root: string): Promise<TestFrameworkInfo[]> => ipcRenderer.invoke('tests:detect', root),
    declarations: (file: string): Promise<TestDeclaration[]> =>
      ipcRenderer.invoke('tests:declarations', file),
    run: (root: string, frameworkId: string, scope: unknown): Promise<{ runId: string }> =>
      ipcRenderer.invoke('tests:run', root, frameworkId, scope),
    cancel: (): Promise<void> => ipcRenderer.invoke('tests:cancel'),
    onUpdate: (cb: (update: TestRunUpdate) => void) => on('tests:update', cb),
  },
  shell: {
    spawn: (id: string, cwd: string, command: string): Promise<void> =>
      ipcRenderer.invoke('shell:spawn', id, cwd, command),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('shell:kill', id),
    input: (id: string, data: string): Promise<void> => ipcRenderer.invoke('shell:input', id, data),
    detectDevServer: (root: string): Promise<{ command: string; url: string } | null> =>
      ipcRenderer.invoke('shell:detectDevServer', root),
    runConfigs: (root: string): Promise<RunConfig[]> => ipcRenderer.invoke('shell:runConfigs', root),
    createRunConfig: (root: string): Promise<string> =>
      ipcRenderer.invoke('shell:createRunConfig', root),
    onData: (cb: (chunk: { id: string; data: string; stream: string }) => void) =>
      on('shell:data', cb),
    onExit: (cb: (payload: { id: string; code: number | null }) => void) => on('shell:exit', cb),
  },
}

contextBridge.exposeInMainWorld('nova', api)

export type NovaApi = typeof api
