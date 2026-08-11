import { useStore } from '@/state/store'
import { applyEdits } from './applyEdits'
import { uriToPath, type LspTextEdit } from './lspConvert'
import type { WorkspaceEdit } from './workspaceEdit'

export interface PreviewFile {
  path: string
  edits: number
  before: string
  after: string
  /** Line numbers (1-based) that the edits touch, for the summary. */
  lines: number[]
}

export interface EditPreview {
  title: string
  files: PreviewFile[]
  resourceOps: string[]
  edit: WorkspaceEdit
}

let resolver: ((approved: boolean) => void) | null = null

/**
 * Shows what a refactoring would change and waits for the user's decision.
 * IntelliJ does the same before a rename lands — the edits are cross-file and
 * often not fully undoable in one step.
 */
export async function requestApproval(title: string, edit: WorkspaceEdit): Promise<boolean> {
  const preview = await buildPreview(title, edit)
  if (preview.files.length === 0 && preview.resourceOps.length === 0) return false

  useStore.setState({ editPreview: preview })
  return new Promise<boolean>((resolve) => {
    resolver = resolve
  })
}

export function resolveApproval(approved: boolean) {
  useStore.setState({ editPreview: null })
  resolver?.(approved)
  resolver = null
}

async function buildPreview(title: string, edit: WorkspaceEdit): Promise<EditPreview> {
  const byFile = new Map<string, LspTextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const file = uriToPath(uri)
    byFile.set(file, [...(byFile.get(file) ?? []), ...edits])
  }
  const resourceOps: string[] = []
  for (const change of edit.documentChanges ?? []) {
    if (change.kind) {
      if (change.kind === 'create') resourceOps.push(`create ${uriToPath(change.uri ?? '')}`)
      else if (change.kind === 'delete') resourceOps.push(`delete ${uriToPath(change.uri ?? '')}`)
      else if (change.kind === 'rename') {
        resourceOps.push(`rename ${uriToPath(change.oldUri ?? '')} → ${uriToPath(change.newUri ?? '')}`)
      }
      continue
    }
    if (!change.textDocument?.uri || !change.edits) continue
    const file = uriToPath(change.textDocument.uri)
    byFile.set(file, [...(byFile.get(file) ?? []), ...change.edits])
  }

  const files: PreviewFile[] = []
  for (const [path, edits] of byFile) {
    const before = await readCurrent(path)
    if (before === null) continue
    let after: string
    try {
      after = applyEdits(before, edits)
    } catch {
      continue
    }
    files.push({
      path,
      edits: edits.length,
      before,
      after,
      lines: [...new Set(edits.map((e) => e.range.start.line + 1))].sort((a, b) => a - b),
    })
  }

  files.sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path))
  return { title, files, resourceOps, edit }
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
