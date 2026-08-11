import { ChevronDown, ChevronRight, Loader2, Network, X } from 'lucide-react'
import { useStore, type HierarchyMode, type HierarchyNode } from '@/state/store'
import { basename, relative } from '@/lib/paths'

const MODES: { id: HierarchyMode; label: string; hint: string }[] = [
  { id: 'callers', label: 'Callers', hint: 'Who calls this' },
  { id: 'callees', label: 'Callees', hint: 'What this calls' },
  { id: 'supertypes', label: 'Supertypes', hint: 'Base classes and interfaces' },
  { id: 'subtypes', label: 'Subtypes', hint: 'Implementations and subclasses' },
]

/** LSP SymbolKind -> a compact badge, matching the symbol palette's language. */
const KIND_GLYPH: Record<number, { glyph: string; color: string }> = {
  5: { glyph: 'C', color: '#e0af68' },   // Class
  6: { glyph: 'm', color: '#9ece6a' },   // Method
  9: { glyph: 'c', color: '#e0af68' },   // Constructor
  11: { glyph: 'I', color: '#7dcfff' },  // Interface
  12: { glyph: 'ƒ', color: '#9ece6a' },  // Function
  13: { glyph: 'v', color: '#a0aec0' },  // Variable
  14: { glyph: 'k', color: '#ff9e64' },  // Constant
  23: { glyph: 'S', color: '#e0af68' },  // Struct
  10: { glyph: 'E', color: '#bb9af7' },  // Enum
}

export default function HierarchyView() {
  const hierarchy = useStore((s) => s.hierarchy)
  const root = useStore((s) => s.root) ?? ''

  if (!hierarchy) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="faint">
          Put the caret on a function or type, then right-click → Call Hierarchy (
          <span className="kbd">⌃⌥H</span>) or Type Hierarchy (<span className="kbd">⌃H</span>).
        </span>
      </div>
    )
  }

  return (
    <div className="usages">
      <div className="usages-header">
        <Network size={13} style={{ color: 'var(--accent)' }} />
        <b className="mono">{hierarchy.rootName || '—'}</b>
        {hierarchy.loading && <Loader2 size={12} className="spin faint" />}
        <div className="segmented" style={{ marginLeft: 10 }}>
          {MODES.map((mode) => {
            const group = mode.id === 'callers' || mode.id === 'callees' ? 'calls' : 'types'
            const unsupported = hierarchy.supported && !hierarchy.supported[group]
            return (
              <button
                key={mode.id}
                className={hierarchy.mode === mode.id ? 'active' : ''}
                title={unsupported ? `Not supported by this language server` : mode.hint}
                disabled={unsupported}
                style={unsupported ? { opacity: 0.4, cursor: 'default' } : undefined}
                onClick={() => void useStore.getState().setHierarchyMode(mode.id)}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn"
          title="Clear"
          onClick={() => useStore.setState({ hierarchy: null })}
        >
          <X size={14} />
        </button>
      </div>

      <div className="usages-body">
        {hierarchy.error && (
          <div className="faint" style={{ padding: 16, lineHeight: 1.6 }}>
            {hierarchy.error}
          </div>
        )}
        {hierarchy.nodes.map((node) => (
          <Row key={node.id} node={node} depth={0} root={root} />
        ))}
        {!hierarchy.loading && !hierarchy.error && hierarchy.nodes.length === 0 && (
          <div className="faint" style={{ padding: 16 }}>
            Nothing found.
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}

function Row({ node, depth, root }: { node: HierarchyNode; depth: number; root: string }) {
  const glyph = KIND_GLYPH[node.kind] ?? { glyph: '·', color: 'var(--text-muted)' }
  const hasChildren = node.children === undefined || node.children.length > 0

  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <button
          className="tree-twisty"
          style={{ background: 'none' }}
          onClick={(e) => {
            e.stopPropagation()
            void useStore.getState().toggleHierarchyNode(node.id)
          }}
          title={node.expanded ? 'Collapse' : 'Expand'}
        >
          {node.loading ? (
            <Loader2 size={11} className="spin" />
          ) : hasChildren ? (
            node.expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
        </button>

        <span className="symbol-glyph" style={{ color: glyph.color }}>
          {glyph.glyph}
        </span>

        <button
          className="tree-label"
          style={{ textAlign: 'left', background: 'none' }}
          onClick={() =>
            void useStore
              .getState()
              .openFile(node.file, { line: node.line, column: node.column })
          }
          title={`${relative(root, node.file)}:${node.line}`}
        >
          <span className="mono">{node.name}</span>
          {node.detail && (
            <span className="faint" style={{ fontSize: 10.5, marginLeft: 8 }}>
              {node.detail}
            </span>
          )}
        </button>

        {node.callSites && node.callSites.length > 0 && (
          <span className="chip" style={{ height: 16 }} title="Call sites in this function">
            {node.callSites.length}
          </span>
        )}

        <span className="faint" style={{ fontSize: 10.5 }}>
          {basename(node.file)}:{node.line}
        </span>
      </div>

      {node.expanded &&
        node.children?.map((child) => (
          <Row key={child.id} node={child} depth={depth + 1} root={root} />
        ))}
      {node.expanded && node.children?.length === 0 && (
        <div
          className="faint"
          style={{ paddingLeft: 8 + (depth + 1) * 14 + 20, fontSize: 11.5, height: 22 }}
        >
          none
        </div>
      )}
    </>
  )
}
