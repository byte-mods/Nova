import { Files, GitBranch, Palette, Search, Shapes } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore, type SidebarView } from '@/state/store'

const ITEMS: { id: SidebarView; label: string; Icon: LucideIcon; hint: string }[] = [
  { id: 'explorer', label: 'Explorer', Icon: Files, hint: '⇧⌘E' },
  { id: 'search', label: 'Search', Icon: Search, hint: '⇧⌘F' },
  { id: 'git', label: 'Source Control', Icon: GitBranch, hint: '⇧⌘G' },
  { id: 'diagrams', label: 'Diagrams', Icon: Shapes, hint: '' },
  { id: 'themes', label: 'Themes & Settings', Icon: Palette, hint: '' },
]

export default function ActivityBar() {
  const sidebarView = useStore((s) => s.sidebarView)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const git = useStore((s) => s.git)

  const changeCount = git ? new Set(git.changes.map((c) => c.path)).size : 0

  return (
    <div className="activity-bar">
      {ITEMS.map(({ id, label, Icon, hint }) => (
        <button
          key={id}
          className={`activity-item ${sidebarVisible && sidebarView === id ? 'active' : ''}`}
          title={hint ? `${label} (${hint})` : label}
          onClick={() => useStore.getState().setSidebarView(id)}
        >
          <Icon size={19} strokeWidth={1.8} />
          {id === 'git' && changeCount > 0 && <span className="activity-badge">{changeCount}</span>}
        </button>
      ))}
    </div>
  )
}
