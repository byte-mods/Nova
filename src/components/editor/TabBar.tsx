import {
  BookOpen,
  GitCommitHorizontal,
  Globe,
  History,
  Loader2,
  Settings,
  Shapes,
  SplitSquareHorizontal,
  X,
} from 'lucide-react'
import { useStore, type Tab } from '@/state/store'
import { fileIcon } from '@/lib/fileIcons'
import { isImage } from '@/lib/language'

export default function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const buffers = useStore((s) => s.buffers)
  const iconPack = useStore((s) => s.settings.iconPack)

  if (tabs.length === 0) return null

  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const dirty = tab.path
          ? buffers[tab.path] && buffers[tab.path].content !== buffers[tab.path].savedContent
          : false
        return (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
            style={tab.preview ? { fontStyle: 'italic' } : undefined}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                useStore.getState().closeTab(tab.id)
              } else {
                useStore.getState().setActiveTab(tab.id)
              }
            }}
            title={tab.subtitle ?? tab.path ?? tab.title}
          >
            <TabIcon tab={tab} iconPack={iconPack} />
            <span className="tab-name">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                useStore.getState().closeTab(tab.id)
              }}
              title="Close"
            >
              {dirty ? <span className="tab-dot" /> : <X size={12} />}
            </button>
          </div>
        )
      })}
      <ExplainButton />
    </div>
  )
}

/**
 * "Explain this" — generates a walkthrough of whatever code is open.
 *
 * It sits at the end of the tab strip rather than in a toolbar of its own so
 * that it is visible above every kind of file without adding a row of chrome
 * that most files do not need.
 */
function ExplainButton() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const explain = useStore((s) => s.explain)

  const active = tabs.find((t) => t.id === activeTabId)
  const path = active?.path
  // Only real, readable source: not diffs, browsers, images or the walkthrough
  // itself (explaining a generated document would be circular).
  const target =
    path && (active.kind === 'file' || active.kind === 'diagram') && !isImage(path) ? path : null

  const running = target ? explain[target]?.status === 'running' : false
  const existing = target ? Boolean(explain[target]) : false

  return (
    <button
      className={`tab-action ${running ? 'busy' : ''}`}
      disabled={!target}
      title={
        target
          ? existing
            ? 'Open the generated walkthrough for this file'
            : 'Generate documentation, diagrams and a tutorial for this file'
          : 'Open a source file to explain it'
      }
      onClick={() => {
        if (!target) return
        const store = useStore.getState()
        // Already generated: just bring the tab forward rather than re-running.
        if (store.explain[target]) {
          store.openTab({
            id: `explain:${target}`,
            kind: 'explain',
            title: `${target.split('/').pop()} — explained`,
            path: target,
          })
          return
        }
        void store.explainFile(target)
      }}
    >
      {running ? <Loader2 size={12} className="spin" /> : <BookOpen size={12} />}
      <span>Explain</span>
    </button>
  )
}

function TabIcon({ tab, iconPack }: { tab: Tab; iconPack: 'nova' | 'classic' | 'minimal' }) {
  if (tab.kind === 'browser') return <Globe size={13} style={{ color: '#7dcfff' }} />
  if (tab.kind === 'diagram') return <Shapes size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'diff') return <SplitSquareHorizontal size={13} style={{ color: 'var(--warning)' }} />
  if (tab.kind === 'commit') return <GitCommitHorizontal size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'history') return <History size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'settings') return <Settings size={13} className="faint" />
  const { Icon, color } = fileIcon(tab.path ?? tab.title, iconPack)
  return <Icon size={13} style={{ color, flexShrink: 0 }} />
}
