import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface MenuEntry {
  id: string
  label?: string
  Icon?: LucideIcon
  danger?: boolean
  separator?: boolean
  onSelect?: () => void
}

interface Props {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

export default function ContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 210)
  const top = Math.min(y, window.innerHeight - entries.length * 30 - 20)

  return (
    <div className="context-menu fade-in" style={{ left, top }} ref={ref}>
      {entries.map((entry) =>
        entry.separator ? (
          <div key={entry.id} className="context-sep" />
        ) : (
          <button
            key={entry.id}
            className={`context-item ${entry.danger ? 'danger' : ''}`}
            onClick={() => {
              entry.onSelect?.()
              onClose()
            }}
          >
            {entry.Icon && <entry.Icon size={13} />}
            {entry.label}
          </button>
        ),
      )}
    </div>
  )
}
