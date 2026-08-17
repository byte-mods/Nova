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
}

export interface StoredChat {
  id: string
  title: string
  /** Serialised `AiMessage[]`; the renderer owns that shape. */
  messages: unknown[]
  /** Resume ids per provider, so switching chats resumes the right session. */
  sessionIds: Partial<Record<AiProvider, string>>
  plan?: Plan
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
