import type { AppliedEdit } from '@shared/types'
import { useStore } from '@/state/store'
import { uriToPath, type LspTextEdit } from './lspConvert'
import { applyEdits } from './applyEdits'

interface DocumentChange {
  textDocument?: { uri: string; version?: number | null }
  edits?: LspTextEdit[]
  /** Resource operations. */
  kind?: 'create' | 'rename' | 'delete'
  uri?: string
  oldUri?: string
  newUri?: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export interface WorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: DocumentChange[]
}

/**
 * Applies an LSP WorkspaceEdit across the project: text edits go through the
 * open buffer when there is one (so undo history and dirty state stay honest)
 * and straight to disk otherwise.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit | null | undefined) {
  const applied: AppliedEdit[] = []
  if (!edit) return applied

  const store = useStore.getState()

  // Resource operations first — later text edits may target created files.
  for (const change of edit.documentChanges ?? []) {
    if (!change.kind) continue
    if (change.kind === 'create' && change.uri) {
      const target = uriToPath(change.uri)
      const exists = await window.nova.fs.exists(target)
      if (!exists || change.options?.overwrite) await window.nova.fs.write(target, '')
      applied.push({ path: target, edits: 0, created: true })
    } else if (change.kind === 'rename' && change.oldUri && change.newUri) {
      const from = uriToPath(change.oldUri)
      const to = uriToPath(change.newUri)
      await window.nova.fs.rename(from, to)
      store.closeTab(`file:${from}`)
      applied.push({ path: to, edits: 0, created: true })
      applied.push({ path: from, edits: 0, deleted: true })
    } else if (change.kind === 'delete' && change.uri) {
      const target = uriToPath(change.uri)
      await window.nova.fs.trash(target)
      store.closeTab(`file:${target}`)
      applied.push({ path: target, edits: 0, deleted: true })
    }
  }

  // Collect text edits from both shapes.
  const byFile = new Map<string, LspTextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const file = uriToPath(uri)
    byFile.set(file, [...(byFile.get(file) ?? []), ...edits])
  }
  for (const change of edit.documentChanges ?? []) {
    if (change.kind || !change.textDocument?.uri || !change.edits) continue
    const file = uriToPath(change.textDocument.uri)
    byFile.set(file, [...(byFile.get(file) ?? []), ...change.edits])
  }

  const skipped: string[] = []

  for (const [file, edits] of byFile) {
    if (edits.length === 0) continue
    const current = await readCurrent(file)
    if (current === null) continue
    let next: string
    try {
      next = applyEdits(current, edits)
    } catch {
      // Conflicting edits: leave the file untouched and report it rather than
      // writing a half-applied result.
      skipped.push(file)
      continue
    }
    if (next === current) continue

    const buffer = useStore.getState().buffers[file]
    if (buffer) {
      // Route through the store so the tab shows as modified and can be undone.
      useStore.getState().updateBuffer(file, next)
      await useStore.getState().saveBuffer(file)
    } else {
      await window.nova.fs.write(file, next)
    }
    applied.push({ path: file, edits: edits.length })
  }

  if (skipped.length) {
    useStore
      .getState()
      .notify(
        `Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} with conflicting edits: ${skipped
          .map((f) => f.split('/').pop())
          .join(', ')}`,
        'error',
      )
  }

  if (applied.length) {
    useStore.getState().bumpTree()
    void useStore.getState().refreshGit()
  }
  return applied
}

async function readCurrent(file: string): Promise<string | null> {
  const buffer = useStore.getState().buffers[file]
  if (buffer) return buffer.content
  try {
    const result = await window.nova.fs.read(file)
    return result.binary ? null : result.content
  } catch {
    return null
  }
}
