/**
 * The plan-first workflow.
 *
 * A request that will change files runs twice: once in plan mode, which is
 * read-only, and then — only after the user approves — for real. The value is
 * not the plan document; it is that the user sees the *scope* of what is about
 * to happen while it is still free to say no.
 *
 * Steps are parsed out of the plan so they can be ticked off as the agent works,
 * which is the difference between a wall of streaming output and something you
 * can glance at to see how far along it is.
 */
import type { Plan, PlanStep } from '@shared/chat'

/** One step's fate between two revisions of a plan. */
export interface PlanStepDelta {
  kind: 'added' | 'removed' | 'kept'
  text: string
}

/**
 * How a plan differs from the one it replaced.
 *
 * Matched on normalised text rather than on step id, because a re-planned turn
 * produces entirely new ids for what is often the same list with one step
 * changed. Comparing ids would report every step as both added and removed,
 * which is the same as reporting nothing.
 */
export function diffPlans(previous: Plan, next: Plan): PlanStepDelta[] {
  const key = (step: PlanStep) => step.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const before = new Map(previous.steps.map((s) => [key(s), s.text]))
  const deltas: PlanStepDelta[] = []

  for (const step of next.steps) {
    const k = key(step)
    if (before.has(k)) {
      deltas.push({ kind: 'kept', text: step.text })
      before.delete(k)
    } else {
      deltas.push({ kind: 'added', text: step.text })
    }
  }
  for (const text of before.values()) deltas.push({ kind: 'removed', text })

  return deltas
}

/** Prompt used for the read-only planning pass. */
export function buildPlanPrompt(request: string): string {
  return `${request}

---

Before changing anything, produce a plan.

This turn is **read-only**: do not create, edit, delete or move any file, and do
not run anything that changes state. Read whatever you need first — open the
files involved, follow the call sites, check the tests — so the plan is grounded
in what the code actually does.

Reply with Markdown in exactly this shape:

## Plan
One short paragraph: what you are going to do and why that is the right shape
for this codebase. Name the files involved.

## Steps
- [ ] One concrete, verifiable step
- [ ] The next one

Each step must be something a reviewer could check afterwards. Order them the
way you will actually do them. Prefer 3–8 steps: one step per file is usually
too fine, "implement the feature" is too coarse.

## Risks
Anything that could go wrong, anything you are unsure about, and anything you
will deliberately not touch. Say "None" if there genuinely are none.`
}

/**
 * Prompt for the execution pass.
 *
 * The approved plan is restated rather than relying on the resumed session to
 * remember it: the user may have waited, switched chats, or approved a plan
 * from a previous run, and a drifting agent is exactly what the approval was
 * meant to prevent.
 */
export function buildExecutePrompt(plan: Plan): string {
  const steps = plan.steps.map((step, i) => `${i + 1}. ${step.text}`).join('\n')
  return `The user approved this plan. Carry it out now.

Original request: ${plan.request}

Plan:
${steps}

Work through the steps in order. Stay within the plan — if you discover it was
wrong, stop and say so rather than silently doing something else. As you finish
each step, say \`STEP ${'{'}n${'}'} DONE\` on its own line so the editor can tick it off.`
}

/**
 * Pulls the checklist out of a plan document.
 *
 * Accepts the `- [ ]` form the prompt asks for, and falls back to a numbered
 * list, because models produce one when asked for the other often enough that
 * failing here would make the feature feel broken.
 */
export function parsePlan(markdown: string, request: string): Plan | null {
  const steps: PlanStep[] = []
  const lines = markdown.split('\n')

  for (const raw of lines) {
    const line = raw.trim()

    const checkbox = /^[-*]\s*\[([ xX])\]\s*(.+)$/.exec(line)
    if (checkbox) {
      steps.push({
        id: `s${steps.length}`,
        text: checkbox[2].trim(),
        status: checkbox[1].toLowerCase() === 'x' ? 'done' : 'pending',
      })
      continue
    }

    // Only treat a numbered list as steps if no checkboxes were found at all;
    // otherwise a "Risks" section written as 1./2./3. would join the checklist.
    if (!steps.length) {
      const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
      if (numbered && numbered[1].length > 8) {
        steps.push({ id: `s${steps.length}`, text: numbered[1].trim(), status: 'pending' })
      }
    }
  }

  if (!steps.length) return null

  // Everything above the first step is the summary the user reads first.
  const firstStepIndex = lines.findIndex((line) => /^\s*(?:[-*]\s*\[[ xX]\]|\d+[.)]\s)/.test(line))
  const summary = lines
    .slice(0, firstStepIndex === -1 ? lines.length : firstStepIndex)
    .join('\n')
    .replace(/^#+\s*Plan\s*$/gim, '')
    .trim()

  return {
    id: `plan_${Date.now().toString(36)}`,
    request,
    summary,
    steps,
    status: 'proposed',
    createdAt: Date.now(),
  }
}

/**
 * Advances the checklist from the agent's output.
 *
 * Matches the `STEP n DONE` marker the execute prompt asks for, and also plain
 * restatements of a step's text, since models narrate as often as they signal.
 */
export function applyProgress(plan: Plan, text: string): Plan {
  let changed = false
  const steps = plan.steps.map((step) => ({ ...step }))

  for (const match of text.matchAll(/STEP\s+(\d+)\s+DONE/gi)) {
    const index = Number(match[1]) - 1
    if (steps[index] && steps[index].status !== 'done') {
      steps[index].status = 'done'
      changed = true
    }
  }

  // Mark the first unfinished step as running so there is always a visible
  // "current" step, rather than a static list while work happens.
  const firstPending = steps.findIndex((step) => step.status === 'pending')
  if (firstPending !== -1 && steps[firstPending].status === 'pending') {
    steps[firstPending].status = 'running'
    changed = true
  }

  if (!changed) return plan
  const allDone = steps.every((step) => step.status === 'done' || step.status === 'skipped')
  return { ...plan, steps, status: allDone ? 'complete' : plan.status }
}

/**
 * Decides whether a request should go through planning.
 *
 * A question does not need a plan, and forcing one on "what does this file do"
 * would double the wait for no benefit. The test is deliberately biased towards
 * *not* planning: a missed plan costs a round trip, an unwanted one costs trust.
 */
export function needsPlan(request: string): boolean {
  const text = request.toLowerCase().trim()
  if (text.length < 12) return false

  // Explicit questions are never plans.
  if (/^(what|why|how|where|when|who|which|is|are|does|do|can|could|should|explain|describe|show|tell)\b/.test(text)) {
    return false
  }
  if (text.endsWith('?')) return false

  return /\b(add|implement|create|build|write|refactor|rename|move|delete|remove|fix|migrate|convert|update|change|replace|extract|introduce|wire|support|integrate|set up|setup)\b/.test(
    text,
  )
}
