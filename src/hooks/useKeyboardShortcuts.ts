import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { dispatchShortcut } from '@/lib/keymap'

/**
 * Global shortcuts.
 *
 * The bindings themselves live in `lib/keymap.ts` as data, overridable from
 * Settings › Keymap. This hook only owns the two things that cannot be a
 * simple combo: double-shift for Search Everywhere, and ⌘1-9 tab selection.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    /** Timestamp of the last bare Shift press, for double-shift detection. */
    let lastShiftAt = 0

    const onKeyDown = (e: KeyboardEvent) => {
      const store = useStore.getState()

      // Double-shift → Search Everywhere. Only bare Shift taps count: Shift
      // held as part of any combo resets the timer instead of arming it.
      if (e.key === 'Shift' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
        const now = Date.now()
        if (now - lastShiftAt < 350) {
          lastShiftAt = 0
          // Not while typing into an input — a double-shift in the commit
          // message box should do nothing.
          const target = e.target as HTMLElement | null
          const editing =
            target?.tagName === 'INPUT' ||
            target?.tagName === 'TEXTAREA' ||
            target?.isContentEditable ||
            Boolean(target?.closest('.monaco-editor'))
          if (!editing) {
            e.preventDefault()
            store.setPalette(true, 'everywhere')
          }
          return
        }
        lastShiftAt = now
        return
      }
      if (e.key !== 'Shift') lastShiftAt = 0

      if (dispatchShortcut(e, store.settings.keymap)) return

      // Cmd+1..9 selects a tab by position.
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
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
