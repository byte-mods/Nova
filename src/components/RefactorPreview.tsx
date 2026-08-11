import { useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { Check, FileWarning, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { resolveApproval } from '@/lib/editPreview'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { languageForPath } from '@/lib/language'

/** Confirmation step for cross-file refactorings, with a per-file diff. */
export default function RefactorPreview() {
  const preview = useStore((s) => s.editPreview)
  const root = useStore((s) => s.root) ?? ''
  const settings = useStore((s) => s.settings)
  const iconPack = settings.iconPack
  const [selected, setSelected] = useState(0)

  if (!preview) return null

  const totalEdits = preview.files.reduce((sum, f) => sum + f.edits, 0)
  const file = preview.files[Math.min(selected, preview.files.length - 1)]

  return (
    <div className="overlay" style={{ paddingTop: 60 }} onMouseDown={() => resolveApproval(false)}>
      <div
        className="modal refactor-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="refactor-head">
          <b>{preview.title}</b>
          <span className="faint">
            {totalEdits} edit{totalEdits === 1 ? '' : 's'} across {preview.files.length} file
            {preview.files.length === 1 ? '' : 's'}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => resolveApproval(false)}>
            <X size={12} /> Cancel
          </button>
          <button className="btn primary sm" onClick={() => resolveApproval(true)}>
            <Check size={12} /> Apply
          </button>
        </div>

        {preview.resourceOps.length > 0 && (
          <div className="refactor-ops">
            <FileWarning size={12} />
            {preview.resourceOps.join(' · ')}
          </div>
        )}

        <div className="refactor-body">
          <div className="refactor-files">
            {preview.files.map((entry, index) => {
              const { Icon, color } = fileIcon(entry.path, iconPack)
              return (
                <button
                  key={entry.path}
                  className={`tree-row ${index === selected ? 'selected' : ''}`}
                  style={{ width: '100%' }}
                  onClick={() => setSelected(index)}
                  title={relative(root, entry.path)}
                >
                  <Icon size={13} style={{ color, flexShrink: 0 }} />
                  <span className="tree-label">{basename(entry.path)}</span>
                  <span className="chip" style={{ height: 16 }}>{entry.edits}</span>
                </button>
              )
            })}
          </div>
          <div className="refactor-diff">
            {file && (
              <DiffEditor
                original={file.before}
                modified={file.after}
                language={languageForPath(file.path)}
                theme={settings.themeId}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  fontSize: settings.fontSize,
                  fontFamily: settings.fontFamily,
                  automaticLayout: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderOverviewRuler: false,
                  padding: { top: 8 },
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
