import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  Ban,
  Bug,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Eye,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Undo2,
  X,
} from 'lucide-react'
import type { DebugScope, DebugVariable } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'

export default function DebugView() {
  const debug = useStore((s) => s.debug)
  const root = useStore((s) => s.root) ?? ''
  const [tab, setTab] = useState<'variables' | 'breakpoints' | 'output'>('variables')
  const [watchInput, setWatchInput] = useState('')

  const state = debug.state
  const status = state?.status ?? 'inactive'
  const paused = status === 'paused'
  const installed = debug.adapters.filter((a) => a.installed)

  return (
    <div className="usages">
      <div className="usages-header">
        <Bug size={13} style={{ color: paused ? 'var(--warning)' : 'var(--accent)' }} />

        {status === 'inactive' ? (
          <button className="btn primary sm" onClick={() => void useStore.getState().startDebug()}>
            <Play size={11} /> Debug this file
          </button>
        ) : (
          <>
            <button
              className="icon-btn"
              title="Continue (F5)"
              disabled={!paused}
              onClick={() => void window.nova.debug.continue()}
            >
              <Play size={14} />
            </button>
            <button
              className="icon-btn"
              title="Pause"
              disabled={paused}
              onClick={() => void window.nova.debug.pause()}
            >
              <Pause size={14} />
            </button>
            <button
              className="icon-btn"
              title="Step over (F10)"
              disabled={!paused}
              onClick={() => void window.nova.debug.next()}
            >
              <ArrowRightToLine size={14} />
            </button>
            <button
              className="icon-btn"
              title="Step into (F11)"
              disabled={!paused}
              onClick={() => void window.nova.debug.stepIn()}
            >
              <ArrowDownToLine size={14} />
            </button>
            <button
              className="icon-btn"
              title="Step out (⇧F11)"
              disabled={!paused}
              onClick={() => void window.nova.debug.stepOut()}
            >
              <ArrowUpFromLine size={14} />
            </button>
            <button
              className="icon-btn"
              title="Run to cursor (⌥F9)"
              disabled={!paused}
              onClick={() => void runToCursor()}
            >
              <CornerDownRight size={14} />
            </button>
            {state?.supportsDropFrame && (
              <button
                className="icon-btn"
                title="Drop frame — re-enter the selected frame from the top"
                disabled={!paused}
                onClick={async () => {
                  const result = await window.nova.debug.dropFrame()
                  if (!result.ok) useStore.getState().notify(result.error, 'error')
                }}
              >
                <Undo2 size={14} />
              </button>
            )}
            {state?.supportsRestart && (
              <button
                className="icon-btn"
                title="Restart"
                onClick={() => void window.nova.debug.restart()}
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              className="icon-btn"
              title="Stop"
              onClick={() => void window.nova.debug.stop()}
            >
              <Square size={14} style={{ color: 'var(--danger)' }} />
            </button>
          </>
        )}

        <span className="chip" style={{ color: paused ? 'var(--warning)' : undefined }}>
          {status}
          {paused && state?.stopReason ? ` · ${state.stopReason}` : ''}
        </span>
        {state?.adapterLabel && <span className="faint" style={{ fontSize: 11 }}>{state.adapterLabel}</span>}

        <span style={{ flex: 1 }} />
        <div className="segmented">
          <button className={tab === 'variables' ? 'active' : ''} onClick={() => setTab('variables')}>
            Variables
          </button>
          <button className={tab === 'breakpoints' ? 'active' : ''} onClick={() => setTab('breakpoints')}>
            Breakpoints
          </button>
          <button className={tab === 'output' ? 'active' : ''} onClick={() => setTab('output')}>
            Console
          </button>
        </div>
        <button
          className="icon-btn"
          title="Remove all breakpoints"
          onClick={() => void window.nova.debug.clearBreakpoints()}
        >
          <Ban size={14} />
        </button>
      </div>

      {state?.error && (
        <div className="ai-error" style={{ margin: '8px 12px' }}>
          <span>{state.error}</span>
        </div>
      )}

      {installed.length === 0 && status === 'inactive' && (
        <div className="faint" style={{ padding: 16, lineHeight: 1.6 }}>
          No debug adapter installed. Nova speaks the Debug Adapter Protocol — install{' '}
          <code className="mono">debugpy</code>, <code className="mono">dlv</code>,{' '}
          <code className="mono">lldb-dap</code> or <code className="mono">codelldb</code> and it
          will be picked up automatically.
        </div>
      )}

      {tab === 'output' ? (
        <pre className="test-output mono" style={{ flex: 1, overflow: 'auto' }}>
          {debug.output || 'No debug output yet.'}
        </pre>
      ) : tab === 'breakpoints' ? (
        <BreakpointsTab />
      ) : (
        <div className="debug-columns">
          <div className="debug-column">
            <div className="debug-column-title">Call stack</div>
            <div className="debug-column-body">
              {(state?.frames ?? []).map((frame) => (
                <button
                  key={frame.id}
                  className={`tree-row ${state?.currentFrameId === frame.id ? 'selected' : ''}`}
                  style={{ width: '100%', paddingLeft: 10 }}
                  onClick={() => {
                    void window.nova.debug.selectFrame(frame.id)
                    if (frame.file) {
                      void useStore
                        .getState()
                        .openFile(frame.file, { line: frame.line, column: frame.column })
                    }
                  }}
                  title={frame.file ? `${relative(root, frame.file)}:${frame.line}` : frame.name}
                >
                  <span className="tree-label mono">{frame.name}</span>
                  <span className="faint" style={{ fontSize: 10.5 }}>
                    {frame.file ? `${basename(frame.file)}:${frame.line}` : ''}
                  </span>
                </button>
              ))}
              {!paused && <div className="faint" style={{ padding: 10, fontSize: 11.5 }}>Not paused.</div>}
            </div>
          </div>

          <div className="debug-column">
            <div className="debug-column-title">Variables</div>
            <div className="debug-column-body">
              {paused && state?.currentFrameId !== null && (
                <Scopes frameId={state!.currentFrameId!} />
              )}
              {!paused && <div className="faint" style={{ padding: 10, fontSize: 11.5 }}>Not paused.</div>}
            </div>
          </div>

          <div className="debug-column">
            <div className="debug-column-title">
              Watches
              <span style={{ flex: 1 }} />
            </div>
            <div className="debug-column-body">
              <form
                className="row"
                style={{ padding: '6px 8px', gap: 5 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void useStore.getState().addWatch(watchInput)
                  setWatchInput('')
                }}
              >
                <Eye size={12} className="faint" />
                <input
                  value={watchInput}
                  onChange={(e) => setWatchInput(e.target.value)}
                  placeholder="expression"
                  style={{ flex: 1, height: 22, fontSize: 11.5 }}
                />
                <button className="icon-btn" style={{ width: 22, height: 22 }} type="submit">
                  <Plus size={12} />
                </button>
              </form>
              {debug.watches.map((watch) => (
                <div key={watch.expression} className="tree-row" style={{ paddingLeft: 10 }}>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--syn-variable)' }}>
                    {watch.expression}
                  </span>
                  <span
                    className="tree-label mono"
                    style={{ fontSize: 11.5, color: watch.error ? 'var(--danger)' : 'var(--text)' }}
                  >
                    {watch.error ? watch.error : watch.value}
                  </span>
                  <button
                    className="icon-btn"
                    style={{ width: 20, height: 20 }}
                    onClick={() => useStore.getState().removeWatch(watch.expression)}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Continue, but stop at the caret — IntelliJ's ⌥F9. */
async function runToCursor() {
  const store = useStore.getState()
  const file = store.tabs.find((t) => t.id === store.activeTabId)?.path
  if (!file || !store.cursor.line) {
    store.notify('Put the caret on the line you want to run to.', 'error')
    return
  }
  await window.nova.debug.runToLine(file, store.cursor.line)
}

/**
 * Line breakpoints, break-on-exception categories and field watchpoints in one
 * list — the three things that can suspend a program, which IntelliJ also
 * gathers into a single dialog.
 */
function BreakpointsTab() {
  const state = useStore((s) => s.debug.state)
  const root = useStore((s) => s.root) ?? ''
  const filters = state?.exceptionFilters ?? []
  const watchpoints = state?.dataBreakpoints ?? []
  const lines = state?.breakpoints ?? []

  return (
    <div className="debug-columns">
      <div className="debug-column">
        <div className="debug-column-title">Line breakpoints</div>
        <div className="debug-column-body">
          {lines.length === 0 && (
            <div className="faint" style={{ padding: 10, fontSize: 11.5 }}>
              None. Click the gutter to add one; right-click it for conditions and log points.
            </div>
          )}
          {lines.flatMap((entry) =>
            entry.items.map((item) => (
              <div key={`${entry.file}:${item.line}`} className="tree-row" style={{ paddingLeft: 10 }}>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) =>
                    void window.nova.debug.updateBreakpoint(entry.file, item.line, {
                      enabled: e.target.checked,
                    })
                  }
                />
                <button
                  className="tree-label mono"
                  style={{ fontSize: 11.5, textAlign: 'left', flex: 1 }}
                  onClick={() =>
                    void useStore.getState().openFile(entry.file, { line: item.line })
                  }
                >
                  {relative(root, entry.file)}:{item.line}
                  {item.condition ? `  ⟨${item.condition}⟩` : ''}
                  {item.logMessage ? '  ⟨log⟩' : ''}
                </button>
              </div>
            )),
          )}
        </div>
      </div>

      <div className="debug-column">
        <div className="debug-column-title">Exception breakpoints</div>
        <div className="debug-column-body">
          {filters.length === 0 && (
            <div className="faint" style={{ padding: 10, fontSize: 11.5 }}>
              {state?.status === 'inactive'
                ? 'Start a session — the adapter declares which exception categories it can break on.'
                : 'This adapter offers no exception categories.'}
            </div>
          )}
          {filters.map((filter) => (
            <div key={filter.filter} style={{ padding: '4px 10px' }}>
              <label className="refactor-check" title={filter.description}>
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onChange={(e) =>
                    void window.nova.debug.setExceptionBreakpoint(filter.filter, {
                      enabled: e.target.checked,
                    })
                  }
                />
                <span>{filter.label}</span>
              </label>
              {filter.enabled && filter.supportsCondition && (
                <input
                  defaultValue={filter.condition}
                  placeholder={filter.conditionDescription || 'condition'}
                  style={{ width: '100%', height: 22, fontSize: 11.5, marginTop: 3 }}
                  onBlur={(e) =>
                    void window.nova.debug.setExceptionBreakpoint(filter.filter, {
                      condition: e.target.value,
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="debug-column">
        <div className="debug-column-title">Watchpoints (fields)</div>
        <div className="debug-column-body">
          {watchpoints.length === 0 && (
            <div className="faint" style={{ padding: 10, fontSize: 11.5 }}>
              {state?.supportsDataBreakpoints
                ? 'Right-click a variable while paused to break when it changes.'
                : 'This adapter does not support data watchpoints.'}
            </div>
          )}
          {watchpoints.map((watchpoint) => (
            <div key={watchpoint.dataId} className="tree-row" style={{ paddingLeft: 10 }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--syn-variable)' }}>
                {watchpoint.label}
              </span>
              <span className="faint" style={{ fontSize: 10.5 }}>
                on {watchpoint.accessType}
              </span>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                onClick={() => void window.nova.debug.removeDataBreakpoint(watchpoint.dataId)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Scopes({ frameId }: { frameId: number }) {
  const [scopes, setScopes] = useState<DebugScope[]>([])

  useEffect(() => {
    let cancelled = false
    void window.nova.debug.scopes(frameId).then((result) => {
      if (!cancelled) setScopes(result)
    })
    return () => {
      cancelled = true
    }
  }, [frameId])

  return (
    <>
      {scopes.map((scope) => (
        <VariableNode
          key={`${scope.name}:${scope.variablesReference}`}
          name={scope.name}
          value=""
          reference={scope.variablesReference}
          container={0}
          depth={0}
          defaultOpen={!scope.expensive}
        />
      ))}
    </>
  )
}

/**
 * One row in the variables tree.
 *
 * Two things happen here beyond display: double-clicking a value edits it
 * through `setVariable`, and right-clicking offers a watchpoint. Both need the
 * *container's* reference rather than the variable's own, which is why
 * `container` is threaded down from the parent.
 */
function VariableNode({
  name,
  value,
  type,
  reference,
  container,
  depth,
  defaultOpen,
}: {
  name: string
  value: string
  type?: string
  reference: number
  /** `variablesReference` of the scope or object this variable lives in. */
  container: number
  depth: number
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [children, setChildren] = useState<DebugVariable[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [shown, setShown] = useState(value)

  useEffect(() => setShown(value), [value])

  useEffect(() => {
    if (!open || children || reference === 0) return
    let cancelled = false
    void window.nova.debug.variables(reference).then((result) => {
      if (!cancelled) setChildren(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, reference, children])

  const expandable = reference > 0
  const editable = container > 0

  const commit = async (next: string) => {
    setEditing(null)
    if (next === shown) return
    const result = await window.nova.debug.setVariable(container, name, next)
    if (result.ok) {
      setShown(result.value)
      setChildren(null)
    } else {
      useStore.getState().notify(result.error, 'error')
    }
  }

  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 12, cursor: expandable ? 'pointer' : 'default' }}
        onClick={() => expandable && setOpen((v) => !v)}
        onContextMenu={async (e) => {
          if (!editable) return
          e.preventDefault()
          const result = await window.nova.debug.addDataBreakpoint(name, container, 'write')
          useStore.getState().notify(result.message, result.ok ? 'success' : 'error')
        }}
        title={editable ? 'Double-click the value to change it · right-click to watch it' : undefined}
      >
        <span className="tree-twisty">
          {expandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--syn-variable)' }}>
          {name}
        </span>
        {editing !== null ? (
          <input
            autoFocus
            className="mono"
            style={{ flex: 1, height: 20, fontSize: 11.5 }}
            value={editing}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={(e) => void commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          shown && (
            <span
              className="tree-label mono"
              style={{ fontSize: 11.5 }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (editable) setEditing(shown)
              }}
            >
              {shown}
            </span>
          )
        )}
        {type && (
          <span className="faint mono" style={{ fontSize: 10 }}>
            {type}
          </span>
        )}
      </div>
      {open &&
        children?.map((child, i) => (
          <VariableNode
            key={`${child.name}:${i}`}
            name={child.name}
            value={child.value}
            type={child.type}
            reference={child.variablesReference}
            container={reference}
            depth={depth + 1}
          />
        ))}
    </>
  )
}
