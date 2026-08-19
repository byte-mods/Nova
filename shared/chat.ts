/**
 * Persisted AI conversations.
 *
 * Chats are stored per project rather than globally: a conversation about one
 * codebase is meaningless in another, and the provider session ids it resumes
 * from are tied to that working directory anyway.
 */
import type { AiProvider } from './types'

/** A plan step the user approved, and whether the agent has finished it. */
export interface PlanStep {
  id: string
  text: string
  status: 'pending' | 'running' | 'done' | 'skipped'
}

export type PlanStatus = 'proposed' | 'approved' | 'executing' | 'complete' | 'rejected'

/**
 * What the test suite said after a plan was carried out.
 *
 * An agent reporting its own success is the weakest claim in the whole loop —
 * it is the one thing it cannot check by reading. Running the project's real
 * tests afterwards turns "I implemented it" into something a reviewer can
 * disagree with.
 *
 * `unavailable` is a first-class outcome rather than a failure: a project with
 * no detectable framework has not failed its tests, and saying so is honest in
 * a way that a green tick would not be.
 */
export interface PlanVerification {
  state: 'running' | 'passed' | 'failed' | 'unavailable'
  /** The framework that was detected and run, e.g. "vitest". */
  framework: string
  passed: number
  failed: number
  total: number
  /** Names of the tests that failed, for the card to list. */
  failures: string[]
  durationMs: number
  ranAt: number
  /** Why nothing ran, when the state is `unavailable`. */
  detail?: string
}

/** A file the agent touched while carrying out a plan. */
export interface PlanFileEdit {
  path: string
  additions: number
  deletions: number
  kind: 'create' | 'modify' | 'delete'
}

/**
 * A plan produced before any edit is made.
 *
 * The point of holding this separately from the message stream is that it stays
 * addressable while the agent works — steps get ticked off in place rather than
 * scrolling away above new output.
 */
export interface Plan {
  id: string
  /** The request the plan was produced for. */
  request: string
  /** Prose the agent wrote around the steps, rendered above the checklist. */
  summary: string
  steps: PlanStep[]
  status: PlanStatus
  createdAt: number
  approvedAt?: number
  /** The plan this one replaced, when the user asked for another attempt. */
  supersedes?: string
  /** Files the agent touched carrying it out, accumulated as it worked. */
  edits?: PlanFileEdit[]
  /** What the project's own tests said afterwards. */
  verification?: PlanVerification
}

export interface StoredChat {
  id: string
  title: string
  /** Serialised `AiMessage[]`; the renderer owns that shape. */
  messages: unknown[]
  /** Resume ids per provider, so switching chats resumes the right session. */
  sessionIds: Partial<Record<AiProvider, string>>
  /**
   * The active plan.
   *
   * Kept alongside `plans` because chats written before plan history existed
   * have only this field, and a stored conversation should not stop opening
   * because the shape moved on.
   */
  plan?: Plan
  /**
   * Every plan this conversation produced, oldest first.
   *
   * Superseded plans are the interesting ones: what was proposed, what the user
   * struck out, and what a second attempt did differently is the record of how
   * a change was actually arrived at. Discarding all but the latest threw that
   * away on every retry.
   */
  plans?: Plan[]
  createdAt: number
  updatedAt: number
}

export interface ChatSummary {
  id: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}
