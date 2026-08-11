import { GitCommitHorizontal, Globe, History, Settings, Shapes, SplitSquareHorizontal, X } from 'lucide-react'
import { useStore, type Tab } from '@/state/store'
import { fileIcon } from '@/lib/fileIcons'

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
    </div>
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
