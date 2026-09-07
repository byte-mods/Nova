import { useEffect, useState } from 'react'
import { useStore } from '@/state/store'
import { fitPanels } from '@/lib/panelLayout'
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
import BreakpointDialog from '@/components/BreakpointDialog'
import RebaseDialog from '@/components/RebaseDialog'
import Splitter from '@/components/Splitter'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useWatchers } from '@/hooks/useWatchers'
import { useSharedAgent } from '@/hooks/useSharedAgent'
import { useExplainEvents } from '@/hooks/useExplainEvents'
import { usePluginEvents, usePluginWorkspaceRoot } from '@/hooks/usePluginEvents'
import { useInspections } from '@/hooks/useInspections'
import { useTemplates } from '@/hooks/useTemplates'

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

  // The panels are sized against the window, so a window narrower than the
  // widths they remember shrinks them rather than pushing the editor off screen.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useKeyboardShortcuts()
  useWatchers()
  useSharedAgent()
  useExplainEvents()
  usePluginEvents()
  useInspections()
  useTemplates()
  usePluginWorkspaceRoot(useStore((s) => s.root))

  if (!ready) {
    return (
      <div className="app">
        <div className="empty-state" style={{ gridRow: '1 / -1' }}>
          <span className="faint">Starting Nova IDE…</span>
        </div>
      </div>
    )
  }

  // The activity bar and each splitter take their own space before the panels
  // and the editor divide up what is left.
  const ACTIVITY_BAR = 48
  const SPLITTER = 4
  const chrome =
    ACTIVITY_BAR + (sidebarVisible ? SPLITTER : 0) + (aiVisible ? SPLITTER : 0)
  const fitted = fitPanels({
    available: windowWidth - chrome,
    sidebar: sidebarVisible ? settings.sidebarWidth : null,
    ai: aiVisible ? settings.aiWidth : null,
  })

  return (
    <div className="app">
      <TitleBar />
      <div
        className="app-body"
        style={
          {
            '--sidebar-width': `${fitted.sidebar}px`,
            '--ai-width': `${fitted.ai}px`,
          } as React.CSSProperties
        }
      >
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
      <BreakpointDialog />
      <RebaseDialog />
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
