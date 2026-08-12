import { useEffect } from 'react'
import { useStore } from '@/state/store'
import TitleBar from '@/components/TitleBar'
import ActivityBar from '@/components/ActivityBar'
import Sidebar from '@/components/sidebar/Sidebar'
import EditorArea from '@/components/editor/EditorArea'
import BottomPanel from '@/components/panel/BottomPanel'
import AiConsole from '@/components/ai/AiConsole'
import StatusBar from '@/components/StatusBar'
import CommandPalette from '@/components/CommandPalette'
import Toast from '@/components/Toast'
import RefactorPreview from '@/components/RefactorPreview'
import RefactorDialog from '@/components/RefactorDialog'
import RefactorMenu from '@/components/RefactorMenu'
import Splitter from '@/components/Splitter'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useWatchers } from '@/hooks/useWatchers'
import { useExplainEvents } from '@/hooks/useExplainEvents'

export default function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const aiVisible = useStore((s) => s.aiVisible)
  const panelVisible = useStore((s) => s.panelVisible)

  useEffect(() => {
    void init()
  }, [init])

  useKeyboardShortcuts()
  useWatchers()
  useExplainEvents()

  if (!ready) {
    return (
      <div className="app">
        <div className="empty-state" style={{ gridRow: '1 / -1' }}>
          <span className="faint">Starting Nova IDE…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <ActivityBar />
        {sidebarVisible && (
          <>
            <Sidebar />
            <Splitter
              direction="vertical"
              onResize={(d) =>
                setSettings({
                  sidebarWidth: clamp(settings.sidebarWidth + d, 180, 560),
                })
              }
            />
          </>
        )}

        <div className="center-column">
          <EditorArea />
          {panelVisible && (
            <>
              <Splitter
                direction="horizontal"
                onResize={(d) =>
                  setSettings({ panelHeight: clamp(settings.panelHeight - d, 120, 640) })
                }
              />
              <BottomPanel />
            </>
          )}
        </div>

        {aiVisible && (
          <>
            <Splitter
              direction="vertical"
              onResize={(d) => setSettings({ aiWidth: clamp(settings.aiWidth - d, 300, 780) })}
            />
            <AiConsole />
          </>
        )}
      </div>
      <StatusBar />
      <CommandPalette />
      <RefactorMenu />
      <RefactorDialog />
      <RefactorPreview />
      <Toast />
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
