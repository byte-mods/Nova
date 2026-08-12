/** Shared IPC contract between the Electron main process and the renderer. */

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  /** Only present for files. */
  size?: number
}

export interface FileReadResult {
  path: string
  content: string
  /** True when the file looked binary and `content` is a base64 data URL instead of text. */
  binary: boolean
  encoding: 'utf8' | 'base64'
  mtimeMs: number
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'unknown'

export interface GitChange {
  path: string
  /** Path before a rename, when applicable. */
  origPath?: string
  status: GitFileStatus
  staged: boolean
  /** Raw two-letter porcelain code, e.g. " M", "??", "A ". */
  code: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  subject: string
  body: string
  author: string
  email: string
  /** Unix seconds. */
  date: number
  refs: string
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  upstream: string
  ahead: number
  behind: number
  changes: GitChange[]
  root: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
}

export interface GitBlameLine {
  line: number
  hash: string
  shortHash: string
  author: string
  /** Unix seconds. */
  date: number
  summary: string
  uncommitted: boolean
}

export interface GitStashEntry {
  ref: string
  subject: string
  date: number
}

/** A single file's before/after content produced by an AI turn. */
export interface FileChange {
  path: string
  before: string
  after: string
  /** `create` when the file did not exist before the turn. */
  kind: 'create' | 'modify' | 'delete'
  additions: number
  deletions: number
}

export type AiProvider = 'claude' | 'codex'

export type AiEvent =
  | { type: 'session'; sessionId: string; runId: string }
  | { type: 'assistant-text'; runId: string; text: string }
  | { type: 'thinking'; runId: string; text: string }
  | { type: 'tool-use'; runId: string; id: string; name: string; input: unknown }
  | { type: 'tool-result'; runId: string; id: string; ok: boolean; preview: string }
  | { type: 'file-change'; runId: string; change: FileChange }
  | { type: 'error'; runId: string; message: string }
  | { type: 'log'; runId: string; text: string }
  | { type: 'done'; runId: string; ok: boolean; costUsd?: number; durationMs?: number }

export interface AiStartRequest {
  provider: AiProvider
  prompt: string
  cwd: string
  model?: string
  /** Continue an existing conversation. */
  resumeSessionId?: string
  /** Extra file paths to pin into the prompt as context. */
  attachments?: string[]
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
}

export interface ProviderInfo {
  id: AiProvider
  label: string
  available: boolean
  binary: string
  version: string
  hint: string
}

export interface TerminalChunk {
  id: string
  data: string
  stream: 'stdout' | 'stderr' | 'system'
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

/* ---------------- code intelligence ---------------- */

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'struct'
  | 'enum'
  | 'type'
  | 'trait'
  | 'variable'
  | 'constant'
  | 'property'
  | 'field'
  | 'module'
  | 'macro'
  | 'selector'

export interface CodeSymbol {
  name: string
  kind: SymbolKind
  file: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
  /** The enclosing class/module/namespace, when one was detected. */
  container: string
  /** The trimmed source line the declaration was found on. */
  signature: string
  language: string
  /** True when the declaration is exported/public, used for ranking. */
  exported: boolean
}

export type ReferenceKind = 'declaration' | 'code' | 'import' | 'comment' | 'string'

export interface CodeReference {
  file: string
  line: number
  column: number
  preview: string
  kind: ReferenceKind
}

export interface IndexStatus {
  root: string
  /** True once a full pass has completed at least once. */
  ready: boolean
  indexing: boolean
  files: number
  symbols: number
  durationMs: number
  /** Set when the walk stopped early because the project exceeded the cap. */
  truncated: boolean
}

/* ---------------- language servers ---------------- */

export interface LspServerStatus {
  id: string
  label: string
  languages: string[]
  command: string
  /** Resolved binary path when installed. */
  binary: string
  installed: boolean
  state: 'starting' | 'ready' | 'failed' | 'stopped'
  error: string
  /** Long-running server work, e.g. rust-analyzer's initial index. */
  progress: string
  install: string
}

export interface LspDiagnosticsEvent {
  /** Absolute file path (already converted from the server's URI). */
  path: string
  diagnostics: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
    severity?: number
    code?: string | number
    source?: string
    message: string
  }[]
}

/* ---------------- run configurations ---------------- */

export interface RunConfig {
  id: string
  label: string
  command: string
  detail: string
  source: 'detected' | 'custom'
}

/* ---------------- local history ---------------- */

export interface HistoryRevision {
  /** Opaque snapshot id (also the on-disk filename). */
  id: string
  /** Unix milliseconds. */
  at: number
  label: string
  size: number
}

/* ---------------- debugging ---------------- */

export interface DebugAdapterStatus {
  id: string
  label: string
  languages: string[]
  command: string
  binary: string
  installed: boolean
  install: string
  /** `binary` adapters need a compiled executable, `script` take a source file. */
  programKind: 'binary' | 'script'
}

export interface DebugStackFrame {
  id: number
  name: string
  file: string
  line: number
  column: number
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string
  /** Non-zero when the value can be expanded. */
  variablesReference: number
}

/**
 * One breakpoint. A bare line breakpoint is the common case; the optional
 * fields map straight onto the DAP `SourceBreakpoint` shape.
 */
export interface DebugBreakpoint {
  line: number
  /** Only break when this expression is truthy. */
  condition?: string
  /** DAP hit condition, e.g. `>5` or `%3`. */
  hitCondition?: string
  /** A log point: print this instead of suspending. `{expr}` interpolates. */
  logMessage?: string
  /** Muted breakpoints stay in the gutter but are not sent to the adapter. */
  enabled: boolean
}

export interface DebugBreakpointFile {
  file: string
  lines: number[]
  /** Lines the adapter confirmed it could bind. */
  verified: number[]
  /** The full definition for each line in `lines`. */
  items: DebugBreakpoint[]
}

export interface DebugState {
  status: 'inactive' | 'starting' | 'running' | 'paused'
  adapterId: string
  adapterLabel: string
  threadId: number | null
  frames: DebugStackFrame[]
  currentFrameId: number | null
  stopReason: string
  error: string
  breakpoints: DebugBreakpointFile[]
  supportsStepBack: boolean
  supportsRestart: boolean
}

/* ---------------- tests ---------------- */

export type TestStatus = 'pass' | 'fail' | 'skip' | 'running'

export type TestEvent =
  | { type: 'start'; id: string; name: string; suite?: string }
  | {
      type: 'result'
      id: string
      name: string
      suite?: string
      status: Exclude<TestStatus, 'running'>
      durationMs?: number
      message?: string
    }
  | { type: 'output'; id?: string; text: string }

export interface TestFrameworkInfo {
  id: string
  label: string
}

export interface TestRunUpdate {
  runId: string
  framework: string
  command: string
  events: TestEvent[]
  /** Present once the process exits. */
  done?: { exitCode: number | null; durationMs: number }
}

export interface TestDeclaration {
  name: string
  line: number
}

/** A file's worth of edits produced by rename or a code action. */
export interface AppliedEdit {
  path: string
  edits: number
  created?: boolean
  deleted?: boolean
}

export interface UsageQuery {
  name: string
  /** The file the query originated from, used to rank same-file results first. */
  fromFile?: string
}
