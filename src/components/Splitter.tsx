import { useCallback, useRef, useState } from 'react'

interface Props {
  direction: 'vertical' | 'horizontal'
  /** Called with the pointer delta in px since the drag started. */
  onResize: (delta: number) => void
  onDone?: () => void
}

/** A thin drag handle between two panes. */
export default function Splitter({ direction, onResize, onDone }: Props) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      origin.current = direction === 'vertical' ? e.clientX : e.clientY
      setDragging(true)
    },
    [direction],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const current = direction === 'vertical' ? e.clientX : e.clientY
      const delta = current - origin.current
      if (delta !== 0) {
        origin.current = current
        onResize(delta)
      }
    },
    [dragging, direction, onResize],
  )

  const stop = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      e.currentTarget.releasePointerCapture(e.pointerId)
      setDragging(false)
      onDone?.()
    },
    [dragging, onDone],
  )

  return (
    <div
      className={`splitter ${direction} ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      role="separator"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
    />
  )
}
