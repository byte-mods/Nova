import { FolderOpen, Globe, GraduationCap, Search, Shapes, Sparkles, Terminal } from 'lucide-react'
import { useStore } from '@/state/store'
import { newDiagramTab } from '@/components/diagram/diagramFile'
import { timeAgo } from '@/lib/paths'

export default function WelcomeView() {
  const recents = useStore((s) => s.recents)
  const root = useStore((s) => s.root)
  const providers = useStore((s) => s.providers)

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <div className="welcome-logo">◈</div>
          <div>
            <h1>Nova IDE</h1>
            <p className="faint">
              Editor, browser, diagrams, Git and an AI console — in one window.
            </p>
          </div>
        </div>

        <div className="welcome-columns">
          <div>
            <h3>Start</h3>
            <button className="welcome-action" onClick={() => void useStore.getState().pickProject()}>
              <FolderOpen size={15} /> Open folder…
            </button>
            <button className="welcome-action" onClick={() => newDiagramTab('microservices')}>
              <Shapes size={15} /> New architecture diagram
            </button>
            <button
              className="welcome-action"
              onClick={() =>
                useStore.getState().openTab({
                  id: `browser:${Date.now()}`,
                  kind: 'browser',
                  title: 'Browser',
                  url: useStore.getState().settings.browserHome,
                })
              }
            >
              <Globe size={15} /> Open built-in browser
            </button>
            <button className="welcome-action" onClick={() => useStore.getState().showPanel('terminal')}>
              <Terminal size={15} /> Open terminal
            </button>
            <button className="welcome-action" onClick={() => useStore.getState().toggleAi()}>
              <Sparkles size={15} /> Ask the AI console
            </button>
            {/* The first thing to want in a codebase you did not write. */}
            <button
              className="welcome-action"
              disabled={!root}
              title={
                root
                  ? 'Read this project and write its technical walkthrough'
                  : 'Open a project first'
              }
              onClick={() => void useStore.getState().generateTutorial('book')}
            >
              <GraduationCap size={15} /> Explain this whole project
            </button>
          </div>

          <div>
            <h3>Recent</h3>
            {recents.length === 0 && <p className="faint">No recent projects yet.</p>}
            {recents.slice(0, 7).map((recent) => (
              <button
                key={recent.path}
                className="welcome-action"
                onClick={() => void useStore.getState().openProject(recent.path)}
                title={recent.path}
              >
                <span style={{ color: 'var(--text)' }}>{recent.name}</span>
                <small className="faint">{timeAgo(Math.floor(recent.openedAt / 1000))}</small>
              </button>
            ))}
          </div>

          <div>
            <h3>Shortcuts</h3>
            <ul className="shortcut-list">
              <li>
                <span className="kbd">⌘P</span> Go to file
              </li>
              <li>
                <span className="kbd">⇧⌘P</span> Command palette
              </li>
              <li>
                <span className="kbd">⇧⌘F</span> Search in project
              </li>
              <li>
                <span className="kbd">⌘B</span> Toggle sidebar
              </li>
              <li>
                <span className="kbd">⌘J</span> Toggle panel
              </li>
              <li>
                <span className="kbd">⌘I</span> Toggle AI console
              </li>
              <li>
                <span className="kbd">⌃`</span> Terminal
              </li>
            </ul>
          </div>
        </div>

        <div className="welcome-status">
          {root ? (
            <span className="row">
              <Search size={13} className="faint" /> Project ready — press{' '}
              <span className="kbd">⌘P</span> to open a file.
            </span>
          ) : (
            <span className="faint">Open a folder to get started.</span>
          )}
          <span style={{ marginLeft: 'auto' }} className="row">
            {providers.map((p) => (
              <span key={p.id} className="chip" title={p.hint}>
                <span
                  className="provider-dot"
                  style={{ background: p.available ? 'var(--success)' : 'var(--text-faint)' }}
                />
                {p.label}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}
