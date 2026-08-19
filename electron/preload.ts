import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiStartRequest,
  Changelist,
  CodeReference,
  CodeSymbol,
  DebugAdapterStatus,
  DebugBreakpoint,
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
  MergeStages,
  ProviderInfo,
  RebaseStep,
  RecentProject,
  RunConfig,
  RunConfigEntry,
  SearchHit,
  ShelfEntry,
  TestDeclaration,
  TestFrameworkInfo,
  StructuralHit,
  TestRunUpdate,
} from '../shared/types'
import type {
  InstalledPlugin,
  PluginInstallProgress,
  PluginLogEvent,
  PluginPermission,
  PluginRuntimeState,
} from '../shared/plugin'
import type {
  GraphqlSchema,
  GrpcServices,
  HistoryEntry,
  HttpCollection,
  HttpEnvironments,
  HttpFile,
  HttpResponse,
  MockStatus,
  OpenapiImport,
  RunResult,
  RunStep,
  StoredCookie,
  StreamMessage,
  StreamStatus,
} from '../shared/http'
import type { SemanticTokensResult } from '../shared/semantic'
import type { VisualComparison } from '../shared/e2e'
import type { ScanOptions, ScanProgress, ScanResult } from '../shared/security'
import type {
  ShareBroadcastSelection,
  ShareMediaChannel,
  ShareOptions,
  SharePresence,
  ShareScreenSource,
  ShareStatus,
} from '../shared/share'
import type { CoverageReport } from '../shared/coverage'
import type { BuildProject, BuildTask, DependencyNode } from '../shared/build'
import type {
  DatabaseConnection,
  DatabaseSchema,
  DriverStatus,
  QueryResult,
} from '../shared/database'
import type { CpuProfile } from '../shared/profile'
import type {
  DockerContainer,
  DockerImage,
  KubeContext,
  KubeResource,
  SshHost,
  ToolAvailability,
} from '../shared/infra'
import type { ChatSummary, StoredChat } from '../shared/chat'


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
    openFileDialog: (options?: {
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string | null> => ipcRenderer.invoke('app:openFileDialog', options),
    recents: (): Promise<RecentProject[]> => ipcRenderer.invoke('app:recents'),
    addRecent: (p: string): Promise<RecentProject[]> => ipcRenderer.invoke('app:addRecent', p),
    homeDir: (): Promise<string> => ipcRenderer.invoke('app:homeDir'),
    projectModel: (root: string): Promise<import('./lib/projectModel').ProjectModel> =>
      ipcRenderer.invoke('app:projectModel', root),
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
    findFiles: (root: string, query: string, limit?: number): Promise<string[]> =>
      ipcRenderer.invoke('fs:findFiles', root, query, limit),
    watch: (root: string): Promise<void> => ipcRenderer.invoke('fs:watch', root),
    history: (file: string): Promise<HistoryRevision[]> => ipcRenderer.invoke('history:list', file),
    historyRead: (file: string, id: string): Promise<string> =>
      ipcRenderer.invoke('history:read', file, id),
    historyClear: (file: string): Promise<void> => ipcRenderer.invoke('history:clear', file),
    onChanged: (cb: (payload: { path: string }) => void) => on('fs:changed', cb),
  },
  editorconfig: {
    resolve: (file: string, root: string): Promise<Record<string, string> | null> =>
      ipcRenderer.invoke('editorconfig:resolve', file, root),
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

    conflicts: (root: string): Promise<string[]> => ipcRenderer.invoke('git:conflicts', root),
    mergeStages: (root: string, file: string): Promise<MergeStages> =>
      ipcRenderer.invoke('git:mergeStages', root, file),
    resolve: (root: string, file: string, content: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:resolve', root, file, content),

    shelfList: (root: string): Promise<ShelfEntry[]> => ipcRenderer.invoke('git:shelfList', root),
    shelve: (
      root: string,
      name: string,
      files: string[],
      revert: boolean,
    ): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:shelve', root, name, files, revert),
    unshelve: (root: string, id: string, drop: boolean): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:unshelve', root, id, drop),
    shelfDrop: (root: string, id: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:shelfDrop', root, id),
    shelfPatch: (root: string, id: string): Promise<string> =>
      ipcRenderer.invoke('git:shelfPatch', root, id),

    changelists: (root: string): Promise<Changelist[]> => ipcRenderer.invoke('git:changelists', root),
    saveChangelists: (root: string, lists: Changelist[]): Promise<void> =>
      ipcRenderer.invoke('git:saveChangelists', root, lists),

    rebaseTodo: (root: string, onto: string): Promise<RebaseStep[]> =>
      ipcRenderer.invoke('git:rebaseTodo', root, onto),
    rebaseRun: (root: string, onto: string, steps: RebaseStep[]): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:rebaseRun', root, onto, steps),
    rebaseAbort: (root: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:rebaseAbort', root),
    rebaseContinue: (root: string): Promise<{ ok: boolean; out: string }> =>
      ipcRenderer.invoke('git:rebaseContinue', root),

    lineHistory: (
      root: string,
      file: string,
      from: number,
      to: number,
      limit?: number,
    ): Promise<{
      ok: boolean
      out: string
      entries: { hash: string; shortHash: string; subject: string; author: string; date: number; diff: string }[]
    }> => ipcRenderer.invoke('git:lineHistory', root, file, from, to, limit),
  },
  ai: {
    providers: (): Promise<ProviderInfo[]> => ipcRenderer.invoke('ai:providers'),
    /** Models Ollama has pulled locally, for the OpenCode provider. */
    localModels: (): Promise<string[]> => ipcRenderer.invoke('ai:localModels'),
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
    executeCommand: (language: string, command: string, args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke('lsp:executeCommand', language, command, args),
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
    semanticTokens: (f: string, l: string): Promise<SemanticTokensResult | null> =>
      ipcRenderer.invoke('lsp:semanticTokens', f, l),
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
    updateBreakpoint: (
      file: string,
      line: number,
      patch: Partial<DebugBreakpoint>,
    ): Promise<void> => ipcRenderer.invoke('debug:updateBreakpoint', file, line, patch),
    setRoot: (root: string): Promise<void> => ipcRenderer.invoke('debug:setRoot', root),
    continue: (): Promise<void> => ipcRenderer.invoke('debug:continue'),
    next: (): Promise<void> => ipcRenderer.invoke('debug:next'),
    stepIn: (): Promise<void> => ipcRenderer.invoke('debug:stepIn'),
    stepOut: (): Promise<void> => ipcRenderer.invoke('debug:stepOut'),
    pause: (): Promise<void> => ipcRenderer.invoke('debug:pause'),
    stepBack: (): Promise<void> => ipcRenderer.invoke('debug:stepBack'),
    runToLine: (file: string, line: number): Promise<void> =>
      ipcRenderer.invoke('debug:runToLine', file, line),
    dropFrame: (frameId?: number): Promise<{ ok: boolean; error: string }> =>
      ipcRenderer.invoke('debug:dropFrame', frameId),
    setExceptionBreakpoint: (
      filter: string,
      patch: { enabled?: boolean; condition?: string },
    ): Promise<void> => ipcRenderer.invoke('debug:setExceptionBreakpoint', filter, patch),
    addDataBreakpoint: (
      name: string,
      variablesReference: number,
      accessType?: 'read' | 'write' | 'readWrite',
    ): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('debug:addDataBreakpoint', name, variablesReference, accessType),
    removeDataBreakpoint: (dataId: string): Promise<void> =>
      ipcRenderer.invoke('debug:removeDataBreakpoint', dataId),
    setVariable: (
      variablesReference: number,
      name: string,
      value: string,
    ): Promise<{ ok: boolean; value: string; error: string }> =>
      ipcRenderer.invoke('debug:setVariable', variablesReference, name, value),
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
    run: (
      root: string,
      frameworkId: string,
      scope: unknown,
      options?: { coverage?: boolean },
    ): Promise<{ runId: string }> => ipcRenderer.invoke('tests:run', root, frameworkId, scope, options),
    cancel: (): Promise<void> => ipcRenderer.invoke('tests:cancel'),
    onUpdate: (cb: (update: TestRunUpdate) => void) => on('tests:update', cb),
  },
  chats: {
    list: (root: string): Promise<ChatSummary[]> => ipcRenderer.invoke('chats:list', root),
    get: (root: string, id: string): Promise<StoredChat | null> =>
      ipcRenderer.invoke('chats:get', root, id),
    save: (root: string, chat: StoredChat): Promise<ChatSummary[]> =>
      ipcRenderer.invoke('chats:save', root, chat),
    delete: (root: string, id: string): Promise<ChatSummary[]> =>
      ipcRenderer.invoke('chats:delete', root, id),
  },
  infra: {
    available: (): Promise<ToolAvailability> => ipcRenderer.invoke('infra:available'),
    dockerContainers: (all: boolean): Promise<DockerContainer[]> =>
      ipcRenderer.invoke('docker:containers', all),
    dockerImages: (): Promise<DockerImage[]> => ipcRenderer.invoke('docker:images'),
    dockerAction: (action: string, id: string): Promise<string> =>
      ipcRenderer.invoke('docker:action', action, id),
    dockerLogs: (id: string, tail?: number): Promise<string> =>
      ipcRenderer.invoke('docker:logs', id, tail),
    kubeContexts: (): Promise<KubeContext[]> => ipcRenderer.invoke('kube:contexts'),
    kubeUse: (context: string): Promise<string> => ipcRenderer.invoke('kube:use', context),
    kubeNamespaces: (): Promise<string[]> => ipcRenderer.invoke('kube:namespaces'),
    kubeResources: (kind: string, namespace: string): Promise<KubeResource[]> =>
      ipcRenderer.invoke('kube:resources', kind, namespace),
    kubeLogs: (pod: string, namespace: string, tail?: number): Promise<string> =>
      ipcRenderer.invoke('kube:logs', pod, namespace, tail),
    kubeDescribe: (kind: string, name: string, namespace: string): Promise<string> =>
      ipcRenderer.invoke('kube:describe', kind, name, namespace),
    sshHosts: (): Promise<SshHost[]> => ipcRenderer.invoke('ssh:hosts'),
  },
  profile: {
    open: (file: string): Promise<CpuProfile> => ipcRenderer.invoke('profile:open', file),
    run: (root: string, script: string, args?: string[]): Promise<CpuProfile> =>
      ipcRenderer.invoke('profile:run', root, script, args),
  },
  db: {
    drivers: (): Promise<DriverStatus[]> => ipcRenderer.invoke('db:drivers'),
    connections: (): Promise<DatabaseConnection[]> => ipcRenderer.invoke('db:connections'),
    save: (connection: DatabaseConnection, password?: string | null): Promise<DatabaseConnection[]> =>
      ipcRenderer.invoke('db:save', connection, password),
    remove: (id: string): Promise<DatabaseConnection[]> => ipcRenderer.invoke('db:remove', id),
    test: (id: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('db:test', id),
    schema: (id: string): Promise<DatabaseSchema> => ipcRenderer.invoke('db:schema', id),
    query: (id: string, sql: string): Promise<QueryResult> => ipcRenderer.invoke('db:query', id, sql),
  },
  structural: {
    search: (
      root: string,
      pattern: string,
      options?: { include?: string; limit?: number },
    ): Promise<StructuralHit[]> => ipcRenderer.invoke('structural:search', root, pattern, options),
    replace: (
      files: string[],
      pattern: string,
      replacement: string,
    ): Promise<{ path: string; before: string; after: string }[]> =>
      ipcRenderer.invoke('structural:replace', files, pattern, replacement),
  },
  build: {
    detect: (root: string): Promise<BuildProject[]> => ipcRenderer.invoke('build:detect', root),
    tasks: (root: string, project: BuildProject): Promise<BuildTask[]> =>
      ipcRenderer.invoke('build:tasks', root, project),
    dependencies: (root: string, project: BuildProject): Promise<DependencyNode[]> =>
      ipcRenderer.invoke('build:dependencies', root, project),
  },
  coverage: {
    load: (root: string, file?: string): Promise<CoverageReport | null> =>
      ipcRenderer.invoke('coverage:load', root, file),
    find: (root: string): Promise<string | null> => ipcRenderer.invoke('coverage:find', root),
    args: (frameworkId: string): Promise<string[] | null> =>
      ipcRenderer.invoke('coverage:args', frameworkId),
  },
  http: {
    setRoot: (root: string): Promise<void> => ipcRenderer.invoke('http:setRoot', root),
    parse: (file: string): Promise<HttpFile> => ipcRenderer.invoke('http:parse', file),
    environments: (file: string): Promise<HttpEnvironments> =>
      ipcRenderer.invoke('http:environments', file),
    collections: (root: string): Promise<HttpCollection[]> =>
      ipcRenderer.invoke('http:collections', root),
    send: (file: string, requestId: string, environment: string | null): Promise<HttpResponse> =>
      ipcRenderer.invoke('http:send', file, requestId, environment),

    /** WebSocket and SSE. Resolves with the id the stream reports under. */
    openStream: (file: string, requestId: string, environment: string | null): Promise<string> =>
      ipcRenderer.invoke('http:openStream', file, requestId, environment),
    sendStream: (streamId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('http:sendStream', streamId, data),
    /** Ends the sending half; a gRPC call then waits for its reply. */
    closeStream: (streamId: string): Promise<void> =>
      ipcRenderer.invoke('http:closeStream', streamId),
    cancelStream: (streamId: string): Promise<void> =>
      ipcRenderer.invoke('http:cancelStream', streamId),
    streams: (): Promise<StreamStatus[]> => ipcRenderer.invoke('http:streams'),
    onStreamMessage: (cb: (message: StreamMessage) => void) => on('http:streamMessage', cb),
    onStreamStatus: (cb: (status: StreamStatus) => void) => on('http:streamStatus', cb),

    graphqlSchema: (file: string, requestId: string, environment: string | null): Promise<GraphqlSchema> =>
      ipcRenderer.invoke('http:graphqlSchema', file, requestId, environment),

    grpcServices: (file: string, requestId: string, environment: string | null): Promise<GrpcServices> =>
      ipcRenderer.invoke('http:grpcServices', file, requestId, environment),
    /** gRPC calls are streams too, so a unary reply arrives as one message. */
    grpcCall: (file: string, requestId: string, environment: string | null): Promise<string> =>
      ipcRenderer.invoke('http:grpcCall', file, requestId, environment),

    /** Runs a file — or one request with the run scope around it. */
    run: (
      file: string,
      environment: string | null,
      options?: { only?: string; bail?: boolean },
    ): Promise<RunResult> => ipcRenderer.invoke('http:run', file, environment, options),
    onRunStep: (cb: (e: { file: string; step: RunStep }) => void) => on('http:runStep', cb),
    onRunDone: (cb: (result: RunResult) => void) => on('http:runDone', cb),

    importOpenapi: (specFile: string): Promise<OpenapiImport> =>
      ipcRenderer.invoke('http:importOpenapi', specFile),

    mockStart: (specFile: string, port?: number): Promise<MockStatus> =>
      ipcRenderer.invoke('http:mockStart', specFile, port),
    mockStop: (): Promise<MockStatus> => ipcRenderer.invoke('http:mockStop'),
    mockStatus: (): Promise<MockStatus> => ipcRenderer.invoke('http:mockStatus'),

    history: (file?: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('http:history', file),
    historyBody: (id: string): Promise<HttpResponse | null> =>
      ipcRenderer.invoke('http:historyBody', id),
    historyClear: (): Promise<void> => ipcRenderer.invoke('http:historyClear'),

    cookies: (): Promise<StoredCookie[]> => ipcRenderer.invoke('http:cookies'),
    clearCookies: (domain?: string): Promise<void> =>
      ipcRenderer.invoke('http:clearCookies', domain),
  },
  e2e: {
    /** Compares a captured page with its stored baseline, creating one if absent. */
    /** `contentsId` comes from the webview's `getWebContentsId()`. */
    compareScreenshot: (root: string, name: string, contentsId: number): Promise<VisualComparison> =>
      ipcRenderer.invoke('e2e:compareScreenshot', root, name, contentsId),
    acceptScreenshot: (root: string, name: string, contentsId: number): Promise<boolean> =>
      ipcRenderer.invoke('e2e:acceptScreenshot', root, name, contentsId),
  },
  security: {
    /** Runs the enabled phases over the project and returns every finding. */
    scan: (root: string, options: ScanOptions): Promise<ScanResult> =>
      ipcRenderer.invoke('security:scan', root, options),
    dependencies: (root: string): Promise<unknown[]> =>
      ipcRenderer.invoke('security:dependencies', root),
    onProgress: (cb: (progress: ScanProgress) => void) => on('security:progress', cb),
  },
  share: {
    /** Whether `cloudflared` is on PATH; without it a share cannot be opened. */
    available: (): Promise<boolean> => ipcRenderer.invoke('share:available'),
    status: (): Promise<ShareStatus> => ipcRenderer.invoke('share:status'),
    start: (root: string, options: ShareOptions): Promise<ShareStatus> =>
      ipcRenderer.invoke('share:start', root, options),
    stop: (): Promise<ShareStatus> => ipcRenderer.invoke('share:stop'),
    /** Pushes the editor's position so viewers follow along. */
    presence: (presence: SharePresence): Promise<ShareStatus> =>
      ipcRenderer.invoke('share:presence', presence),
    onStatus: (cb: (status: ShareStatus) => void) => on('share:status', cb),
    onLog: (cb: (line: string) => void) => on('share:log', cb),

    /** Screens and windows offered in the "what do you want to send" picker. */
    screenSources: (): Promise<ShareScreenSource[]> => ipcRenderer.invoke('share:screenSources'),
    /** Declares what is being sent, or `null` to stop. */
    broadcast: (selection: ShareBroadcastSelection | null, error?: string): Promise<ShareStatus> =>
      ipcRenderer.invoke('share:broadcast', selection, error),
    /** One encoded chunk, on its way to every viewer of that channel. */
    media: (channel: ShareMediaChannel, chunk: ArrayBuffer): void =>
      ipcRenderer.send('share:media', channel, chunk),
    /** Clears the remembered stream header before a new recorder starts. */
    mediaReset: (channel: ShareMediaChannel): Promise<void> =>
      ipcRenderer.invoke('share:mediaReset', channel),
  },
  plugins: {
    list: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins:list'),
    dir: (): Promise<string> => ipcRenderer.invoke('plugins:dir'),
    install: (
      url: string,
      options?: { ref?: string; permissions?: PluginPermission[]; force?: boolean },
    ): Promise<InstalledPlugin> => ipcRenderer.invoke('plugins:install', url, options),
    update: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke('plugins:update', id),
    setEnabled: (id: string, enabled: boolean): Promise<InstalledPlugin | null> =>
      ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    uninstall: (id: string): Promise<void> => ipcRenderer.invoke('plugins:uninstall', id),
    grant: (id: string, permissions: PluginPermission[]): Promise<InstalledPlugin | null> =>
      ipcRenderer.invoke('plugins:grant', id, permissions),
    invoke: (pluginId: string, commandId: string, args?: unknown): Promise<unknown> =>
      ipcRenderer.invoke('plugins:invoke', pluginId, commandId, args),
    runtime: (): Promise<PluginRuntimeState[]> => ipcRenderer.invoke('plugins:runtime'),
    viewHtml: (pluginId: string, viewId: string): Promise<string> =>
      ipcRenderer.invoke('plugins:viewHtml', pluginId, viewId),
    commands: (): Promise<{ pluginId: string; commandId: string; title: string; category: string }[]> =>
      ipcRenderer.invoke('plugins:commands'),
    mcpServers: (): Promise<
      { key: string; pluginId: string; pluginName: string; name: string; description: string; command: string; args: string[] }[]
    > => ipcRenderer.invoke('plugins:mcpServers'),
    setRoot: (root: string | null): Promise<void> => ipcRenderer.invoke('plugins:setRoot', root),

    onList: (cb: (plugins: InstalledPlugin[]) => void) => on('plugins:list', cb),
    onLog: (cb: (e: PluginLogEvent) => void) => on('plugins:log', cb),
    onRuntime: (cb: (states: PluginRuntimeState[]) => void) => on('plugins:runtime', cb),
    onInstallProgress: (cb: (p: PluginInstallProgress) => void) => on('plugins:install-progress', cb),
    onViewHtml: (cb: (e: { pluginId: string; viewId: string; html: string }) => void) =>
      on('plugins:viewHtml', cb),
    onLoadError: (cb: (e: { pluginId: string; error: string }) => void) => on('plugins:loadError', cb),

    /**
     * The main process asks the renderer for editor state a plugin requested.
     * The renderer answers on a plain channel rather than a handler because the
     * request originates on the main side.
     */
    onAsk: (cb: (req: { id: string; question: string; params: unknown }) => void) => on('plugins:ask', cb),
    answer: (id: string, ok: boolean, value?: unknown, error?: string) =>
      ipcRenderer.send('plugins:answer', { id, ok, value, error }),
  },
  shell: {
    open: (id: string, cwd: string, cols: number, rows: number): Promise<{ pty: boolean; reason: string }> =>
      ipcRenderer.invoke('shell:open', id, cwd, cols, rows),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('shell:resize', id, cols, rows),
    dispose: (id: string): Promise<void> => ipcRenderer.invoke('shell:dispose', id),
    capabilities: (): Promise<{ pty: boolean; reason: string; shell: string }> =>
      ipcRenderer.invoke('shell:capabilities'),
    spawn: (id: string, cwd: string, command: string): Promise<void> =>
      ipcRenderer.invoke('shell:spawn', id, cwd, command),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('shell:kill', id),
    input: (id: string, data: string): Promise<void> => ipcRenderer.invoke('shell:input', id, data),
    detectDevServer: (root: string): Promise<{ command: string; url: string } | null> =>
      ipcRenderer.invoke('shell:detectDevServer', root),
    runConfigs: (root: string): Promise<RunConfig[]> => ipcRenderer.invoke('shell:runConfigs', root),
    createRunConfig: (root: string): Promise<string> =>
      ipcRenderer.invoke('shell:createRunConfig', root),
    runConfigEntries: (root: string): Promise<RunConfigEntry[]> =>
      ipcRenderer.invoke('shell:runConfigEntries', root),
    saveRunConfigEntries: (root: string, entries: RunConfigEntry[]): Promise<void> =>
      ipcRenderer.invoke('shell:saveRunConfigEntries', root, entries),
    onData: (cb: (chunk: { id: string; data: string; stream: string }) => void) =>
      on('shell:data', cb),
    onExit: (cb: (payload: { id: string; code: number | null }) => void) => on('shell:exit', cb),
  },
}

contextBridge.exposeInMainWorld('nova', api)

export type NovaApi = typeof api
