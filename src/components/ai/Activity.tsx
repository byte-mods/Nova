/**
 * The compact activity feed.
 *
 * A run produces a lot of mechanical noise — twenty tool calls, six file
 * writes — and rendering each as a full block buries the two sentences of
 * reasoning that actually matter. So each action collapses to one line with the
 * shape `Created normalize.rs +173 -0 ›`, consecutive commands group into
 * `Ran 3 commands ›`, and everything expands on click.
 *
 * The counts are the point. "Created a file" tells you nothing; "+173 −0" tells
 * you whether to go and read it.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { diffLines } from 'diff'
import type { FileChange } from '@shared/types'
import type { AiMessagePart } from '@/state/store'
import { basename } from '@/lib/paths'
import { openChangeDiff } from './AiConsole'

export interface LineDelta {
  added: number
  removed: number
}

/**
 * Counts changed lines.
 *
 * `diffLines` rather than a length comparison so a rewritten line counts as one
 * added and one removed, which is what a reviewer expects to see.
 */
export function countDelta(before: string, after: string): LineDelta {
  let added = 0
  let removed = 0
  for (const part of diffLines(before ?? '', after ?? '')) {
    const lines = part.count ?? part.value.split('\n').length - 1
    if (part.added) added += lines
    else if (part.removed) removed += lines
  }
  return { added, removed }
}

/** "Created" for a file that did not exist, "Updated" otherwise. */
function verbFor(change: FileChange): string {
  if (!change.before) return 'Created'
  if (!change.after) return 'Deleted'
  return 'Updated'
}

export function ChangeLine({ change, root }: { change: FileChange; root: string }) {
  const delta = useMemo(() => countDelta(change.before, change.after), [change.before, change.after])

  return (
    <button
      className="activity-line"
      title={change.path}
      onClick={() => openChangeDiff(change, root)}
    >
      <span className="activity-verb">{verbFor(change)}</span>
      <span className="activity-file">{basename(change.path)}</span>
      {delta.added > 0 && <span className="activity-add">+{delta.added}</span>}
      {delta.removed > 0 && <span className="activity-del">-{delta.removed}</span>}
      <ChevronRight size={11} className="activity-chevron" />
    </button>
  )
}

/**
 * A run of consecutive tool calls, collapsed to one line.
 *
 * Grouping is by adjacency rather than by kind: the user is reading a
 * chronological narrative, and reordering the actions to group them by tool
 * would misrepresent what happened.
 */
export function CommandGroup({ parts }: { parts: AiMessagePart[] }) {
  const [open, setOpen] = useState(false)
  if (!parts.length) return null

  const label =
    parts.length === 1
      ? summarise(parts[0])
      : `Ran ${parts.length} commands`

  return (
    <div className="activity-group">
      <button className="activity-line" onClick={() => setOpen((v) => !v)}>
        <Terminal size={11} className="activity-icon" />
        <span className="activity-verb">{label}</span>
        {open ? (
          <ChevronDown size={11} className="activity-chevron" />
        ) : (
          <ChevronRight size={11} className="activity-chevron" />
        )}
      </button>

      {open && (
        <div className="activity-detail">
          {parts.map((part, i) => (
            <div key={i} className="activity-detail-item">
              <div className="activity-detail-head mono">
                <span className={part.toolOk === false ? 'activity-fail' : ''}>
                  {part.toolName ?? 'tool'}
                </span>
                <span className="faint">{summariseInput(part.toolInput)}</span>
              </div>
              {part.toolResult && <pre className="mono">{part.toolResult.slice(0, 4000)}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function summarise(part: AiMessagePart): string {
  const name = part.toolName ?? 'tool'
  const input = summariseInput(part.toolInput)
  return input ? `${name} ${input}` : `Ran ${name}`
}

/** Pulls the one field worth showing out of a tool's arguments. */
function summariseInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url']) {
    const value = record[key]
    if (typeof value === 'string' && value) {
      return value.length > 70 ? `${value.slice(0, 67)}…` : value
    }
  }
  return ''
}
