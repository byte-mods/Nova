import { useStore } from '@/state/store'
import Explorer from './Explorer'
import SearchView from './SearchView'
import GitView from './GitView'
import DiagramsView from './DiagramsView'
import ThemesView from './ThemesView'

export default function Sidebar() {
  const view = useStore((s) => s.sidebarView)
  const width = useStore((s) => s.settings.sidebarWidth)

  return (
    <div className="sidebar" style={{ width }}>
      {view === 'explorer' && <Explorer />}
      {view === 'search' && <SearchView />}
      {view === 'git' && <GitView />}
      {view === 'diagrams' && <DiagramsView />}
      {view === 'themes' && <ThemesView />}
    </div>
  )
}
