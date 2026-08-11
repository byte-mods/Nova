import { useEffect, useMemo, useState } from 'react'
import type { GitBlameLine } from '@shared/types'
import { useStore } from '@/state/store'
import { timeAgo } from '@/lib/paths'

/**
 * Per-line authorship shown beside the editor. Rendered as a scroll-synced
 * column rather than Monaco decorations so the text stays selectable and the
 * widths line up with the editor's own line height.
 */
export default function BlameGutter({ path, lineHeight }: { path: string; lineHeight: number }) {
  const root = useStore((s) => s.root)
  const git = useStore((s) => s.git)
  const [blame, setBlame] = useState<GitBlameLine[]>([])
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    if (!root || !git?.isRepo) return
    let cancelled = false
    void window.nova.git.blame(root, path).then((result) => {
      if (!cancelled) setBlame(result)
    })
    return () => {
      cancelled = true
    }
  }, [root, path, git?.isRepo])

  useEffect(() => {
    const onScroll = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; scrollTop: number }
      if (detail.path === path) setScrollTop(detail.scrollTop)
    }
    window.addEventListener('nova:editor-scroll', onScroll)
    return () => window.removeEventListener('nova:editor-scroll', onScroll)
  }, [path])

  // Only label the first line of each contiguous run from the same commit.
  const rows = useMemo(
    () =>
      blame.map((line, index) => ({
        ...line,
        first: index === 0 || blame[index - 1].hash !== line.hash,
      })),
    [blame],
  )

  if (rows.length === 0) return null

  return (
    <div className="blame-gutter">
      <div style={{ transform: `translateY(${-scrollTop}px)`, paddingTop: 12 }}>
        {rows.map((row) => (
          <button
            key={row.line}
            className={`blame-row ${row.uncommitted ? 'uncommitted' : ''}`}
            style={{ height: lineHeight }}
            title={
              row.uncommitted
                ? 'Not committed yet'
                : `${row.summary}\n${row.author} · ${new Date(row.date * 1000).toLocaleString()}\n${row.hash}`
            }
            onClick={() => {
              if (row.uncommitted) return
              useStore.getState().openTab({
                id: `commit:${row.hash}`,
                kind: 'commit',
                title: row.shortHash,
                subtitle: row.summary,
                commitHash: row.hash,
              })
            }}
          >
            {row.first && (
              <>
                <span className="blame-author">
                  {row.uncommitted ? 'uncommitted' : row.author}
                </span>
                {!row.uncommitted && (
                  <span className="blame-date">{timeAgo(row.date)}</span>
                )}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
