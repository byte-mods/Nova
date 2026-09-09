/**
 * Messages typed while the assistant is busy.
 *
 * The composer used to drop them. A prompt sent during a run hit a guard that
 * returned early, so the text vanished and the only signal was that nothing
 * happened — you learned to sit and watch the spinner before typing the next
 * thing, which is the opposite of what a queue is for.
 *
 * Two ways in, and the difference between them is the whole design:
 *
 *   - **Queue** is "after this". The turn finishes on its own terms and the next
 *     message starts. Nothing is lost and nothing is disturbed.
 *   - **Interrupt** is "instead of this, then back to it". The running turn is
 *     cancelled, the new message goes first, and the work it displaced is put
 *     back at the head of the queue so it resumes when the interruption is
 *     done — which is the part that makes interrupting safe to use. A stop
 *     button loses the thread; this keeps it.
 *
 * The ordering rules live here, away from the console, because they are the
 * part that can be got wrong quietly: an interrupt that lands behind the queue
 * is not an interrupt, and resumed work that lands at the back never runs.
 */

export interface QueuedMessage {
  id: string
  /** What the user typed, or the prompt that resumes displaced work. */
  text: string
  /** What to show in the queue list — the original request for a resume. */
  label: string
  /** Work that was interrupted and is waiting to be picked back up. */
  resume?: boolean
}

/** Bounded so a held-down Enter cannot turn into a hundred queued turns. */
export const MAX_QUEUED = 25

let counter = 0

/** Ids are per-session and only need to be unique within the list. */
function nextId(): string {
  counter += 1
  return `q${counter}`
}

/** Adds a message to the back. Whitespace-only text is not a message. */
export function enqueue(queue: QueuedMessage[], text: string): QueuedMessage[] {
  const trimmed = text.trim()
  if (!trimmed || queue.length >= MAX_QUEUED) return queue
  return [...queue, { id: nextId(), text: trimmed, label: trimmed }]
}

/**
 * Puts `text` at the front, with the displaced work immediately behind it.
 *
 * `interrupted` is what the running turn was asked to do. It comes back as a
 * prompt that says so, because the assistant's own session still holds the
 * conversation — what it needs is the instruction to pick the thread back up,
 * not the whole context again.
 *
 * Ordering is the point: the interruption is first, the work it displaced is
 * second, and anything already queued keeps its place behind both.
 */
export function interrupt(
  queue: QueuedMessage[],
  text: string,
  interrupted?: string,
): QueuedMessage[] {
  const trimmed = text.trim()
  if (!trimmed) return queue

  const head: QueuedMessage[] = [{ id: nextId(), text: trimmed, label: trimmed }]

  const original = interrupted?.trim()
  if (original) {
    head.push({
      id: nextId(),
      label: original,
      resume: true,
      text: [
        'Pick up the work you were doing before I interrupted you.',
        '',
        'What you were asked for originally:',
        '',
        original,
        '',
        'You were stopped part-way, so check the current state of the files before',
        'continuing — some of what you were about to do may already be done, and some',
        'of what you had started may be half-finished.',
      ].join('\n'),
    })
  }

  // Trimmed from the back: the oldest queued messages are the ones the user has
  // had the longest to change their mind about, and dropping the interrupt or
  // the resume would defeat the point of both.
  return [...head, ...queue].slice(0, MAX_QUEUED)
}

/** Takes the next message off the front. */
export function dequeue(
  queue: QueuedMessage[],
): { next: QueuedMessage | null; rest: QueuedMessage[] } {
  if (!queue.length) return { next: null, rest: queue }
  return { next: queue[0], rest: queue.slice(1) }
}

/** Drops one message the user changed their mind about. */
export function remove(queue: QueuedMessage[], id: string): QueuedMessage[] {
  return queue.filter((m) => m.id !== id)
}

/** How the queue describes itself above the composer. */
export function describeQueue(queue: QueuedMessage[]): string {
  if (!queue.length) return ''
  const resuming = queue.some((m) => m.resume)
  const count = `${queue.length} message${queue.length === 1 ? '' : 's'} queued`
  return resuming ? `${count}, including the work you interrupted` : count
}
