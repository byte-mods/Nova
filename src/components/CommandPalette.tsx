import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, ChevronRight, FileIcon, Terminal } from 'lucide-react'
import type { CodeSymbol } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { symbolGlyph } from '@/lib/symbolGlyph'
import { themes } from '@/theme/themes'
import { newDiagramTab } from '@/components/diagram/diagramFile'

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const mode = useStore((s) => s.paletteMode)
  const root = useStore((s) => s.root)
  const settings = useStore((s) => s.settings)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [symbols, setSymbols] = useState<CodeSymbol[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open, mode])

  useEffect(() => {
    if (!open || mode !== 'file' || !root) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await window.nova.fs.findFiles(root, query)
      if (!cancelled) setFiles(result)
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, mode, query, root])

  useEffect(() => {
    if (!open || mode !== 'symbol' || !root) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await window.nova.code.workspaceSymbols(query, 80)
      if (!cancelled) setSymbols(result)
    }, 70)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, mode, query, root])

  const commands = useMemo<Command[]>(() => {
    const store = useStore.getState()
    const base: Command[] = [
      { id: 'open-folder', label: 'File: Open Folder…', hint: '', run: () => void store.pickProject() },
      { id: 'save-all', label: 'File: Save All', hint: '⇧⌘S', run: () => void store.saveAll() },
      { id: 'new-diagram', label: 'Diagram: New Architecture Diagram', run: () => newDiagramTab() },
      {
        id: 'browser',
        label: 'View: Open Built-in Browser',
        run: () =>
          store.openTab({
            id: `browser:${Date.now()}`,
            kind: 'browser',
            title: 'Browser',
            url: store.settings.browserHome,
          }),
      },
      { id: 'toggle-ai', label: 'View: Toggle AI Console', hint: '⌘I', run: () => store.toggleAi() },
      { id: 'toggle-panel', label: 'View: Toggle Panel', hint: '⌘J', run: () => store.togglePanel() },
      {
        id: 'toggle-sidebar',
        label: 'View: Toggle Sidebar',
        hint: '⌘B',
        run: () => store.toggleSidebar(),
      },
      { id: 'terminal', label: 'Terminal: Show', hint: '⌃`', run: () => store.togglePanel('terminal') },
      {
        id: 'go-to-symbol',
        label: 'Navigate: Go to Symbol in Project…',
        hint: '⇧⌘O',
        run: () => store.setPalette(true, 'symbol'),
      },
      {
        id: 'usages',
        label: 'Navigate: Show Find Usages Panel',
        hint: '⌥F7',
        run: () => store.togglePanel('usages'),
      },
      {
        id: 'reindex',
        label: 'Navigate: Rebuild Project Symbol Index',
        run: () => void store.buildIndex(),
      },
      { id: 'git', label: 'Git: Show Source Control', hint: '⇧⌘G', run: () => store.setSidebarView('git') },
      { id: 'git-refresh', label: 'Git: Refresh', run: () => void store.refreshCommits() },
      {
        id: 'settings',
        label: 'Preferences: Open Settings',
        run: () =>
          store.openTab({ id: 'settings', kind: 'settings', title: 'Settings' }),
      },
      {
        id: 'wrap',
        label: `Editor: Turn Word Wrap ${settings.wordWrap ? 'Off' : 'On'}`,
        run: () => store.setSettings({ wordWrap: !settings.wordWrap }),
      },
      {
        id: 'minimap',
        label: `Editor: Turn Minimap ${settings.minimap ? 'Off' : 'On'}`,
        run: () => store.setSettings({ minimap: !settings.minimap }),
      },
      ...themes.map((theme) => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.name}`,
        hint: theme.type,
        run: () => store.setSettings({ themeId: theme.id }),
      })),
    ]
    return base
  }, [settings.wordWrap, settings.minimap])

  const filteredCommands = useMemo(() => {
    const needle = query.toLowerCase().replace(/^>/, '').trim()
    if (!needle) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(needle))
  }, [commands, query])

  const items = mode === 'file' ? files : mode === 'symbol' ? symbols : filteredCommands
  const clampedIndex = Math.min(index, Math.max(items.length - 1, 0))

  if (!open) return null

  const choose = (i: number) => {
    const store = useStore.getState()
    if (mode === 'file') {
      const file = files[i]
      if (file) void store.openFile(file)
    } else if (mode === 'symbol') {
      const symbol = symbols[i]
      if (symbol) void store.openFile(symbol.file, { line: symbol.line, column: symbol.column })
    } else {
      filteredCommands[i]?.run()
    }
    store.setPalette(false)
  }

  const nextMode = mode === 'file' ? 'symbol' : mode === 'symbol' ? 'command' : 'file'

  return (
    <div className="overlay" onMouseDown={() => useStore.getState().setPalette(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          value={query}
          placeholder={
            mode === 'file'
              ? 'Search files by name…'
              : mode === 'symbol'
                ? 'Search classes, functions, variables…'
                : 'Type a command…'
          }
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') useStore.getState().setPalette(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(clampedIndex)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              useStore.getState().setPalette(true, nextMode)
            }
          }}
        />
        <div className="modal-list">
          {items.length === 0 && <div className="modal-item faint">No matches</div>}
          {mode === 'symbol' &&
            symbols.map((symbol, i) => (
              <button
                key={`${symbol.file}:${symbol.line}:${symbol.name}:${i}`}
                className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="symbol-glyph" style={{ color: symbolGlyph(symbol.kind).color }}>
                  {symbolGlyph(symbol.kind).glyph}
                </span>
                <span className="mono">{symbol.name}</span>
                {symbol.container && (
                  <span className="faint" style={{ fontSize: 11 }}>
                    in {symbol.container}
                  </span>
                )}
                <small>
                  {basename(symbol.file)}:{symbol.line}
                </small>
              </button>
            ))}
          {mode === 'file' &&
            files.map((file, i) => {
              const { Icon, color } = fileIcon(file, settings.iconPack)
              return (
                <button
                  key={file}
                  className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(i)}
                >
                  <Icon size={14} style={{ color, flexShrink: 0 }} />
                  <span>{basename(file)}</span>
                  <small>{root ? relative(root, file) : file}</small>
                </button>
              )
            })}
          {mode === 'command' &&
            filteredCommands.map((command, i) => (
              <button
                key={command.id}
                className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <ChevronRight size={13} style={{ flexShrink: 0 }} />
                <span>{command.label}</span>
                {command.hint && <small>{command.hint}</small>}
              </button>
            ))}
        </div>
        <div
          className="row"
          style={{
            padding: '7px 12px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--text-faint)',
          }}
        >
          {mode === 'file' ? (
            <FileIcon size={12} />
          ) : mode === 'symbol' ? (
            <Boxes size={12} />
          ) : (
            <Terminal size={12} />
          )}
          <span>
            {mode === 'file'
              ? 'Go to File'
              : mode === 'symbol'
                ? 'Go to Symbol in Project'
                : 'Command Palette'}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <span className="kbd">Tab</span> to switch mode · <span className="kbd">↵</span> to run
          </span>
        </div>
      </div>
    </div>
  )
}
