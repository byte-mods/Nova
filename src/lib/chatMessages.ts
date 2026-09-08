/**
 * Turning a live conversation into a stored one, and back.
 *
 * `running` and `runId` describe a run that is happening *now*: a spinner on
 * the message, and the id events are matched against. Neither means anything
 * once the conversation is on disk — the run they refer to ended, or died with
 * the window.
 *
 * Persisting them anyway is how a chat comes back with a spinner that never
 * stops. Saving used to happen only when a turn completed, so a stored message
 * was always a finished one and the question never arose; saving as messages
 * arrive is what made a half-finished turn something that could be written
 * down. The record is better for it — a crashed CLI no longer takes the
 * transcript with it — but a message restored from that record is a
 * transcript, not a run, and has to be stored as one.
 *
 * Applied on the way out *and* on the way in: on the way out so nothing new is
 * written wrong, and on the way in because chats saved before this fix are
 * already on people's disks with `running: true` in them.
 */

/** The parts of a message that only make sense while a run is in flight. */
interface Live {
  running?: boolean
  runId?: string
}

/**
 * A message as it should be stored or restored: no longer running, and not
 * claiming to belong to a run.
 *
 * The keys are deleted rather than set to `false`, so a stored chat does not
 * carry a field whose only possible value is the default.
 */
export function settleMessage<T extends Live>(message: T): T {
  if (message.running === undefined && message.runId === undefined) return message
  const settled = { ...message }
  delete settled.running
  delete settled.runId
  return settled
}

/** `settleMessage` across a conversation, preserving the array when nothing changes. */
export function settleMessages<T extends Live>(messages: T[]): T[] {
  return messages.some((m) => m.running !== undefined || m.runId !== undefined)
    ? messages.map(settleMessage)
    : messages
}
