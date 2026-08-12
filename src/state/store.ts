import { create } from 'zustand'
import type {
  AiProvider,
  CodeReference,
  FileChange,
  GitCommit,
  GitStatus,
  IndexStatus,
  DebugAdapterStatus,
  DebugState,
  LspServerStatus,
  TestEvent,
  TestFrameworkInfo,
  TestStatus,
  ProviderInfo,
  RecentProject,
} from '@shared/types'
import { applyTheme, defaultThemeId, getTheme } from '@/theme/themes'
import { basename } from '@/lib/paths'
import { lspDidChange, lspDidClose, lspDidOpen, lspDidSave, lspResetDocuments } from '@/lib/lspSync'

export type TabKind = 'file' | 'diff' | 'diagram' | 'browser' | 'settings' | 'commit' | 'history' | 'explain'

export interface DiffPayload {
  before: string
  after: string
  language: string
  /** Set when the diff is editable and writing back should target this path. */
  targetPath?: string
}

export interface Tab {
  id: string
  kind: TabKind
  title: string
  path?: string
  subtitle?: string
  diff?: DiffPayload
  url?: string
  commitHash?: string
  preview?: boolean
}

/** A generated walkthrough of one file, streamed in from the AI CLI. */
export interface ExplainDoc {
  path: string
  runId?: string
  provider: AiProvider
  depth: import('@/lib/explain').ExplainDepth
  content: string
  thinking: string
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface Buffer {
  path: string
  content: string
  savedContent: string
  binary: boolean
  mtimeMs: number
}

export type SidebarView = 'explorer' | 'search' | 'git' | 'diagrams' | 'themes'

export type PaletteMode = 'command' | 'file' | 'symbol'

export interface AiMessagePart {
  kind: 'text' | 'thinking' | 'tool' | 'error' | 'log'
  text: string
  toolName?: string
  toolInput?: unknown
  toolResult?: string
  toolOk?: boolean
  id?: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  parts: AiMessagePart[]
  changes: FileChange[]
  provider?: AiProvider
  runId?: string
  running?: boolean
  costUsd?: number
  createdAt: number
}

export type HierarchyMode = 'callers' | 'callees' | 'supertypes' | 'subtypes'

export interface HierarchyNode {
  id: string
  name: string
  detail: string
  file: string
  line: number
  column: number
  /** LSP SymbolKind. */
  kind: number
  /** The raw LSP item, needed to expand this node. */
  item: unknown
  children?: HierarchyNode[]
  expanded?: boolean
  loading?: boolean
  /** Call sites inside the caller, for call hierarchy. */
  callSites?: { line: number; column: number }[]
}

export interface HierarchyResult {
  mode: HierarchyMode
  language: string
  rootName: string
  /** Where the query started, so the mode can be switched without re-picking. */
  origin: { file: string; line: number; column: number }
  loading: boolean
  error?: string
  nodes: HierarchyNode[]
  /** What the active server actually implements, used to disable modes. */
  supported?: { calls: boolean; types: boolean }
}

export interface TestCase {
  id: string
  name: string
  suite?: string
  status: TestStatus
  durationMs?: number
  message?: string
}

export interface TestRunState {
  runId: string
  framework: string
  command: string
  running: boolean
  cases: TestCase[]
  output: string
  exitCode?: number | null
  durationMs?: number
}

export interface DebugUiState {
  adapters: DebugAdapterStatus[]
  state: DebugState | null
  output: string
  /** Watch expressions and their last evaluated value. */
  watches: { expression: string; value: string; error?: string }[]
}

export interface UsageResult {
  name: string
  fromFile?: string
  loading: boolean
  references: CodeReference[]
}

export interface Settings {
  themeId: string
  fontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: boolean
  minimap: boolean
  lineNumbers: boolean
  inlayHints: boolean
  showBlame: boolean
  autoSave: boolean
  formatOnSave: boolean
  aiProvider: AiProvider
  aiModel: string
  aiPermissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  browserHome: string
  iconPack: 'nova' | 'classic' | 'minimal'
  sidebarWidth: number
  aiWidth: number
  panelHeight: number
}

export const defaultSettings: Settings = {
  themeId: defaultThemeId,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  inlayHints: true,
  showBlame: false,
  autoSave: false,
  formatOnSave: false,
  aiProvider: 'claude',
  aiModel: '',
  aiPermissionMode: 'acceptEdits',
  browserHome: 'http://localhost:3000',
  iconPack: 'nova',
  sidebarWidth: 260,
  aiWidth: 400,
  panelHeight: 220,
}

interface State {
  ready: boolean
  root: string | null
  recents: RecentProject[]
  settings: Settings

  tabs: Tab[]
  activeTabId: string | null
  buffers: Record<string, Buffer>

  sidebarView: SidebarView
  sidebarVisible: boolean
  aiVisible: boolean
  panelVisible: boolean
  panelTab: 'terminal' | 'problems' | 'usages' | 'hierarchy' | 'tests' | 'debug'

  indexStatus: IndexStatus | null
  usages: UsageResult | null
  hierarchy: HierarchyResult | null
  lspServers: LspServerStatus[]
  testFrameworks: TestFrameworkInfo[]
  testRun: TestRunState | null
  debug: DebugUiState

  expanded: Record<string, boolean>
  treeVersion: number

  git: GitStatus | null
  commits: GitCommit[]
  gitBusy: boolean

  providers: ProviderInfo[]
  messages: AiMessage[]
  aiRunning: boolean
  aiSessionId: Record<AiProvider, string | undefined>

  paletteOpen: boolean
  paletteMode: PaletteMode
  editPreview: import('@/lib/editPreview').EditPreview | null
  /** Parameter dialog for the refactoring under way, if any. */
  refactorDialog: import('@/lib/refactor/bridge').RefactorDialogState | null
  /** The ⌃T "Refactor This" popup. */
  refactorMenuOpen: boolean
  /** Generated walkthroughs, keyed by the file they describe. */
  explain: Record<string, ExplainDoc>
  toast: { text: string; tone: 'info' | 'error' | 'success' } | null

  init: () => Promise<void>
  setSettings: (patch: Partial<Settings>) => void
  openProject: (path: string) => Promise<void>
  pickProject: () => Promise<void>

  openFile: (
    path: string,
    opts?: { preview?: boolean; line?: number; column?: number },
  ) => Promise<void>
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateBuffer: (path: string, content: string) => void
  saveBuffer: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  reloadBuffer: (path: string) => Promise<void>

  setSidebarView: (view: SidebarView) => void
  toggleSidebar: () => void
  toggleAi: () => void
  togglePanel: (tab?: State['panelTab']) => void
  /** Always reveals the panel on `tab` — never toggles it shut. */
  showPanel: (tab: State['panelTab']) => void
  toggleExpanded: (path: string) => void
  setExpanded: (path: string, value: boolean) => void
  bumpTree: () => void

  refreshGit: () => Promise<void>
  refreshCommits: () => Promise<void>

  buildIndex: () => Promise<void>
  setIndexStatus: (status: IndexStatus) => void
  setLspServers: (servers: LspServerStatus[]) => void
  restartLspServer: (id: string) => Promise<void>
  findUsages: (name: string, fromFile?: string) => Promise<void>
  clearUsages: () => void

  showHierarchy: (
    mode: HierarchyMode,
    file: string,
    line: number,
    column: number,
  ) => Promise<void>
  setHierarchyMode: (mode: HierarchyMode) => Promise<void>
  toggleHierarchyNode: (id: string) => Promise<void>

  detectDebugAdapters: () => Promise<void>
  setDebugState: (state: DebugState) => void
  appendDebugOutput: (text: string) => void
  startDebug: (program?: string) => Promise<void>
  toggleBreakpoint: (file: string, line: number) => Promise<void>
  addWatch: (expression: string) => Promise<void>
  removeWatch: (expression: string) => void
  refreshWatches: () => Promise<void>

  detectTestFrameworks: () => Promise<void>
  runTests: (scope: { kind: 'all' | 'file' | 'name'; file?: string; name?: string }, frameworkId?: string) => Promise<void>
  applyTestEvents: (update: { runId: string; framework: string; command: string; events: TestEvent[]; done?: { exitCode: number | null; durationMs: number } }) => void
  cancelTests: () => Promise<void>

  setProviders: (p: ProviderInfo[]) => void
  addMessage: (m: AiMessage) => void
  patchMessage: (id: string, patch: (m: AiMessage) => AiMessage) => void
  setAiRunning: (running: boolean) => void
  setSession: (provider: AiProvider, id: string) => void
  clearConversation: () => void

  setPalette: (open: boolean, mode?: PaletteMode) => void

  explainFile: (path: string, depth?: import('@/lib/explain').ExplainDepth) => Promise<void>
  stopExplain: (path: string) => Promise<void>
  patchExplain: (runId: string, patch: (doc: ExplainDoc) => ExplainDoc) => void
  notify: (text: string, tone?: 'info' | 'error' | 'success') => void
}

const nova = () => window.nova

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  ready: false,
  root: null,
  recents: [],
  settings: defaultSettings,

  tabs: [],
  activeTabId: null,
  buffers: {},

  sidebarView: 'explorer',
  sidebarVisible: true,
  aiVisible: true,
  panelVisible: false,
  panelTab: 'terminal',

  expanded: {},
  treeVersion: 0,

  git: null,
  commits: [],
  gitBusy: false,

  indexStatus: null,
  usages: null,
  hierarchy: null,
  lspServers: [],
  testFrameworks: [],
  testRun: null,
  debug: { adapters: [], state: null, output: '', watches: [] },

  providers: [],
  messages: [],
  aiRunning: false,
  aiSessionId: { claude: undefined, codex: undefined },

  paletteOpen: false,
  paletteMode: 'command',
  editPreview: null,
  refactorDialog: null,
  refactorMenuOpen: false,
  explain: {},
  toast: null,

  async init() {
    const stored = await nova().app.readSettings<Partial<Settings>>()
    const settings = { ...defaultSettings, ...(stored ?? {}) }
    applyTheme(getTheme(settings.themeId))
    const recents = await nova().app.recents()
    set({ settings, recents, ready: true })
    if (recents[0]) await get().openProject(recents[0].path)
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    if (patch.themeId) applyTheme(getTheme(patch.themeId))
    void nova().app.writeSettings(settings)
  },

  async openProject(requestedPath) {
    // Resolve symlinks first: git reports the real worktree path, and every
    // path comparison in the app (git decorations, diffs, blame) depends on
    // the two agreeing.
    const path = await nova().fs.realpath(requestedPath)
    set({
      root: path,
      tabs: [],
      activeTabId: null,
      buffers: {},
      expanded: { [path]: true },
      commits: [],
      messages: [],
      usages: null,
      indexStatus: null,
      aiSessionId: { claude: undefined, codex: undefined },
    })
    lspResetDocuments()
    const recents = await nova().app.addRecent(path)
    set({ recents })
    await nova().fs.watch(path)
    await nova().lsp.setRoot(path)
    void nova().lsp.detect().then((servers) => set({ lspServers: servers }))
    await get().refreshGit()
    void get().refreshCommits()
    void get().buildIndex()
    void get().detectTestFrameworks()
  },

  async pickProject() {
    const path = await nova().app.openFolderDialog()
    if (path) await get().openProject(path)
  },

  async openFile(path, opts) {
    const reveal = () =>
      window.dispatchEvent(
        new CustomEvent('nova:goto-line', {
          detail: { path, line: opts?.line, column: opts?.column },
        }),
      )

    const existing = get().tabs.find((t) => t.kind === 'file' && t.path === path)
    if (existing) {
      set({ activeTabId: existing.id })
      if (opts?.line) reveal()
      return
    }
    let buffer = get().buffers[path]
    if (!buffer) {
      const res = await nova().fs.read(path)
      buffer = {
        path,
        content: res.content,
        savedContent: res.content,
        binary: res.binary,
        mtimeMs: res.mtimeMs,
      }
      set({ buffers: { ...get().buffers, [path]: buffer } })
      if (!buffer.binary) lspDidOpen(path, buffer.content)
    }
    const isDiagram = path.endsWith('.nova-diagram.json')
    get().openTab({
      id: `file:${path}`,
      kind: isDiagram ? 'diagram' : 'file',
      title: isDiagram ? basename(path).replace('.nova-diagram.json', '') : basename(path),
      path,
      preview: opts?.preview,
    })
    if (opts?.line) setTimeout(reveal, 60)
  },

  openTab(tab) {
    const tabs = get().tabs
    const existing = tabs.find((t) => t.id === tab.id)
    if (existing) {
      set({
        tabs: tabs.map((t) => (t.id === tab.id ? { ...t, ...tab, preview: t.preview && tab.preview } : t)),
        activeTabId: tab.id,
      })
      return
    }
    // A preview tab (single click in the tree) replaces the previous preview tab.
    const withoutPreview = tab.preview ? tabs.filter((t) => !t.preview) : tabs
    set({ tabs: [...withoutPreview, tab], activeTabId: tab.id })
  },

  closeTab(id) {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((t) => t.id === id)
    if (index === -1) return
    const closing = tabs[index]
    const next = tabs.filter((t) => t.id !== id)
    // Tell the server only when no other tab still shows the file.
    if (closing.path && !next.some((t) => t.path === closing.path)) {
      lspDidClose(closing.path)
    }
    let nextActive = activeTabId
    if (activeTabId === id) {
      nextActive = next[index]?.id ?? next[index - 1]?.id ?? next[next.length - 1]?.id ?? null
    }
    set({ tabs: next, activeTabId: nextActive })
  },

  setActiveTab(id) {
    set({
      activeTabId: id,
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)),
    })
  },

  updateBuffer(path, content) {
    const buffer = get().buffers[path]
    if (!buffer) return
    set({ buffers: { ...get().buffers, [path]: { ...buffer, content } } })
    lspDidChange(path, content)
    if (get().settings.autoSave) void get().saveBuffer(path)
  },

  async saveBuffer(path) {
    const buffer = get().buffers[path]
    if (!buffer || buffer.content === buffer.savedContent) return
    await nova().fs.write(path, buffer.content)
    set({
      buffers: {
        ...get().buffers,
        [path]: { ...buffer, savedContent: buffer.content, mtimeMs: Date.now() },
      },
    })
    lspDidSave(path, buffer.content)
    void get().refreshGit()
  },

  async saveAll() {
    const dirty = Object.values(get().buffers).filter((b) => b.content !== b.savedContent)
    await Promise.all(dirty.map((b) => get().saveBuffer(b.path)))
  },

  async reloadBuffer(path) {
    const buffer = get().buffers[path]
    if (!buffer) return
    const res = await nova().fs.read(path)
    set({
      buffers: {
        ...get().buffers,
        [path]: {
          ...buffer,
          content: res.content,
          savedContent: res.content,
          mtimeMs: res.mtimeMs,
        },
      },
    })
  },

  setSidebarView(view) {
    const { sidebarView, sidebarVisible } = get()
    if (sidebarView === view && sidebarVisible) set({ sidebarVisible: false })
    else set({ sidebarView: view, sidebarVisible: true })
  },

  toggleSidebar() {
    set({ sidebarVisible: !get().sidebarVisible })
  },

  toggleAi() {
    set({ aiVisible: !get().aiVisible })
  },

  togglePanel(tab) {
    const { panelVisible, panelTab } = get()
    if (tab && tab !== panelTab) set({ panelTab: tab, panelVisible: true })
    else set({ panelVisible: !panelVisible })
  },

  showPanel(tab) {
    set({ panelTab: tab, panelVisible: true })
  },

  toggleExpanded(path) {
    set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } })
  },

  setExpanded(path, value) {
    set({ expanded: { ...get().expanded, [path]: value } })
  },

  bumpTree() {
    set({ treeVersion: get().treeVersion + 1 })
  },

  async refreshGit() {
    const root = get().root
    if (!root) return
    const git = await nova().git.status(root)
    set({ git })
  },

  async refreshCommits() {
    const root = get().root
    if (!root) return
    set({ gitBusy: true })
    const commits = await nova().git.log(root, 300)
    set({ commits, gitBusy: false })
  },

  async buildIndex() {
    const root = get().root
    if (!root) return
    const status = await nova().code.build(root)
    set({ indexStatus: status })
  },

  setIndexStatus(status) {
    set({ indexStatus: status })
  },

  setLspServers(servers) {
    set({ lspServers: servers })
  },

  async restartLspServer(id) {
    await nova().lsp.restart(id)
    lspResetDocuments()
    // Re-open everything the user has on screen so the new process sees them.
    for (const buffer of Object.values(get().buffers)) {
      lspDidOpen(buffer.path, buffer.content)
    }
    set({ lspServers: await nova().lsp.status() })
  },

  async findUsages(name, fromFile) {
    if (!name) return
    set({
      usages: { name, fromFile, loading: true, references: [] },
      panelVisible: true,
      panelTab: 'usages',
    })
    const references = await nova().code.references(name, fromFile)
    // A newer query may have started while this one was in flight.
    if (get().usages?.name !== name) return
    set({ usages: { name, fromFile, loading: false, references } })
  },

  clearUsages() {
    set({ usages: null })
  },

  async showHierarchy(mode, file, line, column) {
    const { fetchChildren, prepareRoot } = await import('@/lib/hierarchy')
    const { languageForPath } = await import('@/lib/language')
    const language = languageForPath(file)

    set({
      hierarchy: {
        mode,
        language,
        rootName: '',
        origin: { file, line, column },
        loading: true,
        nodes: [],
      },
      panelVisible: true,
      panelTab: 'hierarchy',
    })

    const fail = (error: string, supported?: HierarchyResult['supported']) =>
      set({
        hierarchy: {
          mode,
          language,
          rootName: '',
          origin: { file, line, column },
          loading: false,
          error,
          nodes: [],
          supported,
        },
      })

    // Ask the server what it actually implements, so an unsupported mode reads
    // as a clear limitation rather than an empty result.
    const info = await nova().lsp.capabilities(language)
    if (!info) {
      fail(
        `No language server is running for ${language}. Install one from Settings › Language servers to use hierarchies.`,
      )
      return
    }
    const supported = {
      calls: Boolean(info.capabilities?.callHierarchyProvider),
      types: Boolean(info.capabilities?.typeHierarchyProvider),
    }
    const isCall = mode === 'callers' || mode === 'callees'
    if ((isCall && !supported.calls) || (!isCall && !supported.types)) {
      fail(
        `${info.id} does not implement ${isCall ? 'call' : 'type'} hierarchy.`,
        supported,
      )
      return
    }

    const root = await prepareRoot(mode, language, file, line, column)
    if (!root) {
      fail('Nothing to show here — put the caret on a function or type name.', supported)
      return
    }

    const children = await fetchChildren(mode, language, root.item)
    set({
      hierarchy: {
        mode,
        language,
        rootName: root.name,
        origin: { file, line, column },
        loading: false,
        nodes: [{ ...root, children, expanded: true }],
        supported,
      },
    })
  },

  async setHierarchyMode(mode) {
    const current = get().hierarchy
    if (!current) return
    await get().showHierarchy(
      mode,
      current.origin.file,
      current.origin.line,
      current.origin.column,
    )
  },

  async toggleHierarchyNode(id) {
    const { fetchChildren, findNode, mapNode } = await import('@/lib/hierarchy')
    const current = get().hierarchy
    if (!current) return
    const node = findNode(current.nodes, id)
    if (!node) return

    if (node.expanded) {
      set({
        hierarchy: {
          ...current,
          nodes: mapNode(current.nodes, id, (n) => ({ ...n, expanded: false })),
        },
      })
      return
    }

    if (node.children) {
      set({
        hierarchy: {
          ...current,
          nodes: mapNode(current.nodes, id, (n) => ({ ...n, expanded: true })),
        },
      })
      return
    }

    set({
      hierarchy: {
        ...current,
        nodes: mapNode(current.nodes, id, (n) => ({ ...n, loading: true })),
      },
    })
    const children = await fetchChildren(current.mode, current.language, node.item)
    const latest = get().hierarchy
    if (!latest) return
    set({
      hierarchy: {
        ...latest,
        nodes: mapNode(latest.nodes, id, (n) => ({
          ...n,
          children,
          expanded: true,
          loading: false,
        })),
      },
    })
  },

  async detectDebugAdapters() {
    const adapters = await nova().debug.detect()
    set({ debug: { ...get().debug, adapters } })
  },

  setDebugState(state) {
    set({ debug: { ...get().debug, state } })
    if (state.status === 'paused') void get().refreshWatches()
  },

  appendDebugOutput(text) {
    const debug = get().debug
    const output = (debug.output + text).slice(-200_000)
    set({ debug: { ...debug, output } })
  },

  async startDebug(program) {
    const root = get().root
    if (!root) return
    const active = get().tabs.find((t) => t.id === get().activeTabId)
    const file = program ?? active?.path
    if (!file) {
      get().notify('Open the file you want to debug first', 'error')
      return
    }
    const { languageForPath } = await import('@/lib/language')
    const language = languageForPath(file)
    const adapter = get().debug.adapters.find(
      (a) => a.installed && a.languages.includes(language),
    )
    if (!adapter) {
      get().notify(
        `No debug adapter installed for ${language} — see Settings › Debuggers`,
        'error',
      )
      return
    }
    set({
      debug: { ...get().debug, output: '' },
      panelVisible: true,
      panelTab: 'debug',
    })
    await nova().debug.launch({
      language,
      program: file,
      cwd: root,
      adapterId: adapter.id,
      stopOnEntry: false,
    })
  },

  async toggleBreakpoint(file, line) {
    await nova().debug.toggleBreakpoint(file, line)
  },

  async addWatch(expression) {
    const debug = get().debug
    if (!expression.trim() || debug.watches.some((w) => w.expression === expression)) return
    set({
      debug: { ...debug, watches: [...debug.watches, { expression, value: '' }] },
    })
    await get().refreshWatches()
  },

  removeWatch(expression) {
    const debug = get().debug
    set({ debug: { ...debug, watches: debug.watches.filter((w) => w.expression !== expression) } })
  },

  async refreshWatches() {
    const debug = get().debug
    if (debug.watches.length === 0) return
    const frameId = debug.state?.currentFrameId ?? undefined
    const watches = await Promise.all(
      debug.watches.map(async (watch) => {
        const result = await nova().debug.evaluate(watch.expression, frameId, 'watch')
        return {
          expression: watch.expression,
          value: result.result,
          error: result.error || undefined,
        }
      }),
    )
    set({ debug: { ...get().debug, watches } })
  },

  async detectTestFrameworks() {
    const root = get().root
    if (!root) return
    set({ testFrameworks: await nova().tests.detect(root) })
  },

  async runTests(scope, frameworkId) {
    const root = get().root
    if (!root) return
    const framework = frameworkId ?? get().testFrameworks[0]?.id
    if (!framework) {
      get().notify('No test framework detected in this project', 'error')
      return
    }
    set({
      testRun: {
        runId: '',
        framework,
        command: '',
        running: true,
        cases: [],
        output: '',
      },
      panelVisible: true,
      panelTab: 'tests',
    })
    const { runId } = await nova().tests.run(root, framework, scope)
    const run = get().testRun
    if (run) set({ testRun: { ...run, runId } })
  },

  applyTestEvents(update) {
    const previous = get().testRun
    // A stale run's events must not overwrite a newer one.
    if (previous && previous.runId && update.runId !== previous.runId) return

    const cases = [...(previous?.cases ?? [])]
    let output = previous?.output ?? ''

    for (const event of update.events) {
      if (event.type === 'output') {
        output += event.text
        continue
      }
      const index = cases.findIndex((c) => c.id === event.id)
      if (event.type === 'start') {
        if (index === -1) {
          cases.push({ id: event.id, name: event.name, suite: event.suite, status: 'running' })
        }
        continue
      }
      const next: TestCase = {
        id: event.id,
        name: event.name,
        suite: event.suite,
        status: event.status,
        durationMs: event.durationMs,
        message: event.message,
      }
      if (index === -1) cases.push(next)
      else cases[index] = { ...cases[index], ...next }
    }

    // Cap retained output so a chatty suite cannot grow without bound.
    if (output.length > 400_000) output = output.slice(output.length - 400_000)

    set({
      testRun: {
        runId: update.runId,
        framework: update.framework || previous?.framework || '',
        command: update.command || previous?.command || '',
        running: !update.done,
        cases,
        output,
        exitCode: update.done?.exitCode ?? previous?.exitCode,
        durationMs: update.done?.durationMs ?? previous?.durationMs,
      },
    })
  },

  async cancelTests() {
    await nova().tests.cancel()
    const run = get().testRun
    if (run) set({ testRun: { ...run, running: false } })
  },

  setProviders(providers) {
    set({ providers })
  },

  addMessage(message) {
    set({ messages: [...get().messages, message] })
  },

  patchMessage(id, patch) {
    set({ messages: get().messages.map((m) => (m.id === id ? patch(m) : m)) })
  },

  setAiRunning(running) {
    set({ aiRunning: running })
  },

  setSession(provider, id) {
    set({ aiSessionId: { ...get().aiSessionId, [provider]: id } })
  },

  clearConversation() {
    set({ messages: [], aiSessionId: { claude: undefined, codex: undefined } })
  },

  setPalette(open, mode) {
    set({ paletteOpen: open, paletteMode: mode ?? get().paletteMode })
  },

  /**
   * Starts a read-only agent run that documents `path`, and opens a tab that
   * renders the answer as it streams.
   *
   * The run is deliberately not part of the AI console conversation: it gets no
   * `resumeSessionId`, so a walkthrough never inherits — or pollutes — whatever
   * the user was discussing in the panel.
   */
  async explainFile(path, depth = 'system') {
    const { root, settings, providers } = get()
    if (!root) return
    const provider = providers.find((p) => p.id === settings.aiProvider)
    if (provider && !provider.available) {
      get().notify(`${provider.label} is not installed — ${provider.hint}`, 'error')
      return
    }

    const previous = get().explain[path]
    if (previous?.status === 'running' && previous.runId) {
      await nova().ai.cancel(previous.runId)
    }

    const tabId = `explain:${path}`
    get().openTab({
      id: tabId,
      kind: 'explain',
      title: `${basename(path)} — explained`,
      path,
      subtitle: `Generated walkthrough of ${path}`,
    })

    set({
      explain: {
        ...get().explain,
        [path]: {
          path,
          provider: settings.aiProvider,
          depth,
          content: '',
          thinking: '',
          status: 'running',
          startedAt: Date.now(),
        },
      },
    })

    try {
      const { buildExplainPrompt } = await import('@/lib/explain')
      const { languageForPath } = await import('@/lib/language')
      const { runId } = await nova().ai.start({
        provider: settings.aiProvider,
        prompt: buildExplainPrompt({
          relativePath: path.startsWith(root) ? path.slice(root.length + 1) : path,
          language: languageForPath(path),
          depth,
        }),
        cwd: root,
        model: settings.aiModel || undefined,
        attachments: [path],
        // Read-only: a walkthrough must never rewrite the thing it describes.
        permissionMode: 'plan',
      })
      set({
        explain: { ...get().explain, [path]: { ...get().explain[path], runId } },
      })
      await nova().ai.ack(runId)
    } catch (error) {
      set({
        explain: {
          ...get().explain,
          [path]: {
            ...get().explain[path],
            status: 'error',
            error: (error as Error).message,
            finishedAt: Date.now(),
          },
        },
      })
    }
  },

  async stopExplain(path) {
    const doc = get().explain[path]
    if (!doc?.runId) return
    await nova().ai.cancel(doc.runId)
    set({
      explain: {
        ...get().explain,
        [path]: { ...doc, status: 'done', finishedAt: Date.now() },
      },
    })
  },

  patchExplain(runId, patch) {
    const entries = Object.entries(get().explain)
    const found = entries.find(([, doc]) => doc.runId === runId)
    if (!found) return
    const [path, doc] = found
    set({ explain: { ...get().explain, [path]: patch(doc) } })
  },

  notify(text, tone = 'info') {
    set({ toast: { text, tone } })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 4200)
  },
}))

export function activeTab() {
  const { tabs, activeTabId } = useStore.getState()
  return tabs.find((t) => t.id === activeTabId) ?? null
}
