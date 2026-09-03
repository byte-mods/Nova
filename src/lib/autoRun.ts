/**
 * Keeping the agent going until the work is actually finished.
 *
 * One turn of an agent is one turn: it stops when it has said enough, not when
 * the task is done. The gap between those two is where most of the friction in
 * using an assistant lives — the user reads "I've implemented the first part",
 * types "continue", reads it again, types "continue" again, and is really just
 * being the loop by hand.
 *
 * So this is the loop. After each turn it decides one of four things: keep
 * going, run the tests, stop because a person is genuinely needed, or stop
 * because the work is done and the suite agrees.
 *
 * Three ideas hold it together.
 *
 * **The agent declares, the loop verifies.** A turn ends with a marker saying
 * what the agent believes — done, blocked, or still working. That belief is an
 * input, never the verdict: `NOVA_DONE` does not finish the run, it *promotes*
 * it to the test gate, and a red suite sends it straight back to work with the
 * failures attached. The agent cannot talk its way out of a failing test.
 *
 * **Blocked means blocked.** Stopping to ask is expensive — it is the thing the
 * user turned this on to avoid — so it is reserved for what a person actually
 * has to answer: a missing credential, a destructive choice, an ambiguity in the
 * goal itself. Everything else is the agent's problem to solve.
 *
 * **Something must be moving.** The real failure mode of a loop like this is not
 * a wrong answer, it is a confident one repeated forever at the user's expense.
 * A turn that changes no files, runs no tests and reports no progress is not
 * work; a few of those in a row ends the run and says so, which is the guard
 * that makes running uncapped defensible.
 */
import type { PlanVerification } from '@shared/chat'

/** What the agent says about its own state at the end of a turn. */
export type TurnClaim = 'done' | 'blocked' | 'working'

export type AutoStage =
  /** The agent is doing the work. */
  | 'working'
  /** It claims to be finished; the suite is deciding. */
  | 'verifying'
  /** The suite is green; the manual checks it cannot run are being written. */
  | 'manual'
  | 'complete'
  | 'blocked'
  | 'stalled'

export interface AutoRunState {
  /** The original request, restated to the agent on every continuation. */
  goal: string
  stage: AutoStage
  /** Completed turns, including the first. */
  iteration: number
  /** Hard ceiling on turns; 0 runs uncapped and leans on the stall guard. */
  maxIterations: number
  /** Consecutive turns that changed nothing. */
  idleTurns: number
  /** Why it stopped, when it stopped for a reason a person must read. */
  reason?: string
  verification?: PlanVerification
  /** Set once the manual-check pass has been asked for, so it is asked once. */
  manualRequested: boolean
}

/** What the loop should do next. */
export type AutoDecision =
  | { kind: 'continue'; prompt: string; stage: AutoStage }
  | { kind: 'verify' }
  | { kind: 'stop'; stage: 'complete' | 'blocked' | 'stalled'; reason?: string }

/** Turns with no visible progress before the run is called stuck. */
export const STALL_LIMIT = 3

/**
 * The marker vocabulary.
 *
 * Deliberately ugly and deliberately prefixed: these have to survive being
 * quoted, indented, bulleted or wrapped in a code fence by a model that is
 * mostly writing prose, and they must never collide with something the agent
 * would write by accident while discussing the code.
 */
const DONE = 'NOVA_TASK_COMPLETE'
const BLOCKED = 'NOVA_BLOCKED'
const WORKING = 'NOVA_CONTINUE'

/**
 * Reads the agent's claim out of a finished turn.
 *
 * Scanned from the end, because the marker belongs last and a turn that
 * discusses the protocol earlier — writing docs about this very feature, say —
 * must not have that mistaken for its own status. Anything unrecognised counts
 * as still working, which is the reading that keeps the loop going rather than
 * ending it on a formatting slip.
 */
export function readClaim(text: string): { claim: TurnClaim; reason?: string } {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    // Tolerate a fence, a bullet, a heading marker or bold *around* the marker.
    // Stripped from the ends only — the markers contain underscores, and taking
    // those out anywhere would turn every one of them into something that
    // matches nothing.
    const line = lines[i]
      .replace(/^[\s>#*`~-]+/, '')
      .replace(/[\s*`~]+$/, '')
      .trim()
    if (!line) continue

    const blocked = new RegExp(`^${BLOCKED}\\s*:?\\s*(.*)$`, 'i').exec(line)
    if (blocked) {
      const reason = blocked[1].trim()
      return { claim: 'blocked', reason: reason || 'The agent stopped without saying why.' }
    }
    if (new RegExp(`^${DONE}\\b`, 'i').test(line)) return { claim: 'done' }
    if (new RegExp(`^${WORKING}\\b`, 'i').test(line)) return { claim: 'working' }
  }
  return { claim: 'working' }
}

/** The protocol every turn of an automatic run is prefixed with. */
export function protocolBlock(): string {
  return [
    '## How this run works',
    '',
    'You are running unattended. Nobody will read this turn and type "continue" —',
    'the editor will, automatically, until you say the work is finished. So do not',
    'stop at a good place to check in, and do not ask whether to proceed. Keep going.',
    '',
    'End every turn with exactly one of these on a line of its own:',
    '',
    `- \`${WORKING}\` — more to do. This is the default; use it whenever unsure.`,
    `- \`${DONE}\` — the whole task is finished, including tests.`,
    `- \`${BLOCKED}: <what you need>\` — you genuinely cannot continue without a person.`,
    '',
    `\`${BLOCKED}\` costs the user their attention, which is the thing they turned this`,
    'off to keep. Use it only for what a person must actually supply or decide:',
    'a credential or secret you do not have, a destructive or irreversible action,',
    'or a genuine ambiguity in the goal where guessing wrong would waste the work.',
    'A failing test, a missing file, an unclear API, a compile error, a design',
    'choice with a defensible answer — none of these are blockers. Solve them.',
    '',
    `\`${DONE}\` is a claim, not an ending: the editor runs the project's test suite`,
    'when it sees it, and sends you back to work with the failures if any are red.',
    'Claiming completion with a broken build only costs you another turn.',
  ].join('\n')
}

/** The first prompt of an automatic run. */
export function openingPrompt(goal: string): string {
  return [
    protocolBlock(),
    '',
    '## The task',
    '',
    goal,
    '',
    'Work through it completely — implementation, then tests that actually cover it.',
    'Start now.',
  ].join('\n')
}

/**
 * Restates the goal on every continuation.
 *
 * The agent has its own conversation history, so this is not for its memory —
 * it is for its aim. Over a long run the most recent turns crowd out the
 * original request, and an agent that has spent four turns on a test helper
 * starts optimising the test helper. One line of goal at the top of every turn
 * is cheap and keeps the work pointed at what was asked.
 */
function continuationHeader(state: AutoRunState): string {
  return [
    protocolBlock(),
    '',
    '## The task',
    '',
    state.goal,
    '',
    `(Turn ${state.iteration + 1}${state.maxIterations ? ` of at most ${state.maxIterations}` : ''}.)`,
    '',
  ].join('\n')
}

/** Names the failures rather than saying "some tests failed". */
function failureList(verification: PlanVerification): string {
  if (!verification.failures.length) return ''
  const shown = verification.failures.slice(0, 20)
  const rest = verification.failures.length - shown.length
  return [
    '',
    'Failing:',
    ...shown.map((name) => `- ${name}`),
    ...(rest > 0 ? [`- …and ${rest} more`] : []),
  ].join('\n')
}

/**
 * Decides what happens after a turn ends.
 *
 * Pure, and separate from the console, because this is the part worth testing:
 * every branch here is a way the loop can misbehave — running forever, stopping
 * early, or accepting a completion claim it should not have.
 */
export function decideNext(
  state: AutoRunState,
  turn: { text: string; filesChanged: number; verification?: PlanVerification },
): AutoDecision {
  // The cap is checked first: an exhausted run stops whatever it was about to
  // do, including a verification it has not run yet.
  if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
    return {
      kind: 'stop',
      stage: 'stalled',
      reason: `Stopped after ${state.iteration} turns without finishing. The work so far is kept — say "continue" to keep going.`,
    }
  }

  // A verification that has just landed decides the run.
  if (state.stage === 'verifying' && turn.verification) {
    const result = turn.verification
    if (result.state === 'failed') {
      return {
        kind: 'continue',
        stage: 'working',
        prompt: [
          continuationHeader(state),
          `You said the task was complete, and the suite disagrees: ${result.failed} of ${result.total} tests fail.`,
          failureList(result),
          '',
          'Fix them. If a failure is a pre-existing one unrelated to this task, say so',
          'explicitly and move on — do not delete or skip a test to make it pass.',
        ].join('\n'),
      }
    }

    // Green, or nothing to run. Either way the automated half is settled and
    // the manual half is what is left.
    if (!state.manualRequested) {
      const suite =
        result.state === 'passed'
          ? `The suite passes (${result.passed}/${result.total}).`
          : `There is no automated suite to run here — ${result.detail ?? 'none was detected'}.`
      return {
        kind: 'continue',
        stage: 'manual',
        prompt: [
          continuationHeader(state),
          suite,
          '',
          'Last step: the checks a suite cannot make. Write a short manual test plan for',
          'what you changed — the specific things a person should click, run or look at,',
          'with the expected result for each. Then carry out every item you can yourself',
          '(run the commands, read the output, check the files) and mark it with what you',
          'actually observed. Leave only the items that genuinely need a human — a visual',
          'check, a real device, a third-party account — and say so for each.',
          '',
          `Then end with \`${DONE}\`.`,
        ].join('\n'),
      }
    }

    return { kind: 'stop', stage: 'complete' }
  }

  const { claim, reason } = readClaim(turn.text)

  if (claim === 'blocked') return { kind: 'stop', stage: 'blocked', reason }

  if (claim === 'done') {
    // The claim promotes the run to the gate rather than ending it. After the
    // manual pass the gate has already been through once, so a second `DONE`
    // with a green suite is the end.
    if (state.manualRequested && state.verification?.state !== 'failed') {
      return { kind: 'stop', stage: 'complete' }
    }
    return { kind: 'verify' }
  }

  // Still working. Nothing moved for several turns running means it is not
  // working, it is circling — and the user is paying for each lap.
  if (turn.filesChanged === 0 && state.idleTurns + 1 >= STALL_LIMIT) {
    return {
      kind: 'stop',
      stage: 'stalled',
      reason: `No files changed in the last ${STALL_LIMIT} turns, so the run is going in circles rather than making progress. Stopping to save the tokens.`,
    }
  }

  return {
    kind: 'continue',
    stage: 'working',
    prompt: [
      continuationHeader(state),
      'Continue from where you left off. Do not summarise what you have already done',
      'and do not ask whether to proceed — pick up the next piece of work and do it.',
    ].join('\n'),
  }
}

/**
 * Folds a decision back into the run's state.
 *
 * `countsAsTurn` is false for the step that only resolves a test result. That
 * step consumes no agent turn, so counting it would spend the iteration cap
 * twice as fast as the user asked for and would credit the stall guard with an
 * idle turn that never happened — which is how an uncapped run would stop three
 * verifications in rather than when it stopped making progress.
 */
export function advance(
  state: AutoRunState,
  decision: AutoDecision,
  turn: { filesChanged: number; verification?: PlanVerification },
  countsAsTurn = true,
): AutoRunState {
  const next: AutoRunState = {
    ...state,
    iteration: countsAsTurn ? state.iteration + 1 : state.iteration,
    idleTurns: countsAsTurn ? (turn.filesChanged === 0 ? state.idleTurns + 1 : 0) : state.idleTurns,
    verification: turn.verification ?? state.verification,
  }

  if (decision.kind === 'verify') return { ...next, stage: 'verifying' }
  if (decision.kind === 'stop') return { ...next, stage: decision.stage, reason: decision.reason }
  return {
    ...next,
    stage: decision.stage,
    manualRequested: state.manualRequested || decision.stage === 'manual',
  }
}

/** A fresh run for one goal. */
export function beginAutoRun(goal: string, maxIterations: number): AutoRunState {
  return {
    goal,
    stage: 'working',
    iteration: 0,
    maxIterations: Math.max(0, maxIterations),
    idleTurns: 0,
    manualRequested: false,
  }
}
