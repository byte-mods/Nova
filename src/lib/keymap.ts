/**
 * The app-level keymap: every global shortcut as data, so the bindings can be
 * changed in Settings instead of living hardcoded in an event handler.
 *
 * A combo is written `mod+shift+f` — `mod` is ⌘ on macOS and Ctrl elsewhere.
 * `settings.keymap[action id]` overrides the default; an empty string unbinds.
 * Monaco's editor-local bindings are separate and unaffected: this keymap is
 * for the shortcuts that must work with focus anywhere in the app.
 */

import { activeTab, useStore } from '@/state/store'

export interface ShortcutAction {
  id: string
  label: string
  /** Default combo, e.g. `mod+shift+o`. Empty means unbound by default. */
  combo: string
  /** Runs with the keydown already prevented. */
  run: (event: KeyboardEvent) => void
  /** Skip while the shortcut would fight a more specific handler. */
  when?: () => boolean
}

export interface ParsedCombo {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}

export function parseCombo(combo: string): ParsedCombo | null {
  if (!combo.trim()) return null
  const parts = combo.toLowerCase().split('+').map((part) => part.trim())
  const parsed: ParsedCombo = { key: '', mod: false, shift: false, alt: false, ctrl: false }
  for (const part of parts) {
    if (part === 'mod' || part === 'cmd' || part === 'meta') parsed.mod = true
    else if (part === 'shift') parsed.shift = true
    else if (part === 'alt' || part === 'option' || part === 'opt') parsed.alt = true
    else if (part === 'ctrl' || part === 'control') parsed.ctrl = true
    else parsed.key = part
  }
  return parsed.key ? parsed : null
}

export function comboMatches(combo: ParsedCombo, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== combo.key) return false
  if (combo.shift !== event.shiftKey) return false
  if (combo.alt !== event.altKey) return false
  // `ctrl` is the literal Control key; `mod` accepts ⌘ or Ctrl so one combo
  // works across platforms; neither means neither may be down.
  if (combo.ctrl) return event.ctrlKey && !event.metaKey
  if (combo.mod) return event.metaKey || event.ctrlKey
  return !event.metaKey && !event.ctrlKey
}

/** Renders a combo the way macOS menus do. */
export function describeCombo(combo: string): string {
  const parsed = parseCombo(combo)
  if (!parsed) return ''
  const key = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key.replace(/^f(\d+)$/, 'F$1')
  return `${parsed.ctrl ? '⌃' : ''}${parsed.alt ? '⌥' : ''}${parsed.shift ? '⇧' : ''}${parsed.mod ? '⌘' : ''}${key}`
}

/** Turns a keydown into combo notation, for the Settings capture field. */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase()
  if (['meta', 'shift', 'alt', 'control'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey && !event.metaKey) parts.push('ctrl')
  if (event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/* ---------------- the actions ---------------- */

const nova = () => window.nova

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: 'palette.files',
    label: 'Go to File',
    combo: 'mod+p',
    run: () => useStore.getState().setPalette(true, 'file'),
  },
  {
    id: 'palette.commands',
    label: 'Find Action',
    combo: 'mod+shift+p',
    run: () => useStore.getState().setPalette(true, 'command'),
  },
  {
    id: 'palette.commands2',
    label: 'Find Action (alternative)',
    combo: 'mod+shift+k',
    run: () => useStore.getState().setPalette(true, 'command'),
  },
  {
    id: 'palette.symbols',
    label: 'Go to Symbol in Project',
    combo: 'mod+shift+o',
    run: () => useStore.getState().setPalette(true, 'symbol'),
  },
  {
    id: 'search.everywhere',
    label: 'Search Everywhere (double-shift also works)',
    combo: '',
    run: () => useStore.getState().setPalette(true, 'everywhere'),
  },
  {
    id: 'palette.recent',
    label: 'Recent Files',
    combo: 'mod+e',
    run: () => useStore.getState().setPalette(true, 'recent'),
  },
  {
    id: 'palette.locations',
    label: 'Recent Locations',
    combo: 'mod+shift+e',
    run: () => useStore.getState().setPalette(true, 'locations'),
  },
  {
    id: 'palette.structure',
    label: 'File Structure',
    combo: 'mod+f12',
    run: () => useStore.getState().setPalette(true, 'structure'),
  },
  {
    id: 'bookmarks.toggle',
    label: 'Toggle Bookmark',
    combo: 'f11',
    when: () => useStore.getState().debug.state?.status !== 'paused',
    run: () => useStore.getState().toggleBookmark(),
  },
  {
    id: 'bookmarks.list',
    label: 'Show Bookmarks',
    combo: 'shift+f11',
    when: () => useStore.getState().debug.state?.status !== 'paused',
    run: () => useStore.getState().setPalette(true, 'bookmarks'),
  },
  {
    id: 'debug.stop',
    label: 'Stop Debugging',
    combo: 'shift+f5',
    run: () => void nova().debug.stop(),
  },
  {
    id: 'debug.continue',
    label: 'Start / Continue Debugging',
    combo: 'f5',
    run: () => {
      const status = useStore.getState().debug.state?.status
      if (status === 'paused') void nova().debug.continue()
      else if (status === 'inactive' || !status) void useStore.getState().startDebug()
    },
  },
  {
    id: 'debug.stepOver',
    label: 'Step Over',
    combo: 'f10',
    run: () => void nova().debug.next(),
  },
  {
    id: 'debug.stepIn',
    label: 'Step Into',
    combo: 'f11',
    when: () => useStore.getState().debug.state?.status === 'paused',
    run: () => void nova().debug.stepIn(),
  },
  {
    id: 'debug.stepOut',
    label: 'Step Out',
    combo: 'shift+f11',
    when: () => useStore.getState().debug.state?.status === 'paused',
    run: () => void nova().debug.stepOut(),
  },
  {
    id: 'search.replaceInPath',
    label: 'Replace in Path',
    combo: 'mod+shift+r',
    run: () => {
      useStore.getState().setSidebarView('search')
      window.dispatchEvent(new CustomEvent('nova:open-replace'))
    },
  },
  {
    id: 'view.splitRight',
    label: 'Split Editor Right',
    combo: 'mod+alt+arrowright',
    run: () => useStore.getState().splitEditor(),
  },
  {
    id: 'view.closeSplit',
    label: 'Close Split',
    combo: 'mod+alt+arrowleft',
    run: () => useStore.getState().closeSplit(),
  },
  {
    id: 'ai.explainFile',
    label: 'Explain This File',
    combo: 'mod+alt+e',
    run: () => {
      const store = useStore.getState()
      const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
      if (path) void store.explainFile(path)
    },
  },
  {
    id: 'ai.projectTutorial',
    label: 'Explain This Whole Project',
    combo: 'mod+alt+shift+e',
    run: () => void useStore.getState().generateTutorial('book'),
  },
  {
    id: 'refactor.menu',
    label: 'Refactor This',
    combo: 'ctrl+t',
    run: () => useStore.setState({ refactorMenuOpen: true }),
  },
  {
    id: 'navigate.usages',
    label: 'Find Usages of Selection',
    combo: 'alt+f7',
    run: () => {
      const selection = window.getSelection()?.toString().trim()
      if (selection) void useStore.getState().findUsages(selection)
    },
  },
  {
    id: 'file.save',
    label: 'Save',
    combo: 'mod+s',
    run: () => {
      const tab = activeTab()
      if (tab?.path) void useStore.getState().saveBuffer(tab.path)
    },
  },
  {
    id: 'file.saveAll',
    label: 'Save All',
    combo: 'mod+shift+s',
    run: () => void useStore.getState().saveAll(),
  },
  {
    id: 'view.sidebar',
    label: 'Toggle Sidebar',
    combo: 'mod+b',
    run: () => useStore.getState().toggleSidebar(),
  },
  {
    id: 'view.panel',
    label: 'Toggle Panel',
    combo: 'mod+j',
    run: () => useStore.getState().togglePanel(),
  },
  {
    id: 'view.ai',
    label: 'Toggle AI Console',
    combo: 'mod+i',
    run: () => useStore.getState().toggleAi(),
  },
  {
    id: 'file.closeTab',
    label: 'Close Tab',
    combo: 'mod+w',
    run: () => {
      const store = useStore.getState()
      if (store.activeTabId) store.closeTab(store.activeTabId)
    },
  },
  {
    id: 'search.inProject',
    label: 'Find in Project',
    combo: 'mod+shift+f',
    run: () => useStore.getState().setSidebarView('search'),
  },
  {
    id: 'view.git',
    label: 'Show Source Control',
    combo: 'mod+shift+g',
    run: () => useStore.getState().setSidebarView('git'),
  },
  {
    id: 'view.explorer',
    label: 'Show Explorer',
    combo: 'mod+shift+e',
    run: () => useStore.getState().setSidebarView('explorer'),
  },
  {
    id: 'view.terminal',
    label: 'Toggle Terminal',
    combo: 'ctrl+`',
    run: () => useStore.getState().togglePanel('terminal'),
  },
]

/**
 * Two defaults collide on purpose (⇧⌘E is Recent Locations *and* Explorer —
 * IntelliJ and VS Code muscle memory respectively). First match wins, and the
 * order above puts Recent Locations first; rebinding either resolves it.
 */
export function effectiveCombo(action: ShortcutAction, keymap: Record<string, string>): string {
  return keymap[action.id] !== undefined ? keymap[action.id] : action.combo
}

export function dispatchShortcut(event: KeyboardEvent, keymap: Record<string, string>): boolean {
  for (const action of SHORTCUT_ACTIONS) {
    const combo = parseCombo(effectiveCombo(action, keymap))
    if (!combo || !comboMatches(combo, event)) continue
    if (action.when && !action.when()) continue
    event.preventDefault()
    action.run(event)
    return true
  }
  return false
}
