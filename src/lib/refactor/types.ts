/**
 * Shared shapes for the refactoring engine.
 *
 * Everything under `refactor/` except `bridge.ts` is pure: no DOM, no Monaco,
 * no `window.nova`. Cross-file knowledge arrives through `RefactorWorkspace`,
 * which the bridge implements over the symbol index and the file system. That
 * split is what lets `tests/test-refactor.mjs` run the whole engine in Node.
 *
 * Positions are 0-based line/character pairs, matching LSP and the existing
 * `applyEdits` helper. `WorkspaceEdit.changes` is keyed by **absolute file
 * path** rather than a `file:` URI — `uriToPath` passes non-URI keys through
 * untouched, so the existing applier and preview accept both.
 */

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface ResourceOperation {
  kind: 'create' | 'rename' | 'delete'
  uri?: string
  oldUri?: string
  newUri?: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export interface DocumentEdit {
  textDocument: { uri: string; version?: number | null }
  edits: TextEdit[]
}

export type DocumentChange = ResourceOperation | DocumentEdit

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
  documentChanges?: DocumentChange[]
}

/* ---------------- index shapes ---------------- */

/**
 * Structurally compatible with `CodeSymbol` / `CodeReference` in
 * `shared/types.ts`. Redeclared here so the core has no import that the test
 * bundler has to resolve.
 */
export interface IndexSymbol {
  name: string
  kind: string
  file: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
  container: string
  signature: string
  language: string
  exported: boolean
}

export interface IndexReference {
  file: string
  line: number
  column: number
  preview: string
  kind: 'declaration' | 'code' | 'import' | 'comment' | 'string'
}

/** The I/O the engine needs, injected so the core stays testable. */
export interface RefactorWorkspace {
  readFile(path: string): Promise<string | null>
  references(name: string, fromFile?: string): Promise<IndexReference[]>
  definitions(name: string, fromFile?: string): Promise<IndexSymbol[]>
  workspaceSymbols(query: string, limit?: number): Promise<IndexSymbol[]>
  /** Absolute paths of every indexed file, used by move + import rewriting. */
  files(): Promise<string[]>
}

/* ---------------- request / result ---------------- */

/** Where a refactoring was invoked: a file, its text, and the selection. */
export interface RefactorSite {
  file: string
  language: string
  text: string
  /** Collapsed to a caret when the refactoring works from the cursor alone. */
  range: Range
}

export type RefactorId =
  | 'rename'
  | 'rename.file'
  | 'rename.directory'
  | 'extract.variable'
  | 'extract.constant'
  | 'extract.field'
  | 'extract.method'
  | 'extract.parameter'
  | 'extract.interface'
  | 'extract.superclass'
  | 'inline.variable'
  | 'inline.method'
  | 'inline.parameter'
  | 'inline.field'
  | 'move.file'
  | 'move.class'
  | 'signature.change'
  | 'signature.parameterObject'
  | 'encapsulate.field'
  | 'invert.boolean'
  | 'convert.anonymous'
  | 'safeDelete'
  | 'members.pullUp'
  | 'members.pushDown'

export interface RefactorSuccess {
  ok: true
  title: string
  edit: WorkspaceEdit
  /** Shown above the diff — things the user should look at before applying. */
  warnings: string[]
}

export interface RefactorFailure {
  ok: false
  reason: string
}

export type RefactorResult = RefactorSuccess | RefactorFailure

export function fail(reason: string): RefactorFailure {
  return { ok: false, reason }
}

export function succeed(
  title: string,
  edit: WorkspaceEdit,
  warnings: string[] = [],
): RefactorSuccess {
  return { ok: true, title, edit, warnings }
}

/** Convenience: single-file edit set keyed by path. */
export function fileEdit(file: string, edits: TextEdit[]): WorkspaceEdit {
  return { changes: { [file]: edits } }
}

export function mergeEdits(...parts: WorkspaceEdit[]): WorkspaceEdit {
  const changes: Record<string, TextEdit[]> = {}
  const documentChanges: DocumentChange[] = []
  for (const part of parts) {
    for (const [file, edits] of Object.entries(part.changes ?? {})) {
      changes[file] = [...(changes[file] ?? []), ...edits]
    }
    for (const change of part.documentChanges ?? []) documentChanges.push(change)
  }
  const result: WorkspaceEdit = {}
  if (Object.keys(changes).length) result.changes = changes
  if (documentChanges.length) result.documentChanges = documentChanges
  return result
}
