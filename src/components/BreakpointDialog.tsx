import { useEffect, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { basename } from '@/lib/paths'

/**
 * Breakpoint properties, opened by right-clicking the gutter.
 *
 * Condition, hit count and log message map straight onto the DAP
 * `SourceBreakpoint` fields, so whatever the adapter supports, works — and
 * whatever it ignores, it ignores, which is why the hints say what each one
 * does rather than promising behaviour Nova cannot enforce.
 */
export default function BreakpointDialog() {
  const dialog = useStore((s) => s.breakpointDialog)
  const debugState = useStore((s) => s.debug.state)
  const [condition, setCondition] = useState('')
  const [hitCondition, setHitCondition] = useState('')
  const [logMessage, setLogMessage] = useState('')
  const [enabled, setEnabled] = useState(true)

  const existing = dialog
    ? debugState?.breakpoints
        .find((b) => b.file === dialog.file)
        ?.items?.find((b) => b.line === dialog.line)
    : undefined

  useEffect(() => {
    if (!dialog) return
    setCondition(existing?.condition ?? '')
    setHitCondition(existing?.hitCondition ?? '')
    setLogMessage(existing?.logMessage ?? '')
    setEnabled(existing?.enabled ?? true)
  }, [dialog?.file, dialog?.line])

  if (!dialog) return null

  const close = () => useStore.setState({ breakpointDialog: null })

  const save = async () => {
    await window.nova.debug.updateBreakpoint(dialog.file, dialog.line, {
      condition: condition.trim() || undefined,
      hitCondition: hitCondition.trim() || undefined,
      logMessage: logMessage.trim() || undefined,
      enabled,
    })
    close()
  }

  const remove = async () => {
    if (existing) await window.nova.debug.toggleBreakpoint(dialog.file, dialog.line)
    close()
  }

  return (
    <div className="overlay" style={{ paddingTop: 110 }} onMouseDown={close}>
      <div
        className="modal refactor-dialog"
        style={{ width: 'min(560px, 92vw)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
        }}
      >
        <div className="refactor-head">
          <b>Breakpoint</b>
          <span className="faint">
            {basename(dialog.file)}:{dialog.line}
          </span>
          <span style={{ flex: 1 }} />
          {existing && (
            <button className="btn sm" onClick={() => void remove()} title="Remove this breakpoint">
              <Trash2 size={12} /> Remove
            </button>
          )}
          <button className="btn sm" onClick={close}>
            <X size={12} /> Cancel
          </button>
          <button className="btn primary sm" onClick={() => void save()}>
            <Check size={12} /> Save
          </button>
        </div>

        <div className="refactor-fields">
          <label className="refactor-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enabled</span>
          </label>

          <label className="field">
            <span>Condition</span>
            <input
              autoFocus
              value={condition}
              placeholder="total &gt; 100"
              onChange={(e) => setCondition(e.target.value)}
            />
            <span className="faint refactor-hint">
              Suspend only when this expression is true, evaluated in the frame's scope.
            </span>
          </label>

          <label className="field">
            <span>Hit count</span>
            <input
              value={hitCondition}
              placeholder="&gt;5, %3, =10"
              onChange={(e) => setHitCondition(e.target.value)}
            />
            <span className="faint refactor-hint">
              Suspend on a hit count matching this. Support varies by adapter.
            </span>
          </label>

          <label className="field">
            <span>Log message</span>
            <input
              value={logMessage}
              placeholder="order {order.id} total {total}"
              onChange={(e) => setLogMessage(e.target.value)}
            />
            <span className="faint refactor-hint">
              Turns this into a log point: prints to the debug console and does{' '}
              <b>not</b> suspend. Expressions in <code>{'{}'}</code> are interpolated.
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
