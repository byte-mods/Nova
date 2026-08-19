/**
 * Checking a plan against the project's own tests.
 *
 * An agent reporting that it finished is the weakest claim in the loop: it is
 * the one thing it cannot establish by reading. Running the suite the project
 * already has turns "I implemented it" into a result a reviewer can disagree
 * with, and it costs nothing to write because the test runner, the framework
 * detection and the result parsing are all already here.
 *
 * Deliberately *not* a pass/fail gate on the agent. The edits stay whether the
 * suite is green or red — reverting someone's work because a pre-existing
 * failure happened to be red would be worse than reporting it. What this
 * produces is a fact attached to the plan, not a verdict.
 */
import type { PlanVerification } from '@shared/chat'
import type { TestEvent, TestRunUpdate } from '@shared/types'

/** How long to wait for a suite before giving up on it. */
const TIMEOUT_MS = 180_000

/**
 * Runs the project's tests and summarises them.
 *
 * Resolves with `unavailable` rather than rejecting when there is no framework
 * or the run cannot start: a project with no tests has not failed its tests,
 * and a thrown error here would surface as a broken feature rather than as the
 * accurate statement that there was nothing to run.
 */
export async function verifyPlan(root: string): Promise<PlanVerification> {
  const startedAt = Date.now()
  const blank = (state: PlanVerification['state'], detail?: string): PlanVerification => ({
    state,
    framework: '',
    passed: 0,
    failed: 0,
    total: 0,
    failures: [],
    durationMs: Date.now() - startedAt,
    ranAt: Date.now(),
    detail,
  })

  let frameworks
  try {
    frameworks = await window.nova.tests.detect(root)
  } catch (err) {
    return blank('unavailable', `Could not look for a test framework: ${message(err)}`)
  }

  const framework = frameworks[0]
  if (!framework) {
    return blank('unavailable', 'No test framework was detected in this project.')
  }

  return new Promise<PlanVerification>((resolve) => {
    // Results arrive per test rather than as a summary, so they are folded
    // here. A test that starts and never reports is not counted either way —
    // guessing at its outcome is the one thing this must not do.
    const outcomes = new Map<string, { name: string; passed: boolean }>()
    let settled = false

    const finish = (state: PlanVerification['state'], detail?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      off?.()

      const results = [...outcomes.values()]
      const failures = results.filter((r) => !r.passed)
      resolve({
        state,
        framework: framework.label || framework.id,
        passed: results.length - failures.length,
        failed: failures.length,
        total: results.length,
        failures: failures.map((f) => f.name).slice(0, 12),
        durationMs: Date.now() - startedAt,
        ranAt: Date.now(),
        detail,
      })
    }

    const timer = setTimeout(
      () => {
        void window.nova.tests.cancel().catch(() => undefined)
        finish('unavailable', `The suite was still running after ${TIMEOUT_MS / 1000}s and was stopped.`)
      },
      TIMEOUT_MS,
    )

    const off = window.nova.tests.onUpdate((update: TestRunUpdate) => {
      for (const event of update.events) record(outcomes, event)
      if (!update.done) return

      // A non-zero exit with no parsed failures still means the suite failed —
      // a compile error produces exactly that, and calling it a pass because
      // nothing was parsed would be the most misleading outcome available.
      const failed = [...outcomes.values()].some((r) => !r.passed)
      const bad = failed || (update.done.exitCode !== 0 && update.done.exitCode !== null)
      if (bad && !outcomes.size) {
        finish('failed', `${framework.label || framework.id} exited ${update.done.exitCode} without reporting any test.`)
      } else {
        finish(bad ? 'failed' : 'passed')
      }
    })

    window.nova.tests
      .run(root, framework.id, { kind: 'all' })
      .catch((err) => finish('unavailable', `Could not start the suite: ${message(err)}`))
  })
}

function record(outcomes: Map<string, { name: string; passed: boolean }>, event: TestEvent) {
  if (event.type !== 'result') return
  if (event.status === 'skip') return
  outcomes.set(event.id, {
    name: event.suite ? `${event.suite} › ${event.name}` : event.name,
    passed: event.status === 'pass',
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
