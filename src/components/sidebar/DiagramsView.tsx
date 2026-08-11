import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Shapes } from 'lucide-react'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { createDiagramFile, TEMPLATES, type TemplateId } from '@/components/diagram/diagramFile'

export default function DiagramsView() {
  const root = useStore((s) => s.root)
  const treeVersion = useStore((s) => s.treeVersion)
  const activeTabId = useStore((s) => s.activeTabId)
  const [files, setFiles] = useState<string[]>([])

  useEffect(() => {
    if (!root) return
    void window.nova.fs
      .findFiles(root, 'nova-diagram')
      .then((result) => setFiles(result.filter((f) => f.endsWith('.nova-diagram.json'))))
  }, [root, treeVersion])

  if (!root) {
    return (
      <>
        <div className="sidebar-header">
          <span className="sidebar-title">Diagrams</span>
        </div>
        <div className="faint" style={{ padding: 14 }}>
          Open a folder to create diagrams.
        </div>
      </>
    )
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Diagrams</span>
        <button className="icon-btn" title="Refresh" onClick={() => useStore.getState().bumpTree()}>
          <RefreshCw size={14} />
        </button>
      </div>

      <div style={{ padding: '0 10px 10px' }}>
        <div className="sidebar-title" style={{ margin: '2px 0 6px' }}>
          New from template
        </div>
        <div style={{ display: 'grid', gap: 5 }}>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              className="template-card"
              onClick={() => void createDiagramFile(root, template.id as TemplateId, template.id)}
            >
              <Plus size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>
                <b>{template.name}</b>
                <small>{template.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-title" style={{ padding: '6px 14px' }}>
          In this project ({files.length})
        </div>
        {files.map((file) => (
          <button
            key={file}
            className={`tree-row ${activeTabId === `file:${file}` ? 'selected' : ''}`}
            style={{ width: '100%', paddingLeft: 12 }}
            onClick={() => void useStore.getState().openFile(file)}
            title={relative(root, file)}
          >
            <Shapes size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="tree-label">
              {basename(file).replace('.nova-diagram.json', '')}
            </span>
          </button>
        ))}
        {files.length === 0 && (
          <div className="faint" style={{ padding: '4px 14px', fontSize: 11.5 }}>
            No diagrams yet.
          </div>
        )}
        <div style={{ height: 30 }} />
      </div>
    </>
  )
}
