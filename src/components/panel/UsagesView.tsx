import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Quote, Slash, Target, X } from 'lucide-react'
import type { CodeReference, ReferenceKind } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'

const KIND_LABEL: Record<ReferenceKind, string> = {
  declaration: 'declaration',
  code: 'usage',
  import: 'import',
  comment: 'comment',
  string: 'string',
}

const KIND_COLOR: Record<ReferenceKind, string> = {
  declaration: 'var(--accent)',
  code: 'var(--text-muted)',
  import: 'var(--info)',
  comment: 'var(--text-faint)',
  string: 'var(--syn-string)',
}

export default function UsagesView() {
  const usages = useStore((s) => s.usages)
  const root = useStore((s) => s.root) ?? ''
  const iconPack = useStore((s) => s.settings.iconPack)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [includeSoft, setIncludeSoft] = useState(false)

  const visible = useMemo(() => {
    if (!usages) return []
    return includeSoft
      ? usages.references
      : usages.references.filter((r) => r.kind !== 'comment' && r.kind !== 'string')
  }, [usages, includeSoft])

  const grouped = useMemo(() => {
    const map = new Map<string, CodeReference[]>()
    for (const ref of visible) {
      const list = map.get(ref.file)
      if (list) list.push(ref)
      else map.set(ref.file, [ref])
    }
    return [...map.entries()]
  }, [visible])

  const softCount = usages
    ? usages.references.length - usages.references.filter((r) => r.kind !== 'comment' && r.kind !== 'string').length
    : 0

  if (!usages) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="faint">
          Put the caret on a symbol and press <span className="kbd">⌥F7</span>, or right-click →
          Find Usages.
        </span>
      </div>
    )
  }

  return (
    <div className="usages">
      <div className="usages-header">
        <Target size={13} style={{ color: 'var(--accent)' }} />
        <b className="mono">{usages.name}</b>
        {usages.loading ? (
          <Loader2 size={12} className="spin faint" />
        ) : (
          <span className="faint">
            {visible.length} {visible.length === 1 ? 'result' : 'results'} in {grouped.length}{' '}
            {grouped.length === 1 ? 'file' : 'files'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {softCount > 0 && (
          <button
            className={`btn ghost sm ${includeSoft ? 'active' : ''}`}
            onClick={() => setIncludeSoft((v) => !v)}
            title="Include matches inside comments and string literals"
          >
            <Quote size={11} />
            {includeSoft ? 'Hide' : 'Show'} {softCount} soft
          </button>
        )}
        <button
          className="icon-btn"
          title="Clear"
          onClick={() => useStore.getState().clearUsages()}
        >
          <X size={14} />
        </button>
      </div>

      <div className="usages-body">
        {!usages.loading && grouped.length === 0 && (
          <div className="faint" style={{ padding: 16 }}>
            <Slash size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
            No usages found for <b className="mono">{usages.name}</b>.
          </div>
        )}

        {grouped.map(([file, refs]) => {
          const { Icon, color } = fileIcon(file, iconPack)
          const isCollapsed = collapsed[file]
          return (
            <div key={file}>
              <button
                className="tree-row"
                style={{ width: '100%', paddingLeft: 8 }}
                onClick={() => setCollapsed((c) => ({ ...c, [file]: !c[file] }))}
              >
                <span className="tree-twisty">
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </span>
                <Icon size={14} style={{ color, flexShrink: 0 }} />
                <span className="tree-label">{basename(file)}</span>
                <span className="faint" style={{ fontSize: 10.5 }}>
                  {relative(root, file)}
                </span>
                <span className="chip" style={{ height: 16 }}>
                  {refs.length}
                </span>
              </button>

              {!isCollapsed &&
                refs.map((ref, i) => (
                  <button
                    key={`${ref.line}:${ref.column}:${i}`}
                    className="tree-row usage-row"
                    style={{ width: '100%', paddingLeft: 34 }}
                    onClick={() =>
                      void useStore
                        .getState()
                        .openFile(ref.file, { line: ref.line, column: ref.column })
                    }
                    title={`${relative(root, ref.file)}:${ref.line}:${ref.column}`}
                  >
                    <span className="faint mono" style={{ fontSize: 11, minWidth: 38, textAlign: 'right' }}>
                      {ref.line}
                    </span>
                    <span className="usage-preview mono">
                      {highlight(ref.preview, usages.name, ref.column)}
                    </span>
                    <span
                      className="usage-kind"
                      style={{ color: KIND_COLOR[ref.kind] }}
                    >
                      {KIND_LABEL[ref.kind]}
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}

/** Bolds the matched identifier inside its source line. */
function highlight(preview: string, name: string, column: number) {
  const start = column - 1
  if (preview.slice(start, start + name.length) !== name) return preview.trim()
  const leading = preview.length - preview.trimStart().length
  return (
    <>
      {preview.slice(leading, start)}
      <b className="usage-match">{name}</b>
      {preview.slice(start + name.length)}
    </>
  )
}
