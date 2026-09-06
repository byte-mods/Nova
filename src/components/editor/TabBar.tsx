import { providerStateLabel } from '@shared/aiProviders'
import { useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  Columns2,
  GitCommitHorizontal,
  Globe,
  GraduationCap,
  History,
  Loader2,
  Pin,
  Send,
  Settings,
  Shapes,
  SplitSquareHorizontal,
  X,
} from 'lucide-react'
import { useStore, type GroupId, type Tab } from '@/state/store'
import { fileIcon } from '@/lib/fileIcons'
import { isImage } from '@/lib/language'
import { TUTORIAL_CHAPTERS } from '@/lib/tutorial'
import ContextMenu, { type MenuEntry } from '@/components/ContextMenu'

/**
 * The tab strip for one editor group.
 *
 * Tabs can be reordered by dragging, pinned so Close Others spares them, moved
 * into the other group, and closed in bulk from the context menu — the set of
 * things you reach for once more than a handful of files are open.
 */
export default function TabBar({ group }: { group: GroupId }) {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.groupActive[group])
  const buffers = useStore((s) => s.buffers)
  const iconPack = useStore((s) => s.settings.iconPack)
  const groups = useStore((s) => s.groups)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const mine = tabs.filter((t) => (t.group ?? 'main') === group)
  // Pinned tabs sit at the front, the way every editor with pinning does it.
  const ordered = [...mine.filter((t) => t.pinned), ...mine.filter((t) => !t.pinned)]
  if (ordered.length === 0) return null

  const contextItems = (tab: Tab): MenuEntry[] => {
    const store = useStore.getState()
    const other: GroupId = group === 'main' ? 'right' : 'main'
    return [
      { id: 'close', label: 'Close', onSelect: () => store.closeTab(tab.id) },
      { id: 'close-others', label: 'Close Others', onSelect: () => store.closeOtherTabs(tab.id) },
      { id: 'close-right', label: 'Close to the Right', onSelect: () => store.closeTabsToRight(tab.id) },
      { id: 'sep1', separator: true },
      { id: 'pin', label: tab.pinned ? 'Unpin' : 'Pin', onSelect: () => store.togglePinTab(tab.id) },
      groups.includes(other)
        ? {
            id: 'move-group',
            label: `Move to ${other === 'right' ? 'Right' : 'Left'} Group`,
            onSelect: () => store.moveTabToGroup(tab.id, other),
          }
        : { id: 'split', label: 'Split Right', onSelect: () => store.splitEditor() },
      ...(tab.path
        ? [
            { id: 'sep2', separator: true },
            { id: 'copy-path', label: 'Copy Path', onSelect: () => void navigator.clipboard.writeText(tab.path!) },
            { id: 'reveal', label: 'Reveal in Finder', onSelect: () => void window.nova.app.revealInFinder(tab.path!) },
          ]
        : []),
    ]
  }

  return (
    <div
      className={`tabbar ${useStore.getState().activeGroup === group ? 'focused' : ''}`}
      onMouseDown={() => useStore.getState().setActiveGroup(group)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/nova-tab')
        if (id) useStore.getState().moveTabToGroup(id, group)
      }}
    >
      {ordered.map((tab) => {
        const dirty = tab.path
          ? buffers[tab.path] && buffers[tab.path].content !== buffers[tab.path].savedContent
          : false
        return (
          <div
            key={tab.id}
            draggable
            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${dirty ? 'dirty' : ''} ${
              dragging === tab.id ? 'dragging' : ''
            }`}
            style={tab.preview ? { fontStyle: 'italic' } : undefined}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/nova-tab', tab.id)
              e.dataTransfer.effectAllowed = 'move'
              setDragging(tab.id)
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const id = e.dataTransfer.getData('text/nova-tab')
              if (!id || id === tab.id) return
              const store = useStore.getState()
              const dragged = store.tabs.find((t) => t.id === id)
              if (dragged && (dragged.group ?? 'main') !== group) store.moveTabToGroup(id, group)
              store.moveTab(id, tab.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, entries: contextItems(tab) })
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                useStore.getState().closeTab(tab.id)
              } else if (e.button === 0) {
                useStore.getState().setActiveTab(tab.id)
              }
            }}
            title={tab.subtitle ?? tab.path ?? tab.title}
          >
            {tab.pinned && <Pin size={10} className="tab-pin" />}
            <TabIcon tab={tab} iconPack={iconPack} />
            <span className="tab-name">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                useStore.getState().closeTab(tab.id)
              }}
              title="Close"
            >
              {dirty ? <span className="tab-dot" /> : <X size={12} />}
            </button>
          </div>
        )
      })}

      <div className="tab-actions">
        <HttpButton group={group} />
        <SplitButton group={group} />
        <ExplainButton group={group} />
        {group === 'main' && <TutorialButton />}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

/**
 * Opens the HTTP client for a `.http` file.
 *
 * The file itself stays in a normal editor tab — you write requests as text —
 * and the client opens beside it rather than replacing the buffer, so editing a
 * request and re-running it does not mean switching modes.
 */
function HttpButton({ group }: { group: GroupId }) {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.groupActive[group])

  const active = tabs.find((t) => t.id === activeTabId)
  const path = active?.kind === 'file' && active.path && isHttpFile(active.path) ? active.path : null
  if (!path) return null

  return (
    <button
      className="tab-action"
      title="Open the HTTP client for this file"
      onClick={() =>
        useStore.getState().openTab({
          id: `http:${path}`,
          kind: 'http',
          title: `${path.split('/').pop()} — requests`,
          path,
        })
      }
    >
      <Send size={12} />
      <span>Requests</span>
    </button>
  )
}

export function isHttpFile(path: string): boolean {
  return /\.(http|rest)$/i.test(path)
}

function SplitButton({ group }: { group: GroupId }) {
  const groups = useStore((s) => s.groups)
  const split = groups.length > 1
  if (group !== 'main' && !split) return null
  return (
    <button
      className="tab-action tab-action-split"
      title={split ? 'Close the split' : 'Split editor right (⌥⌘→)'}
      onClick={() => (split ? useStore.getState().closeSplit() : useStore.getState().splitEditor())}
    >
      {split ? <Columns2 size={12} /> : <SplitSquareHorizontal size={12} />}
    </button>
  )
}

/**
 * "Explain this" — generates a walkthrough of whatever code is open.
 *
 * It sits at the end of the tab strip rather than in a toolbar of its own so
 * that it is visible above every kind of file without adding a row of chrome
 * that most files do not need.
 */
function ExplainButton({ group }: { group: GroupId }) {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.groupActive[group])
  const explain = useStore((s) => s.explain)

  const active = tabs.find((t) => t.id === activeTabId)
  const path = active?.path
  // Only real, readable source: not diffs, browsers, images or the walkthrough
  // itself (explaining a generated document would be circular).
  const target =
    path && (active.kind === 'file' || active.kind === 'diagram') && !isImage(path) ? path : null

  const running = target ? explain[target]?.status === 'running' : false
  const existing = target ? Boolean(explain[target]) : false

  return (
    <button
      className={`tab-action tab-action-explain ${running ? 'busy' : ''}`}
      disabled={!target}
      title={
        target
          ? existing
            ? 'Open the generated walkthrough for this file'
            : 'Generate documentation, diagrams and a tutorial for this file'
          : 'Open a source file to explain it'
      }
      onClick={() => {
        if (!target) return
        const store = useStore.getState()
        // Already generated: just bring the tab forward rather than re-running.
        if (store.explain[target]) {
          store.openTab({
            id: `explain:${target}`,
            kind: 'explain',
            title: `${target.split('/').pop()} — explained`,
            path: target,
          })
          return
        }
        void store.explainFile(target)
      }}
    >
      {running ? <Loader2 size={12} className="spin" /> : <BookOpen size={12} />}
      <span>Explain</span>
    </button>
  )
}

/**
 * "Tutorial" — generates the technical walkthrough of the whole project:
 * libraries, architecture, patterns, algorithms, data, flows and pipeline.
 *
 * It sits beside Explain because the two are the same gesture at two scales, and
 * it is project-scoped rather than file-scoped, so it is enabled whenever a
 * project is open — including on the welcome screen, where a newcomer to a
 * codebase is most likely to want it.
 *
 * The chevron exists because the two CLIs write materially different documents
 * from the same repository. Picking one in Settings for ever is the wrong shape
 * for a task you may want to run twice and compare, so the provider is a
 * per-run choice here rather than a setting.
 */
function TutorialButton() {
  const root = useStore((s) => s.root)
  const tutorial = useStore((s) => s.tutorial)
  const providers = useStore((s) => s.providers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const running = tutorial?.status === 'running'

  const open = () => {
    const store = useStore.getState()
    // Already generated: bring the tab forward rather than paying for it twice.
    if (store.tutorial) {
      store.openTab({
        id: 'tutorial',
        kind: 'tutorial',
        title: `${root?.split('/').pop() ?? 'Project'} — tutorial`,
      })
      return
    }
    void store.generateTutorial('book')
  }

  return (
    <>
      <button
        className={`tab-action tab-action-tutorial ${running ? 'busy' : ''}`}
        disabled={!root}
        title={
          root
            ? tutorial
              ? 'Open the generated project tutorial'
              : 'Generate a technical walkthrough of this project — libraries, architecture, patterns, algorithms, data and flows'
            : 'Open a project to generate its tutorial'
        }
        onClick={open}
      >
        {running ? <Loader2 size={12} className="spin" /> : <GraduationCap size={12} />}
        <span>Tutorial</span>
      </button>
      <button
        className={`tab-action tab-action-chevron ${running ? 'busy' : ''}`}
        disabled={!root || running}
        title="Choose which assistant writes it, and which chapter"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.right - 250, y: rect.bottom + 2 })
        }}
      >
        <ChevronDown size={12} />
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          entries={[
            ...providers.map((provider) => ({
              id: `provider:${provider.id}`,
              label: provider.available
                ? `Write it with ${provider.label}`
                : `${provider.label} — ${providerStateLabel(provider)}`,
              Icon: GraduationCap,
              onSelect: () => {
                if (!provider.available) {
                  useStore.getState().notify(`${provider.label} — ${provider.hint}`, 'error')
                  return
                }
                void useStore.getState().generateTutorial('book', provider.id)
              },
            })),
            { id: 'sep', separator: true },
            ...TUTORIAL_CHAPTERS.filter((chapter) => chapter.id !== 'book').map((chapter) => ({
              id: `chapter:${chapter.id}`,
              label: `Just: ${chapter.short}`,
              onSelect: () => void useStore.getState().generateTutorial(chapter.id),
            })),
          ]}
        />
      )}
    </>
  )
}

function TabIcon({ tab, iconPack }: { tab: Tab; iconPack: 'nova' | 'classic' | 'minimal' }) {
  if (tab.kind === 'browser') return <Globe size={13} style={{ color: '#7dcfff' }} />
  if (tab.kind === 'diagram') return <Shapes size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'diff') return <SplitSquareHorizontal size={13} style={{ color: 'var(--warning)' }} />
  if (tab.kind === 'commit') return <GitCommitHorizontal size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'history') return <History size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'explain') return <BookOpen size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'tutorial') return <GraduationCap size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'http') return <Send size={13} style={{ color: 'var(--accent)' }} />
  if (tab.kind === 'settings') return <Settings size={13} className="faint" />
  const { Icon, color } = fileIcon(tab.path ?? tab.title, iconPack)
  return <Icon size={13} style={{ color, flexShrink: 0 }} />
}
