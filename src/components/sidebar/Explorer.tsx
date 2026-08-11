import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  History,
  FolderPlus,
  Pencil,
  RefreshCw,
  Shapes,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react'
import type { DirEntry, GitChange } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, dirname, joinPath, relative } from '@/lib/paths'
import { fileIcon, folderIcon } from '@/lib/fileIcons'
import ContextMenu, { type MenuEntry } from '@/components/ContextMenu'
import { createDiagramFile } from '@/components/diagram/diagramFile'

interface MenuState {
  x: number
  y: number
  entry: DirEntry | null
}

export default function Explorer() {
  const root = useStore((s) => s.root)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ dir: string; isDir: boolean } | null>(null)

  if (!root) return <WelcomeSidebar />

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">{basename(root)}</span>
        <div className="row" style={{ gap: 0 }}>
          <button
            className="icon-btn"
            title="New file"
            onClick={() => setCreating({ dir: root, isDir: false })}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="icon-btn"
            title="New folder"
            onClick={() => setCreating({ dir: root, isDir: true })}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Refresh"
            onClick={() => useStore.getState().bumpTree()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div
        className="sidebar-scroll"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, entry: null })
        }}
      >
        <Directory
          dir={root}
          depth={0}
          onContextMenu={(e, entry) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, entry })
          }}
          renaming={renaming}
          setRenaming={setRenaming}
          creating={creating}
          setCreating={setCreating}
        />
        <div style={{ height: 40 }} />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          entries={buildMenu(menu.entry, root, {
            setRenaming,
            setCreating,
          })}
        />
      )}
    </>
  )
}

function buildMenu(
  entry: DirEntry | null,
  root: string,
  actions: {
    setRenaming: (p: string | null) => void
    setCreating: (v: { dir: string; isDir: boolean } | null) => void
  },
): MenuEntry[] {
  const targetDir = entry ? (entry.isDirectory ? entry.path : dirname(entry.path)) : root
  const store = useStore.getState()

  const entries: MenuEntry[] = [
    {
      id: 'new-file',
      label: 'New File',
      Icon: FilePlus2,
      onSelect: () => actions.setCreating({ dir: targetDir, isDir: false }),
    },
    {
      id: 'new-folder',
      label: 'New Folder',
      Icon: FolderPlus,
      onSelect: () => actions.setCreating({ dir: targetDir, isDir: true }),
    },
    {
      id: 'new-diagram',
      label: 'New Diagram',
      Icon: Shapes,
      onSelect: () => void createDiagramFile(targetDir),
    },
  ]

  if (entry) {
    entries.push(
      { id: 'sep1', separator: true },
      {
        id: 'rename',
        label: 'Rename…',
        Icon: Pencil,
        onSelect: () => actions.setRenaming(entry.path),
      },
      {
        id: 'history',
        label: 'Local History…',
        Icon: History,
        onSelect: () =>
          store.openTab({
            id: `history:${entry.path}`,
            kind: 'history',
            title: `${basename(entry.path)} — history`,
            path: entry.path,
          }),
      },
      {
        id: 'copy-path',
        label: 'Copy Relative Path',
        Icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(relative(root, entry.path)),
      },
      {
        id: 'reveal',
        label: 'Reveal in Finder',
        Icon: SquareArrowOutUpRight,
        onSelect: () => void window.nova.app.revealInFinder(entry.path),
      },
      { id: 'sep2', separator: true },
      {
        id: 'delete',
        label: 'Move to Trash',
        Icon: Trash2,
        danger: true,
        onSelect: async () => {
          await window.nova.fs.trash(entry.path)
          store.closeTab(`file:${entry.path}`)
          store.bumpTree()
          store.notify(`Moved ${basename(entry.path)} to Trash`, 'success')
        },
      },
    )
  }
  return entries
}

interface DirectoryProps {
  dir: string
  depth: number
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void
  renaming: string | null
  setRenaming: (p: string | null) => void
  creating: { dir: string; isDir: boolean } | null
  setCreating: (v: { dir: string; isDir: boolean } | null) => void
}

function Directory(props: DirectoryProps) {
  const { dir, depth } = props
  const treeVersion = useStore((s) => s.treeVersion)
  const [entries, setEntries] = useState<DirEntry[]>([])

  useEffect(() => {
    let cancelled = false
    window.nova.fs
      .list(dir)
      .then((result) => {
        if (!cancelled) setEntries(result)
      })
      .catch(() => setEntries([]))
    return () => {
      cancelled = true
    }
  }, [dir, treeVersion])

  return (
    <>
      {props.creating?.dir === dir && (
        <InlineInput
          depth={depth}
          isDir={props.creating.isDir}
          placeholder={props.creating.isDir ? 'folder name' : 'file name'}
          onCancel={() => props.setCreating(null)}
          onSubmit={async (name) => {
            props.setCreating(null)
            if (!name.trim()) return
            const target = joinPath(dir, name.trim())
            await window.nova.fs.create(target, props.creating!.isDir)
            useStore.getState().bumpTree()
            useStore.getState().setExpanded(dir, true)
            if (!props.creating!.isDir) void useStore.getState().openFile(target)
          }}
        />
      )}
      {entries.map((entry) => (
        <TreeItem key={entry.path} entry={entry} {...props} />
      ))}
    </>
  )
}

function TreeItem({ entry, depth, ...props }: DirectoryProps & { entry: DirEntry }) {
  const expanded = useStore((s) => Boolean(s.expanded[entry.path]))
  const activeTabId = useStore((s) => s.activeTabId)
  const iconPack = useStore((s) => s.settings.iconPack)
  const git = useStore((s) => s.git)
  const buffers = useStore((s) => s.buffers)

  const decoration = useMemo(() => gitDecoration(git?.changes ?? [], entry), [git, entry])
  const selected = activeTabId === `file:${entry.path}`
  const dirty = buffers[entry.path] && buffers[entry.path].content !== buffers[entry.path].savedContent

  const onClick = useCallback(() => {
    if (entry.isDirectory) useStore.getState().toggleExpanded(entry.path)
    else void useStore.getState().openFile(entry.path, { preview: true })
  }, [entry])

  const { Icon, color } = entry.isDirectory
    ? folderIcon(expanded, iconPack)
    : fileIcon(entry.path, iconPack)

  if (props.renaming === entry.path) {
    return (
      <InlineInput
        depth={depth}
        isDir={entry.isDirectory}
        initial={entry.name}
        placeholder="new name"
        onCancel={() => props.setRenaming(null)}
        onSubmit={async (name) => {
          props.setRenaming(null)
          if (!name.trim() || name === entry.name) return
          const target = joinPath(dirname(entry.path), name.trim())
          await window.nova.fs.rename(entry.path, target)
          useStore.getState().closeTab(`file:${entry.path}`)
          useStore.getState().bumpTree()
        }}
      />
    )
  }

  return (
    <>
      <div
        className={`tree-row ${selected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={onClick}
        onDoubleClick={() => !entry.isDirectory && void useStore.getState().openFile(entry.path)}
        onContextMenu={(e) => props.onContextMenu(e, entry)}
        title={entry.path}
      >
        <span className="tree-twisty">
          {entry.isDirectory &&
            (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </span>
        <Icon size={14} style={{ color, flexShrink: 0 }} />
        <span
          className="tree-label"
          style={decoration ? { color: decoration.color } : undefined}
        >
          {entry.name}
        </span>
        {dirty && <span className="tree-status" style={{ color: 'var(--warning)' }}>●</span>}
        {decoration && !dirty && (
          <span className="tree-status" style={{ color: decoration.color }}>
            {decoration.letter}
          </span>
        )}
      </div>
      {entry.isDirectory && expanded && (
        <Directory
          {...props}
          dir={entry.path}
          depth={depth + 1}
        />
      )}
    </>
  )
}

function gitDecoration(changes: GitChange[], entry: DirEntry) {
  if (entry.isDirectory) {
    const inside = changes.some((c) => c.path.startsWith(`${entry.path}/`))
    return inside ? { letter: '', color: 'var(--warning)' } : null
  }
  const change = changes.find((c) => c.path === entry.path)
  if (!change) return null
  switch (change.status) {
    case 'untracked':
      return { letter: 'U', color: 'var(--success)' }
    case 'added':
      return { letter: 'A', color: 'var(--success)' }
    case 'deleted':
      return { letter: 'D', color: 'var(--danger)' }
    case 'conflicted':
      return { letter: '!', color: 'var(--danger)' }
    default:
      return { letter: 'M', color: 'var(--warning)' }
  }
}

function InlineInput({
  depth,
  isDir,
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  depth: number
  isDir: boolean
  initial?: string
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const iconPack = useStore((s) => s.settings.iconPack)
  const { Icon, color } = isDir ? folderIcon(false, iconPack) : fileIcon(value || 'x.txt', iconPack)

  return (
    <div className="tree-row" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="tree-twisty" />
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSubmit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          else if (e.key === 'Escape') onCancel()
        }}
        style={{ height: 20, padding: '0 4px', flex: 1, fontSize: 12.5 }}
      />
    </div>
  )
}

function WelcomeSidebar() {
  const recents = useStore((s) => s.recents)
  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Explorer</span>
      </div>
      <div className="sidebar-scroll" style={{ padding: 12 }}>
        <button
          className="btn primary"
          style={{ width: '100%' }}
          onClick={() => void useStore.getState().pickProject()}
        >
          Open Folder
        </button>
        {recents.length > 0 && (
          <>
            <div className="sidebar-title" style={{ margin: '18px 0 8px' }}>
              Recent
            </div>
            {recents.map((r) => (
              <button
                key={r.path}
                className="tree-row"
                style={{ width: '100%', paddingLeft: 4 }}
                onClick={() => void useStore.getState().openProject(r.path)}
                title={r.path}
              >
                <span className="tree-label">{r.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  )
}
