/**
 * Every action the palette can run — IntelliJ's Find Action, rather than a
 * curated shortlist.
 *
 * Two sources feed it: the app's own commands, declared here, and every action
 * Monaco has registered on the active editor. The second is the important one:
 * it is ~140 entries covering folding, multi-cursor, case transforms, line
 * moves, selection expansion and the whole find/replace family, all of which
 * were previously reachable only if you already knew the shortcut.
 */

import type * as monacoNs from 'monaco-editor'
import { currentSite, runRefactoring } from '@/lib/refactor/bridge'
import { REFACTORINGS } from '@/lib/refactor'
import { newDiagramTab } from '@/components/diagram/diagramFile'
import { TUTORIAL_CHAPTERS } from '@/lib/tutorial'
import { themes } from '@/theme/themes'
import { useStore } from '@/state/store'

export interface Action {
  id: string
  label: string
  /** Grouping prefix shown before the label, e.g. `Editor`. */
  category: string
  hint?: string
  run: () => void
}

/** Monaco reports keybindings as chords; render them the way menus do. */
function describeKeybinding(editor: monacoNs.editor.ICodeEditor, actionId: string): string {
  try {
    const service = (editor as unknown as {
      _standaloneKeybindingService?: {
        lookupKeybinding?: (id: string) => { getLabel(): string | null } | undefined
      }
    })._standaloneKeybindingService
    const found = service?.lookupKeybinding?.(actionId)
    return found?.getLabel() ?? ''
  } catch {
    return ''
  }
}

/** Turns `editor.action.transformToUppercase` into `Transform to Uppercase`. */
function humanise(label: string, id: string): string {
  if (label && label !== id) return label
  return id
    .replace(/^editor\.action\./, '')
    .replace(/^editor\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

/** Actions that only make sense with an editor open. */
export function editorActions(editor: monacoNs.editor.ICodeEditor | null): Action[] {
  if (!editor) return []
  let supported: monacoNs.editor.IEditorAction[]
  try {
    supported = editor.getSupportedActions()
  } catch {
    return []
  }
  return supported.map((action) => ({
    id: `editor:${action.id}`,
    label: humanise(action.label, action.id),
    category: 'Editor',
    hint: describeKeybinding(editor, action.id),
    run: () => {
      editor.focus()
      editor.trigger('palette', action.id, null)
    },
  }))
}

/** The app's own commands: everything that is not a Monaco editor action. */
/** The bottom panels, so the palette can reach every one by name. */
const PANELS = [
  { id: 'terminal' as const, label: 'Terminal' },
  { id: 'problems' as const, label: 'Problems' },
  { id: 'usages' as const, label: 'Usages' },
  { id: 'hierarchy' as const, label: 'Hierarchy' },
  { id: 'tests' as const, label: 'Tests' },
  { id: 'debug' as const, label: 'Debug' },
  { id: 'todo' as const, label: 'TODO' },
  { id: 'coverage' as const, label: 'Coverage' },
  { id: 'build' as const, label: 'Build' },
  { id: 'profile' as const, label: 'Profiler' },
  { id: 'infra' as const, label: 'Infra' },
  { id: 'security' as const, label: 'Security' },
  { id: 'devices' as const, label: 'Devices' },
]

export function appActions(): Action[] {
  const store = useStore.getState()
  const settings = store.settings

  const commands: Action[] = [
    { id: 'open-folder', label: 'Open Folder…', category: 'File', run: () => void store.pickProject() },
    { id: 'save', label: 'Save', category: 'File', hint: '⌘S', run: () => {
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (path) void store.saveBuffer(path)
    } },
    { id: 'save-all', label: 'Save All', category: 'File', hint: '⇧⌘S', run: () => void store.saveAll() },
    { id: 'close-tab', label: 'Close Tab', category: 'File', hint: '⌘W', run: () => {
      if (store.activeTabId) store.closeTab(store.activeTabId)
    } },
    { id: 'close-others', label: 'Close Other Tabs', category: 'File', run: () => store.closeOtherTabs(store.activeTabId ?? '') },
    { id: 'new-diagram', label: 'New Architecture Diagram', category: 'File', run: () => newDiagramTab() },
    { id: 'gen-uml', label: 'Generate UML Class Diagram from Code', category: 'Diagrams', run: async () => {
      const { generateUmlDiagram } = await import('@/lib/diagramActions')
      await generateUmlDiagram()
    } },
    { id: 'gen-modules', label: 'Generate Module Dependency Diagram', category: 'Diagrams', run: async () => {
      const { generateModuleDependencyDiagram } = await import('@/lib/diagramActions')
      await generateModuleDependencyDiagram()
    } },
    { id: 'gen-dsm', label: 'Generate Dependency Structure Matrix', category: 'Diagrams', run: async () => {
      const { generateDependencyMatrix } = await import('@/lib/diagramActions')
      await generateDependencyMatrix()
    } },
    { id: 'scratches', label: 'Scratch Files…', category: 'File', run: () =>
      store.openTab({ id: 'scratches', kind: 'scratch', title: 'Scratches' }) },
    { id: 'new-scratch', label: 'New Scratch File (TypeScript)', category: 'File', run: async () => {
      const { newScratchFile } = await import('@/components/editor/ScratchView')
      await newScratchFile('ts')
    } },

    { id: 'go-to-file', label: 'Go to File…', category: 'Navigate', hint: '⌘P', run: () => store.setPalette(true, 'file') },
    { id: 'go-to-symbol', label: 'Go to Symbol in Project…', category: 'Navigate', hint: '⇧⌘O', run: () => store.setPalette(true, 'symbol') },
    { id: 'recent-files', label: 'Recent Files…', category: 'Navigate', hint: '⌘E', run: () => store.setPalette(true, 'recent') },
    { id: 'structure', label: 'File Structure…', category: 'Navigate', hint: '⌘F12', run: () => store.setPalette(true, 'structure') },
    { id: 'bookmarks', label: 'Show Bookmarks…', category: 'Navigate', hint: '⇧F11', run: () => store.setPalette(true, 'bookmarks') },
    { id: 'toggle-bookmark', label: 'Toggle Bookmark', category: 'Navigate', hint: 'F11', run: () => store.toggleBookmark() },
    { id: 'usages', label: 'Show Find Usages Panel', category: 'Navigate', hint: '⌥F7', run: () => store.togglePanel('usages') },
    { id: 'reindex', label: 'Rebuild Project Symbol Index', category: 'Navigate', run: () => void store.buildIndex() },

    { id: 'search', label: 'Find in Project…', category: 'Search', hint: '⇧⌘F', run: () => store.setSidebarView('search') },
    { id: 'replace', label: 'Replace in Project…', category: 'Search', hint: '⇧⌘R', run: () => {
      store.setSidebarView('search')
      window.dispatchEvent(new CustomEvent('nova:open-replace'))
    } },
    { id: 'todos', label: 'Show TODOs', category: 'Search', run: () => store.togglePanel('todo') },

    { id: 'inspect-code', label: 'Inspect Code — whole project', category: 'Code', run: () => void store.runInspectCode() },

    { id: 'git', label: 'Show Source Control', category: 'Git', hint: '⇧⌘G', run: () => store.setSidebarView('git') },
    { id: 'git-refresh', label: 'Refresh', category: 'Git', run: () => void store.refreshCommits() },

    { id: 'database', label: 'Database Console', category: 'Tools', run: () => {
      useStore.getState().openTab({ id: 'database', kind: 'database', title: 'Database' })
    } },
    { id: 'explain', label: 'Explain This File — docs, diagrams and a tutorial', category: 'AI', hint: '⌥⌘E', run: () => {
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (path) void store.explainFile(path)
      else store.notify('Open a source file first.', 'error')
    } },
    { id: 'tutorial', label: 'Explain This Whole Project — libraries, architecture, patterns and flows', category: 'AI', hint: '⇧⌥⌘E', run: () => void store.generateTutorial('book') },
    ...TUTORIAL_CHAPTERS.filter((chapter) => chapter.id !== 'book').map((chapter) => ({
      id: `tutorial:${chapter.id}`,
      label: `Project Tutorial — ${chapter.short}: ${chapter.blurb}`,
      category: 'AI',
      run: () => void store.generateTutorial(chapter.id),
    })),
    { id: 'toggle-ai', label: 'Toggle AI Console', category: 'AI', hint: '⌘I', run: () => store.toggleAi() },

    { id: 'format', label: 'Reformat Code', category: 'Code', hint: '⌥⌘L', run: async () => {
      const { activeEditor } = await import('@/lib/refactor/bridge')
      const { formatDocument } = await import('@/lib/format')
      const editor = activeEditor()
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (editor && path) await formatDocument(editor, path)
      else store.notify('Open a file first.', 'error')
    } },
    { id: 'optimize-imports', label: 'Optimize Imports', category: 'Code', hint: '⌃⌥O', run: async () => {
      const { activeEditor } = await import('@/lib/refactor/bridge')
      const { optimizeImportsIn } = await import('@/lib/format')
      const editor = activeEditor()
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (editor && path) await optimizeImportsIn(editor, path)
      else store.notify('Open a file first.', 'error')
    } },

    { id: 'refactor-this', label: 'Refactor This…', category: 'Refactor', hint: '⌃T', run: () => useStore.setState({ refactorMenuOpen: true }) },
    ...REFACTORINGS.map((descriptor) => ({
      id: `refactor:${descriptor.id}`,
      label: descriptor.label,
      category: 'Refactor',
      hint: descriptor.shortcut,
      run: () => {
        const site = currentSite()
        if (!site) {
          store.notify('Open a file to refactor.', 'error')
          return
        }
        void runRefactoring(descriptor.id, site)
      },
    })),

    { id: 'debug-start', label: 'Start / Continue', category: 'Debug', hint: 'F5', run: () => void store.startDebug() },
    { id: 'debug-stop', label: 'Stop', category: 'Debug', hint: '⇧F5', run: () => void window.nova.debug.stop() },
    { id: 'debug-clear-bp', label: 'Remove All Breakpoints', category: 'Debug', run: () => void window.nova.debug.clearBreakpoints() },
    { id: 'debug-run-to-cursor', label: 'Run to Cursor', category: 'Debug', hint: '⌥F9', run: () => {
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (!path || !store.cursor.line) return
      void window.nova.debug.runToLine(path, store.cursor.line)
    } },
    { id: 'debug-drop-frame', label: 'Drop Frame', category: 'Debug', run: async () => {
      const result = await window.nova.debug.dropFrame()
      if (!result.ok) store.notify(result.error, 'error')
    } },
    { id: 'debug-breakpoints', label: 'Breakpoints — lines, exceptions and watchpoints', category: 'Debug', run: () => store.showPanel('debug') },
    { id: 'tests-run', label: 'Run All Tests', category: 'Run', run: () => void store.runTests({ kind: 'all' }) },
    { id: 'run-configs', label: 'Edit Run Configurations…', category: 'Run', run: () =>
      store.openTab({ id: 'runconfigs', kind: 'runconfigs', title: 'Run Configurations' }) },
    { id: 'terminal', label: 'Terminal', category: 'Run', hint: '⌃`', run: () => store.togglePanel('terminal') },

    { id: 'browser', label: 'Open Built-in Browser', category: 'View', run: () =>
      store.openTab({ id: `browser:${Date.now()}`, kind: 'browser', title: 'Browser', url: settings.browserHome }) },
    { id: 'toggle-panel', label: 'Toggle Panel', category: 'View', hint: '⌘J', run: () => store.togglePanel() },

    /*
     * One entry per bottom panel.
     *
     * The tab strip scrolls when the window is narrow, and the panels that end
     * up past its edge had no other route — a strip with a hidden scrollbar
     * gives no sign they exist. Someone looking for coverage or the security
     * scanner types its name, and the palette does not care how wide the
     * window is.
     */
    ...PANELS.map((panel) => ({
      id: `panel-${panel.id}`,
      label: `${panel.label} Panel`,
      category: 'View',
      run: () => store.showPanel(panel.id),
    })),
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View', hint: '⌘B', run: () => store.toggleSidebar() },
    { id: 'split', label: 'Split Editor Right', category: 'View', hint: '⌥⌘→', run: () => store.splitEditor() },
    { id: 'unsplit', label: 'Close Split', category: 'View', run: () => store.closeSplit() },

    { id: 'settings', label: 'Open Settings', category: 'Preferences', run: () =>
      store.openTab({ id: 'settings', kind: 'settings', title: 'Settings' }) },
    { id: 'project-structure', label: 'Project Structure — modules, SDKs, frameworks', category: 'Preferences', run: () =>
      store.openTab({ id: 'projectmodel', kind: 'projectmodel', title: 'Project Structure' }) },
    { id: 'wrap', label: `Turn Word Wrap ${settings.wordWrap ? 'Off' : 'On'}`, category: 'Preferences', run: () => store.setSettings({ wordWrap: !settings.wordWrap }) },
    { id: 'minimap', label: `Turn Minimap ${settings.minimap ? 'Off' : 'On'}`, category: 'Preferences', run: () => store.setSettings({ minimap: !settings.minimap }) },
    { id: 'blame', label: `Turn Blame Gutter ${settings.showBlame ? 'Off' : 'On'}`, category: 'Preferences', run: () => store.setSettings({ showBlame: !settings.showBlame }) },
    { id: 'autosave', label: `Turn Auto Save ${settings.autoSave ? 'Off' : 'On'}`, category: 'Preferences', run: () => store.setSettings({ autoSave: !settings.autoSave }) },
    ...themes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.name,
      category: 'Theme',
      hint: theme.type,
      run: () => store.setSettings({ themeId: theme.id }),
    })),
  ]

  return commands
}

/** Ranks by where the needle matches: whole label, word start, then anywhere. */
export function rankActions(actions: Action[], query: string): Action[] {
  const needle = query.toLowerCase().replace(/^>/, '').trim()
  if (!needle) return actions
  const scored: { action: Action; score: number }[] = []
  for (const action of actions) {
    const label = action.label.toLowerCase()
    const full = `${action.category.toLowerCase()}: ${label}`
    let score = 0
    if (label === needle) score = 100
    else if (label.startsWith(needle)) score = 80
    else if (new RegExp(`\\b${escapeRegExp(needle)}`).test(label)) score = 60
    else if (label.includes(needle)) score = 40
    else if (full.includes(needle)) score = 20
    else if (subsequence(label, needle)) score = 10
    if (score > 0) scored.push({ action, score })
  }
  scored.sort((a, b) => b.score - a.score || a.action.label.length - b.action.label.length)
  return scored.map((entry) => entry.action)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function subsequence(haystack: string, needle: string) {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}
