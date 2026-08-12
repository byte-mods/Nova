import { useEffect } from 'react'
import { activeTab, useStore } from '@/state/store'

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const store = useStore.getState()

      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        store.setPalette(true, e.shiftKey ? 'command' : 'file')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        store.setPalette(true, 'command')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        store.setPalette(true, 'symbol')
        return
      }
      // Debugger transport keys, active regardless of focus.
      // Shift+F5 must be tested before plain F5, or it never matches.
      if (e.shiftKey && e.key === 'F5') {
        e.preventDefault()
        void window.nova.debug.stop()
        return
      }
      if (e.key === 'F5') {
        e.preventDefault()
        const status = store.debug.state?.status
        if (status === 'paused') void window.nova.debug.continue()
        else if (status === 'inactive' || !status) void store.startDebug()
        return
      }
      if (e.key === 'F10') {
        e.preventDefault()
        void window.nova.debug.next()
        return
      }
      if (e.key === 'F11' && store.debug.state?.status === 'paused') {
        e.preventDefault()
        if (e.shiftKey) void window.nova.debug.stepOut()
        else void window.nova.debug.stepIn()
        return
      }
      // Recent Files (⌘E) and Recent Locations (⇧⌘E).
      if (mod && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        store.setPalette(true, 'recent')
        return
      }
      // File Structure (⌘F12).
      if (mod && e.key === 'F12') {
        e.preventDefault()
        store.setPalette(true, 'structure')
        return
      }
      // Bookmarks: F11 toggles, ⇧F11 lists. Debug step-into keeps ⇧F11 only
      // while a session is live, which is when it can mean anything.
      if (e.key === 'F11' && !e.shiftKey && store.debug.state?.status !== 'paused') {
        e.preventDefault()
        store.toggleBookmark()
        return
      }
      if (e.key === 'F11' && e.shiftKey && store.debug.state?.status !== 'paused') {
        e.preventDefault()
        store.setPalette(true, 'bookmarks')
        return
      }
      // Replace in Path (⇧⌘R).
      if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        store.setSidebarView('search')
        window.dispatchEvent(new CustomEvent('nova:open-replace'))
        return
      }
      // Split editor (⌥⌘→) and close split (⌥⌘←).
      if (mod && e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        store.splitEditor()
        return
      }
      if (mod && e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        store.closeSplit()
        return
      }
      // Explain This File.
      if (mod && e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        const path = store.tabs.find((t) => t.id === store.activeTabId)?.path
        if (path) void store.explainFile(path)
        return
      }
      // Refactor This. Monaco binds it too; this covers the rest of the app.
      if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        useStore.setState({ refactorMenuOpen: true })
        return
      }
      // IntelliJ's Find Usages; the editor binds it too, this covers other panes.
      if (e.altKey && e.key === 'F7') {
        e.preventDefault()
        const selection = window.getSelection()?.toString().trim()
        if (selection) void store.findUsages(selection)
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void store.saveAll()
        else {
          const tab = activeTab()
          if (tab?.path) void store.saveBuffer(tab.path)
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault()
        store.toggleSidebar()
        return
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        store.togglePanel()
        return
      }
      if (mod && e.key.toLowerCase() === 'i' && !e.shiftKey) {
        e.preventDefault()
        store.toggleAi()
        return
      }
      if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (store.activeTabId) store.closeTab(store.activeTabId)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        store.setSidebarView('search')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        store.setSidebarView('git')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        store.setSidebarView('explorer')
        return
      }
      if (e.key === '`' && e.ctrlKey) {
        e.preventDefault()
        store.togglePanel('terminal')
        return
      }
      // Cmd+1..9 selects a tab by position.
      if (mod && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        const tab = store.tabs[index]
        if (tab) {
          e.preventDefault()
          store.setActiveTab(tab.id)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
