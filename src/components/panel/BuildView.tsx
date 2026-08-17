/**
 * The Build tool window: run tasks, inspect dependencies.
 *
 * Tasks run through the terminal rather than a bespoke output pane, because a
 * build's output is exactly what a terminal is for — scrollback, ANSI colour
 * and Ctrl-C all come for free, and users already know where to look for it.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Hammer,
  Loader2,
  Package,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useStore } from '@/state/store'
import type { BuildProject, DependencyNode } from '@shared/build'

export default function BuildView() {
  const root = useStore((s) => s.root)
  const [projects, setProjects] = useState<BuildProject[] | null>(null)
  const [active, setActive] = useState(0)
  const [mode, setMode] = useState<'tasks' | 'dependencies'>('tasks')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  const detect = useMemo(
    () => async () => {
      if (!root) return
      setBusy(true)
      try {
        setProjects(await window.nova.build.detect(root))
      } finally {
        setBusy(false)
      }
    },
    [root],
  )

  useEffect(() => {
    void detect()
  }, [detect])

  const project = projects?.[active]

  if (!root) {
    return (
      <div className="empty-state">
        <span className="faint">Open a project first.</span>
      </div>
    )
  }

  if (busy && !projects) {
    return (
      <div className="empty-state">
        <Loader2 size={16} className="spin faint" />
      </div>
    )
  }

  if (!projects?.length) {
    return (
      <div className="empty-state" style={{ flexDirection: 'column', gap: 8 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          No build system detected.
        </span>
        <span className="faint" style={{ fontSize: 10.5 }}>
          Looked for Gradle, Maven, npm/pnpm/yarn, Cargo and Make.
        </span>
        <button className="btn sm" onClick={() => void detect()}>
          <RefreshCw size={12} /> Rescan
        </button>
      </div>
    )
  }

  return (
    <div className="build-view">
      <div className="build-head">
        {projects.length > 1 && (
          <select value={active} onChange={(e) => setActive(Number(e.target.value))}>
            {projects.map((p, i) => (
              <option key={p.tool} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {projects.length === 1 && (
          <span className="build-tool">
            <Hammer size={12} /> {project!.label}
          </span>
        )}

        <div className="segmented">
          <button className={mode === 'tasks' ? 'active' : ''} onClick={() => setMode('tasks')}>
            Tasks
          </button>
          <button
            className={mode === 'dependencies' ? 'active' : ''}
            onClick={() => setMode('dependencies')}
          >
            Dependencies
          </button>
        </div>

        <input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ height: 22, flex: 1, minWidth: 60, maxWidth: 220 }}
        />

        <button className="icon-btn" title="Rescan" onClick={() => void detect()}>
          <RefreshCw size={13} />
        </button>
      </div>

      {project?.error && <div className="build-error">{project.error}</div>}

      {mode === 'tasks' ? (
        <TaskList project={project!} root={root} filter={filter} />
      ) : (
        <DependencyList project={project!} root={root} filter={filter} />
      )}
    </div>
  )
}

function TaskList({ project, root, filter }: { project: BuildProject; root: string; filter: string }) {
  const [tasks, setTasks] = useState(project.tasks)
  const [loading, setLoading] = useState(false)

  useEffect(() => setTasks(project.tasks), [project])

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const map = new Map<string, typeof tasks>()
    for (const task of tasks) {
      if (needle && !task.name.toLowerCase().includes(needle) && !task.description.toLowerCase().includes(needle)) {
        continue
      }
      const list = map.get(task.group) ?? []
      list.push(task)
      map.set(task.group, list)
    }
    return Array.from(map.entries())
  }, [tasks, filter])

  const run = (name: string) => {
    // Hand it to the terminal the user is already watching, via the same event
    // run configurations use, so build output lands where build output lands.
    const command = `${project.command} ${name}`
    useStore.getState().togglePanel('terminal')
    window.dispatchEvent(new CustomEvent('nova:run-command', { detail: { command } }))
  }

  return (
    <div className="build-list">
      {project.tool === 'gradle' && (
        <button
          className="build-loadall"
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            try {
              setTasks(await window.nova.build.tasks(root, project))
            } catch (err) {
              useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
            } finally {
              setLoading(false)
            }
          }}
        >
          {loading ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
          Load every task from Gradle (starts the daemon)
        </button>
      )}

      {grouped.map(([group, list]) => (
        <div key={group}>
          <div className="build-group">{group}</div>
          {list.map((task) => (
            <button key={task.id} className="build-row" onDoubleClick={() => run(task.name)}>
              <Play size={11} className="faint" onClick={() => run(task.name)} />
              <span className="build-name mono">{task.name}</span>
              <span className="build-desc">{task.description}</span>
            </button>
          ))}
        </div>
      ))}
      {!grouped.length && (
        <p className="faint" style={{ padding: 12, fontSize: 11.5 }}>
          Nothing matches “{filter}”.
        </p>
      )}
    </div>
  )
}

function DependencyList({
  project,
  root,
  filter,
}: {
  project: BuildProject
  root: string
  filter: string
}) {
  const [nodes, setNodes] = useState<DependencyNode[] | null>(project.dependencies ?? null)
  const [loading, setLoading] = useState(false)

  useEffect(() => setNodes(project.dependencies ?? null), [project])

  const resolve = async () => {
    setLoading(true)
    try {
      setNodes(await window.nova.build.dependencies(root, project))
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  const needsResolve = project.tool === 'gradle' || project.tool === 'maven' || project.tool === 'cargo'

  return (
    <div className="build-list">
      {needsResolve && (
        <button className="build-loadall" disabled={loading} onClick={() => void resolve()}>
          {loading ? <Loader2 size={11} className="spin" /> : <Package size={11} />}
          Resolve the full tree with {project.label}
        </button>
      )}
      {!nodes?.length && !loading && (
        <p className="faint" style={{ padding: 12, fontSize: 11.5 }}>
          No dependencies found.
        </p>
      )}
      {(nodes ?? []).map((node) => (
        <DependencyRow key={node.id} node={node} depth={0} filter={filter} />
      ))}
    </div>
  )
}

function DependencyRow({
  node,
  depth,
  filter,
}: {
  node: DependencyNode
  depth: number
  filter: string
}) {
  const [open, setOpen] = useState(depth < 1)
  const needle = filter.trim().toLowerCase()

  // A node stays visible when it matches, or when anything under it does —
  // otherwise filtering a tree hides the path to the thing you searched for.
  const selfMatches = !needle || node.name.toLowerCase().includes(needle)
  const descendantMatches = useMemo(
    () => (needle ? hasMatch(node, needle) : false),
    [node, needle],
  )
  if (needle && !selfMatches && !descendantMatches) return null

  return (
    <>
      <div className="build-row dep" style={{ paddingLeft: 8 + depth * 14 }}>
        {node.children.length > 0 ? (
          <button className="dep-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="dep-toggle" />
        )}
        <span className="build-name mono">{node.name}</span>
        <span className="dep-version mono">{node.version}</span>
        {node.resolvedFrom && (
          <span className="chip" title={`Requested ${node.resolvedFrom}, resolved to ${node.version}`}>
            was {node.resolvedFrom}
          </span>
        )}
        <span className="dep-scope">{node.scope}</span>
      </div>
      {open &&
        node.children.map((child) => (
          <DependencyRow key={child.id} node={child} depth={depth + 1} filter={filter} />
        ))}
    </>
  )
}

function hasMatch(node: DependencyNode, needle: string): boolean {
  if (node.name.toLowerCase().includes(needle)) return true
  return node.children.some((child) => hasMatch(child, needle))
}
