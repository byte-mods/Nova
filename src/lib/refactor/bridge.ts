/**
 * The browser side of the refactoring engine.
 *
 * Everything impure lives here: reading the Monaco selection, answering the
 * engine's cross-file questions from the symbol index, and routing the
 * resulting `WorkspaceEdit` through the same preview + applier that Rename
 * already uses. The engine itself stays pure and testable.
 */

import type * as monacoNs from 'monaco-editor'
import { useStore } from '@/state/store'
import { requestApproval } from '@/lib/editPreview'
import { applyWorkspaceEdit } from '@/lib/workspaceEdit'
import { languageForPath } from '@/lib/language'
import { dirname } from '@/lib/paths'
import {
  changeSignature,
  convertAnonymousToInner,
  encapsulateField,
  extractConstant,
  extractField,
  extractMethod,
  extractParameter,
  extractType,
  extractVariable,
  inlineField,
  inlineMethod,
  inlineParameter,
  inlineVariable,
  introduceParameterObject,
  invertBoolean,
  moveClass,
  moveFile,
  moveMembers,
  prepareChangeSignature,
  prepareConvertAnonymous,
  prepareEncapsulateField,
  prepareExtract,
  prepareExtractMethod,
  prepareExtractType,
  prepareInlineField,
  prepareInlineMethod,
  prepareInlineParameter,
  prepareInlineVariable,
  prepareInvertBoolean,
  prepareMembers,
  prepareMoveClass,
  prepareRename,
  prepareSafeDelete,
  renameDirectory,
  renameSymbol,
  safeDelete,
  validateIdentifier,
  type MemberTarget,
  type RefactorId,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
} from './index'

/* ---------------- workspace adapter ---------------- */

export const workspace: RefactorWorkspace = {
  async readFile(path) {
    const buffer = useStore.getState().buffers[path]
    if (buffer) return buffer.content
    try {
      const result = await window.nova.fs.read(path)
      return result.binary ? null : result.content
    } catch {
      return null
    }
  },
  async references(name, fromFile) {
    return window.nova.code.references(name, fromFile).catch(() => [])
  },
  async definitions(name, fromFile) {
    return window.nova.code.definitions(name, fromFile).catch(() => [])
  },
  async workspaceSymbols(query, limit) {
    return window.nova.code.workspaceSymbols(query, limit).catch(() => [])
  },
  async files() {
    const root = useStore.getState().root
    if (!root) return []
    // The fuzzy finder already walks the indexed tree; an empty query returns
    // everything it knows about, which is exactly the set imports can point at.
    return window.nova.fs.findFiles(root, '', 5000).catch(() => [])
  },
}

/* ---------------- site construction ---------------- */

export function siteFromEditor(editor: monacoNs.editor.ICodeEditor, file: string): RefactorSite | null {
  const model = editor.getModel()
  if (!model) return null
  const selection = editor.getSelection()
  const position = editor.getPosition()
  const range = selection ?? (position ? { ...position, startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } : null)
  if (!range) return null
  return {
    file,
    language: languageForPath(file),
    text: model.getValue(),
    range: {
      start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
      end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
    },
  }
}

/**
 * A site built from a model and a position rather than a live editor — used by
 * the Monaco rename provider, which is handed both but no editor.
 */
export function siteFromEditorModel(
  model: monacoNs.editor.ITextModel,
  file: string,
  position: monacoNs.IPosition,
): RefactorSite {
  return {
    file,
    language: languageForPath(file),
    text: model.getValue(),
    range: {
      start: { line: position.lineNumber - 1, character: position.column - 1 },
      end: { line: position.lineNumber - 1, character: position.column - 1 },
    },
  }
}

export function hasSelection(editor: monacoNs.editor.ICodeEditor): boolean {
  const selection = editor.getSelection()
  return Boolean(selection && !selection.isEmpty())
}

/**
 * The editor a refactoring should act on.
 *
 * The command palette and the ⌃T popup both take focus away from Monaco, so
 * the last focused code editor is remembered here rather than looked up when
 * the command finally runs.
 */
let active: { editor: monacoNs.editor.ICodeEditor; file: string } | null = null

export function setActiveEditor(editor: monacoNs.editor.ICodeEditor, file: string) {
  active = { editor, file }
}

export function clearActiveEditor(file: string) {
  if (active?.file === file) active = null
}

export function currentSite(): RefactorSite | null {
  if (!active) return null
  return siteFromEditor(active.editor, active.file)
}

export function currentHasSelection(): boolean {
  return active ? hasSelection(active.editor) : false
}

/** The last focused code editor, for anything that needs its actions. */
export function activeEditor(): monacoNs.editor.ICodeEditor | null {
  return active?.editor ?? null
}

/* ---------------- dialog plumbing ---------------- */

export type FieldKind = 'text' | 'checkbox' | 'select' | 'params' | 'members' | 'info'

export interface DialogField {
  key: string
  label: string
  kind: FieldKind
  value: unknown
  options?: { label: string; value: string }[]
  hint?: string
  /** Rendered but not editable. */
  readOnly?: boolean
}

export interface RefactorDialogState {
  id: RefactorId
  title: string
  fields: DialogField[]
  /** Free-text notes rendered above the fields. */
  notes: string[]
  confirmLabel: string
}

let dialogResolver: ((values: Record<string, unknown> | null) => void) | null = null

function ask(state: RefactorDialogState): Promise<Record<string, unknown> | null> {
  useStore.setState({ refactorDialog: state })
  return new Promise((resolve) => {
    dialogResolver = resolve
  })
}

export function resolveRefactorDialog(values: Record<string, unknown> | null) {
  useStore.setState({ refactorDialog: null })
  dialogResolver?.(values)
  dialogResolver = null
}

/* ---------------- entry point ---------------- */

/** Runs a refactoring end to end: prepare → dialog → preview → apply. */
export async function runRefactoring(id: RefactorId, site: RefactorSite): Promise<void> {
  const store = useStore.getState()
  try {
    const result = await buildResult(id, site)
    if (!result) return
    if (!result.ok) {
      store.notify(result.reason, 'error')
      return
    }

    const approved = await requestApproval(result.title, result.edit as never)
    if (!approved) return

    const applied = await applyWorkspaceEdit(result.edit as never)
    const total = applied.reduce((sum, entry) => sum + entry.edits, 0)
    const files = applied.filter((entry) => entry.edits > 0 || entry.created || entry.deleted).length
    store.notify(
      `${result.title} — ${total} edit${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`,
      'success',
    )
    for (const warning of result.warnings) store.notify(warning, 'info')
    void store.buildIndex()
  } catch (error) {
    store.notify(`Refactoring failed: ${(error as Error).message}`, 'error')
  }
}

/** Returns null when the user cancelled a dialog. */
async function buildResult(id: RefactorId, site: RefactorSite): Promise<RefactorResult | null> {
  switch (id) {
    case 'rename':
      return renameFlow(site)
    case 'rename.file':
      return renameFileFlow(site)
    case 'rename.directory':
      return renameDirectoryFlow(site)
    case 'extract.interface':
      return extractTypeFlow(site, 'interface')
    case 'extract.superclass':
      return extractTypeFlow(site, 'superclass')
    case 'inline.parameter':
      return inlineParameterFlow(site)
    case 'inline.field':
      return inlineFieldFlow(site)
    case 'encapsulate.field':
      return encapsulateFieldFlow(site)
    case 'invert.boolean':
      return invertBooleanFlow(site)
    case 'convert.anonymous':
      return convertAnonymousFlow(site)
    case 'extract.variable':
    case 'extract.constant':
    case 'extract.field':
      return extractLocalFlow(id, site)
    case 'extract.parameter':
      return extractParameterFlow(site)
    case 'extract.method':
      return extractMethodFlow(site)
    case 'inline.variable':
      return inlineVariableFlow(site)
    case 'inline.method':
      return inlineMethodFlow(site)
    case 'signature.change':
      return changeSignatureFlow(site)
    case 'signature.parameterObject':
      return parameterObjectFlow(site)
    case 'move.file':
      return moveFileFlow(site)
    case 'move.class':
      return moveClassFlow(site)
    case 'members.pullUp':
      return membersFlow(site, 'up')
    case 'members.pushDown':
      return membersFlow(site, 'down')
    case 'safeDelete':
      return safeDeleteFlow(site)
    default:
      return { ok: false, reason: `Unknown refactoring “${id}”.` }
  }
}

/* ---------------- individual flows ---------------- */

/**
 * Rename, driven by the symbol index.
 *
 * The dialog leads with the scope decision because that is the only thing the
 * user can get wrong: the engine narrows to the current file whenever the name
 * has no exported declaration, and says why, so widening it is a deliberate act
 * rather than the default.
 */
async function renameFlow(site: RefactorSite): Promise<RefactorResult | null> {
  let preparation = await prepareRename(site, workspace)
  if (!preparation.ok) return preparation

  const softNote = preparation.soft.length
    ? `${preparation.soft.length} mention(s) in comments or strings`
    : 'No mentions in comments or strings'

  const values = await ask({
    id: 'rename',
    title: `Rename ${preparation.kind || 'symbol'} “${preparation.name}”`,
    notes: [
      `${preparation.code.length} occurrence(s) in ${preparation.files.length} file(s)`,
      preparation.fileLocal
        ? `Scoped to this file — ${preparation.scopeReason}.`
        : `Project-wide — ${preparation.scopeReason}.`,
      softNote,
      ...preparation.warnings,
    ],
    fields: [
      { key: 'newName', label: 'New name', kind: 'text', value: preparation.name },
      ...(preparation.fileLocal
        ? [
            {
              key: 'wholeProject',
              label: 'Rename across the whole project instead',
              kind: 'checkbox' as const,
              value: false,
            },
          ]
        : []),
      ...(preparation.soft.length
        ? [
            {
              key: 'searchInComments',
              label: `Also rename in comments and strings (${preparation.soft.length})`,
              kind: 'checkbox' as const,
              value: false,
            },
          ]
        : []),
      ...(preparation.renamesFile
        ? [
            {
              key: 'renameFile',
              label: 'Rename the file to match, updating imports',
              kind: 'checkbox' as const,
              value: true,
            },
          ]
        : []),
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const newName = String(values.newName ?? '').trim()
  const invalid = validateIdentifier(newName, site.language)
  if (invalid) return { ok: false, reason: invalid }

  if (values.wholeProject) {
    const widened = await prepareRename(site, workspace, { wholeProject: true })
    if (!widened.ok) return widened
    preparation = widened
  }

  return renameSymbol(
    site,
    {
      newName,
      searchInComments: Boolean(values.searchInComments),
      wholeProject: Boolean(values.wholeProject),
      renameFile: Boolean(values.renameFile),
      root: useStore.getState().root ?? '',
    },
    workspace,
  )
}

async function renameFileFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const current = site.file.split('/').pop() ?? ''
  const values = await ask({
    id: 'rename.file',
    title: `Rename ${current}`,
    notes: [site.file, 'Relative imports that point at this file are recomputed.'],
    fields: [{ key: 'newName', label: 'New file name', kind: 'text', value: current }],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  const newName = String(values.newName ?? '').trim()
  if (!newName || newName === current) return null
  return moveFile(
    site,
    {
      targetDir: dirname(site.file),
      newName,
      root: useStore.getState().root ?? '',
      updateImports: true,
    },
    workspace,
  )
}

async function renameDirectoryFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const directory = dirname(site.file)
  const values = await ask({
    id: 'rename.directory',
    title: 'Rename Directory / Package',
    notes: [
      'Every file underneath moves with it; relative and dotted imports are recomputed.',
    ],
    fields: [
      { key: 'directory', label: 'Folder', kind: 'text', value: directory },
      { key: 'newName', label: 'New name', kind: 'text', value: directory.split('/').pop() ?? '' },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return renameDirectory(
    {
      directory: String(values.directory ?? directory).trim(),
      newName: String(values.newName ?? '').trim(),
      root: useStore.getState().root ?? '',
    },
    workspace,
  )
}

/** Preview and apply a result produced outside `runRefactoring`'s dialog flow. */
async function applyResult(result: RefactorResult): Promise<void> {
  const store = useStore.getState()
  if (!result.ok) {
    store.notify(result.reason, 'error')
    return
  }
  const approved = await requestApproval(result.title, result.edit as never)
  if (!approved) return
  await applyWorkspaceEdit(result.edit as never)
  store.notify(result.title, 'success')
  for (const warning of result.warnings) store.notify(warning, 'info')
  store.bumpTree()
  void store.buildIndex()
}

/** Rename a folder chosen in the Explorer rather than from an open editor. */
export async function renameDirectoryAt(directory: string): Promise<void> {
  const store = useStore.getState()
  const values = await ask({
    id: 'rename.directory',
    title: `Rename “${directory.split('/').pop()}”`,
    notes: ['Every file underneath moves with it; imports are recomputed.'],
    fields: [{ key: 'newName', label: 'New name', kind: 'text', value: directory.split('/').pop() ?? '' }],
    confirmLabel: 'Preview',
  })
  if (!values) return
  await applyResult(
    await renameDirectory(
      { directory, newName: String(values.newName ?? '').trim(), root: store.root ?? '' },
      workspace,
    ),
  )
}

/** Move or rename a file chosen in the Explorer, updating imports. */
export async function renameFileAt(file: string): Promise<void> {
  const store = useStore.getState()
  const text = (await workspace.readFile(file)) ?? ''
  const values = await ask({
    id: 'move.file',
    title: `Move ${file.split('/').pop()}`,
    notes: [file],
    fields: [
      { key: 'targetDir', label: 'Destination folder', kind: 'text', value: dirname(file) },
      { key: 'newName', label: 'File name', kind: 'text', value: file.split('/').pop() ?? '' },
      { key: 'updateImports', label: 'Update imports across the project', kind: 'checkbox', value: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return
  await applyResult(
    await moveFile(
      { file, language: languageForPath(file), text, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
      {
        targetDir: String(values.targetDir ?? '').trim(),
        newName: String(values.newName ?? '').trim(),
        root: store.root ?? '',
        updateImports: Boolean(values.updateImports),
      },
      workspace,
    ),
  )
}

/* ---------------- safe delete from the Explorer ---------------- */

/** One reason a file should not be deleted: something outside it still uses it. */
export interface FileUsage {
  /** The symbol declared in the doomed file. */
  symbol: string
  /** The file that still refers to it. */
  file: string
  /** 1-based. */
  line: number
}

export interface FileUsageReport {
  usages: FileUsage[]
  /**
   * Files the index has no declarations for, so nothing could be checked about
   * them — assets, markdown, config, or a language with no parser profile.
   * Reported separately because "no usages found" and "nothing was looked at"
   * must not read the same way in a delete confirmation.
   */
  unanalysed: string[]
}

/**
 * Finds what would break if `paths` were deleted.
 *
 * The symbol-level Safe Delete refactoring needs a caret on a declaration, which
 * the Explorer does not have. The file-level equivalent asks the index for every
 * declaration the file makes, then for every reference to those declarations
 * from somewhere that is *not* also being deleted — deleting a module and its
 * only consumer together is not a dangling reference.
 *
 * Comment and string mentions are deliberately excluded: they cannot break a
 * build, and including them makes the warning noisy enough to be ignored.
 */
export async function findFileUsages(paths: string[]): Promise<FileUsageReport> {
  const doomed = new Set(paths)
  const usages: FileUsage[] = []
  const unanalysed: string[] = []
  const seen = new Set<string>()

  for (const file of paths) {
    const symbols = await window.nova.code.documentSymbols(file).catch(() => [])
    if (symbols.length === 0) {
      unanalysed.push(file)
      continue
    }
    for (const symbol of symbols) {
      const references = await workspace.references(symbol.name, file)
      for (const reference of references) {
        if (reference.kind !== 'code' && reference.kind !== 'import') continue
        if (doomed.has(reference.file)) continue
        const key = `${reference.file}:${reference.line}:${symbol.name}`
        if (seen.has(key)) continue
        seen.add(key)
        usages.push({ symbol: symbol.name, file: reference.file, line: reference.line })
      }
    }
  }
  return { usages, unanalysed }
}

/**
 * Deletes files chosen in the Explorer, but checks first.
 *
 * "Move to Trash" used to call `fs.trash` straight away, which is the one
 * destructive action in the tree with no preview in front of it. This puts the
 * same gate on it that every refactoring has: what breaks, where, and an
 * explicit override rather than an undo.
 */
export async function safeDeleteFilesAt(paths: string[]): Promise<void> {
  const store = useStore.getState()
  if (paths.length === 0) return

  // A directory is deleted as the set of files under it, so the usage check
  // sees the same thing the disk will.
  const all = await workspace.files()
  const expanded = [
    ...new Set(
      paths.flatMap((p) =>
        all.some((f) => f === p) ? [p] : all.filter((f) => f.startsWith(`${p}/`)),
      ),
    ),
  ]
  const targets = expanded.length > 0 ? expanded : paths

  const { usages, unanalysed } = await findFileUsages(targets)
  const root = store.root ?? ''
  const shortName = (p: string) => p.split('/').pop() ?? p
  const label =
    paths.length === 1 ? `“${shortName(paths[0])}”` : `${paths.length} items`

  const notes = [
    paths.length === 1 ? paths[0] : `${targets.length} file(s) under ${paths.length} selected items`,
  ]
  if (usages.length > 0) {
    notes.push(`${usages.length} reference(s) elsewhere would be left dangling:`)
    for (const usage of usages.slice(0, 12)) {
      notes.push(`  ${usage.symbol} — ${relativeTo(root, usage.file)}:${usage.line}`)
    }
    if (usages.length > 12) notes.push(`  …and ${usages.length - 12} more`)
  } else if (unanalysed.length < targets.length) {
    notes.push('Nothing else in the project refers to what these files declare.')
  }

  // Never let an unchecked file read as a checked one.
  if (unanalysed.length > 0) {
    notes.push(
      `${unanalysed.length} of ${targets.length} file(s) could not be checked — the index has no` +
        ' declarations for them (assets, docs, or a language with no parser).',
    )
    for (const file of unanalysed.slice(0, 6)) notes.push(`  ${relativeTo(root, file)}`)
    if (unanalysed.length > 6) notes.push(`  …and ${unanalysed.length - 6} more`)
  }

  const values = await ask({
    id: 'safeDelete',
    title: `Delete ${label}?`,
    notes,
    fields:
      usages.length > 0
        ? [
            {
              key: 'force',
              label: 'Delete anyway, leaving those references broken',
              kind: 'checkbox',
              value: false,
            },
          ]
        : [],
    confirmLabel: 'Move to Trash',
  })
  if (!values) return
  if (usages.length > 0 && !values.force) {
    store.notify('Nothing was deleted — tick the box to delete with references remaining.', 'info')
    return
  }

  for (const path of paths) {
    await window.nova.fs.trash(path)
    store.closeTab(`file:${path}`)
  }
  for (const path of targets) store.closeTab(`file:${path}`)
  store.bumpTree()
  void store.buildIndex()
  store.notify(
    paths.length === 1
      ? `Moved ${shortName(paths[0])} to Trash`
      : `Moved ${paths.length} items to Trash`,
    'success',
  )
}

function relativeTo(root: string, file: string): string {
  return root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
}

async function extractTypeFlow(
  site: RefactorSite,
  kind: 'interface' | 'superclass',
): Promise<RefactorResult | null> {
  const preparation = prepareExtractType(site, kind)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: kind === 'interface' ? 'extract.interface' : 'extract.superclass',
    title: `Extract ${kind === 'interface' ? 'Interface' : 'Superclass'} from ${preparation.className}`,
    notes: [preparation.note, `${preparation.members.length} member(s) available`].filter(Boolean),
    fields: [
      { key: 'name', label: 'Name', kind: 'text', value: preparation.suggestedName },
      {
        key: 'targetFile',
        label: 'Destination file',
        kind: 'text',
        value: site.file,
        hint: 'change to put the new type in its own file',
      },
      {
        key: 'members',
        label: 'Members',
        kind: 'members',
        value: preparation.members.map((member) => ({
          id: member.name,
          label: member.isField ? `${member.name} (field)` : `${member.name}(${member.params})`,
          checked: !member.isField,
        })),
      },
      ...(preparation.conforms
        ? [
            {
              key: 'updateDeclaration',
              label: `Make ${preparation.className} conform to it`,
              kind: 'checkbox' as const,
              value: true,
            },
          ]
        : []),
      ...(kind === 'superclass'
        ? [
            {
              key: 'moveMembers',
              label: 'Move the members out of the original class',
              kind: 'checkbox' as const,
              value: true,
            },
          ]
        : []),
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const chosen = ((values.members as { id: string; checked: boolean }[]) ?? [])
    .filter((entry) => entry.checked)
    .map((entry) => entry.id)

  return extractType(site, kind, {
    name: String(values.name ?? '').trim(),
    members: chosen,
    targetFile: String(values.targetFile ?? '').trim(),
    updateDeclaration: Boolean(values.updateDeclaration),
    moveMembers: Boolean(values.moveMembers),
  })
}

async function inlineParameterFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareInlineParameter(site, workspace)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'inline.parameter',
    title: `Inline Parameter “${preparation.parameterName}”`,
    notes: [
      `Every one of the ${preparation.callSiteCount} call site(s) passes \`${preparation.value}\``,
      'It becomes a local at the top of the body and disappears from the signature.',
    ],
    fields: [
      { key: 'value', label: 'Value', kind: 'text', value: preparation.value, readOnly: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return inlineParameter(site, workspace)
}

async function inlineFieldFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareInlineField(site)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'inline.field',
    title: `Inline Field “${preparation.name}”`,
    notes: [`= ${preparation.value}`, `${preparation.usageCount} usage(s) in ${preparation.className}`],
    fields: [{ key: 'keepDeclaration', label: 'Keep the declaration', kind: 'checkbox', value: false }],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return inlineField(site, { keepDeclaration: Boolean(values.keepDeclaration) })
}

async function encapsulateFieldFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareEncapsulateField(site, workspace)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'encapsulate.field',
    title: `Encapsulate Field “${preparation.field}”`,
    notes: [
      `${preparation.reads} read(s) and ${preparation.writes} write(s) in this file`,
      preparation.transparent
        ? 'This language uses properties, so call sites keep the plain name.'
        : 'Reads become getter calls and writes become setter calls.',
      preparation.otherFiles.length
        ? `${preparation.otherFiles.length} other file(s) mention it — they are not rewritten.`
        : '',
    ].filter(Boolean),
    fields: [
      { key: 'getterName', label: 'Getter', kind: 'text', value: preparation.getterName },
      { key: 'generateSetter', label: 'Generate a setter', kind: 'checkbox', value: true },
      { key: 'setterName', label: 'Setter', kind: 'text', value: preparation.setterName },
      { key: 'updateAccesses', label: 'Rewrite accesses in this file', kind: 'checkbox', value: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  return encapsulateField(site, {
    getterName: String(values.getterName ?? '').trim(),
    setterName: String(values.setterName ?? '').trim(),
    generateSetter: Boolean(values.generateSetter),
    updateAccesses: Boolean(values.updateAccesses),
  })
}

async function invertBooleanFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareInvertBoolean(site, workspace)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'invert.boolean',
    title: `Invert Boolean “${preparation.name}”`,
    notes: [
      `${preparation.kind === 'function' ? `${preparation.valueCount} return statement(s)` : 'The initializer'} will be negated`,
      `${preparation.usageCount} usage(s) will be wrapped in a negation`,
    ],
    fields: [{ key: 'newName', label: 'New name', kind: 'text', value: preparation.suggestedName }],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return invertBoolean(site, { newName: String(values.newName ?? '').trim() }, workspace)
}

async function convertAnonymousFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareConvertAnonymous(site)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'convert.anonymous',
    title: `Convert Anonymous ${preparation.typeName} to Inner Class`,
    notes: [
      `${preparation.bodyLines} line(s) of body`,
      preparation.args ? `Constructor arguments: ${preparation.args}` : 'No constructor arguments',
    ],
    fields: [
      { key: 'name', label: 'Class name', kind: 'text', value: preparation.suggestedName },
      { key: 'nested', label: 'Nest it inside the enclosing class', kind: 'checkbox', value: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return convertAnonymousToInner(site, {
    name: String(values.name ?? '').trim(),
    nested: Boolean(values.nested),
  })
}

async function extractLocalFlow(
  id: 'extract.variable' | 'extract.constant' | 'extract.field',
  site: RefactorSite,
): Promise<RefactorResult | null> {
  const target = id === 'extract.variable' ? 'variable' : id === 'extract.constant' ? 'constant' : 'field'
  const preparation = prepareExtract(site, target)
  if (!preparation.ok) return preparation

  const fields: DialogField[] = [
    { key: 'name', label: 'Name', kind: 'text', value: preparation.suggestedName },
  ]
  if (preparation.typeRequired || preparation.inferredType) {
    fields.push({
      key: 'type',
      label: 'Type',
      kind: 'text',
      value: preparation.inferredType,
      hint: preparation.typeRequired ? 'required in this language' : 'optional',
    })
  }
  if (preparation.occurrenceCount > 1) {
    fields.push({
      key: 'replaceAll',
      label: `Replace all ${preparation.occurrenceCount} occurrences`,
      kind: 'checkbox',
      value: true,
    })
  }
  if (target === 'field' && site.language !== 'python') {
    fields.push({ key: 'isStatic', label: 'Static', kind: 'checkbox', value: false })
  }

  const values = await ask({
    id,
    title: `Extract ${target[0].toUpperCase()}${target.slice(1)}`,
    notes: [preparation.expression],
    fields,
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const options = {
    name: String(values.name ?? '').trim(),
    type: String(values.type ?? '').trim() || undefined,
    replaceAll: Boolean(values.replaceAll),
  }
  if (id === 'extract.variable') return extractVariable(site, options)
  if (id === 'extract.constant') return extractConstant(site, options)
  return extractField(site, { ...options, isStatic: Boolean(values.isStatic) })
}

async function extractParameterFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareExtract(site, 'parameter')
  if (!preparation.ok) return preparation
  if (!preparation.hasEnclosingFunction) {
    return { ok: false, reason: 'Extract Parameter needs a surrounding function.' }
  }

  const values = await ask({
    id: 'extract.parameter',
    title: `Extract Parameter from ${preparation.functionName}()`,
    notes: [preparation.expression],
    fields: [
      { key: 'name', label: 'Parameter name', kind: 'text', value: preparation.suggestedName },
      {
        key: 'type',
        label: 'Type',
        kind: 'text',
        value: preparation.inferredType,
        hint: preparation.typeRequired ? 'required in this language' : 'optional',
      },
      {
        key: 'useDefault',
        label: 'Give it a default value (keeps existing calls working)',
        kind: 'checkbox',
        value: true,
      },
      {
        key: 'updateCallSites',
        label: 'Otherwise: pass the value at every call site',
        kind: 'checkbox',
        value: true,
      },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  return extractParameter(
    site,
    {
      name: String(values.name ?? '').trim(),
      type: String(values.type ?? '').trim() || undefined,
      useDefault: Boolean(values.useDefault),
      updateCallSites: Boolean(values.updateCallSites),
    },
    workspace,
  )
}

async function extractMethodFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareExtractMethod(site)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'extract.method',
    title: preparation.isMethod ? `Extract Method from ${preparation.className}` : 'Extract Function',
    notes: [
      `${preparation.body.length} line(s) selected`,
      preparation.parameters.length
        ? `Parameters: ${preparation.parameters.join(', ')}`
        : 'No parameters detected',
      preparation.returns ? `Returns: ${preparation.returns}` : 'Returns nothing',
      ...preparation.warnings,
    ],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', value: preparation.suggestedName },
      {
        key: 'parameters',
        label: 'Parameters',
        kind: 'text',
        value: preparation.parameters.join(', '),
        hint: 'comma separated; edit to add, remove or reorder',
      },
      ...(preparation.returns
        ? [{ key: 'returns', label: 'Return variable', kind: 'text' as const, value: preparation.returns }]
        : []),
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const parameters = String(values.parameters ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, type] = entry.split(':').map((p) => p.trim())
      return { name, type: type || undefined }
    })

  return extractMethod(site, {
    name: String(values.name ?? '').trim(),
    parameters,
    returns: values.returns ? String(values.returns).trim() : null,
  })
}

async function inlineVariableFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareInlineVariable(site)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'inline.variable',
    title: `Inline Variable “${preparation.name}”`,
    notes: [`= ${preparation.value}`, `${preparation.usageCount} usage(s)`],
    fields: [
      { key: 'keepDeclaration', label: 'Keep the declaration', kind: 'checkbox', value: false },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return inlineVariable(site, { keepDeclaration: Boolean(values.keepDeclaration) })
}

async function inlineMethodFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareInlineMethod(site, workspace)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'inline.method',
    title: `Inline Method “${preparation.name}”`,
    notes: [`Body: ${preparation.body}`, `${preparation.callSiteCount} call site(s)`],
    fields: [
      { key: 'removeDeclaration', label: 'Remove the declaration afterwards', kind: 'checkbox', value: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null
  return inlineMethod(site, { removeDeclaration: Boolean(values.removeDeclaration) }, workspace)
}

async function changeSignatureFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareChangeSignature(site)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: 'signature.change',
    title: `Change Signature of ${preparation.functionName}()`,
    notes: [
      preparation.typeRequired ? 'This language needs a type on every parameter.' : '',
      'Reorder rows to reorder arguments at every call site. New rows need a call-site value.',
    ].filter(Boolean),
    fields: [
      { key: 'name', label: 'Name', kind: 'text', value: preparation.functionName },
      { key: 'returnType', label: 'Return type', kind: 'text', value: preparation.returnType },
      {
        key: 'params',
        label: 'Parameters',
        kind: 'params',
        value: preparation.params.map((param, index) => ({
          name: param.name,
          type: param.type,
          initializer: param.initializer,
          originalIndex: index,
          callSiteValue: '',
        })),
      },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  return changeSignature(
    site,
    {
      name: String(values.name ?? '').trim(),
      returnType: String(values.returnType ?? '').trim(),
      params: (values.params as never[]) ?? [],
    },
    workspace,
  )
}

async function parameterObjectFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = prepareChangeSignature(site)
  if (!preparation.ok) return preparation
  if (preparation.params.length < 2) {
    return { ok: false, reason: `\`${preparation.functionName}\` has fewer than two parameters.` }
  }

  const values = await ask({
    id: 'signature.parameterObject',
    title: `Introduce Parameter Object in ${preparation.functionName}()`,
    notes: ['Tick the parameters to fold into the new object.'],
    fields: [
      {
        key: 'typeName',
        label: 'Type name',
        kind: 'text',
        value: `${preparation.functionName[0].toUpperCase()}${preparation.functionName.slice(1)}Params`,
      },
      { key: 'parameterName', label: 'Parameter name', kind: 'text', value: 'params' },
      {
        key: 'indices',
        label: 'Parameters',
        kind: 'members',
        value: preparation.params.map((param, index) => ({
          id: String(index),
          label: param.raw,
          checked: true,
        })),
      },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const chosen = ((values.indices as { id: string; checked: boolean }[]) ?? [])
    .filter((entry) => entry.checked)
    .map((entry) => Number(entry.id))

  return introduceParameterObject(
    site,
    {
      typeName: String(values.typeName ?? '').trim(),
      parameterName: String(values.parameterName ?? '').trim(),
      indices: chosen,
    },
    workspace,
  )
}

async function moveFileFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const root = useStore.getState().root ?? ''
  const values = await ask({
    id: 'move.file',
    title: `Move ${site.file.split('/').pop()}`,
    notes: [site.file],
    fields: [
      { key: 'targetDir', label: 'Destination folder', kind: 'text', value: dirname(site.file) },
      { key: 'newName', label: 'File name', kind: 'text', value: site.file.split('/').pop() ?? '' },
      { key: 'updateImports', label: 'Update imports across the project', kind: 'checkbox', value: true },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  return moveFile(
    site,
    {
      targetDir: String(values.targetDir ?? '').trim(),
      newName: String(values.newName ?? '').trim(),
      root,
      updateImports: Boolean(values.updateImports),
    },
    workspace,
  )
}

async function moveClassFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareMoveClass(site, workspace)
  if (!preparation.ok) return preparation
  const root = useStore.getState().root ?? ''
  const suggested = `${dirname(site.file)}/${preparation.className}${extensionOf(site.file)}`

  const values = await ask({
    id: 'move.class',
    title: `Move Class “${preparation.className}”`,
    notes: [
      `${preparation.to - preparation.from + 1} line(s)`,
      preparation.referencingFiles.length
        ? `Referenced in ${preparation.referencingFiles.length} other file(s)`
        : 'No other file references it',
    ],
    fields: [
      { key: 'targetFile', label: 'Destination file', kind: 'text', value: suggested, hint: 'created if it does not exist' },
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  return moveClass(site, { targetFile: String(values.targetFile ?? '').trim(), root }, workspace)
}

function extensionOf(file: string) {
  const base = file.split('/').pop() ?? ''
  const index = base.lastIndexOf('.')
  return index <= 0 ? '' : base.slice(index)
}

async function membersFlow(site: RefactorSite, direction: 'up' | 'down'): Promise<RefactorResult | null> {
  const preparation = await prepareMembers(site, direction, workspace)
  if (!preparation.ok) return preparation

  const values = await ask({
    id: direction === 'up' ? 'members.pullUp' : 'members.pushDown',
    title: `${direction === 'up' ? 'Pull Up' : 'Push Down'} “${preparation.memberName}”`,
    notes: [
      `from ${preparation.sourceClass}`,
      `${preparation.memberLines.length} line(s)`,
    ],
    fields: [
      {
        key: 'targets',
        label: direction === 'up' ? 'Base class' : 'Subclasses',
        kind: 'members',
        value: preparation.targets.map((target, index) => ({
          id: String(index),
          label: `${target.name} — ${target.file.split('/').pop()}:${target.line + 1}`,
          checked: direction === 'up' ? index === 0 : true,
        })),
      },
      ...(direction === 'down'
        ? [{ key: 'keepOriginal', label: 'Keep the original member as well', kind: 'checkbox' as const, value: false }]
        : []),
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  const chosen = ((values.targets as { id: string; checked: boolean }[]) ?? [])
    .filter((entry) => entry.checked)
    .map((entry) => preparation.targets[Number(entry.id)])
    .filter(Boolean) as MemberTarget[]

  return moveMembers(
    site,
    { direction, targets: chosen, keepOriginal: Boolean(values.keepOriginal) },
    workspace,
  )
}

async function safeDeleteFlow(site: RefactorSite): Promise<RefactorResult | null> {
  const preparation = await prepareSafeDelete(site, workspace)
  if (!preparation.ok) return preparation

  const blocking = preparation.blocking
  const notes = [
    `${preparation.to - preparation.from + 1} line(s)`,
    blocking.length
      ? `${blocking.length} reference(s) would break: ${blocking.slice(0, 4).map((r) => `${r.file.split('/').pop()}:${r.line}`).join(', ')}${blocking.length > 4 ? '…' : ''}`
      : 'No references found — safe to delete.',
    ...(preparation.soft.length ? [`${preparation.soft.length} mention(s) in comments or strings.`] : []),
  ]

  const values = await ask({
    id: 'safeDelete',
    title: `Safe Delete “${preparation.name}”`,
    notes,
    fields: [
      ...(blocking.length
        ? [{ key: 'force', label: `Delete anyway, breaking ${blocking.length} reference(s)`, kind: 'checkbox' as const, value: false }]
        : []),
      ...(preparation.wholeFile
        ? [{ key: 'deleteFile', label: 'Delete the whole file', kind: 'checkbox' as const, value: false }]
        : []),
    ],
    confirmLabel: 'Preview',
  })
  if (!values) return null

  if (blocking.length > 0 && !values.force) {
    // Surface the blockers where the user can walk them.
    void useStore.getState().findUsages(preparation.name, site.file)
    return { ok: false, reason: `\`${preparation.name}\` is still used — see the Usages panel.` }
  }

  return safeDelete(
    site,
    { force: Boolean(values.force), deleteFile: Boolean(values.deleteFile) },
    workspace,
  )
}
