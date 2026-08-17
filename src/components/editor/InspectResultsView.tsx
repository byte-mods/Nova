/**
 * The Inspect Code tab: project-wide inspection results, grouped by rule.
 *
 * Grouping by rule rather than by file is deliberate — a batch run's job is to
 * answer "how much of X do we have", and the per-rule count is that answer.
 * Code Cleanup applies every mechanical fix a rule offered, one file at a
 * time, through the same fs.write path everything else uses so local history
 * records each file it touched.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Info, Play, Wand2, XCircle } from 'lucide-react'
import { useStore } from '@/state/store'
import { relative } from '@/lib/paths'
import type { BatchFinding } from '@/lib/inspections/batch'

const SEVERITY_ICON = {
  error: <XCircle size={12} style={{ color: 'var(--danger)' }} />,
  warning: <AlertTriangle size={12} style={{ color: 'var(--warning)' }} />,
  info: <Info size={12} style={{ color: 'var(--info, var(--accent))' }} />,
  off: null,
}

export default function InspectResultsView() {
  const run = useStore((s) => s.inspectRun)
  const root = useStore((s) => s.root) ?? ''
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [cleaning, setCleaning] = useState(false)

  const groups = useMemo(() => {
    const byRule = new Map<string, BatchFinding[]>()
    for (const finding of run?.findings ?? []) {
      byRule.set(finding.ruleId, [...(byRule.get(finding.ruleId) ?? []), finding])
    }
    return [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [run?.findings])

  const fixable = useMemo(() => (run?.findings ?? []).filter((f) => f.fix), [run?.findings])

  const runCleanup = async () => {
    const store = useStore.getState()
    if (!store.root) return
    setCleaning(true)
    try {
      const { cleanupText } = await import('@/lib/inspections/batch')
      const files = [...new Set(fixable.map((f) => f.file))]
      let applied = 0
      let touched = 0
      for (const file of files) {
        const buffer = store.buffers[file]
        const current = buffer?.content ?? (await window.nova.fs.read(file).catch(() => null))?.content
        if (current === undefined || current === null) continue
        const result = cleanupText(file, current, store.settings.inspectionProfile)
        if (result.applied === 0) continue
        if (buffer) {
          store.updateBuffer(file, result.text)
          await store.saveBuffer(file)
        } else {
          await window.nova.fs.write(file, result.text)
        }
        applied += result.applied
        touched++
      }
      store.notify(`Code Cleanup — ${applied} fix${applied === 1 ? '' : 'es'} in ${touched} file${touched === 1 ? '' : 's'}`, 'success')
      void store.runInspectCode()
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="usages-header">
        <button
          className="btn primary sm"
          disabled={run?.running}
          onClick={() => void useStore.getState().runInspectCode()}
        >
          <Play size={12} /> {run?.running ? `Scanning ${run.scanned}/${run.total}…` : run ? 'Run again' : 'Inspect Code'}
        </button>
        {run && !run.running && (
          <span className="chip">
            {run.findings.length} finding(s) in {run.scanned} files ·{' '}
            {(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000).toFixed(1)}s
          </span>
        )}
        <span style={{ flex: 1 }} />
        {fixable.length > 0 && !run?.running && (
          <button className="btn sm" disabled={cleaning} onClick={() => void runCleanup()}>
            <Wand2 size={12} /> {cleaning ? 'Cleaning…' : `Code Cleanup (${fixable.length} mechanical fixes)`}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {!run && (
          <div className="faint" style={{ padding: 20, lineHeight: 1.7 }}>
            Runs every enabled inspection over the whole project, not just open files. Severity per
            rule is configurable in Settings › Inspections; suppress a single line with{' '}
            <code className="mono">// nova-ignore &lt;rule-id&gt;</code>.
          </div>
        )}
        {run && !run.running && run.findings.length === 0 && (
          <div className="empty-state">No problems found. Ship it.</div>
        )}
        {groups.map(([ruleId, findings]) => {
          const isCollapsed = collapsed[ruleId]
          return (
            <div key={ruleId}>
              <button
                className="section-header"
                style={{ width: '100%' }}
                onClick={() => setCollapsed((c) => ({ ...c, [ruleId]: !c[ruleId] }))}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                {SEVERITY_ICON[findings[0].severity]}
                {findings[0].ruleName}
                <span className="chip" style={{ marginLeft: 'auto' }}>{findings.length}</span>
              </button>
              {!isCollapsed &&
                findings.slice(0, 500).map((finding, index) => (
                  <button
                    key={`${finding.file}:${finding.line}:${finding.column}:${index}`}
                    className="tree-row"
                    style={{ width: '100%', paddingLeft: 26, height: 'auto', paddingTop: 3, paddingBottom: 3 }}
                    onClick={() =>
                      void useStore.getState().openFile(finding.file, { line: finding.line, column: finding.column })
                    }
                    title={finding.message}
                  >
                    <span style={{ display: 'grid', gap: 0, minWidth: 0, textAlign: 'left' }}>
                      <span className="tree-label" style={{ fontSize: 12 }}>{finding.message}</span>
                      <span className="faint mono" style={{ fontSize: 10.5 }}>
                        {relative(root, finding.file)}:{finding.line} · {finding.preview}
                      </span>
                    </span>
                  </button>
                ))}
              {!isCollapsed && findings.length > 500 && (
                <div className="faint" style={{ padding: '4px 26px', fontSize: 11 }}>
                  …and {findings.length - 500} more.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
