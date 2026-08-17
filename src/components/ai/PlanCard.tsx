/**
 * The approval gate.
 *
 * A plan is shown before anything is written, and nothing is written until the
 * user presses Approve. Once running, each step ticks over in place so the card
 * doubles as a progress indicator — the list stays put while output scrolls
 * past it.
 *
 * Steps can be struck out before approving. That matters more than it looks: it
 * is the difference between "approve or start over" and "approve most of it".
 */
import { Check, CircleDashed, Loader2, Play, X } from 'lucide-react'
import type { Plan } from '@shared/chat'
import Markdown from '@/components/editor/Markdown'

export default function PlanCard({
  plan,
  running,
  onApprove,
  onReject,
  onToggleStep,
}: {
  plan: Plan
  running: boolean
  onApprove: () => void
  onReject: () => void
  onToggleStep: (id: string) => void
}) {
  const proposed = plan.status === 'proposed'
  const done = plan.steps.filter((s) => s.status === 'done').length
  const active = plan.steps.filter((s) => s.status !== 'skipped').length

  return (
    <div className={`plan-card ${plan.status}`}>
      <div className="plan-head">
        <span className="plan-title">
          {proposed ? 'Proposed plan' : plan.status === 'complete' ? 'Plan complete' : 'Executing plan'}
        </span>
        {!proposed && (
          <span className="plan-progress">
            {done}/{active}
          </span>
        )}
        {running && <Loader2 size={12} className="spin" style={{ color: 'var(--accent)' }} />}
      </div>

      {plan.summary && (
        <div className="plan-summary">
          <Markdown content={plan.summary} />
        </div>
      )}

      <ol className="plan-steps">
        {plan.steps.map((step, i) => (
          <li key={step.id} className={`plan-step ${step.status}`}>
            <button
              className="plan-check"
              // Before approval the checkbox chooses what to include; after it,
              // the state is the agent's to report, not the user's to fake.
              disabled={!proposed}
              title={proposed ? 'Include or skip this step' : undefined}
              onClick={() => onToggleStep(step.id)}
            >
              {step.status === 'done' && <Check size={11} />}
              {step.status === 'running' && <Loader2 size={11} className="spin" />}
              {step.status === 'skipped' && <X size={11} />}
              {step.status === 'pending' && <CircleDashed size={11} />}
            </button>
            <span className="plan-step-num">{i + 1}</span>
            <span className="plan-step-text">{step.text}</span>
          </li>
        ))}
      </ol>

      {proposed && (
        <div className="plan-actions">
          <button
            className="btn primary sm"
            disabled={!plan.steps.some((s) => s.status !== 'skipped')}
            onClick={onApprove}
          >
            <Play size={11} /> Approve and run
          </button>
          <button className="btn sm" onClick={onReject}>
            <X size={11} /> Discard
          </button>
          <span className="faint" style={{ fontSize: 10, marginLeft: 'auto' }}>
            Nothing has been changed yet.
          </span>
        </div>
      )}
    </div>
  )
}
