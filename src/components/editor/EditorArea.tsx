import { useStore } from '@/state/store'
import TabBar from './TabBar'
import CodeEditor from './CodeEditor'
import MarkdownView from './MarkdownView'
import ImageView from './ImageView'
import DiffView from './DiffView'
import CommitView from './CommitView'
import SettingsView from './SettingsView'
import HistoryView from './HistoryView'
import WelcomeView from './WelcomeView'
import BrowserPane from '@/components/browser/BrowserPane'
import DiagramEditor from '@/components/diagram/DiagramEditor'
import { isImage, isMarkdown } from '@/lib/language'

export default function EditorArea() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  return (
    <>
      <TabBar />
      <div className="editor-host">
        {tabs.length === 0 && <WelcomeView />}
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          // Browser tabs stay mounted so page state and history survive tab switches.
          if (!active && tab.kind !== 'browser') return null
          return (
            <div
              key={tab.id}
              className="editor-slot"
              style={{ display: active ? 'flex' : 'none' }}
            >
              {renderTab(tab)}
            </div>
          )
        })}
      </div>
    </>
  )
}

function renderTab(tab: ReturnType<typeof useStore.getState>['tabs'][number]) {
  switch (tab.kind) {
    case 'file': {
      const path = tab.path!
      if (isImage(path)) return <ImageView path={path} />
      if (isMarkdown(path)) return <MarkdownView path={path} />
      return <CodeEditor path={path} />
    }
    case 'diagram':
      return <DiagramEditor path={tab.path!} />
    case 'diff':
      return <DiffView tab={tab} />
    case 'browser':
      return <BrowserPane tabId={tab.id} initialUrl={tab.url ?? 'about:blank'} />
    case 'commit':
      return <CommitView hash={tab.commitHash!} />
    case 'history':
      return <HistoryView path={tab.path!} />
    case 'settings':
      return <SettingsView />
    default:
      return null
  }
}
