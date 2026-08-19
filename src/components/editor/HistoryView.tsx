import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { History, RotateCcw, Trash2 } from 'lucide-react'
import type { HistoryRevision } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, formatBytes } from '@/lib/paths'
import { languageForPath } from '@/lib/language'
import { enableSemanticHighlighting } from '@/lib/semanticTokens'

/**
 * Local History: every overwrite of a file is snapshotted, so work can be
 * recovered even when it was never committed — including edits made by the AI
 * console or a quick fix.
 */
export default function HistoryView({ path }: { path: string }) {
  const settings = useStore((s) => s.settings)
  const buffer = useStore((s) => s.buffers[path])
  const [revisions, setRevisions] = useState<HistoryRevision[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState('')

  const refresh = () => {
    void window.nova.fs.history(path).then((result) => {
      setRevisions(result)
      setSelected((current) => current ?? result[0]?.id ?? null)
    })
  }

  useEffect(refresh, [path])

  useEffect(() => {
    if (!selected) {
      setSnapshot('')
      return
    }
    void window.nova.fs.historyRead(path, selected).then(setSnapshot)
  }, [path, selected])

  const current = buffer?.content ?? ''

  return (
    <div className="diff-view">
      <div className="md-toolbar">
        <History size={13} style={{ color: 'var(--accent)' }} />
        <span className="chip">{basename(path)}</span>
        <span className="faint" style={{ fontSize: 11 }}>
          {revisions.length} revision{revisions.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        {selected && (
          <button
            className="btn sm"
            title="Replace the current file with this revision"
            onClick={async () => {
              await window.nova.fs.write(path, snapshot)
              await useStore.getState().reloadBuffer(path)
              useStore.getState().notify(`Restored ${basename(path)} from history`, 'success')
              refresh()
            }}
          >
            <RotateCcw size={12} /> Restore this revision
          </button>
        )}
        <button
          className="btn ghost sm"
          onClick={async () => {
            await window.nova.fs.historyClear(path)
            refresh()
            setSelected(null)
          }}
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      <div className="commit-body-split">
        <div className="commit-files">
          {revisions.map((revision) => (
            <button
              key={revision.id}
              className={`tree-row ${selected === revision.id ? 'selected' : ''}`}
              style={{ width: '100%', height: 'auto', paddingTop: 5, paddingBottom: 5 }}
              onClick={() => setSelected(revision.id)}
            >
              <span style={{ display: 'grid', gap: 1, textAlign: 'left', minWidth: 0 }}>
                <span className="tree-label" style={{ color: 'var(--text)' }}>
                  {new Date(revision.at).toLocaleString()}
                </span>
                <span className="faint" style={{ fontSize: 10.5 }}>
                  {revision.label} · {formatBytes(revision.size)}
                </span>
              </span>
            </button>
          ))}
          {revisions.length === 0 && (
            <div className="faint" style={{ padding: 14, fontSize: 12, lineHeight: 1.6 }}>
              No history yet. A revision is recorded each time this file is overwritten.
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selected ? (
            <DiffEditor
              original={snapshot}
              modified={current}
              language={languageForPath(path)}
              theme={settings.themeId}
              onMount={enableSemanticHighlighting}
              options={{
                readOnly: true,
                renderSideBySide: true,
                fontSize: settings.fontSize,
                fontFamily: settings.fontFamily,
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                renderOverviewRuler: false,
                padding: { top: 10 },
              }}
            />
          ) : (
            <div className="empty-state">
              <span className="faint">Select a revision to compare it with the current file.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
