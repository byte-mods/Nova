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
  extractConstant,
  extractField,
  extractMethod,
  extractParameter,
  extractVariable,
  inlineMethod,
  inlineVariable,
  introduceParameterObject,
  moveClass,
  moveFile,
  moveMembers,
  prepareChangeSignature,
  prepareExtract,
  prepareExtractMethod,
  prepareInlineMethod,
  prepareInlineVariable,
  prepareMembers,
  prepareMoveClass,
  prepareSafeDelete,
  safeDelete,
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
