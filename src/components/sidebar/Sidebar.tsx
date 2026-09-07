import { useStore } from '@/state/store'
import Explorer from './Explorer'
import SearchView from './SearchView'
import GitView from './GitView'
import DiagramsView from './DiagramsView'
import PluginsView from './PluginsView'
import StructuralSearchView from './StructuralSearchView'
import ThemesView from './ThemesView'

export default function Sidebar() {
  const view = useStore((s) => s.sidebarView)

  return (
    <div className="sidebar">
      {view === 'explorer' && <Explorer />}
      {view === 'search' && <SearchView />}
      {view === 'structural' && <StructuralSearchView />}
      {view === 'git' && <GitView />}
      {view === 'diagrams' && <DiagramsView />}
      {view === 'plugins' && <PluginsView />}
      {view === 'themes' && <ThemesView />}
    </div>
  )
}
