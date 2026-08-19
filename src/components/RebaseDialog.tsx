/**
 * Interactive rebase without the todo file.
 *
 * The dialog builds the same plan `git rebase -i` would open in an editor —
 * pick / reword / squash / fixup / drop, reorderable — and hands it to the
 * main process, which feeds it to git through GIT_SEQUENCE_EDITOR. Commits are
 * shown newest-first like the log; the backend reverses them into git's
 * oldest-first todo order.
 */

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Play, X } from 'lucide-react'
import type { RebaseStep } from '@shared/types'
import { useStore } from '@/state/store'

export interface RebaseRequest {
  /** The commit the rebase replays onto, e.g. `origin/main` or a hash. */
  onto: string
}

let opener: ((request: RebaseRequest) => void) | null = null

export function openRebaseDialog(request: RebaseRequest) {
  opener?.(request)
}

const ACTIONS: RebaseStep['action'][] = ['pick', 'reword', 'squash', 'fixup', 'edit', 'drop']

export default function RebaseDialog() {
  const root = useStore((s) => s.root)
  const [request, setRequest] = useState<RebaseRequest | null>(null)
  const [steps, setSteps] = useState<RebaseStep[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    opener = (incoming) => setRequest(incoming)
    return () => {
      opener = null
    }
  }, [])

  useEffect(() => {
    if (!request || !root) return
    void window.nova.git.rebaseTodo(root, request.onto).then(setSteps)
  }, [request, root])

  if (!request || !root) return null

  const close = () => {
    setRequest(null)
    setSteps([])
  }

  const update = (index: number, patch: Partial<RebaseStep>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)))

  const swap = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return
    setSteps((current) => {
      const next = [...current]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }

  const run = async () => {
    setRunning(true)
    try {
      const result = await window.nova.git.rebaseRun(root, request.onto, steps)
      const store = useStore.getState()
      const summary = result.out.trim().split('\n').filter(Boolean).pop() ?? ''
      store.notify(result.ok ? `Rebase done: ${summary}` : `Rebase failed — ${summary}`, result.ok ? 'success' : 'error')
      if (!result.ok && /conflict/i.test(result.out)) {
        store.notify('Resolve the conflicts in the Git view, then Continue or Abort the rebase there.', 'info')
      }
      void store.refreshGit()
      void store.refreshCommits()
      store.bumpTree()
      if (result.ok) close()
    } finally {
      setRunning(false)
    }
  }

  // The UI lists newest-first; git's todo runs oldest-first, and its first
  // line — our *last* row — has no earlier commit to squash into.
  const oldest = steps[steps.length - 1]
  const squashInvalid = oldest && (oldest.action === 'squash' || oldest.action === 'fixup')

  return (
    <div className="overlay" style={{ paddingTop: 60 }} onMouseDown={close}>
      <div className="modal refactor-dialog" style={{ width: 720 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="refactor-head">
          <b>Interactive Rebase onto {request.onto}</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={close}>
            <X size={12} /> Cancel
          </button>
          <button
            className="btn primary sm"
            disabled={running || steps.length === 0 || Boolean(squashInvalid)}
            onClick={() => void run()}
          >
            <Play size={12} /> {running ? 'Rebasing…' : 'Rebase'}
          </button>
        </div>

        {squashInvalid && (
          <div className="refactor-notes">
            <div className="refactor-note">The oldest commit in the list cannot squash — there is nothing above it.</div>
          </div>
        )}
        {steps.length === 0 && (
          <div className="faint" style={{ padding: 16 }}>
            No commits between {request.onto} and HEAD.
          </div>
        )}

        <div style={{ maxHeight: 420, overflow: 'auto', padding: '4px 10px 12px', display: 'grid', gap: 4 }}>
          {steps.map((step, index) => (
            <div key={step.hash} className="row" style={{ gap: 6 }}>
              <select
                className="select"
                style={{ width: 92 }}
                value={step.action}
                onChange={(e) => update(index, { action: e.target.value as RebaseStep['action'] })}
              >
                {ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
              <code className="mono faint" style={{ fontSize: 11 }}>
                {step.shortHash}
              </code>
              {step.action === 'reword' ? (
                <input
                  style={{ flex: 1, fontSize: 12 }}
                  value={step.message ?? step.subject}
                  onChange={(e) => update(index, { message: e.target.value })}
                />
              ) : (
                <span
                  className="tree-label"
                  style={{
                    flex: 1,
                    fontSize: 12,
                    textDecoration: step.action === 'drop' ? 'line-through' : 'none',
                    opacity: step.action === 'drop' ? 0.5 : 1,
                  }}
                >
                  {step.subject}
                </span>
              )}
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                title="Move this commit earlier"
                onClick={() => swap(index, index - 1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                title="Move this commit later"
                onClick={() => swap(index, index + 1)}
              >
                <ArrowDown size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
