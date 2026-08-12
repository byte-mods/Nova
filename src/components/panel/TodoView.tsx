import { useEffect, useMemo, useState } from 'react'
import { ListTodo, RefreshCw } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { useStore } from '@/state/store'
import { relative } from '@/lib/paths'

const TAGS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'NOTE'] as const
type Tag = (typeof TAGS)[number]

const TAG_COLOUR: Record<Tag, string> = {
  TODO: 'var(--accent)',
  FIXME: 'var(--danger)',
  HACK: 'var(--warning)',
  XXX: 'var(--danger)',
  BUG: 'var(--danger)',
  NOTE: 'var(--text-faint)',
}

interface Item extends SearchHit {
  tag: Tag
  text: string
}

/**
 * IntelliJ's TODO tool window: every tagged comment in the project, grouped by
 * file. It reuses the project search backend rather than a second scanner, so
 * it honours the same ignore rules the rest of the IDE does.
 */
export default function TodoView() {
  const root = useStore((s) => s.root)
  const treeVersion = useStore((s) => s.treeVersion)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<Set<Tag>>(new Set(TAGS))

  const scan = async () => {
    if (!root) return
    setLoading(true)
    try {
      const hits = await window.nova.fs.search(root, `\\b(${TAGS.join('|')})\\b[:\\s]`, {
        regex: true,
        caseSensitive: true,
        maxHits: 800,
      })
      const parsed: Item[] = []
      for (const hit of hits as SearchHit[]) {
        const match = new RegExp(`\\b(${TAGS.join('|')})\\b[:\\s]+(.*)$`).exec(hit.preview)
        if (!match) continue
        parsed.push({ ...hit, tag: match[1] as Tag, text: match[2].trim().slice(0, 160) })
      }
      setItems(parsed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void scan()
  }, [root, treeVersion])

  const grouped = useMemo(() => {
    const visible = items.filter((item) => active.has(item.tag))
    const byFile = new Map<string, Item[]>()
    for (const item of visible) byFile.set(item.path, [...(byFile.get(item.path) ?? []), item])
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items, active])

  const counts = useMemo(() => {
    const map = new Map<Tag, number>()
    for (const item of items) map.set(item.tag, (map.get(item.tag) ?? 0) + 1)
    return map
  }, [items])

  const total = grouped.reduce((sum, [, list]) => sum + list.length, 0)

  return (
    <div className="pane-body">
      <div className="usages-header">
        <ListTodo size={13} style={{ color: 'var(--accent)' }} />
        <b>
          {total} item{total === 1 ? '' : 's'}
        </b>
        <span className="faint">in {grouped.length} file{grouped.length === 1 ? '' : 's'}</span>
        <span style={{ display: 'flex', gap: 5, marginLeft: 12 }}>
          {TAGS.filter((tag) => counts.get(tag)).map((tag) => (
            <button
              key={tag}
              className={`chip ${active.has(tag) ? '' : 'muted'}`}
              style={{ color: active.has(tag) ? TAG_COLOUR[tag] : undefined, cursor: 'pointer' }}
              onClick={() => {
                const next = new Set(active)
                if (next.has(tag)) next.delete(tag)
                else next.add(tag)
                setActive(next)
              }}
            >
              {tag} {counts.get(tag)}
            </button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => void scan()} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> Rescan
        </button>
      </div>

      <div className="usages-list">
        {total === 0 && !loading && (
          <div className="empty-state">
            <span className="faint">No TODO comments found.</span>
          </div>
        )}
        {grouped.map(([file, list]) => (
          <div key={file}>
            <div className="section-header">
              {relative(root ?? '', file)}
              <span className="chip">{list.length}</span>
            </div>
            {list.map((item) => (
              <button
                key={`${item.path}:${item.line}:${item.column}`}
                className="usage-row"
                onClick={() =>
                  void useStore.getState().openFile(item.path, { line: item.line, column: item.column })
                }
              >
                <span className="chip" style={{ color: TAG_COLOUR[item.tag] }}>
                  {item.tag}
                </span>
                <span className="usage-preview">{item.text || '(no description)'}</span>
                <span className="faint" style={{ marginLeft: 'auto' }}>
                  :{item.line}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
