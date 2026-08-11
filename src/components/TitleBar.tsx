import {
  ChevronRight,
  FolderOpen,
  Globe,
  LayoutPanelLeft,
  MessageSquareCode,
  PanelBottom,
  Save,
  Shapes,
  Terminal,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { newDiagramTab } from '@/components/diagram/diagramFile'
import RunPicker from '@/components/RunPicker'

export default function TitleBar() {
  const root = useStore((s) => s.root)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const buffers = useStore((s) => s.buffers)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const panelVisible = useStore((s) => s.panelVisible)
  const aiVisible = useStore((s) => s.aiVisible)
  const settings = useStore((s) => s.settings)

  const tab = tabs.find((t) => t.id === activeTabId)
  const dirtyCount = Object.values(buffers).filter((b) => b.content !== b.savedContent).length
  const crumbs = tab?.path && root ? relative(root, tab.path).split('/') : []

  return (
    <div className="titlebar">
      <button
        className="btn ghost sm"
        onClick={() => void useStore.getState().pickProject()}
        title="Open a folder"
      >
        <FolderOpen size={13} />
        {root ? basename(root) : 'Open Folder'}
      </button>

      {crumbs.length > 0 && (
        <div className="titlebar-title">
          {crumbs.map((crumb, i) => (
            <span key={i} className="row" style={{ gap: 4, minWidth: 0 }}>
              {i > 0 && <ChevronRight size={11} className="faint" />}
              <span
                style={{
                  color: i === crumbs.length - 1 ? 'var(--text)' : undefined,
                  whiteSpace: 'nowrap',
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="titlebar-spacer" />

      <RunPicker />

      <div className="titlebar-actions">
        {dirtyCount > 0 && (
          <button
            className="btn ghost sm"
            onClick={() => void useStore.getState().saveAll()}
            title="Save all (⇧⌘S)"
          >
            <Save size={13} />
            {dirtyCount}
          </button>
        )}
        <button
          className="icon-btn"
          title="New diagram"
          onClick={() => newDiagramTab()}
          disabled={!root}
        >
          <Shapes size={15} />
        </button>
        <button
          className="icon-btn"
          title="Open browser preview"
          onClick={() =>
            useStore.getState().openTab({
              id: `browser:${Date.now()}`,
              kind: 'browser',
              title: 'Browser',
              url: settings.browserHome,
            })
          }
        >
          <Globe size={15} />
        </button>
        <span style={{ width: 8 }} />
        <button
          className={`icon-btn ${sidebarVisible ? 'active' : ''}`}
          title="Toggle sidebar (⌘B)"
          onClick={() => useStore.getState().toggleSidebar()}
        >
          <LayoutPanelLeft size={15} />
        </button>
        <button
          className={`icon-btn ${panelVisible ? 'active' : ''}`}
          title="Toggle panel (⌘J)"
          onClick={() => useStore.getState().togglePanel()}
        >
          <PanelBottom size={15} />
        </button>
        <button
          className={`icon-btn ${aiVisible ? 'active' : ''}`}
          title="Toggle AI console (⌘I)"
          onClick={() => useStore.getState().toggleAi()}
        >
          <MessageSquareCode size={15} />
        </button>
        <button
          className="icon-btn"
          title="Toggle developer tools"
          onClick={() => void window.nova.app.windowAction('devtools')}
        >
          <Terminal size={15} />
        </button>
      </div>
    </div>
  )
}
