import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Boxes,
  Braces,
  Check,
  GitBranch,
  Loader2,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { languageForPath } from '@/lib/language'
import { getTheme } from '@/theme/themes'

export default function StatusBar() {
  const git = useStore((s) => s.git)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const buffers = useStore((s) => s.buffers)
  const settings = useStore((s) => s.settings)
  const aiRunning = useStore((s) => s.aiRunning)
  const providers = useStore((s) => s.providers)
  const indexStatus = useStore((s) => s.indexStatus)
  const lspServers = useStore((s) => s.lspServers)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })

  useEffect(() => {
    const handler = (e: Event) => setCursor((e as CustomEvent).detail)
    window.addEventListener('nova:cursor', handler)
    return () => window.removeEventListener('nova:cursor', handler)
  }, [])

  const tab = tabs.find((t) => t.id === activeTabId)
  const buffer = tab?.path ? buffers[tab.path] : undefined
  const dirty = buffer ? buffer.content !== buffer.savedContent : false
  const provider = providers.find((p) => p.id === settings.aiProvider)

  // The server handling the file in front of the user, if any.
  const activeLanguage = tab?.kind === 'file' && tab.path ? languageForPath(tab.path) : ''
  const activeServer = activeLanguage
    ? lspServers.find(
        (s) => s.installed && s.languages.includes(activeLanguage) && s.state !== 'stopped',
      )
    : undefined

  return (
    <div className="statusbar">
      {git?.isRepo && (
        <button
          className="status-item"
          onClick={() => useStore.getState().setSidebarView('git')}
          title={git.upstream ? `Tracking ${git.upstream}` : 'No upstream branch'}
        >
          <GitBranch size={12} />
          {git.branch}
          {git.ahead > 0 && <span className="faint">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="faint">↓{git.behind}</span>}
          {git.changes.length > 0 && (
            <span style={{ color: 'var(--warning)' }}>{git.changes.length}∆</span>
          )}
        </button>
      )}

      <button
        className="status-item"
        title="Show the terminal (⌘J)"
        onClick={() => useStore.getState().togglePanel('terminal')}
      >
        <Terminal size={12} />
        Terminal
      </button>

      {activeServer && (
        <button
          className="status-item"
          onClick={() =>
            useStore.getState().openTab({ id: 'settings', kind: 'settings', title: 'Settings' })
          }
          title={
            activeServer.state === 'failed'
              ? `${activeServer.label}: ${activeServer.error}`
              : `${activeServer.label} — ${activeServer.binary}`
          }
        >
          {activeServer.state === 'ready' && !activeServer.progress ? (
            <Braces size={12} style={{ color: 'var(--success)' }} />
          ) : activeServer.state === 'failed' ? (
            <AlertCircle size={12} style={{ color: 'var(--danger)' }} />
          ) : (
            <Loader2 size={12} className="spin" style={{ color: 'var(--warning)' }} />
          )}
          {activeServer.progress || activeServer.label}
        </button>
      )}

      {indexStatus && (
        <button
          className="status-item"
          onClick={() => useStore.getState().setPalette(true, 'symbol')}
          title={
            indexStatus.indexing
              ? 'Building the project symbol index…'
              : `${indexStatus.symbols.toLocaleString()} symbols across ${indexStatus.files.toLocaleString()} files` +
                (indexStatus.truncated ? ' (project truncated at the file cap)' : '') +
                ` · indexed in ${indexStatus.durationMs} ms`
          }
        >
          {indexStatus.indexing ? (
            <Loader2 size={12} className="spin" style={{ color: 'var(--accent)' }} />
          ) : (
            <Boxes size={12} />
          )}
          {indexStatus.indexing
            ? `Indexing ${indexStatus.files.toLocaleString()}…`
            : `${indexStatus.symbols.toLocaleString()} symbols`}
        </button>
      )}

      <div style={{ flex: 1 }} />

      {aiRunning && (
        <span className="status-item" style={{ color: 'var(--accent)' }}>
          <Loader2 size={12} className="spin" />
          {provider?.label ?? settings.aiProvider} working…
        </span>
      )}

      <button
        className="status-item"
        onClick={() => useStore.getState().toggleAi()}
        title={provider?.hint ?? `Toggle the AI console (⌘I) — ${provider?.label ?? 'no assistant configured'}`}
      >
        {provider?.available ? (
          <Sparkles size={12} style={{ color: 'var(--accent)' }} />
        ) : (
          <AlertCircle size={12} style={{ color: 'var(--warning)' }} />
        )}
        {provider?.label ?? 'AI'}
      </button>

      {tab?.kind === 'file' && tab.path && (
        <>
          <span className="status-item" title="Where the caret is: line and column">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span className="status-item" title="Indent width, in spaces">
            Spaces: {settings.tabSize}
          </span>
          <span className="status-item" title="The language this file is highlighted as">
            {languageForPath(tab.path)}
          </span>
        </>
      )}

      <button
        className="status-item"
        onClick={() => useStore.getState().setSidebarView('themes')}
        title="Change theme"
      >
        {getTheme(settings.themeId).name}
      </button>

      <span
        className="status-item"
        style={{ color: dirty ? 'var(--warning)' : undefined }}
        title={dirty ? 'This file has changes that are not on disk (⌘S)' : 'Everything is saved'}
      >
        {dirty ? 'Unsaved' : <Check size={12} />}
      </span>
    </div>
  )
}
