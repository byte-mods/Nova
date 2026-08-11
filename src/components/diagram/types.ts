import type { DiagramIconName } from '@/lib/fileIcons'

export type NodeShape =
  | 'rect'
  | 'rounded'
  | 'cylinder'
  | 'cloud'
  | 'diamond'
  | 'hexagon'
  | 'circle'
  | 'note'
  | 'actor'
  | 'package'

/** UML-flavoured relationship endings. */
export type EdgeKind =
  | 'association'
  | 'dependency'
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'flow'

export interface DiagramNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
  /** Second line — a stereotype, tech note, or UML member list (newline separated). */
  detail: string
  icon: DiagramIconName
  shape: NodeShape
  color: string
}

export interface DiagramEdge {
  id: string
  from: string
  to: string
  label: string
  kind: EdgeKind
}

export interface DiagramDoc {
  version: 1
  title: string
  mode: 'canvas' | 'mermaid'
  mermaid: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export const NODE_COLORS = [
  '#6ea8fe',
  '#2ec4b6',
  '#9ece6a',
  '#e0af68',
  '#f7768e',
  '#bb9af7',
  '#7dcfff',
  '#ff9e64',
  '#a0aec0',
]

export function emptyDiagram(title = 'Untitled diagram'): DiagramDoc {
  return {
    version: 1,
    title,
    mode: 'canvas',
    mermaid: DEFAULT_MERMAID,
    nodes: [],
    edges: [],
  }
}

export const DEFAULT_MERMAID = `classDiagram
    class Service {
        +String name
        +start() void
        +stop() void
    }
    class HttpService {
        +int port
        +listen() void
    }
    class Repository~T~ {
        +find(id) T
        +save(entity) void
    }
    Service <|-- HttpService
    HttpService --> Repository : uses
`

export function nodeId() {
  return `n${Math.random().toString(36).slice(2, 9)}`
}

export function edgeId() {
  return `e${Math.random().toString(36).slice(2, 9)}`
}
