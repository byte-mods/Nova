import { useEffect, useState } from 'react'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import { monaco } from '@/lib/monacoSetup'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'

interface Problem {
  path: string
  line: number
  column: number
  message: string
  severity: number
  source: string
}

/** Lists Monaco's diagnostics for every open model. */
export default function ProblemsView() {
  const root = useStore((s) => s.root) ?? ''
  const buffers = useStore((s) => s.buffers)
  const [problems, setProblems] = useState<Problem[]>([])

  useEffect(() => {
    const collect = () => {
      const markers = monaco.editor.getModelMarkers({})
      setProblems(
        markers
          .filter((m) => m.message)
          .map((m) => ({
            path: m.resource.path,
            line: m.startLineNumber,
            column: m.startColumn,
            message: m.message,
            severity: m.severity,
            source: m.owner ?? '',
          }))
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 400),
      )
    }
    collect()
    const disposable = monaco.editor.onDidChangeMarkers(collect)
    return () => disposable.dispose()
  }, [buffers])

  if (problems.length === 0) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="faint">No problems detected in the open files.</span>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {problems.map((problem, i) => {
        const Icon =
          problem.severity >= 8 ? CircleAlert : problem.severity >= 4 ? AlertTriangle : Info
        const color =
          problem.severity >= 8
            ? 'var(--danger)'
            : problem.severity >= 4
              ? 'var(--warning)'
              : 'var(--info)'
        return (
          <button
            key={i}
            className="tree-row"
            style={{ width: '100%', paddingLeft: 12 }}
            onClick={() =>
              void useStore.getState().openFile(problem.path, { line: problem.line })
            }
          >
            <Icon size={13} style={{ color, flexShrink: 0 }} />
            <span className="tree-label">{problem.message}</span>
            <span className="faint" style={{ fontSize: 11 }}>
              {basename(problem.path)}:{problem.line}:{problem.column}
            </span>
            <span className="faint" style={{ fontSize: 10.5 }}>
              {relative(root, problem.path).split('/').slice(0, -1).join('/')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
