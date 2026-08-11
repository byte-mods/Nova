import { useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { Columns2, FileText, Rows2, Undo2 } from 'lucide-react'
import { useStore, type Tab } from '@/state/store'
import { basename } from '@/lib/paths'

export default function DiffView({ tab }: { tab: Tab }) {
  const settings = useStore((s) => s.settings)
  const [inline, setInline] = useState(false)
  const diff = tab.diff

  if (!diff) return <div className="empty-state">Nothing to compare.</div>

  const additions = countLines(diff.before, diff.after)

  return (
    <div className="diff-view">
      <div className="md-toolbar">
        <span className="chip">{tab.subtitle ?? basename(tab.path ?? '')}</span>
        <span className="chip" style={{ color: 'var(--added)' }}>
          +{additions.added}
        </span>
        <span className="chip" style={{ color: 'var(--removed)' }}>
          −{additions.removed}
        </span>
        <div className="segmented" style={{ marginLeft: 'auto' }}>
          <button className={!inline ? 'active' : ''} onClick={() => setInline(false)}>
            <Columns2 size={12} /> Side by side
          </button>
          <button className={inline ? 'active' : ''} onClick={() => setInline(true)}>
            <Rows2 size={12} /> Inline
          </button>
        </div>
        {tab.path && (
          <button className="btn sm" onClick={() => void useStore.getState().openFile(tab.path!)}>
            <FileText size={12} /> Open file
          </button>
        )}
        {diff.targetPath && (
          <button
            className="btn sm"
            title="Write the original content back to disk"
            onClick={async () => {
              await window.nova.fs.write(diff.targetPath!, diff.before)
              await useStore.getState().reloadBuffer(diff.targetPath!)
              await useStore.getState().refreshGit()
              useStore.getState().notify(`Reverted ${basename(diff.targetPath!)}`, 'success')
            }}
          >
            <Undo2 size={12} /> Revert
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          original={diff.before}
          modified={diff.after}
          language={diff.language}
          theme={settings.themeId}
          options={{
            renderSideBySide: !inline,
            fontSize: settings.fontSize,
            fontFamily: settings.fontFamily,
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderOverviewRuler: false,
            padding: { top: 10 },
          }}
        />
      </div>
    </div>
  )
}

function countLines(before: string, after: string) {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const counts = new Map<string, number>()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of b) {
    const n = counts.get(line) ?? 0
    if (n > 0) counts.set(line, n - 1)
    else added++
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  return { added, removed }
}
