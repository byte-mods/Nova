import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  Frame,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Plus,
  Shapes,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { diagramIconChoices, type DiagramIconName } from '@/lib/fileIcons'
import { diagramIcon } from './icons'
import MermaidView from './MermaidView'
import { buildTemplate, parseDiagram, TEMPLATES, type TemplateId } from './diagramFile'
import {
  edgeId,
  NODE_COLORS,
  nodeId,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type EdgeKind,
  type NodeShape,
} from './types'

const SHAPES: { id: NodeShape; label: string }[] = [
  { id: 'rounded', label: 'Rounded' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'package', label: 'UML class' },
  { id: 'cylinder', label: 'Datastore' },
  { id: 'hexagon', label: 'Queue' },
  { id: 'diamond', label: 'Decision' },
  { id: 'circle', label: 'Circle' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'actor', label: 'Actor' },
  { id: 'note', label: 'Note' },
]

const EDGE_KINDS: { id: EdgeKind; label: string }[] = [
  { id: 'flow', label: 'Flow →' },
  { id: 'association', label: 'Association —' },
  { id: 'dependency', label: 'Dependency ⇢' },
  { id: 'inheritance', label: 'Inheritance ▷' },
  { id: 'implementation', label: 'Implements ⊳ (dashed)' },
  { id: 'composition', label: 'Composition ◆' },
  { id: 'aggregation', label: 'Aggregation ◇' },
]

interface Selection {
  kind: 'node' | 'edge'
  id: string
}

export default function DiagramEditor({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  const doc = useMemo<DiagramDoc>(() => parseDiagram(buffer?.content ?? ''), [buffer?.content])

  const [selection, setSelection] = useState<Selection | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [view, setView] = useState({ x: 40, y: 40, zoom: 1 })
  const [iconQuery, setIconQuery] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)

  const update = useCallback(
    (next: DiagramDoc) => {
      useStore.getState().updateBuffer(path, JSON.stringify(next, null, 2))
    },
    [path],
  )

  const patchNode = useCallback(
    (id: string, patch: Partial<DiagramNode>) => {
      update({ ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })
    },
    [doc, update],
  )

  const patchEdge = useCallback(
    (id: string, patch: Partial<DiagramEdge>) => {
      update({ ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
    },
    [doc, update],
  )

  const addNode = useCallback(() => {
    const id = nodeId()
    const node: DiagramNode = {
      id,
      x: Math.round((-view.x + 260) / view.zoom / 8) * 8,
      y: Math.round((-view.y + 180) / view.zoom / 8) * 8,
      w: 168,
      h: 74,
      label: 'New node',
      detail: '',
      icon: 'box',
      shape: 'rounded',
      color: NODE_COLORS[doc.nodes.length % NODE_COLORS.length],
    }
    update({ ...doc, nodes: [...doc.nodes, node] })
    setSelection({ kind: 'node', id })
  }, [doc, update, view])

  const remove = useCallback(() => {
    if (!selection) return
    if (selection.kind === 'node') {
      update({
        ...doc,
        nodes: doc.nodes.filter((n) => n.id !== selection.id),
        edges: doc.edges.filter((e) => e.from !== selection.id && e.to !== selection.id),
      })
    } else {
      update({ ...doc, edges: doc.edges.filter((e) => e.id !== selection.id) })
    }
    setSelection(null)
  }, [doc, selection, update])

  const duplicate = useCallback(() => {
    if (selection?.kind !== 'node') return
    const source = doc.nodes.find((n) => n.id === selection.id)
    if (!source) return
    const copy = { ...source, id: nodeId(), x: source.x + 28, y: source.y + 28 }
    update({ ...doc, nodes: [...doc.nodes, copy] })
    setSelection({ kind: 'node', id: copy.id })
  }, [doc, selection, update])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        remove()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicate()
      } else if (e.key === 'Escape') {
        setConnectFrom(null)
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [remove, duplicate])

  const toClient = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - view.x) / view.zoom,
      y: (e.clientY - rect.top - view.y) / view.zoom,
    }
  }

  const onNodePointerDown = (e: React.PointerEvent, node: DiagramNode) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setSelection({ kind: 'node', id: node.id })
    if (connectFrom) {
      if (connectFrom !== node.id) {
        const edge: DiagramEdge = {
          id: edgeId(),
          from: connectFrom,
          to: node.id,
          label: '',
          kind: 'flow',
        }
        update({ ...doc, edges: [...doc.edges, edge] })
        setSelection({ kind: 'edge', id: edge.id })
      }
      setConnectFrom(null)
      return
    }
    const point = toClient(e)
    dragRef.current = { id: node.id, dx: point.x - node.x, dy: point.y - node.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const point = toClient(e)
      const snap = (v: number) => (e.altKey ? v : Math.round(v / 8) * 8)
      patchNode(dragRef.current.id, {
        x: snap(point.x - dragRef.current.dx),
        y: snap(point.y - dragRef.current.dy),
      })
      return
    }
    if (panRef.current) {
      setView((v) => ({
        ...v,
        x: v.x + (e.clientX - panRef.current!.x),
        y: v.y + (e.clientY - panRef.current!.y),
      }))
      panRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const endPointer = () => {
    dragRef.current = null
    panRef.current = null
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      return
    }
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setView((v) => {
      const zoom = Math.min(2.6, Math.max(0.25, v.zoom * (e.deltaY < 0 ? 1.08 : 0.925)))
      const ratio = zoom / v.zoom
      return { zoom, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio }
    })
  }

  const fit = useCallback(() => {
    if (doc.nodes.length === 0) {
      setView({ x: 40, y: 40, zoom: 1 })
      return
    }
    const minX = Math.min(...doc.nodes.map((n) => n.x)) - 40
    const minY = Math.min(...doc.nodes.map((n) => n.y)) - 40
    const maxX = Math.max(...doc.nodes.map((n) => n.x + n.w)) + 40
    const maxY = Math.max(...doc.nodes.map((n) => n.y + n.h)) + 40
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const zoom = Math.min(1.6, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)))
    setView({ zoom, x: -minX * zoom + 20, y: -minY * zoom + 20 })
  }, [doc.nodes])

  const exportSvg = () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove())
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml',
    })
    downloadBlob(blob, `${doc.title || 'diagram'}.svg`)
  }

  const exportPng = () => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove())
    const source = new XMLSerializer().serializeToString(clone)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = rect.width * 2
      canvas.height = rect.height * 2
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2)
      ctx.drawImage(image, 0, 0)
      canvas.toBlob((blob) => blob && downloadBlob(blob, `${doc.title || 'diagram'}.png`))
    }
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
  }

  const selectedNode = selection?.kind === 'node' ? doc.nodes.find((n) => n.id === selection.id) : undefined
  const selectedEdge = selection?.kind === 'edge' ? doc.edges.find((e) => e.id === selection.id) : undefined

  return (
    <div className="diagram-editor">
      <div className="diagram-toolbar">
        <div className="segmented">
          <button
            className={doc.mode === 'canvas' ? 'active' : ''}
            onClick={() => update({ ...doc, mode: 'canvas' })}
          >
            <Shapes size={12} /> Canvas
          </button>
          <button
            className={doc.mode === 'mermaid' ? 'active' : ''}
            onClick={() => update({ ...doc, mode: 'mermaid' })}
          >
            <Frame size={12} /> Mermaid
          </button>
        </div>

        <input
          value={doc.title}
          onChange={(e) => update({ ...doc, title: e.target.value })}
          style={{ height: 26, width: 190 }}
          placeholder="Diagram title"
        />

        {doc.mode === 'canvas' ? (
          <>
            <button className="btn sm" onClick={addNode}>
              <Plus size={12} /> Node
            </button>
            <button
              className={`btn sm ${connectFrom ? 'primary' : ''}`}
              onClick={() =>
                setConnectFrom(connectFrom ? null : (selection?.kind === 'node' ? selection.id : null))
              }
              disabled={!connectFrom && selection?.kind !== 'node'}
              title="Select a node, click Connect, then click the target node"
            >
              <Link2 size={12} /> {connectFrom ? 'Pick target…' : 'Connect'}
            </button>
            <button className="btn sm" onClick={duplicate} disabled={selection?.kind !== 'node'}>
              <Copy size={12} />
            </button>
            <button className="btn sm" onClick={remove} disabled={!selection}>
              <Trash2 size={12} />
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => setView((v) => ({ ...v, zoom: v.zoom * 0.9 }))}>
              <ZoomOut size={12} />
            </button>
            <span className="chip">{Math.round(view.zoom * 100)}%</span>
            <button className="btn sm" onClick={() => setView((v) => ({ ...v, zoom: v.zoom * 1.1 }))}>
              <ZoomIn size={12} />
            </button>
            <button className="btn sm" onClick={fit} title="Fit to content">
              <Maximize2 size={12} />
            </button>
            <button className="btn sm" onClick={exportSvg} title="Export SVG">
              <Download size={12} /> SVG
            </button>
            <button className="btn sm" onClick={exportPng} title="Export PNG">
              <ImageIcon size={12} /> PNG
            </button>
          </>
        ) : (
          <>
            <span style={{ flex: 1 }} />
            <TemplateMenu
              onPick={(id) => {
                const next = buildTemplate(id, doc.title)
                update({ ...next, title: doc.title })
              }}
            />
          </>
        )}
        {doc.mode === 'canvas' && (
          <TemplateMenu
            onPick={(id) => {
              const next = buildTemplate(id, doc.title)
              update({ ...next, title: doc.title })
              setTimeout(fit, 40)
            }}
          />
        )}
      </div>

      {doc.mode === 'mermaid' ? (
        <div className="diagram-mermaid">
          <textarea
            className="mermaid-source mono"
            value={doc.mermaid}
            spellCheck={false}
            onChange={(e) => update({ ...doc, mermaid: e.target.value })}
          />
          <div className="mermaid-preview">
            <MermaidView code={doc.mermaid} />
          </div>
        </div>
      ) : (
        <div className="diagram-body">
          <svg
            ref={svgRef}
            className="diagram-canvas"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg')) {
                setSelection(null)
                setConnectFrom(null)
                panRef.current = { x: e.clientX, y: e.clientY }
              }
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerLeave={endPointer}
            onWheel={onWheel}
          >
            <defs>
              <pattern id="grid" width={24} height={24} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill="var(--border)" />
              </pattern>
              {arrowMarkers()}
            </defs>
            <rect data-bg="1" width="100%" height="100%" fill="var(--editor-bg)" />
            <rect
              data-bg="1"
              width="100%"
              height="100%"
              fill="url(#grid)"
              style={{ opacity: 0.6 }}
            />

            <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
              {doc.edges.map((edge) => (
                <EdgeShape
                  key={edge.id}
                  edge={edge}
                  nodes={doc.nodes}
                  selected={selection?.kind === 'edge' && selection.id === edge.id}
                  onSelect={() => setSelection({ kind: 'edge', id: edge.id })}
                />
              ))}
              {doc.nodes.map((node) => (
                <NodeShape
                  key={node.id}
                  node={node}
                  selected={selection?.kind === 'node' && selection.id === node.id}
                  connecting={connectFrom === node.id}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                />
              ))}
            </g>

            {doc.nodes.length === 0 && (
              <text
                data-chrome="1"
                x="50%"
                y="50%"
                textAnchor="middle"
                fill="var(--text-faint)"
                fontSize={13}
              >
                Add a node, or start from a template
              </text>
            )}
          </svg>

          <div className="diagram-inspector">
            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                onChange={(patch) => patchNode(selectedNode.id, patch)}
                iconQuery={iconQuery}
                setIconQuery={setIconQuery}
              />
            ) : selectedEdge ? (
              <EdgeInspector edge={selectedEdge} onChange={(patch) => patchEdge(selectedEdge.id, patch)} />
            ) : (
              <div className="inspector-empty faint">
                <p>Select a node or connection to edit it.</p>
                <ul>
                  <li>Drag on empty space to pan, ⌘/Ctrl + scroll to zoom</li>
                  <li>Hold ⌥ while dragging to bypass grid snapping</li>
                  <li>Select a node then <b>Connect</b> to draw a relationship</li>
                  <li><span className="kbd">⌫</span> deletes, <span className="kbd">⌘D</span> duplicates</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateMenu({ onPick }: { onPick: (id: TemplateId) => void }) {
  return (
    <select
      className="select"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as TemplateId)
        e.target.value = ''
      }}
      title="Replace the diagram with a template"
    >
      <option value="">Template…</option>
      {TEMPLATES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

function NodeShape({
  node,
  selected,
  connecting,
  onPointerDown,
}: {
  node: DiagramNode
  selected: boolean
  connecting: boolean
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const Icon = diagramIcon(node.icon)
  const detailLines = node.detail ? node.detail.split('\n').slice(0, 6) : []
  const isClass = node.shape === 'package'

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      onPointerDown={onPointerDown}
      style={{ cursor: 'move' }}
    >
      <ShapeBody node={node} />
      {(selected || connecting) && (
        <rect
          x={-4}
          y={-4}
          width={node.w + 8}
          height={node.h + 8}
          rx={12}
          fill="none"
          stroke={connecting ? 'var(--warning)' : 'var(--accent)'}
          strokeWidth={1.6}
          strokeDasharray={connecting ? '5 4' : undefined}
        />
      )}

      <g transform={`translate(12, ${isClass ? 9 : node.h / 2 - 9})`} pointerEvents="none">
        <Icon size={18} color={node.color} strokeWidth={1.9} />
      </g>

      <text
        x={38}
        y={isClass ? 23 : node.h / 2 - (detailLines.length ? 3 : -4)}
        fill="var(--text)"
        fontSize={13}
        fontWeight={600}
        pointerEvents="none"
      >
        {truncate(node.label, Math.floor((node.w - 46) / 7))}
      </text>

      {detailLines.map((line, i) => (
        <text
          key={i}
          x={isClass ? 14 : 38}
          y={(isClass ? 44 : node.h / 2 + 13) + i * 13}
          fill="var(--text-muted)"
          fontSize={11}
          fontFamily="var(--font-mono)"
          pointerEvents="none"
        >
          {truncate(line, Math.floor((node.w - 24) / 6))}
        </text>
      ))}
    </g>
  )
}

function ShapeBody({ node }: { node: DiagramNode }) {
  const { w, h, color, shape } = node
  const common = {
    fill: 'var(--bg-elevated)',
    stroke: color,
    strokeWidth: 1.6,
  }

  switch (shape) {
    case 'rect':
      return <rect width={w} height={h} rx={3} {...common} />
    case 'circle':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
    case 'diamond':
      return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...common} />
    case 'hexagon':
      return (
        <polygon
          points={`18,0 ${w - 18},0 ${w},${h / 2} ${w - 18},${h} 18,${h} 0,${h / 2}`}
          {...common}
        />
      )
    case 'cylinder':
      return (
        <g>
          <path
            d={`M0,12 A${w / 2},12 0 0 1 ${w},12 L${w},${h - 12} A${w / 2},12 0 0 1 0,${h - 12} Z`}
            {...common}
          />
          <path d={`M0,12 A${w / 2},12 0 0 0 ${w},12`} fill="none" stroke={color} strokeWidth={1.4} />
        </g>
      )
    case 'cloud':
      return (
        <path
          d={`M${w * 0.24},${h * 0.82} A${w * 0.2},${h * 0.24} 0 0 1 ${w * 0.22},${h * 0.4}
              A${w * 0.22},${h * 0.3} 0 0 1 ${w * 0.55},${h * 0.2}
              A${w * 0.24},${h * 0.28} 0 0 1 ${w * 0.86},${h * 0.44}
              A${w * 0.17},${h * 0.22} 0 0 1 ${w * 0.8},${h * 0.82} Z`}
          {...common}
        />
      )
    case 'actor':
      return (
        <g>
          <rect width={w} height={h} rx={h / 2} {...common} />
        </g>
      )
    case 'note':
      return (
        <path
          d={`M0,0 L${w - 16},0 L${w},16 L${w},${h} L0,${h} Z`}
          {...common}
          fill="var(--accent-soft)"
        />
      )
    case 'package':
      return (
        <g>
          <rect width={w} height={h} rx={4} {...common} />
          <line x1={0} y1={32} x2={w} y2={32} stroke={color} strokeWidth={1.2} opacity={0.6} />
        </g>
      )
    case 'rounded':
    default:
      return <rect width={w} height={h} rx={10} {...common} />
  }
}

function EdgeShape({
  edge,
  nodes,
  selected,
  onSelect,
}: {
  edge: DiagramEdge
  nodes: DiagramNode[]
  selected: boolean
  onSelect: () => void
}) {
  const from = nodes.find((n) => n.id === edge.from)
  const to = nodes.find((n) => n.id === edge.to)
  if (!from || !to) return null

  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const start = borderPoint(from, b)
  const end = borderPoint(to, a)
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }

  const dashed = edge.kind === 'dependency' || edge.kind === 'implementation'
  const marker = markerFor(edge.kind)

  return (
    <g onPointerDown={(e) => (e.stopPropagation(), onSelect())} style={{ cursor: 'pointer' }}>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="transparent"
        strokeWidth={14}
      />
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={selected ? 'var(--accent)' : 'var(--text-muted)'}
        strokeWidth={selected ? 2.2 : 1.5}
        strokeDasharray={dashed ? '7 5' : undefined}
        markerEnd={marker ? `url(#${marker})` : undefined}
      />
      {edge.label && (
        <>
          <rect
            x={mid.x - edge.label.length * 3.3 - 5}
            y={mid.y - 9}
            width={edge.label.length * 6.6 + 10}
            height={17}
            rx={4}
            fill="var(--bg)"
            stroke="var(--border)"
            strokeWidth={0.8}
          />
          <text
            x={mid.x}
            y={mid.y + 3.5}
            textAnchor="middle"
            fontSize={10.5}
            fill="var(--text-muted)"
          >
            {edge.label}
          </text>
        </>
      )}
    </g>
  )
}

function markerFor(kind: EdgeKind) {
  switch (kind) {
    case 'inheritance':
    case 'implementation':
      return 'arrow-triangle'
    case 'composition':
      return 'arrow-diamond-filled'
    case 'aggregation':
      return 'arrow-diamond'
    case 'association':
      return ''
    default:
      return 'arrow-open'
  }
}

function arrowMarkers() {
  return (
    <>
      <marker
        id="arrow-open"
        viewBox="0 0 10 10"
        refX={9}
        refY={5}
        markerWidth={7}
        markerHeight={7}
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
      </marker>
      <marker
        id="arrow-triangle"
        viewBox="0 0 12 12"
        refX={11}
        refY={6}
        markerWidth={10}
        markerHeight={10}
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 12 6 L 0 12 z" fill="var(--bg-elevated)" stroke="var(--text-muted)" />
      </marker>
      <marker
        id="arrow-diamond"
        viewBox="0 0 14 10"
        refX={13}
        refY={5}
        markerWidth={12}
        markerHeight={10}
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 7 0 L 14 5 L 7 10 z" fill="var(--bg-elevated)" stroke="var(--text-muted)" />
      </marker>
      <marker
        id="arrow-diamond-filled"
        viewBox="0 0 14 10"
        refX={13}
        refY={5}
        markerWidth={12}
        markerHeight={10}
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 7 0 L 14 5 L 7 10 z" fill="var(--text-muted)" />
      </marker>
    </>
  )
}

/** Where a line from the node's centre toward `target` crosses its bounding box. */
function borderPoint(node: DiagramNode, target: { x: number; y: number }) {
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const dx = target.x - cx
  const dy = target.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const halfW = node.w / 2 + 4
  const halfH = node.h / 2 + 4
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function NodeInspector({
  node,
  onChange,
  iconQuery,
  setIconQuery,
}: {
  node: DiagramNode
  onChange: (patch: Partial<DiagramNode>) => void
  iconQuery: string
  setIconQuery: (v: string) => void
}) {
  const icons = diagramIconChoices.filter((name) => name.includes(iconQuery.toLowerCase()))

  return (
    <div className="inspector">
      <div className="inspector-title">Node</div>

      <label className="field">
        <span>Label</span>
        <input value={node.label} onChange={(e) => onChange({ label: e.target.value })} />
      </label>

      <label className="field">
        <span>Detail / members</span>
        <textarea
          rows={4}
          className="mono"
          value={node.detail}
          placeholder={'«interface»\n+ method(): Type'}
          onChange={(e) => onChange({ detail: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Shape</span>
        <select className="select" value={node.shape} onChange={(e) => onChange({ shape: e.target.value as NodeShape })}>
          {SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {NODE_COLORS.map((color) => (
            <button
              key={color}
              className={`swatch ${node.color === color ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => onChange({ color })}
              title={color}
            />
          ))}
          <input
            type="color"
            value={node.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="swatch-custom"
            title="Custom colour"
          />
        </div>
      </div>

      <div className="field">
        <span>Icon</span>
        <input
          placeholder="Filter icons…"
          value={iconQuery}
          onChange={(e) => setIconQuery(e.target.value)}
          style={{ marginBottom: 6 }}
        />
        <div className="icon-grid">
          {icons.map((name) => {
            const Icon = diagramIcon(name as DiagramIconName)
            return (
              <button
                key={name}
                className={`icon-choice ${node.icon === name ? 'active' : ''}`}
                title={name}
                onClick={() => onChange({ icon: name as DiagramIconName })}
              >
                <Icon size={15} />
              </button>
            )
          })}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Width</span>
          <input
            type="number"
            value={node.w}
            min={80}
            max={520}
            onChange={(e) => onChange({ w: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Height</span>
          <input
            type="number"
            value={node.h}
            min={48}
            max={420}
            onChange={(e) => onChange({ h: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}

function EdgeInspector({
  edge,
  onChange,
}: {
  edge: DiagramEdge
  onChange: (patch: Partial<DiagramEdge>) => void
}) {
  return (
    <div className="inspector">
      <div className="inspector-title">Connection</div>
      <label className="field">
        <span>Label</span>
        <input
          value={edge.label}
          placeholder="e.g. publishes, 1..*"
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Relationship</span>
        <select
          className="select"
          value={edge.kind}
          onChange={(e) => onChange({ kind: e.target.value as EdgeKind })}
        >
          {EDGE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
        UML endings: inheritance and implementation use a hollow triangle, composition a filled
        diamond, aggregation a hollow diamond. Dependency and implementation are drawn dashed.
      </p>
    </div>
  )
}

function truncate(text: string, max: number) {
  if (max <= 1) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
