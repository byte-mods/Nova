import { useState } from 'react'
import {
  AlertTriangle,
  Bug,
  ChevronsDown,
  Container,
  Flame,
  FlaskConical,
  Hammer,
  ListTodo,
  Network,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Target,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useStore } from '@/state/store'
import TerminalView from './TerminalView'
import TodoView from './TodoView'
import ProblemsView from './ProblemsView'
import UsagesView from './UsagesView'
import HierarchyView from './HierarchyView'
import TestsView from './TestsView'
import DebugView from './DebugView'
import CoverageView from './CoverageView'
import BuildView from './BuildView'
import ProfileView from './ProfileView'
import InfraView from './InfraView'
import SecurityView from './SecurityView'

export default function BottomPanel() {
  const height = useStore((s) => s.settings.panelHeight)
  const panelTab = useStore((s) => s.panelTab)
  const usages = useStore((s) => s.usages)
  const testRun = useStore((s) => s.testRun)
  const debugStatus = useStore((s) => s.debug.state?.status)
  const coverage = useStore((s) => s.coverage)
  const [terminals, setTerminals] = useState<string[]>(['term-1'])
  const [activeTerminal, setActiveTerminal] = useState('term-1')

  const usageCount = usages?.references.length ?? 0
  const testFailures = testRun?.cases.filter((c) => c.status === 'fail').length ?? 0
  const coveragePct = coverage
    ? Math.round((coverage.totals.coveredLines / Math.max(coverage.totals.totalLines, 1)) * 100)
    : null

  return (
    <div className="pane" style={{ height }}>
      <div className="pane-header">
        <div className="pane-tabs">
          <button
            className={`pane-tab ${panelTab === 'terminal' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('terminal')}
          >
            <TerminalIcon size={12} /> Terminal
          </button>
          <button
            className={`pane-tab ${panelTab === 'usages' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('usages')}
          >
            <Target size={12} /> Usages
            {usageCount > 0 && <span className="chip" style={{ height: 15 }}>{usageCount}</span>}
          </button>
          <button
            className={`pane-tab ${panelTab === 'hierarchy' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('hierarchy')}
          >
            <Network size={12} /> Hierarchy
          </button>
          <button
            className={`pane-tab ${panelTab === 'tests' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('tests')}
          >
            <FlaskConical size={12} /> Tests
            {testFailures > 0 && (
              <span className="chip" style={{ height: 15, color: 'var(--danger)' }}>
                {testFailures}
              </span>
            )}
          </button>
          <button
            className={`pane-tab ${panelTab === 'debug' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('debug')}
          >
            <Bug size={12} /> Debug
            {debugStatus && debugStatus !== 'inactive' && (
              <span className="chip" style={{ height: 15, color: 'var(--warning)' }}>
                {debugStatus}
              </span>
            )}
          </button>
          <button
            className={`pane-tab ${panelTab === 'infra' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('infra')}
          >
            <Container size={12} /> Infra
          </button>
          <button
            className={`pane-tab ${panelTab === 'security' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('security')}
          >
            <ShieldAlert size={12} /> Security
          </button>
          <button
            className={`pane-tab ${panelTab === 'profile' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('profile')}
          >
            <Flame size={12} /> Profiler
          </button>
          <button
            className={`pane-tab ${panelTab === 'build' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('build')}
          >
            <Hammer size={12} /> Build
          </button>
          <button
            className={`pane-tab ${panelTab === 'coverage' ? 'active' : ''}`}
            onClick={() => {
              useStore.getState().togglePanel('coverage')
              // Loading on open means the panel is never showing a stale report
              // from a run three commits ago without the user asking for it.
              if (!useStore.getState().coverage) void useStore.getState().loadCoverage()
            }}
          >
            <ShieldCheck size={12} /> Coverage
            {coveragePct !== null && (
              <span className="chip" style={{ height: 15 }}>{coveragePct}%</span>
            )}
          </button>
          <button
            className={`pane-tab ${panelTab === 'problems' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('problems')}
          >
            <AlertTriangle size={12} /> Problems
          </button>
          <button
            className={`pane-tab ${panelTab === 'todo' ? 'active' : ''}`}
            onClick={() => useStore.getState().togglePanel('todo')}
          >
            <ListTodo size={12} /> TODO
          </button>
        </div>

        {panelTab === 'terminal' && (
          <>
            <div className="row" style={{ gap: 3 }}>
              {terminals.map((id, i) => (
                <button
                  key={id}
                  className={`pane-tab ${activeTerminal === id ? 'active' : ''}`}
                  onClick={() => setActiveTerminal(id)}
                >
                  {i + 1}
                  {terminals.length > 1 && (
                    <X
                      size={10}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.nova.shell.dispose(id)
                        const next = terminals.filter((t) => t !== id)
                        setTerminals(next)
                        if (activeTerminal === id) setActiveTerminal(next[0])
                        void window.nova.shell.kill(id)
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
            <button
              className="icon-btn"
              title="New terminal"
              onClick={() => {
                const id = `term-${Date.now()}`
                setTerminals((t) => [...t, id])
                setActiveTerminal(id)
              }}
            >
              <Plus size={14} />
            </button>
            <button
              className="icon-btn"
              title="Kill running command"
              onClick={() => void window.nova.shell.kill(activeTerminal)}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}

        <button
          className="icon-btn"
          title="Hide panel (⌘J)"
          onClick={() => useStore.getState().togglePanel()}
        >
          <ChevronsDown size={15} />
        </button>
      </div>

      <div className="pane-body">
        {panelTab === 'terminal' &&
          terminals.map((id) => (
            <div
              key={id}
              style={{
                position: 'absolute',
                inset: 0,
                display: activeTerminal === id ? 'block' : 'none',
              }}
            >
              <TerminalView id={id} visible={activeTerminal === id} />
            </div>
          ))}
        {panelTab === 'usages' && <UsagesView />}
        {panelTab === 'hierarchy' && <HierarchyView />}
        {panelTab === 'tests' && <TestsView />}
        {panelTab === 'debug' && <DebugView />}
        {panelTab === 'build' && <BuildView />}
        {panelTab === 'profile' && <ProfileView />}
        {panelTab === 'infra' && <InfraView />}
        {panelTab === 'security' && <SecurityView />}
        {panelTab === 'coverage' && <CoverageView />}
        {panelTab === 'problems' && <ProblemsView />}
        {panelTab === 'todo' && <TodoView />}
      </div>
    </div>
  )
}
