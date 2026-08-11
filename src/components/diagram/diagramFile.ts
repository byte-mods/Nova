import { useStore } from '@/state/store'
import { joinPath } from '@/lib/paths'
import { edgeId, emptyDiagram, nodeId, type DiagramDoc, type DiagramNode } from './types'

const DIAGRAM_SUFFIX = '.nova-diagram.json'

function node(partial: Partial<DiagramNode> & { label: string; x: number; y: number }): DiagramNode {
  return {
    id: nodeId(),
    w: 168,
    h: 74,
    detail: '',
    icon: 'box',
    shape: 'rounded',
    color: '#6ea8fe',
    ...partial,
  }
}

export type TemplateId = 'blank' | 'microservices' | 'layered' | 'uml-class' | 'sequence' | 'c4'

export const TEMPLATES: { id: TemplateId; name: string; description: string }[] = [
  { id: 'blank', name: 'Blank canvas', description: 'Start from nothing' },
  {
    id: 'microservices',
    name: 'Microservices',
    description: 'Gateway, services, queue and datastores',
  },
  { id: 'layered', name: 'Layered architecture', description: 'UI → domain → data layers' },
  { id: 'uml-class', name: 'UML class diagram', description: 'Classes with inheritance' },
  { id: 'sequence', name: 'Sequence diagram', description: 'Mermaid sequence flow' },
  { id: 'c4', name: 'C4 context', description: 'System context in Mermaid' },
]

export function buildTemplate(id: TemplateId, title: string): DiagramDoc {
  const doc = emptyDiagram(title)

  if (id === 'microservices') {
    const web = node({ label: 'Web App', detail: 'React · Vite', x: 60, y: 60, icon: 'monitor', color: '#7dcfff' })
    const mobile = node({ label: 'Mobile App', detail: 'iOS · Android', x: 60, y: 180, icon: 'smartphone', color: '#7dcfff' })
    const gateway = node({ label: 'API Gateway', detail: 'Auth · Rate limit', x: 320, y: 120, icon: 'network', color: '#bb9af7' })
    const auth = node({ label: 'Auth Service', detail: 'JWT · OAuth2', x: 580, y: 30, icon: 'shield', color: '#9ece6a' })
    const orders = node({ label: 'Orders Service', detail: 'REST · gRPC', x: 580, y: 140, icon: 'package', color: '#9ece6a' })
    const billing = node({ label: 'Billing Service', detail: 'Stripe', x: 580, y: 250, icon: 'credit-card', color: '#9ece6a' })
    const queue = node({ label: 'Event Bus', detail: 'Kafka', x: 580, y: 370, icon: 'workflow', shape: 'hexagon', color: '#e0af68' })
    const db = node({ label: 'Postgres', detail: 'Primary store', x: 850, y: 140, icon: 'database', shape: 'cylinder', color: '#f7768e' })
    const cache = node({ label: 'Redis', detail: 'Cache · sessions', x: 850, y: 30, icon: 'zap', shape: 'cylinder', color: '#f7768e' })

    doc.nodes = [web, mobile, gateway, auth, orders, billing, queue, db, cache]
    doc.edges = [
      { id: edgeId(), from: web.id, to: gateway.id, label: 'HTTPS', kind: 'flow' },
      { id: edgeId(), from: mobile.id, to: gateway.id, label: 'HTTPS', kind: 'flow' },
      { id: edgeId(), from: gateway.id, to: auth.id, label: '', kind: 'flow' },
      { id: edgeId(), from: gateway.id, to: orders.id, label: '', kind: 'flow' },
      { id: edgeId(), from: gateway.id, to: billing.id, label: '', kind: 'flow' },
      { id: edgeId(), from: orders.id, to: queue.id, label: 'publishes', kind: 'dependency' },
      { id: edgeId(), from: billing.id, to: queue.id, label: 'subscribes', kind: 'dependency' },
      { id: edgeId(), from: orders.id, to: db.id, label: '', kind: 'flow' },
      { id: edgeId(), from: auth.id, to: cache.id, label: '', kind: 'flow' },
    ]
    return doc
  }

  if (id === 'layered') {
    const ui = node({ label: 'Presentation', detail: 'Components · routing', x: 220, y: 40, w: 300, h: 76, icon: 'monitor', color: '#7dcfff' })
    const app = node({ label: 'Application', detail: 'Use cases · orchestration', x: 220, y: 170, w: 300, h: 76, icon: 'workflow', color: '#bb9af7' })
    const domain = node({ label: 'Domain', detail: 'Entities · business rules', x: 220, y: 300, w: 300, h: 76, icon: 'brain', color: '#9ece6a' })
    const infra = node({ label: 'Infrastructure', detail: 'DB · HTTP · queues', x: 220, y: 430, w: 300, h: 76, icon: 'hard-drive', color: '#e0af68' })

    doc.nodes = [ui, app, domain, infra]
    doc.edges = [
      { id: edgeId(), from: ui.id, to: app.id, label: 'calls', kind: 'dependency' },
      { id: edgeId(), from: app.id, to: domain.id, label: 'uses', kind: 'dependency' },
      { id: edgeId(), from: infra.id, to: domain.id, label: 'implements ports', kind: 'implementation' },
    ]
    return doc
  }

  if (id === 'uml-class') {
    const base = node({
      label: 'Repository<T>',
      detail: '«interface»\n+ find(id): T\n+ save(e: T): void',
      x: 340,
      y: 40,
      w: 210,
      h: 108,
      shape: 'package',
      icon: 'layers',
      color: '#bb9af7',
    })
    const user = node({
      label: 'UserRepository',
      detail: '- db: Pool\n+ findByEmail(e): User',
      x: 140,
      y: 240,
      w: 210,
      h: 96,
      shape: 'package',
      icon: 'user',
      color: '#6ea8fe',
    })
    const order = node({
      label: 'OrderRepository',
      detail: '- db: Pool\n+ listForUser(id): Order[]',
      x: 540,
      y: 240,
      w: 220,
      h: 96,
      shape: 'package',
      icon: 'shopping-cart',
      color: '#6ea8fe',
    })
    const entity = node({
      label: 'Order',
      detail: '+ id: UUID\n+ total: Money\n+ items: LineItem[]',
      x: 540,
      y: 410,
      w: 220,
      h: 96,
      shape: 'package',
      icon: 'box',
      color: '#9ece6a',
    })
    const item = node({
      label: 'LineItem',
      detail: '+ sku: string\n+ qty: int',
      x: 840,
      y: 410,
      w: 180,
      h: 84,
      shape: 'package',
      icon: 'box',
      color: '#9ece6a',
    })

    doc.nodes = [base, user, order, entity, item]
    doc.edges = [
      { id: edgeId(), from: user.id, to: base.id, label: '', kind: 'implementation' },
      { id: edgeId(), from: order.id, to: base.id, label: '', kind: 'implementation' },
      { id: edgeId(), from: order.id, to: entity.id, label: 'manages', kind: 'association' },
      { id: edgeId(), from: entity.id, to: item.id, label: '1..*', kind: 'composition' },
    ]
    return doc
  }

  if (id === 'sequence') {
    doc.mode = 'mermaid'
    doc.mermaid = `sequenceDiagram
    autonumber
    actor User
    participant Web as Web App
    participant API as API Gateway
    participant Svc as Orders Service
    participant DB as Postgres

    User->>Web: Place order
    Web->>API: POST /orders
    API->>Svc: createOrder(cmd)
    Svc->>DB: INSERT order
    DB-->>Svc: order id
    Svc-->>API: 201 Created
    API-->>Web: order payload
    Web-->>User: Confirmation
`
    return doc
  }

  if (id === 'c4') {
    doc.mode = 'mermaid'
    doc.mermaid = `flowchart TB
    subgraph Internet
      U([Customer])
      A([Admin])
    end

    subgraph "Our System"
      W[Web Application]
      API[API Application]
      DB[(Database)]
      Q{{Message Queue}}
    end

    subgraph "External"
      MAIL[Email Provider]
      PAY[Payment Gateway]
    end

    U --> W
    A --> W
    W --> API
    API --> DB
    API --> Q
    Q --> MAIL
    API --> PAY
`
    return doc
  }

  return doc
}

export function isDiagramPath(path: string) {
  return path.endsWith(DIAGRAM_SUFFIX)
}

export async function createDiagramFile(dir: string, template: TemplateId = 'blank', name?: string) {
  const store = useStore.getState()
  const base = (name ?? 'architecture').replace(/[^a-zA-Z0-9-_]/g, '-')
  let target = joinPath(dir, `${base}${DIAGRAM_SUFFIX}`)
  let counter = 2
  while (await window.nova.fs.exists(target)) {
    target = joinPath(dir, `${base}-${counter++}${DIAGRAM_SUFFIX}`)
  }
  const doc = buildTemplate(template, base)
  await window.nova.fs.write(target, JSON.stringify(doc, null, 2))
  store.bumpTree()
  await store.openFile(target)
  return target
}

export function newDiagramTab(template: TemplateId = 'blank') {
  const root = useStore.getState().root
  if (!root) {
    useStore.getState().notify('Open a folder first', 'error')
    return
  }
  void createDiagramFile(root, template)
}

export function parseDiagram(content: string): DiagramDoc {
  try {
    const parsed = JSON.parse(content) as Partial<DiagramDoc>
    return {
      ...emptyDiagram(parsed.title ?? 'Diagram'),
      ...parsed,
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
    } as DiagramDoc
  } catch {
    return emptyDiagram('Diagram (unreadable file)')
  }
}
