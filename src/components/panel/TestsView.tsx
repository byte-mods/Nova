import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Loader2,
  Play,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react'
import { useStore, type TestCase } from '@/state/store'
import { basename } from '@/lib/paths'

export default function TestsView() {
  const run = useStore((s) => s.testRun)
  const history = useStore((s) => s.testHistory)
  const frameworks = useStore((s) => s.testFrameworks)
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [showOutput, setShowOutput] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | 'failed'>('all')

  const totals = useMemo(() => {
    const cases = run?.cases ?? []
    return {
      passed: cases.filter((c) => c.status === 'pass').length,
      failed: cases.filter((c) => c.status === 'fail').length,
      skipped: cases.filter((c) => c.status === 'skip').length,
      running: cases.filter((c) => c.status === 'running').length,
    }
  }, [run?.cases])

  const grouped = useMemo(() => {
    const map = new Map<string, TestCase[]>()
    for (const test of run?.cases ?? []) {
      if (filter === 'failed' && test.status !== 'fail') continue
      const key = test.suite ?? ''
      const list = map.get(key)
      if (list) list.push(test)
      else map.set(key, [test])
    }
    return [...map.entries()]
  }, [run?.cases, filter])

  if (frameworks.length === 0 && !run) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="faint">
          No test framework detected. Nova looks for go.mod, Cargo.toml, pytest, vitest, jest,
          rspec, PHPUnit, Gradle, Maven and an npm <code className="mono">test</code> script.
        </span>
      </div>
    )
  }

  return (
    <div className="usages">
      <div className="usages-header">
        <button
          className="btn primary sm"
          disabled={run?.running}
          onClick={() => void useStore.getState().runTests({ kind: 'all' })}
        >
          <Play size={11} /> Run all
        </button>
        {activeTab?.path && (
          <button
            className="btn sm"
            disabled={run?.running}
            onClick={() =>
              void useStore.getState().runTests({ kind: 'file', file: activeTab.path })
            }
          >
            <Play size={11} /> This file
          </button>
        )}
        {run?.running && (
          <button className="btn sm" onClick={() => void useStore.getState().cancelTests()}>
            <Square size={11} /> Stop
          </button>
        )}
        {!run?.running && totals.failed > 0 && (
          <button
            className="btn sm"
            title="Rerun only the tests that failed"
            onClick={() => void useStore.getState().rerunFailedTests()}
          >
            <Play size={11} style={{ color: 'var(--danger)' }} /> Rerun failed
          </button>
        )}
        <button
          className="btn sm"
          disabled={run?.running}
          title="Run all with the framework's coverage flags, then load the report"
          onClick={() => void useStore.getState().runTests({ kind: 'all' }, undefined, { coverage: true })}
        >
          <Play size={11} /> With coverage
        </button>
        {history.length > 0 && (
          <select
            className="select"
            style={{ maxWidth: 170, fontSize: 11 }}
            value={run?.runId ?? ''}
            title="Previous runs this session"
            onChange={(e) => useStore.getState().showTestRun(e.target.value)}
          >
            {run && !history.some((h) => h.runId === run.runId) && (
              <option value={run.runId}>current run</option>
            )}
            {history.map((entry) => {
              const failed = entry.cases.filter((c) => c.status === 'fail').length
              return (
                <option key={entry.runId} value={entry.runId}>
                  {entry.framework} · {entry.cases.length} tests{failed ? ` · ${failed} failed` : ''}
                </option>
              )
            })}
          </select>
        )}

        {frameworks.length > 1 && (
          <select
            className="select"
            value={run?.framework ?? frameworks[0].id}
            onChange={(e) =>
              void useStore.getState().runTests({ kind: 'all' }, e.target.value)
            }
          >
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        )}

        {run && (
          <>
            {run.running && <Loader2 size={12} className="spin faint" />}
            <span className="chip" style={{ color: 'var(--success)' }}>{totals.passed} passed</span>
            {totals.failed > 0 && (
              <button
                className={`chip ${filter === 'failed' ? 'chip-active' : ''}`}
                style={{ color: 'var(--danger)', cursor: 'pointer' }}
                onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
                title="Show only failures"
              >
                {totals.failed} failed
              </button>
            )}
            {totals.skipped > 0 && <span className="chip">{totals.skipped} skipped</span>}
            {run.durationMs !== undefined && (
              <span className="faint" style={{ fontSize: 11 }}>
                {(run.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </>
        )}

        <span style={{ flex: 1 }} />
        <button
          className={`btn ghost sm ${showOutput ? 'active' : ''}`}
          onClick={() => setShowOutput((v) => !v)}
          title="Raw runner output"
        >
          <TerminalSquare size={12} /> Output
        </button>
        {run && (
          <button
            className="icon-btn"
            title="Clear"
            onClick={() => useStore.setState({ testRun: null })}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="usages-body">
        {showOutput ? (
          <pre className="test-output mono">{run?.output || 'No output yet.'}</pre>
        ) : (
          <>
            {run?.command && (
              <div className="faint mono" style={{ padding: '6px 12px', fontSize: 11 }}>
                {run.command}
              </div>
            )}
            {grouped.map(([suite, tests]) => (
              <div key={suite || 'root'}>
                {suite && (
                  <button
                    className="tree-row"
                    style={{ width: '100%', paddingLeft: 8 }}
                    onClick={() => setCollapsed((c) => ({ ...c, [suite]: !c[suite] }))}
                  >
                    <span className="tree-twisty">
                      {collapsed[suite] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </span>
                    <span className="tree-label mono">{basename(suite)}</span>
                    <span className="chip" style={{ height: 16 }}>{tests.length}</span>
                  </button>
                )}
                {!collapsed[suite] &&
                  tests.map((test) => <TestRow key={test.id} test={test} indented={!!suite} />)}
              </div>
            ))}
            {run && run.cases.length === 0 && !run.running && (
              <div className="faint" style={{ padding: 16, lineHeight: 1.6 }}>
                The runner produced no per-test results
                {run.exitCode === 0 ? ' but exited cleanly.' : `; it exited with ${run.exitCode}.`}{' '}
                Open <b>Output</b> to see what it printed.
              </div>
            )}
          </>
        )}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}

function TestRow({ test, indented }: { test: TestCase; indented: boolean }) {
  const [open, setOpen] = useState(false)
  const Icon =
    test.status === 'pass'
      ? Check
      : test.status === 'fail'
        ? X
        : test.status === 'skip'
          ? CircleSlash
          : Loader2
  const color =
    test.status === 'pass'
      ? 'var(--success)'
      : test.status === 'fail'
        ? 'var(--danger)'
        : 'var(--text-faint)'

  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: indented ? 30 : 12, cursor: test.message ? 'pointer' : 'default' }}
        onClick={() => test.message && setOpen((v) => !v)}
      >
        <Icon
          size={13}
          className={test.status === 'running' ? 'spin' : ''}
          style={{ color, flexShrink: 0 }}
        />
        <span className="tree-label mono" style={{ fontSize: 12 }}>
          {test.name}
        </span>
        {test.durationMs !== undefined && test.durationMs > 0 && (
          <span className="faint" style={{ fontSize: 10.5 }}>
            {test.durationMs}ms
          </span>
        )}
      </div>
      {open && test.message && <pre className="test-failure mono">{test.message}</pre>}
    </>
  )
}
