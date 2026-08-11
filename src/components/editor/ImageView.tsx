import { useEffect, useState } from 'react'
import { useStore } from '@/state/store'
import { basename, formatBytes } from '@/lib/paths'

export default function ImageView({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)

  const isSvg = path.toLowerCase().endsWith('.svg')
  const src = buffer?.binary ? buffer.content : `data:image/svg+xml;utf8,${encodeURIComponent(buffer?.content ?? '')}`

  useEffect(() => setZoom(1), [path])

  if (!buffer) return <div className="empty-state">Loading…</div>

  return (
    <div className="image-view">
      <div className="md-toolbar">
        <span className="chip">{basename(path)}</span>
        {dimensions && (
          <span className="chip">
            {dimensions.w} × {dimensions.h}
          </span>
        )}
        <span className="chip">{formatBytes(new Blob([buffer.content]).size)}</span>
        <div className="segmented" style={{ marginLeft: 'auto' }}>
          {[0.5, 1, 2].map((z) => (
            <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
              {z * 100}%
            </button>
          ))}
        </div>
      </div>
      <div className="image-canvas">
        <img
          src={src}
          alt={basename(path)}
          style={{ transform: `scale(${zoom})` }}
          onLoad={(e) =>
            setDimensions({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
        />
      </div>
      {isSvg && (
        <div className="faint" style={{ padding: '6px 12px', fontSize: 11, borderTop: '1px solid var(--border)' }}>
          SVG source is editable — open it from the tree with ⌘P and edit as text.
        </div>
      )}
    </div>
  )
}
