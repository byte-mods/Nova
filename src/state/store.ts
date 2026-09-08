import { providerStateLabel } from '@shared/aiProviders'
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
import type { CoverageReport } from '@shared/coverage'
import type { ChatSummary, Plan, StoredChat } from '@shared/chat'
import type { AutoRunState } from '@/lib/autoRun'
import type {
  InstalledPlugin,
  PluginInstallProgress,
  PluginLogEvent,
  PluginPermission,
  PluginRuntimeState,
} from '@shared/plugin'
import { applyTheme, defaultThemeId, getTheme } from '@/theme/themes'
import { basename } from '@/lib/paths'
import { languageForPath } from '@/lib/language'
import { settleMessages } from '@/lib/chatMessages'

/** Console lines kept from the browser pane, for the assistant to read back. */
const MAX_BROWSER_CONSOLE = 300
import { lspDidChange, lspDidClose, lspDidOpen, lspDidSave, lspResetDocuments } from '@/lib/lspSync'

export type TabKind =
  | 'file'
  | 'diff'
  | 'diagram'
  | 'browser'
  | 'settings'
  | 'commit'
  | 'history'
  | 'explain'
  | 'tutorial'
  | 'http'
  | 'database'
  | 'merge'
  | 'linehistory'
  | 'scratch'
  | 'inspect'
  | 'runconfigs'
  | 'projectmodel'

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
  /** Which editor group shows this tab. */
  group?: GroupId
  /** Pinned tabs resist Close Others and sort to the front. */
  pinned?: boolean
  /** For `linehistory` tabs: the 1-based selection the history was asked for. */
  lineRange?: { from: number; to: number }
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

/**
 * A generated walkthrough of the whole project.
 *
 * Kept as a single document rather than a map like `explain`, because there is
 * only ever one project open: asking for a second chapter replaces the first
 * rather than accumulating tabs the reader has to manage.
 */
export interface TutorialDoc {
  chapter: import('@/lib/tutorial').TutorialChapterId
  runId?: string
  provider: AiProvider
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
  /**
   * The buffer holds a representation of the file, not the file.
   *
   * True for a file too large to load, and for one whose bytes are not text.
   * Either way `content` cannot be written back, so the editor shows it rather
   * than offering it for editing and `saveBuffer` refuses it outright.
   */
  readOnly?: boolean
  /** Why it is read-only, for the banner the editor shows in its place. */
  readOnlyReason?: 'too-large' | 'binary'
  /** Size on disk, when the file was too large to load. */
  size?: number
}

export type SidebarView =
  | 'explorer'
  | 'search'
  | 'structural'
  | 'git'
  | 'diagrams'
  | 'plugins'
  | 'themes'

export type PaletteMode =
  | 'command'
  | 'file'
  | 'symbol'
  | 'recent'
  | 'structure'
  | 'bookmarks'
  | 'everywhere'
  | 'locations'

/** One caret position the user actually visited, for Recent Locations. */
export interface RecentLocation {
  file: string
  /** 1-based. */
  line: number
  column: number
  /** The source line at the time, so the list reads like code. */
  preview: string
  at: number
}

/** Editor groups. A split adds a second one; there are never more than two. */
export type GroupId = 'main' | 'right'

/**
 * A fresh, provider-complete session map.
 *
 * A function rather than a shared constant so no caller can mutate the blank
 * one, and written out per provider rather than built from a list so that
 * adding a provider is a type error here instead of a silent `undefined`.
 */
const noSessions = (): Record<AiProvider, string | undefined> => ({
  claude: undefined,
  codex: undefined,
  opencode: undefined,
  kimi: undefined,
  gemini: undefined,
  glm: undefined,
  deepseek: undefined,
})

export interface Bookmark {
  file: string
  /** 1-based. */
  line: number
  /** The source line at the time it was set, for the list. */
  preview: string
  /** IntelliJ's mnemonic: 0-9 jumps straight to it. */
  mnemonic?: string
}

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
  /** Per-provider endpoint overrides for the Anthropic-compatible vendors. */
  aiBaseUrls?: Partial<Record<AiProvider, string>>
  /** Open files the assistant edits, so the change can be watched as it lands. */
  aiFollowEdits?: boolean
  /** Reasoning effort, for the CLIs that accept one. */
  aiEffort?: string
  /**
   * Keep the agent going until the task is finished, rather than one turn at a
   * time.
   *
   * Off by default, and deliberately so: it spends the user's tokens without
   * asking between turns, which has to be a thing someone chooses rather than
   * something they discover on a bill.
   */
  aiAutoRun?: boolean
  /**
   * Hard ceiling on turns in an automatic run. `0` runs uncapped.
   *
   * Uncapped is the default because the stall guard is the real protection — a
   * run that stops changing files ends on its own — and a fixed number is
   * always either too small for the task that needed it or too large to be a
   * safeguard. The Stop button ends any run immediately.
   */
  aiAutoMaxIterations?: number
  /**
   * Models the user has actually used, per provider.
   *
   * Any list shipped with the editor is stale the week after it is written —
   * vendors release models faster than releases go out, and being unable to
   * pick one because Nova has not heard of it is a wall. What someone types
   * once is offered from then on, so the suggestions track reality instead of
   * whatever was true when this file was last edited.
   */
  aiRecentModels?: Partial<Record<AiProvider, string[]>>
  browserHome: string
  iconPack: 'nova' | 'classic' | 'minimal'
  /** Master switch for the built-in inspections. */
  inspectionsEnabled: boolean
  /** Severity overrides by rule id; absent means the rule's own default. */
  inspectionProfile: Record<string, 'error' | 'warning' | 'info' | 'off'>
  /** User-defined live templates, merged with the built-ins. */
  userTemplates: import('@/lib/templates').LiveTemplate[]
  /**
   * Code style, applied when formatting and when saving. `.editorconfig` in the
   * project overrides it per file — see `@/lib/format`.
   */
  codeStyle: import('@/lib/format/style').CodeStyle
  /** Run Optimize Imports as part of format-on-save. */
  optimizeImportsOnSave: boolean
  /** The symbol path bar above the editor. */
  breadcrumbs: boolean
  /** Inline usage counts above declarations (code vision). */
  codeVision: boolean
  /**
   * User keymap: action id -> combo like `mod+shift+f`. Absent means the
   * default binding; an empty string unbinds the action.
   */
  keymap: Record<string, string>
  /**
   * Saved search scopes: named file masks for Find in Project. `!pattern`
   * entries exclude, e.g. `src/**, !**\/*.test.ts`.
   */
  searchScopes: { name: string; mask: string }[]
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
  aiBaseUrls: {},
  aiFollowEdits: true,
  aiEffort: '',
  aiAutoRun: false,
  aiAutoMaxIterations: 0,
  aiRecentModels: {},
  browserHome: 'http://localhost:3000',
  iconPack: 'nova',
  inspectionsEnabled: true,
  inspectionProfile: {},
  userTemplates: [],
  codeStyle: {
    indentSize: 2,
    useTabs: false,
    maxLineLength: 100,
    trimTrailingWhitespace: true,
    insertFinalNewline: true,
    maxBlankLines: 2,
    reindent: false,
    normalizeSpacing: true,
    importOrder: 'alphabetical',
    removeUnusedImports: true,
    groupImports: true,
    endOfLine: 'lf',
  },
  optimizeImportsOnSave: false,
  breadcrumbs: true,
  codeVision: true,
  keymap: {},
  searchScopes: [
    { name: 'Production code', mask: '!**/*.test.*, !**/*.spec.*, !**/test/**, !**/tests/**, !**/__tests__/**' },
    { name: 'Tests only', mask: '**/*.test.*, **/*.spec.*, **/test/**, **/tests/**, **/__tests__/**' },
  ],
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

  /** Open editor groups, left to right. A single group means no split. */
  groups: GroupId[]
  activeGroup: GroupId
  /** The active tab within each group. */
  groupActive: Record<GroupId, string | null>
  /** Most-recently-used file paths, newest first. */
  recentFiles: string[]
  /** Caret positions visited, newest first — Recent Locations (⇧⌘E). */
  recentLocations: RecentLocation[]
  bookmarks: Bookmark[]
  /** Caret position in the active editor, 1-based. */
  cursor: { line: number; column: number }

  sidebarView: SidebarView
  sidebarVisible: boolean
  aiVisible: boolean
  panelVisible: boolean
  panelTab: 'terminal' | 'problems' | 'usages' | 'hierarchy' | 'tests' | 'debug' | 'todo' | 'coverage' | 'build' | 'profile' | 'infra' | 'security' | 'devices'

  /** Last loaded coverage report, or null when none has been produced. */
  coverage: CoverageReport | null
  coverageLoading: boolean
  /** Draw uncovered-line markers in the editor gutter. */
  coverageVisible: boolean

  /** Installed plugins, mirrored from the main process. */
  plugins: InstalledPlugin[]
  /** What each running plugin registered at activation. */
  pluginRuntime: PluginRuntimeState[]
  /** Host log, newest last. Capped so a chatty plugin cannot grow it forever. */
  pluginLog: PluginLogEvent[]
  /** Live progress while a git install runs, or null when idle. */
  pluginInstall: PluginInstallProgress | null
  /** HTML each plugin view last rendered, keyed `pluginId:viewId`. */
  pluginViewHtml: Record<string, string>

  /** Project-wide Inspect Code run, or null before the first one. */
  inspectRun: {
    running: boolean
    scanned: number
    total: number
    findings: import('@/lib/inspections/batch').BatchFinding[]
    startedAt: number
    finishedAt?: number
  } | null

  indexStatus: IndexStatus | null
  usages: UsageResult | null
  hierarchy: HierarchyResult | null
  lspServers: LspServerStatus[]
  testFrameworks: TestFrameworkInfo[]
  testRun: TestRunState | null
  /** Finished runs, newest first, for the Tests panel's history dropdown. */
  testHistory: TestRunState[]
  debug: DebugUiState

  expanded: Record<string, boolean>
  treeVersion: number

  git: GitStatus | null
  commits: GitCommit[]
  gitBusy: boolean

  providers: ProviderInfo[]
  /** Saved conversations for this project, newest first. */
  chats: ChatSummary[]
  /** Which conversation `messages` belongs to. */
  activeChatId: string | null
  /** The plan awaiting approval or being executed in the active chat. */
  plan: Plan | null
  /** Every plan this conversation produced, oldest first. */
  plans: Plan[]
  messages: AiMessage[]
  aiRunning: boolean
  /**
   * The automatic run in flight, for the console to draw progress from.
   *
   * A mirror of the ref that actually drives the loop: the loop needs a value
   * that does not go stale inside a subscription, and the UI needs one that
   * re-renders. Keeping both is cheaper than making either do the other's job.
   */
  autoRun: AutoRunState | null
  /** Set by Stop, so the loop does not start another turn after the kill. */
  aiAutoCancelled: boolean
  /**
   * Recent console output from the browser pane, oldest first.
   *
   * Kept so the assistant can read it: a page that throws on load is the single
   * most useful thing to hand back when it asks why its change did not work,
   * and a `<webview>` gets no preload, so this is the only place the messages
   * can be collected. Bounded, because a page in a render loop would otherwise
   * grow it without limit.
   */
  browserConsole: { level: string; text: string; at: number }[]
  /**
   * The run the console is currently waiting on.
   *
   * In the store rather than in a component ref because the console unmounts
   * whenever it is toggled with ⌘I, and a ref lost at that moment left
   * `aiRunning` stuck true with nothing able to clear it.
   */
  activeRunId: string | null
  aiSessionId: Record<AiProvider, string | undefined>

  paletteOpen: boolean
  paletteMode: PaletteMode
  /**
   * A file mask handed to the Search pane, and a query handed to the palette,
   * by whoever opened them — the Explorer's "Find in Folder" and "Find File by
   * Name".
   *
   * State rather than a DOM event because the sender switches to the pane and
   * seeds it in the same tick: an event would be dispatched before the listener
   * mounts and silently do nothing. The consumer clears the value once applied.
   */
  pendingSearchMask: string | null
  pendingPaletteQuery: string | null
  editPreview: import('@/lib/editPreview').EditPreview | null
  /** Parameter dialog for the refactoring under way, if any. */
  refactorDialog: import('@/lib/refactor/bridge').RefactorDialogState | null
  /** The ⌃T "Refactor This" popup. */
  refactorMenuOpen: boolean
  /** Generated walkthroughs, keyed by the file they describe. */
  explain: Record<string, ExplainDoc>
  /** The project-wide tutorial, if one has been generated this session. */
  tutorial: TutorialDoc | null
  /** Breakpoint properties dialog, opened from the gutter. */
  breakpointDialog: { file: string; line: number } | null
  /**
   * Files that changed on disk while their buffer had unsaved edits. Silently
   * dropping the disk version is how work gets lost, so it is surfaced.
   */
  externalChanges: Record<string, { diskContent: string; noticedAt: number }>
  toast: { text: string; tone: 'info' | 'error' | 'success' } | null

  init: () => Promise<void>
  setSettings: (patch: Partial<Settings>) => void
  openProject: (path: string) => Promise<void>
  pickProject: () => Promise<void>

  openFile: (
    path: string,
    opts?: {
      preview?: boolean
      line?: number
      column?: number
      /**
       * Open the tab without moving focus to it.
       *
       * For edits arriving from an agent: the file should appear so it can be
       * watched, but taking the editor away from someone mid-read — five times
       * in as many seconds during a multi-file turn — is worse than not showing
       * it at all.
       */
      background?: boolean
    },
  ) => Promise<void>
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  togglePinTab: (id: string) => void
  moveTab: (id: string, beforeId: string | null) => void
  splitEditor: () => void
  closeSplit: () => void
  setActiveGroup: (group: GroupId) => void
  moveTabToGroup: (id: string, group: GroupId) => void
  toggleBookmark: (file?: string, line?: number) => void
  removeBookmark: (file: string, line: number) => void
  noteRecentFile: (path: string) => void
  noteLocation: (file: string, line: number, column: number) => void
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

  /** Runs every inspection over the whole project into the Inspect tab. */
  runInspectCode: () => Promise<void>
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
  runTests: (
    scope: { kind: 'all' | 'file' | 'name' | 'names'; file?: string; name?: string; names?: string[] },
    frameworkId?: string,
    options?: { coverage?: boolean },
  ) => Promise<void>
  /** Reruns only the failures of the current (or given) run. */
  rerunFailedTests: () => Promise<void>
  /** Shows a past run from the history without executing anything. */
  showTestRun: (runId: string) => void
  applyTestEvents: (update: { runId: string; framework: string; command: string; events: TestEvent[]; done?: { exitCode: number | null; durationMs: number } }) => void
  cancelTests: () => Promise<void>

  setProviders: (p: ProviderInfo[]) => void
  addMessage: (m: AiMessage) => void
  patchMessage: (id: string, patch: (m: AiMessage) => AiMessage) => void
  setAiRunning: (running: boolean) => void
  setAutoRun: (run: AutoRunState | null) => void
  setAiAutoCancelled: (cancelled: boolean) => void
  pushBrowserConsole: (level: string, text: string) => void
  setSession: (provider: AiProvider, id: string) => void
  clearConversation: () => void
  loadChats: () => Promise<void>
  newChat: () => Promise<void>
  switchChat: (id: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  persistChat: () => Promise<void>
  schedulePersist: () => void
  /** Pending debounced save, so a burst of tokens writes once. */
  persistTimer: ReturnType<typeof setTimeout> | null
  setPlan: (plan: Plan | null) => void
  discardPlan: () => void
  patchPlan: (id: string, patch: (plan: Plan) => Plan) => void

  setPalette: (open: boolean, mode?: PaletteMode) => void
  searchInFolder: (dir: string) => void
  findFileIn: (dir: string) => void

  explainFile: (path: string, depth?: import('@/lib/explain').ExplainDepth) => Promise<void>
  stopExplain: (path: string) => Promise<void>
  patchExplain: (runId: string, patch: (doc: ExplainDoc) => ExplainDoc) => void

  generateTutorial: (
    chapter?: import('@/lib/tutorial').TutorialChapterId,
    provider?: AiProvider,
  ) => Promise<void>
  stopTutorial: () => Promise<void>
  patchTutorial: (runId: string, patch: (doc: TutorialDoc) => TutorialDoc) => void

  loadCoverage: (file?: string) => Promise<void>
  toggleCoverageVisible: () => void

  refreshPlugins: () => Promise<void>
  installPlugin: (
    url: string,
    options?: { ref?: string; permissions?: PluginPermission[]; force?: boolean; allowBuild?: boolean },
  ) => Promise<boolean>
  updatePluginById: (id: string) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
  uninstallPlugin: (id: string) => Promise<void>
  grantPluginPermissions: (id: string, permissions: PluginPermission[]) => Promise<void>
  runPluginCommand: (pluginId: string, commandId: string) => Promise<void>
  appendPluginLog: (event: PluginLogEvent) => void
  setPluginInstall: (progress: PluginInstallProgress | null) => void
  setPluginViewHtml: (pluginId: string, viewId: string, html: string) => void

  noteExternalChange: (path: string) => Promise<void>
  resolveExternalChange: (path: string, action: 'reload' | 'keep' | 'compare') => Promise<void>
  notify: (text: string, tone?: 'info' | 'error' | 'success') => void
}

const nova = () => window.nova

let toastTimer: ReturnType<typeof setTimeout> | undefined

/** Longer than any suite worth waiting on, and finite, which is the point. */
const COVERAGE_POLL_TIMEOUT_MS = 30 * 60_000

export const useStore = create<State>((set, get) => ({
  ready: false,
  root: null,
  recents: [],
  settings: defaultSettings,

  tabs: [],
  activeTabId: null,
  buffers: {},

  groups: ['main'],
  activeGroup: 'main',
  groupActive: { main: null, right: null },
  recentFiles: [],
  recentLocations: [],
  bookmarks: [],
  cursor: { line: 0, column: 0 },

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

  coverage: null,
  coverageLoading: false,
  coverageVisible: true,

  plugins: [],
  pluginRuntime: [],
  pluginLog: [],
  pluginInstall: null,
  pluginViewHtml: {},

  inspectRun: null,
  indexStatus: null,
  usages: null,
  hierarchy: null,
  lspServers: [],
  testFrameworks: [],
  testRun: null,
  testHistory: [],
  debug: { adapters: [], state: null, output: '', watches: [] },

  providers: [],
  chats: [],
  activeChatId: null,
  plan: null,
  plans: [],
  persistTimer: null,
  messages: [],
  aiRunning: false,
  autoRun: null,
  aiAutoCancelled: false,
  browserConsole: [],
  activeRunId: null,
  aiSessionId: noSessions(),

  paletteOpen: false,
  paletteMode: 'command',
  pendingSearchMask: null,
  pendingPaletteQuery: null,
  editPreview: null,
  refactorDialog: null,
  refactorMenuOpen: false,
  explain: {},
  tutorial: null,
  breakpointDialog: null,
  externalChanges: {},
  toast: null,

  async init() {
    const stored = await nova().app.readSettings<Partial<Settings>>()
    const settings: Settings = {
      ...defaultSettings,
      ...(stored ?? {}),
      // Nested objects need merging rather than replacing, or a settings file
      // written by an older build drops every option added since.
      codeStyle: { ...defaultSettings.codeStyle, ...(stored?.codeStyle ?? {}) },
      inspectionProfile: { ...defaultSettings.inspectionProfile, ...(stored?.inspectionProfile ?? {}) },
      keymap: { ...defaultSettings.keymap, ...(stored?.keymap ?? {}) },
    }
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
      chats: [],
      activeChatId: null,
      plan: null,
      plans: [],
      usages: null,
      indexStatus: null,
      aiSessionId: noSessions(),
    })
    lspResetDocuments()
    // Terminals hold a live shell rooted in the old project; retire them so the
    // next one opens in the new root rather than inheriting the previous cwd.
    window.dispatchEvent(new CustomEvent('nova:project-changed'))
    const recents = await nova().app.addRecent(path)
    set({ recents })
    await nova().fs.watch(path)
    await nova().lsp.setRoot(path)
    // Restores this project's saved breakpoints.
    await nova().debug.setRoot(path)
    // The request client's cookie jar and history are per project, so they
    // move with it rather than leaking a session between two checkouts.
    await nova().http.setRoot(path)
    void nova().lsp.detect().then((servers) => set({ lspServers: servers }))
    await get().refreshGit()
    void get().refreshCommits()
    void get().buildIndex()
    void get().detectTestFrameworks()
    // Conversations are per project, so they load with it rather than at boot.
    void get().loadChats()
  },

  async pickProject() {
    const path = await nova().app.openFolderDialog()
    if (path) await get().openProject(path)
  },

  async openFile(requestedPath, opts) {
    // Resolve symlinks first. On macOS the same file arrives as both
    // `/var/…` and `/private/var/…` depending on whether it came from the file
    // watcher, the index or a caller; without canonicalising here the store
    // ends up with two buffers and two tabs for one file.
    const path = await nova().fs.realpath(requestedPath).catch(() => requestedPath)

    const reveal = () =>
      window.dispatchEvent(
        new CustomEvent('nova:goto-line', {
          detail: { path, line: opts?.line, column: opts?.column },
        }),
      )

    const existing = get().tabs.find((t) => t.kind === 'file' && t.path === path)
    if (existing) {
      // Already open: a background request has nothing left to do, since the
      // file is on screen for the taking.
      if (opts?.background) return
      // Must go through setActiveTab, or the tab's group never learns it is the
      // active one and the editor area renders nothing.
      get().setActiveTab(existing.id)
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
        readOnly: res.truncated || res.binary,
        readOnlyReason: res.truncated ? 'too-large' : res.binary ? 'binary' : undefined,
        size: res.size,
      }
      set({ buffers: { ...get().buffers, [path]: buffer } })
      // A language server is given documents it could act on. A file that was
      // never loaded is not one — sending it would describe the file as empty.
      if (!buffer.readOnly) lspDidOpen(path, buffer.content)
    }
    const isDiagram = path.endsWith('.nova-diagram.json')
    const previouslyActive = get().activeTabId
    get().openTab({
      id: `file:${path}`,
      kind: isDiagram ? 'diagram' : 'file',
      title: isDiagram ? basename(path).replace('.nova-diagram.json', '') : basename(path),
      path,
      preview: opts?.preview,
    })
    // `openTab` activates what it opens, which is right for every other caller.
    // Put the selection back for a background open.
    if (opts?.background && previouslyActive) get().setActiveTab(previouslyActive)
    if (opts?.line && !opts.background) setTimeout(reveal, 60)
  },

  openTab(tab) {
    const { tabs, activeGroup } = get()
    const group = tab.group ?? activeGroup
    const existing = tabs.find((t) => t.id === tab.id)
    if (existing) {
      set({
        tabs: tabs.map((t) =>
          t.id === tab.id ? { ...t, ...tab, group: t.group ?? group, preview: t.preview && tab.preview } : t,
        ),
      })
      get().setActiveTab(tab.id)
      return
    }
    // A preview tab (single click in the tree) replaces the previous preview
    // tab — but only within its own group.
    const withoutPreview = tab.preview ? tabs.filter((t) => !(t.preview && (t.group ?? 'main') === group)) : tabs
    set({ tabs: [...withoutPreview, { ...tab, group }] })
    get().setActiveTab(tab.id)
    if (tab.path) get().noteRecentFile(tab.path)
  },

  closeTab(id) {
    const { tabs, groupActive } = get()
    const index = tabs.findIndex((t) => t.id === id)
    if (index === -1) return
    const closing = tabs[index]
    const group = closing.group ?? 'main'
    const next = tabs.filter((t) => t.id !== id)
    // Tell the server only when no other tab still shows the file.
    const lastTabForFile = Boolean(closing.path) && !next.some((t) => t.path === closing.path)
    if (closing.path && lastTabForFile) {
      lspDidClose(closing.path)
    }

    // Closing a tab freed the tab and kept the file. Buffers were only ever
    // added to, so a session that browsed a few hundred files held every one of
    // them — the base64 of each image among them — until the window closed.
    // A dirty buffer stays: that content exists nowhere else.
    const buffers = get().buffers
    let nextBuffers = buffers
    if (closing.path && lastTabForFile) {
      const buffer = buffers[closing.path]
      if (buffer && buffer.content === buffer.savedContent) {
        nextBuffers = { ...buffers }
        delete nextBuffers[closing.path]
      }
    }

    const nextGroupActive = { ...groupActive }
    if (groupActive[group] === id) {
      const siblings = next.filter((t) => (t.group ?? 'main') === group)
      const position = tabs.filter((t) => (t.group ?? 'main') === group).findIndex((t) => t.id === id)
      nextGroupActive[group] =
        siblings[position]?.id ?? siblings[position - 1]?.id ?? siblings[siblings.length - 1]?.id ?? null
    }

    // An emptied split collapses rather than leaving a blank half.
    const groups = get().groups.filter(
      (g) => g === 'main' || next.some((t) => (t.group ?? 'main') === g),
    )
    const activeGroup = groups.includes(get().activeGroup) ? get().activeGroup : 'main'

    set({
      tabs: next,
      groups,
      activeGroup,
      groupActive: nextGroupActive,
      activeTabId: nextGroupActive[activeGroup] ?? null,
      buffers: nextBuffers,
    })
  },

  closeOtherTabs(id) {
    const target = get().tabs.find((t) => t.id === id)
    if (!target) return
    const group = target.group ?? 'main'
    for (const tab of get().tabs.slice()) {
      if (tab.id === id || tab.pinned || (tab.group ?? 'main') !== group) continue
      get().closeTab(tab.id)
    }
  },

  closeTabsToRight(id) {
    const target = get().tabs.find((t) => t.id === id)
    if (!target) return
    const group = target.group ?? 'main'
    const siblings = get().tabs.filter((t) => (t.group ?? 'main') === group)
    const index = siblings.findIndex((t) => t.id === id)
    for (const tab of siblings.slice(index + 1)) {
      if (!tab.pinned) get().closeTab(tab.id)
    }
  },

  togglePinTab(id) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned, preview: false } : t)) })
  },

  /** Reorders `id` to sit before `beforeId`, or last when that is null. */
  moveTab(id, beforeId) {
    const tabs = get().tabs.slice()
    const from = tabs.findIndex((t) => t.id === id)
    if (from === -1 || id === beforeId) return
    const [moved] = tabs.splice(from, 1)
    const to = beforeId ? tabs.findIndex((t) => t.id === beforeId) : tabs.length
    tabs.splice(to === -1 ? tabs.length : to, 0, moved)
    set({ tabs })
  },

  splitEditor() {
    const { groups, activeTabId, tabs } = get()
    if (groups.includes('right')) {
      get().setActiveGroup('right')
      return
    }
    const active = tabs.find((t) => t.id === activeTabId)
    set({ groups: ['main', 'right'], activeGroup: 'right' })
    // Show the current file on both sides, the way splitting an editor should.
    if (active?.path) {
      get().openTab({ ...active, id: `${active.id}::right`, group: 'right', preview: false })
    }
  },

  closeSplit() {
    for (const tab of get().tabs.filter((t) => t.group === 'right')) get().closeTab(tab.id)
    set({ groups: ['main'], activeGroup: 'main', activeTabId: get().groupActive.main })
  },

  setActiveGroup(group) {
    if (!get().groups.includes(group)) return
    set({ activeGroup: group, activeTabId: get().groupActive[group] })
  },

  /** MRU list behind ⌘E, capped so it stays a list and not a log. */
  noteRecentFile(path) {
    const next = [path, ...get().recentFiles.filter((p) => p !== path)].slice(0, 60)
    set({ recentFiles: next })
  },

  /**
   * Records a caret position for Recent Locations.
   *
   * Adjacent positions in the same file merge into one entry — a location is a
   * place you worked, not every line the caret passed through on the way.
   */
  noteLocation(file, line, column) {
    if (!line) return
    const locations = get().recentLocations
    const head = locations[0]
    const content = get().buffers[file]?.content ?? ''
    const preview = content.split('\n')[line - 1]?.trim().slice(0, 140) ?? ''
    if (head && head.file === file && Math.abs(head.line - line) <= 4) {
      set({
        recentLocations: [{ file, line, column, preview, at: Date.now() }, ...locations.slice(1)],
      })
      return
    }
    set({
      recentLocations: [
        { file, line, column, preview, at: Date.now() },
        ...locations.filter((l) => !(l.file === file && Math.abs(l.line - line) <= 4)),
      ].slice(0, 80),
    })
  },

  /**
   * Toggles a bookmark. With no arguments it uses the caret, which is what the
   * F11 binding does.
   */
  toggleBookmark(file, line) {
    const target = file ?? get().tabs.find((t) => t.id === get().activeTabId)?.path
    const targetLine = line ?? get().cursor.line
    if (!target || !targetLine) return
    const existing = get().bookmarks.find((b) => b.file === target && b.line === targetLine)
    if (existing) {
      set({ bookmarks: get().bookmarks.filter((b) => b !== existing) })
      return
    }
    const content = get().buffers[target]?.content ?? ''
    const preview = content.split('\n')[targetLine - 1]?.trim().slice(0, 120) ?? ''
    set({ bookmarks: [...get().bookmarks, { file: target, line: targetLine, preview }] })
  },

  removeBookmark(file, line) {
    set({ bookmarks: get().bookmarks.filter((b) => !(b.file === file && b.line === line)) })
  },

  moveTabToGroup(id, group) {
    if (!get().groups.includes(group)) return
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, group } : t)) })
    get().setActiveTab(id)
  },

  setActiveTab(id) {
    const tab = get().tabs.find((t) => t.id === id)
    // A stale id would otherwise point a group at a tab that does not exist,
    // leaving the editor area blank with no way back.
    if (!tab) return
    const group = tab.group ?? get().activeGroup
    set({
      groupActive: { ...get().groupActive, [group]: id },
      activeGroup: group,
    })
    if (tab?.path) get().noteRecentFile(tab.path)
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

    // The buffer never held the file, so writing it back would replace the file
    // with the placeholder. Save-all reaches here too, which is how this used to
    // destroy a file nobody had deliberately saved.
    if (buffer.readOnly) return

    // Code style is applied on the way out, so what lands on disk matches the
    // project's settings even when the edit came from a paste or an agent.
    const { formatOnSave, optimizeImportsOnSave } = get().settings
    let content = buffer.content
    if (formatOnSave && !buffer.binary) {
      const { formatFile, optimizeImports, resolveStyle } = await import('@/lib/format')
      if (optimizeImportsOnSave) {
        const style = await resolveStyle(path)
        const result = optimizeImports(content, languageForPath(path), style)
        if (result.ok && result.changed) content = result.text
      }
      content = await formatFile(path, content)
    }

    await nova().fs.write(path, content)
    set({
      buffers: {
        ...get().buffers,
        [path]: { ...buffer, content, savedContent: content, mtimeMs: Date.now() },
      },
    })
    lspDidSave(path, content)
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
    const readOnly = Boolean(res.truncated || res.binary)
    set({
      buffers: {
        ...get().buffers,
        [path]: {
          ...buffer,
          content: res.content,
          savedContent: res.content,
          mtimeMs: res.mtimeMs,
          binary: res.binary,
          readOnly,
          readOnlyReason: res.truncated ? 'too-large' : res.binary ? 'binary' : undefined,
          size: res.size,
        },
      },
    })

    // The language server still holds the version from before the reload. Every
    // diagnostic, hover and completion after a branch switch was computed
    // against content the file no longer had — off by however much the reload
    // changed, and silently so.
    if (!readOnly) lspDidChange(path, res.content)
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

  /**
   * Inspect Code: every enabled rule over every text file in the project.
   *
   * Runs in the renderer over the indexer's file list — the rules are line
   * regexes, so even large trees finish in seconds, and doing it here means
   * unsaved buffer content is inspected rather than the stale disk copy.
   */
  async runInspectCode() {
    const root = get().root
    if (!root) return
    if (get().inspectRun?.running) return

    get().openTab({ id: 'inspect', kind: 'inspect', title: 'Inspect Code' })

    const files = await nova().fs.findFiles(root, '', 20_000).catch(() => [] as string[])
    set({
      inspectRun: { running: true, scanned: 0, total: files.length, findings: [], startedAt: Date.now() },
    })

    const { inspectText } = await import('@/lib/inspections/batch')
    const profile = get().settings.inspectionProfile
    const findings: import('@/lib/inspections/batch').BatchFinding[] = []
    let scanned = 0

    for (const file of files) {
      // A newer run may have replaced this one.
      const current = get().inspectRun
      if (!current || !current.running || current.startedAt !== get().inspectRun?.startedAt) break
      const buffer = get().buffers[file]
      let text = buffer && !buffer.binary ? buffer.content : null
      if (text === null) {
        try {
          const read = await nova().fs.read(file)
          text = read.binary ? null : read.content
        } catch {
          text = null
        }
      }
      if (text !== null && text.length < 2_000_000) {
        findings.push(...inspectText(file, text, profile))
      }
      scanned++
      if (scanned % 100 === 0 || scanned === files.length) {
        set({ inspectRun: { ...get().inspectRun!, scanned, findings: [...findings] } })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    set({
      inspectRun: {
        ...get().inspectRun!,
        running: false,
        scanned,
        findings,
        finishedAt: Date.now(),
      },
    })
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

  async runTests(scope, frameworkId, options) {
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
    const { runId } = await nova().tests.run(root, framework, scope, options)
    const run = get().testRun
    if (run) set({ testRun: { ...run, runId } })
    if (options?.coverage) {
      // Once the run lands, pick up whatever report it produced.
      //
      // Bounded, because the two exits below are both conditional on a state
      // this poll does not control: a run that neither finishes nor is replaced
      // — a wedged runner, a process that never reports — left this ticking for
      // the life of the session, once per coverage run ever started.
      const startedAt = Date.now()
      const poll = setInterval(() => {
        const state = get().testRun
        if (state?.runId !== runId) {
          clearInterval(poll)
          return
        }
        if (!state.running) {
          clearInterval(poll)
          void get().loadCoverage()
          return
        }
        if (Date.now() - startedAt > COVERAGE_POLL_TIMEOUT_MS) clearInterval(poll)
      }, 800)
    }
  },

  async rerunFailedTests() {
    const run = get().testRun ?? get().testHistory[0]
    if (!run) {
      get().notify('No test run to take failures from.', 'error')
      return
    }
    const failed = run.cases.filter((c) => c.status === 'fail').map((c) => c.name)
    if (failed.length === 0) {
      get().notify('Nothing failed in the last run.', 'success')
      return
    }
    await get().runTests({ kind: 'names', names: failed }, run.framework)
  },

  showTestRun(runId) {
    const entry = get().testHistory.find((run) => run.runId === runId)
    if (entry) set({ testRun: entry })
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

    const next: TestRunState = {
      runId: update.runId,
      framework: update.framework || previous?.framework || '',
      command: update.command || previous?.command || '',
      running: !update.done,
      cases,
      output,
      exitCode: update.done?.exitCode ?? previous?.exitCode,
      durationMs: update.done?.durationMs ?? previous?.durationMs,
    }
    set({ testRun: next })

    // A finished run joins the history, newest first, capped.
    if (update.done) {
      set({
        testHistory: [next, ...get().testHistory.filter((run) => run.runId !== next.runId)].slice(0, 20),
      })
    }
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
    get().schedulePersist()
  },

  patchMessage(id, patch) {
    set({ messages: get().messages.map((m) => (m.id === id ? patch(m) : m)) })
  },

  setAutoRun(run) {
    set({ autoRun: run })
  },

  setAiAutoCancelled(cancelled) {
    set({ aiAutoCancelled: cancelled })
  },

  pushBrowserConsole(level, text) {
    set((state) => ({
      browserConsole: [...state.browserConsole, { level, text, at: Date.now() }].slice(
        -MAX_BROWSER_CONSOLE,
      ),
    }))
  },

  setAiRunning(running) {
    set({ aiRunning: running })
  },

  setSession(provider, id) {
    set({ aiSessionId: { ...get().aiSessionId, [provider]: id } })
  },

  clearConversation() {
    set({ messages: [], aiSessionId: noSessions() })
  },

  setPalette(open, mode) {
    set({ paletteOpen: open, paletteMode: mode ?? get().paletteMode })
  },

  /** Opens the Search pane scoped to one folder, from the Explorer. */
  searchInFolder(dir) {
    const root = get().root ?? ''
    const relativeDir = dir.startsWith(root) ? dir.slice(root.length + 1) : dir
    set({
      sidebarVisible: true,
      sidebarView: 'search',
      pendingSearchMask: relativeDir ? `${relativeDir}/**` : '',
    })
  },

  /** Opens the file finder already narrowed to one folder. */
  findFileIn(dir) {
    const root = get().root ?? ''
    const relativeDir = dir.startsWith(root) ? dir.slice(root.length + 1) : dir
    set({ paletteOpen: true, paletteMode: 'file', pendingPaletteQuery: relativeDir })
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
      get().notify(`${provider.label} ${providerStateLabel(provider)} — ${provider.hint}`, 'error')
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

  /**
   * Starts a read-only agent run that documents the whole project, and opens a
   * tab that renders the answer as it streams.
   *
   * `provider` overrides the configured assistant for this run only, which is
   * how the button offers "generate with Claude" and "generate with Codex" side
   * by side: the two write noticeably different documents, and comparing them on
   * the same codebase is worth more than picking one in Settings for ever.
   *
   * Like `explainFile`, the run is isolated from the AI console conversation and
   * uses plan-mode permissions — a document about the code must never become an
   * edit to it.
   */
  async generateTutorial(chapter = 'book', provider) {
    const { root, settings, providers } = get()
    if (!root) {
      get().notify('Open a project first — the tutorial is written from its source.', 'error')
      return
    }

    const chosen = provider ?? settings.aiProvider
    const info = providers.find((p) => p.id === chosen)
    if (info && !info.available) {
      get().notify(`${info.label} ${providerStateLabel(info)} — ${info.hint}`, 'error')
      return
    }

    const previous = get().tutorial
    if (previous?.status === 'running' && previous.runId) {
      await nova().ai.cancel(previous.runId)
    }

    const { buildTutorialPrompt } = await import('@/lib/tutorial')
    const projectName = basename(root)

    get().openTab({
      id: 'tutorial',
      kind: 'tutorial',
      title: `${projectName} — tutorial`,
      subtitle: `Generated technical walkthrough of ${projectName}`,
    })

    set({
      tutorial: {
        chapter,
        provider: chosen,
        content: '',
        thinking: '',
        status: 'running',
        startedAt: Date.now(),
      },
    })

    try {
      const { runId } = await nova().ai.start({
        provider: chosen,
        prompt: buildTutorialPrompt({ chapter, projectName }),
        cwd: root,
        model: settings.aiModel || undefined,
        // Read-only: the document must never rewrite its subject.
        permissionMode: 'plan',
      })
      const current = get().tutorial
      if (current) set({ tutorial: { ...current, runId } })
      await nova().ai.ack(runId)
    } catch (error) {
      const current = get().tutorial
      if (!current) return
      set({
        tutorial: {
          ...current,
          status: 'error',
          error: (error as Error).message,
          finishedAt: Date.now(),
        },
      })
    }
  },

  async stopTutorial() {
    const doc = get().tutorial
    if (!doc?.runId) return
    await nova().ai.cancel(doc.runId)
    set({ tutorial: { ...doc, status: 'done', finishedAt: Date.now() } })
  },

  patchTutorial(runId, patch) {
    const doc = get().tutorial
    if (!doc || doc.runId !== runId) return
    set({ tutorial: patch(doc) })
  },

  /**
   * Records that `path` changed underneath a dirty buffer. The buffer is left
   * exactly as the user typed it — this only makes the divergence visible, so a
   * later save is a decision rather than an accident.
   */
  async noteExternalChange(path) {
    const buffer = get().buffers[path]
    if (!buffer) return
    let diskContent = ''
    try {
      const result = await nova().fs.read(path)
      if (result.binary) return
      diskContent = result.content
    } catch {
      return
    }
    if (diskContent === buffer.content) return

    // Disk matches what Nova last wrote, so whatever the watcher saw was Nova's
    // own save coming back. Reporting that as somebody else's edit put a
    // "changed on disk" bar over the file the user had just saved, and offered
    // to reload their own content over their unsaved edits.
    if (diskContent === buffer.savedContent) return

    set({
      externalChanges: {
        ...get().externalChanges,
        [path]: { diskContent, noticedAt: Date.now() },
      },
    })
  },

  async resolveExternalChange(path, action) {
    const entry = get().externalChanges[path]
    const { [path]: _dropped, ...rest } = get().externalChanges
    if (action === 'reload') {
      await get().reloadBuffer(path)
    } else if (action === 'compare' && entry) {
      const buffer = get().buffers[path]
      get().openTab({
        id: `diff:external:${path}`,
        kind: 'diff',
        title: `${basename(path)} — on disk ↔ yours`,
        subtitle: path,
        diff: {
          before: entry.diskContent,
          after: buffer?.content ?? '',
          language: languageForPath(path),
          targetPath: path,
        },
      })
    }
    set({ externalChanges: rest })
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

  /**
   * Reads whatever coverage report the project has on disk.
   *
   * Located by convention, so running `jest --coverage` in a terminal and then
   * opening this panel just works — the report does not have to come from a run
   * Nova itself started.
   */
  async loadCoverage(file) {
    const root = get().root
    if (!root) return
    set({ coverageLoading: true })
    try {
      const coverage = await nova().coverage.load(root, file)
      set({ coverage })
      if (!coverage) get().notify('No coverage report found. Run tests with coverage first.', 'error')
    } catch (err) {
      get().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      set({ coverageLoading: false })
    }
  },

  toggleCoverageVisible() {
    set({ coverageVisible: !get().coverageVisible })
  },

  /**
   * Loads the chat list for the open project and restores the newest one.
   *
   * Restoring rather than starting empty is the whole point: closing the app
   * used to lose the conversation, which made the console feel disposable.
   */
  async loadChats() {
    const root = get().root
    if (!root) {
      set({ chats: [], activeChatId: null, messages: [], plan: null, plans: [] })
      return
    }
    const chats = await nova().chats.list(root)
    set({ chats })
    if (chats.length) await get().switchChat(chats[0].id)
    else await get().newChat()
  },

  async newChat() {
    const root = get().root
    if (!root) return
    // Save whatever is on screen before replacing it.
    await get().persistChat()

    const id = `chat_${Date.now().toString(36)}`
    const stored: StoredChat = {
      id,
      title: 'New chat',
      messages: [],
      sessionIds: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const chats = await nova().chats.save(root, stored)
    set({
      chats,
      activeChatId: id,
      messages: [],
      plan: null,
      plans: [],
      aiSessionId: noSessions(),
    })
  },

  async switchChat(id) {
    const root = get().root
    if (!root || id === get().activeChatId) return
    await get().persistChat()

    const stored = await nova().chats.get(root, id)
    if (!stored) return
    // A chat saved before plan history existed has only the active plan, so
    // treat that as a one-entry history rather than opening with nothing.
    const plans = stored.plans?.length ? stored.plans : stored.plan ? [stored.plan] : []

    set({
      activeChatId: id,
      messages: settleMessages((stored.messages as AiMessage[]) ?? []),
      plan: stored.plan ?? null,
      plans,
      aiSessionId: {
        ...noSessions(),
        ...(stored.sessionIds as Partial<Record<AiProvider, string | undefined>>),
      },
    })
  },

  async deleteChat(id) {
    const root = get().root
    if (!root) return
    const chats = await nova().chats.delete(root, id)
    set({ chats })
    if (get().activeChatId === id) {
      if (chats.length) {
        set({ activeChatId: null })
        await get().switchChat(chats[0].id)
      } else {
        set({ activeChatId: null, messages: [], plan: null, plans: [] })
        await get().newChat()
      }
    }
  },

  /**
   * Writes the active chat back to disk.
   *
   * The title is derived from the first user message the first time there is
   * one, so the list is browsable without asking the user to name anything.
   */
  /**
   * Saves the conversation shortly, coalescing bursts.
   *
   * Persistence used to happen only when a turn completed, which meant a run
   * that never reported completion — a crashed CLI, a lost event — took the
   * whole conversation with it, and the history list stayed empty however long
   * the user had been working. Saving as messages arrive means the record
   * survives whatever happens to the run. Debounced because a streaming turn
   * patches its message on every token, and writing the file that often would
   * be pointless work.
   */
  schedulePersist() {
    const pending = get().persistTimer
    if (pending) clearTimeout(pending)
    set({
      persistTimer: setTimeout(() => {
        set({ persistTimer: null })
        void get().persistChat()
      }, 1200),
    })
  },

  async persistChat() {
    const { root, activeChatId, messages, plan, aiSessionId, chats } = get()
    if (!root || !activeChatId) return
    // A stored message is a transcript, not a run. See `settleMessages`.
    const settled = settleMessages(messages)

    const existing = chats.find((c) => c.id === activeChatId)
    const firstUser = messages.find((m) => m.role === 'user')
    const derived = firstUser?.parts.find((p) => p.kind === 'text')?.text ?? ''
    const title =
      existing && existing.title !== 'New chat'
        ? existing.title
        : derived
          ? derived.replace(/\s+/g, ' ').slice(0, 60)
          : 'New chat'

    const stored: StoredChat = {
      id: activeChatId,
      title,
      messages: settled,
      sessionIds: { claude: aiSessionId.claude, codex: aiSessionId.codex },
      plan: plan ?? undefined,
      plans: get().plans,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    set({ chats: await nova().chats.save(root, stored) })
  },

  /**
   * Sets the active plan and folds it into this chat's history.
   *
   * Updating in place by id rather than appending: the same plan is written
   * back on every step tick, and a history that grew a row per tick would be
   * useless. Clearing the active plan deliberately leaves the record alone —
   * discarding a plan is a thing that happened, and the point of the history is
   * to still be able to see what was proposed.
   */
  setPlan(plan) {
    if (!plan) {
      set({ plan: null })
      void get().persistChat()
      return
    }
    const plans = [...get().plans]
    const at = plans.findIndex((p) => p.id === plan.id)
    if (at === -1) plans.push(plan)
    else plans[at] = plan

    set({ plan, plans })
    void get().persistChat()
  },

  /**
   * Updates one plan wherever it lives.
   *
   * Distinct from `setPlan` because a late-arriving result — a test run that
   * finished after the user moved on — must not drag that plan back to being
   * the active one. The active plan only changes if it is the one being
   * patched.
   */
  patchPlan(id, patch) {
    const plans = get().plans.map((p) => (p.id === id ? patch(p) : p))
    const current = get().plan
    set({ plans, plan: current?.id === id ? patch(current) : current })
    void get().persistChat()
  },

  /** Records a plan as rejected, then clears it, so the history keeps it. */
  discardPlan() {
    const plan = get().plan
    if (plan) get().setPlan({ ...plan, status: 'rejected' })
    set({ plan: null })
    void get().persistChat()
  },

  async refreshPlugins() {
    const [plugins, pluginRuntime] = await Promise.all([nova().plugins.list(), nova().plugins.runtime()])
    set({ plugins, pluginRuntime })
  },

  /**
   * Installs from a git URL. Returns whether it succeeded so the view can keep
   * the URL in the field on failure — retyping a long URL after a typo in the
   * branch name is the kind of small insult that makes a feature feel hostile.
   */
  async installPlugin(url, options) {
    set({ pluginInstall: { url, stage: 'cloning', message: 'Starting…' } })
    try {
      const plugin = await nova().plugins.install(url, options)
      await get().refreshPlugins()
      get().notify(`Installed ${plugin.manifest.name}`, 'success')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // An install that stopped to ask about the build command already
      // broadcast that stage, and it carries the command the panel has to show.
      // Overwriting it with a plain error would throw away the question.
      if (get().pluginInstall?.stage !== 'needs-build-consent') {
        set({ pluginInstall: { url, stage: 'error', message } })
      }
      get().notify(message.split('\n')[0], 'error')
      return false
    }
  },

  async updatePluginById(id) {
    try {
      const plugin = await nova().plugins.update(id)
      await get().refreshPlugins()
      get().notify(`${plugin.manifest.name} is now ${plugin.manifest.version}`, 'success')
    } catch (err) {
      get().notify(err instanceof Error ? err.message : String(err), 'error')
    }
  },

  async setPluginEnabled(id, enabled) {
    await nova().plugins.setEnabled(id, enabled)
    await get().refreshPlugins()
  },

  async uninstallPlugin(id) {
    await nova().plugins.uninstall(id)
    await get().refreshPlugins()
  },

  async grantPluginPermissions(id, permissions) {
    await nova().plugins.grant(id, permissions)
    await get().refreshPlugins()
  },

  async runPluginCommand(pluginId, commandId) {
    try {
      await nova().plugins.invoke(pluginId, commandId)
    } catch (err) {
      get().notify(err instanceof Error ? err.message : String(err), 'error')
    }
  },

  appendPluginLog(event) {
    // Keep the tail: a plugin in a logging loop should not grow the heap.
    const next = [...get().pluginLog, event]
    set({ pluginLog: next.length > 500 ? next.slice(-500) : next })
  },

  setPluginInstall(progress) {
    set({ pluginInstall: progress })
  },

  setPluginViewHtml(pluginId, viewId, html) {
    set({ pluginViewHtml: { ...get().pluginViewHtml, [`${pluginId}:${viewId}`]: html } })
  },
}))

export function activeTab() {
  const { tabs, activeTabId } = useStore.getState()
  return tabs.find((t) => t.id === activeTabId) ?? null
}
