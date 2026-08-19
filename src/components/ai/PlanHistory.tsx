/**
 * Every plan this conversation produced, and what changed between attempts.
 *
 * The reason this exists separately from the transcript is that a plan is the
 * only part of an agent run that is a *decision*. The prose scrolls away and is
 * rarely re-read; what was proposed, what the user struck out before approving,
 * and what a second attempt did differently is the record of how a change was
 * arrived at — and it is the thing someone reviewing the commit afterwards
 * actually wants.
 *
 * A revision is shown as a diff against the plan it replaced rather than as
 * another list, because two nearly-identical checklists side by side hide the
 * one line that moved.
 */
import { useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FlaskConical,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import type { Plan } from '@shared/chat'
import { diffPlans } from '@/lib/planning'

export default function PlanHistory({
  plans,
  activeId,
  onOpen,
}: {
  plans: Plan[]
  activeId?: string
  onOpen: (plan: Plan) => void
}) {
  if (!plans.length) {
    return (
      <p className="faint" style={{ padding: 8, fontSize: 11 }}>
        No plans yet. Ask for a change and the plan will be kept here.
      </p>
    )
  }

  // Newest first: the one being worked on is the one being looked for.
  const ordered = [...plans].reverse()

  return (
    <div className="plan-history">
      {ordered.map((plan) => (
        <PlanHistoryRow
          key={plan.id}
          plan={plan}
          previous={plan.supersedes ? plans.find((p) => p.id === plan.supersedes) : undefined}
          active={plan.id === activeId}
          onOpen={() => onOpen(plan)}
        />
      ))}
    </div>
  )
}

function PlanHistoryRow({
  plan,
  previous,
  active,
  onOpen,
}: {
  plan: Plan
  previous?: Plan
  active: boolean
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)

  const done = plan.steps.filter((s) => s.status === 'done').length
  const counted = plan.steps.filter((s) => s.status !== 'skipped').length
  const edits = plan.edits ?? []
  const additions = edits.reduce((n, e) => n + e.additions, 0)
  const deletions = edits.reduce((n, e) => n + e.deletions, 0)

  return (
    <div className={`plan-history-row ${plan.status} ${active ? 'active' : ''}`}>
      <button
        className="plan-history-head"
        title={open ? 'Hide the steps of this plan' : 'Show the steps of this plan'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="plan-history-request">{plan.request || 'Untitled plan'}</span>
        <span className={`chip plan-status-chip ${plan.status}`}>{plan.status}</span>
      </button>

      <div className="plan-history-meta">
        <span title="Steps completed out of those not skipped">
          {done}/{counted} steps
        </span>
        {edits.length > 0 && (
          <span title={`${edits.length} file${edits.length === 1 ? '' : 's'} changed`}>
            {edits.length} file{edits.length === 1 ? '' : 's'}
            <span className="diff-add"> +{additions}</span>
            <span className="diff-del"> −{deletions}</span>
          </span>
        )}
        {plan.verification && <VerificationChip verification={plan.verification} />}
        {previous && <span className="chip" title={`Replaced an earlier plan`}>revision</span>}
      </div>

      {open && (
        <div className="plan-history-body">
          {previous ? (
            <>
              <span className="plan-label">What changed from the previous attempt</span>
              <ul className="plan-delta">
                {diffPlans(previous, plan).map((delta, i) => (
                  <li key={i} className={`plan-delta-${delta.kind}`}>
                    {delta.kind === 'added' && <Plus size={10} />}
                    {delta.kind === 'removed' && <Minus size={10} />}
                    {delta.kind === 'kept' && <CircleDashed size={10} />}
                    <span>{delta.text}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ol className="plan-history-steps">
              {plan.steps.map((step) => (
                <li key={step.id} className={`plan-step ${step.status}`}>
                  {step.status === 'done' && <Check size={10} />}
                  {step.status === 'skipped' && <X size={10} />}
                  {step.status !== 'done' && step.status !== 'skipped' && <CircleDashed size={10} />}
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
          )}

          {edits.length > 0 && (
            <>
              <span className="plan-label">Files it touched</span>
              <ul className="plan-history-files">
                {edits.map((edit) => (
                  <li key={edit.path}>
                    <span className="mono">{edit.path.split('/').pop()}</span>
                    <span className="diff-add">+{edit.additions}</span>
                    <span className="diff-del">−{edit.deletions}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button className="btn sm" title="Bring this plan back into the console" onClick={onOpen}>
            Open this plan
          </button>
        </div>
      )}
    </div>
  )
}

function VerificationChip({ verification }: { verification: NonNullable<Plan['verification']> }) {
  const label =
    verification.state === 'running'
      ? 'testing…'
      : verification.state === 'unavailable'
        ? 'no tests'
        : `${verification.passed}/${verification.total} pass`

  const title =
    verification.state === 'unavailable'
      ? verification.detail || 'No test framework was detected in this project.'
      : `${verification.framework}: ${verification.passed} passed, ${verification.failed} failed`

  return (
    <span className={`chip verify-chip ${verification.state}`} title={title}>
      <FlaskConical size={9} /> {label}
    </span>
  )
}
