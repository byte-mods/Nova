/**
 * History for Selection — `git log -L` over the lines the user had selected.
 *
 * The commit list is on the left and the diff of the traced range on the
 * right, which reads like Show History for Selection in IntelliJ: each entry
 * is one time the block actually changed, renames followed, unrelated commits
 * skipped by git itself.
 */

import { useEffect, useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { useStore, type Tab } from '@/state/store'
import { relative, timeAgo } from '@/lib/paths'

interface Entry {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: number
  diff: string
}

export default function LineHistoryView({ tab }: { tab: Tab }) {
  const root = useStore((s) => s.root) ?? ''
  const file = tab.path!
  const range = tab.lineRange ?? { from: 1, to: 1 }
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.nova.git.lineHistory(root, file, range.from, range.to).then((result) => {
      if (cancelled) return
      if (!result.ok) setError(result.out || 'git log -L failed')
      else setEntries(result.entries)
    })
    return () => {
      cancelled = true
    }
  }, [root, file, range.from, range.to])

  if (error) return <div className="empty-state">{error}</div>
  if (!entries) return <div className="empty-state">Tracing lines {range.from}–{range.to}…</div>
  if (entries.length === 0) {
    return <div className="empty-state">No commit has touched those lines.</div>
  }

  const current = entries[selected]

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 300, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
        <div className="faint" style={{ padding: '8px 12px', fontSize: 11 }}>
          {relative(root, file)} · lines {range.from}–{range.to}
        </div>
        {entries.map((entry, index) => (
          <button
            key={entry.hash}
            className={`tree-row ${index === selected ? 'selected' : ''}`}
            style={{ width: '100%', paddingLeft: 12, height: 'auto', paddingTop: 5, paddingBottom: 5 }}
            onClick={() => setSelected(index)}
            title={`${entry.subject}\n${entry.hash}`}
          >
            <GitCommitHorizontal size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ display: 'grid', gap: 1, minWidth: 0, textAlign: 'left' }}>
              <span className="tree-label" style={{ color: 'var(--text)' }}>{entry.subject}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>
                {entry.author} · {timeAgo(entry.date)} · {entry.shortHash}
              </span>
            </span>
          </button>
        ))}
      </div>
      <pre className="test-output mono" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
        {current ? renderDiff(current.diff) : ''}
      </pre>
    </div>
  )
}

/** Strips the noisy `diff --git` header; the hunks are the story here. */
function renderDiff(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => !/^(diff --git|index |--- |\+\+\+ )/.test(line))
    .join('\n')
    .trim()
}

/** Opens History for Selection on the given range. */
export function openLineHistory(file: string, from: number, to: number) {
  useStore.getState().openTab({
    id: `linehistory:${file}:${from}-${to}`,
    kind: 'linehistory',
    title: `${file.split('/').pop()}:${from}-${to} — history`,
    path: file,
    lineRange: { from, to },
  })
}
