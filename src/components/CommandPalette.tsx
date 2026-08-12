import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark as BookmarkIcon, Boxes, ChevronRight, Clock, FileIcon, Terminal } from 'lucide-react'
import type { CodeSymbol } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { symbolGlyph } from '@/lib/symbolGlyph'
import { appActions, editorActions, rankActions, type Action } from '@/lib/actions'
import { activeEditor } from '@/lib/refactor/bridge'

/**
 * One overlay, five modes: files (⌘P), symbols (⇧⌘O), recent files (⌘E),
 * file structure (⌘F12), bookmarks (⇧F11) and Find Action (⇧⌘P).
 *
 * Find Action lists the app's commands *and* every action Monaco registered on
 * the active editor, so anything the editor can do is reachable by name rather
 * than only by shortcut.
 */
export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const mode = useStore((s) => s.paletteMode)
  const root = useStore((s) => s.root)
  const settings = useStore((s) => s.settings)
  const recentFiles = useStore((s) => s.recentFiles)
  const bookmarks = useStore((s) => s.bookmarks)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [symbols, setSymbols] = useState<CodeSymbol[]>([])
  const [structure, setStructure] = useState<CodeSymbol[]>([])
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

  // File structure reads the same document symbols the outline uses.
  useEffect(() => {
    if (!open || mode !== 'structure') return
    const store = useStore.getState()
    const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
    if (!path) {
      setStructure([])
      return
    }
    let cancelled = false
    void window.nova.code.documentSymbols(path).then((result) => {
      if (!cancelled) setStructure(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, mode])

  const actions = useMemo<Action[]>(() => {
    if (!open || mode !== 'command') return []
    return [...appActions(), ...editorActions(activeEditor())]
  }, [open, mode, settings.wordWrap, settings.minimap, settings.showBlame, settings.autoSave])

  const filteredActions = useMemo(() => rankActions(actions, query), [actions, query])

  const filteredRecent = useMemo(() => {
    const needle = query.toLowerCase().trim()
    const list = recentFiles.filter((p) => !needle || p.toLowerCase().includes(needle))
    return list
  }, [recentFiles, query])

  const filteredBookmarks = useMemo(() => {
    const needle = query.toLowerCase().trim()
    if (!needle) return bookmarks
    return bookmarks.filter(
      (b) => b.preview.toLowerCase().includes(needle) || b.file.toLowerCase().includes(needle),
    )
  }, [bookmarks, query])

  const filteredStructure = useMemo(() => {
    const needle = query.toLowerCase().trim()
    if (!needle) return structure
    return structure.filter((symbol) => symbol.name.toLowerCase().includes(needle))
  }, [structure, query])

  const items: unknown[] =
    mode === 'file'
      ? files
      : mode === 'symbol'
        ? symbols
        : mode === 'recent'
          ? filteredRecent
          : mode === 'structure'
            ? filteredStructure
            : mode === 'bookmarks'
              ? filteredBookmarks
              : filteredActions
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
    } else if (mode === 'recent') {
      const file = filteredRecent[i]
      if (file) void store.openFile(file)
    } else if (mode === 'structure') {
      const symbol = filteredStructure[i]
      if (symbol) void store.openFile(symbol.file, { line: symbol.line, column: symbol.column })
    } else if (mode === 'bookmarks') {
      const bookmark = filteredBookmarks[i]
      if (bookmark) void store.openFile(bookmark.file, { line: bookmark.line, column: 1 })
    } else {
      filteredActions[i]?.run()
    }
    store.setPalette(false)
  }

  const nextMode: Record<string, string> = {
    file: 'symbol',
    symbol: 'command',
    command: 'recent',
    recent: 'structure',
    structure: 'bookmarks',
    bookmarks: 'file',
  }

  const placeholder =
    mode === 'file'
      ? 'Search files by name…'
      : mode === 'symbol'
        ? 'Search classes, functions, variables…'
        : mode === 'recent'
          ? 'Recently opened files…'
          : mode === 'structure'
            ? 'Search this file’s symbols…'
            : mode === 'bookmarks'
              ? 'Search bookmarks…'
              : 'Type an action…'

  return (
    <div className="overlay" onMouseDown={() => useStore.getState().setPalette(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          value={query}
          placeholder={placeholder}
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
              useStore.getState().setPalette(true, nextMode[mode] as never)
            }
          }}
        />

        <div className="modal-list">
          {items.length === 0 && <div className="modal-item faint">No matches</div>}

          {mode === 'command' &&
            filteredActions.slice(0, 300).map((action, i) => (
              <button
                key={action.id}
                className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <Terminal size={13} className="faint" />
                <span className="faint" style={{ minWidth: 74 }}>
                  {action.category}
                </span>
                <span>{action.label}</span>
                {action.hint && (
                  <span className="faint" style={{ marginLeft: 'auto' }}>
                    {action.hint}
                  </span>
                )}
              </button>
            ))}

          {(mode === 'file' || mode === 'recent') &&
            (mode === 'file' ? files : filteredRecent).map((file, i) => {
              const { Icon, color } = fileIcon(file, settings.iconPack)
              return (
                <button
                  key={file}
                  className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(i)}
                >
                  {mode === 'recent' ? (
                    <Clock size={13} className="faint" />
                  ) : (
                    <Icon size={13} style={{ color }} />
                  )}
                  <span>{basename(file)}</span>
                  <span className="faint" style={{ marginLeft: 'auto' }}>
                    {relative(root ?? '', file)}
                  </span>
                </button>
              )
            })}

          {(mode === 'symbol' || mode === 'structure') &&
            (mode === 'symbol' ? symbols : filteredStructure).map((symbol, i) => {
              const glyph = symbolGlyph(symbol.kind)
              return (
                <button
                  key={`${symbol.file}:${symbol.line}:${symbol.name}`}
                  className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(i)}
                >
                  <span className="symbol-glyph" style={{ color: glyph.color }}>
                    {glyph.glyph}
                  </span>
                  <span>{symbol.name}</span>
                  {symbol.container && (
                    <span className="faint">
                      <ChevronRight size={10} /> {symbol.container}
                    </span>
                  )}
                  <span className="faint" style={{ marginLeft: 'auto' }}>
                    {mode === 'structure' ? `:${symbol.line}` : relative(root ?? '', symbol.file)}
                  </span>
                </button>
              )
            })}

          {mode === 'bookmarks' &&
            filteredBookmarks.map((bookmark, i) => (
              <button
                key={`${bookmark.file}:${bookmark.line}`}
                className={`modal-item ${i === clampedIndex ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <BookmarkIcon size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5 }}>
                  {bookmark.preview || '(empty line)'}
                </span>
                <span className="faint" style={{ marginLeft: 'auto' }}>
                  {basename(bookmark.file)}:{bookmark.line}
                </span>
              </button>
            ))}
        </div>

        <div className="modal-foot faint">
          <Boxes size={11} /> Tab switches mode · {items.length} result
          {items.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  )
}
