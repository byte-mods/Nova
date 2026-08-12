import { useStore, type GroupId } from '@/state/store'
import TabBar from './TabBar'
import CodeEditor from './CodeEditor'
import MarkdownView from './MarkdownView'
import ImageView from './ImageView'
import DiffView from './DiffView'
import CommitView from './CommitView'
import SettingsView from './SettingsView'
import HistoryView from './HistoryView'
import WelcomeView from './WelcomeView'
import ExplainView from './ExplainView'
import ExternalChangeBar from './ExternalChangeBar'
import BrowserPane from '@/components/browser/BrowserPane'
import DiagramEditor from '@/components/diagram/DiagramEditor'
import { isImage, isMarkdown } from '@/lib/language'

/**
 * The editor area, one column per group. Splitting adds a second column with
 * its own tab strip and its own active tab.
 */
export default function EditorArea() {
  const tabs = useStore((s) => s.tabs)
  const groups = useStore((s) => s.groups)

  if (tabs.length === 0) {
    return (
      <div className="editor-host">
        <WelcomeView />
      </div>
    )
  }

  return (
    <div className="editor-groups">
      {groups.map((group) => (
        <div className="editor-group" key={group}>
          <EditorGroup group={group} />
        </div>
      ))}
    </div>
  )
}

function EditorGroup({ group }: { group: GroupId }) {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.groupActive[group])
  const mine = tabs.filter((t) => (t.group ?? 'main') === group)

  return (
    <>
      <TabBar group={group} />
      <div className="editor-host">
        {mine.length === 0 && <WelcomeView />}
        {mine.map((tab) => {
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
      return (
        <>
          <ExternalChangeBar path={path} />
          {isMarkdown(path) ? <MarkdownView path={path} /> : <CodeEditor path={path} />}
        </>
      )
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
    case 'explain':
      return <ExplainView path={tab.path!} />
    case 'settings':
      return <SettingsView />
    default:
      return null
  }
}
