import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { availableRefactorings } from '@/lib/refactor'
import { currentHasSelection, currentSite, runRefactoring } from '@/lib/refactor/bridge'

/**
 * IntelliJ's Refactor This (⌃T): every refactoring that applies where the
 * caret is, with the ones that do not explaining why.
 */
export default function RefactorMenu() {
  const open = useStore((s) => s.refactorMenuOpen)
  const [index, setIndex] = useState(0)

  const entries = useMemo(() => {
    if (!open) return []
    const site = currentSite()
    if (!site) return []
    return availableRefactorings(site, currentHasSelection())
  }, [open])

  const enabled = entries.filter((entry) => entry.enabled)

  useEffect(() => {
    setIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        useStore.setState({ refactorMenuOpen: false })
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((i) => Math.min(i + 1, enabled.length - 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const chosen = enabled[index]
        if (chosen) choose(chosen.descriptor.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, enabled, index])

  if (!open) return null

  const site = currentSite()

  return (
    <div className="overlay" style={{ paddingTop: 120 }} onMouseDown={() => useStore.setState({ refactorMenuOpen: false })}>
      <div className="modal refactor-menu" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Refactor This</b>
          <span className="faint">{site ? site.language : 'no editor'}</span>
        </div>
        <div className="modal-list">
          {entries.length === 0 && <div className="modal-item faint">Open a file to refactor.</div>}
          {entries.map((entry) => {
            const position = enabled.indexOf(entry)
            return (
              <button
                key={entry.descriptor.id}
                className={`modal-item ${entry.enabled && position === index ? 'active' : ''} ${entry.enabled ? '' : 'disabled'}`}
                disabled={!entry.enabled}
                onMouseEnter={() => position >= 0 && setIndex(position)}
                onClick={() => choose(entry.descriptor.id)}
              >
                <span>{entry.descriptor.label}</span>
                <span className="faint" style={{ marginLeft: 'auto' }}>
                  {entry.enabled ? entry.descriptor.shortcut : entry.reason}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function choose(id: Parameters<typeof runRefactoring>[0]) {
  const site = currentSite()
  useStore.setState({ refactorMenuOpen: false })
  if (!site) return
  void runRefactoring(id, site)
}
