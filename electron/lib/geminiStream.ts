/**
 * Reading the JSONL that `gemini --output-format stream-json` emits.
 *
 * The event kinds are taken from the shipped CLI rather than from
 * documentation: `system`, `assistant`, `user`, `tool_call`, `tool_result`,
 * `result` and `error`. Kimi's CLI emits the same shapes, which is why they
 * share this reader.
 *
 * Tolerant on purpose. These CLIs move quickly and rename fields between minor
 * versions, and the failure that matters is not "a field was renamed" — it is
 * an editor that shows an empty reply because one key moved. So each value is
 * looked for in the handful of places it is plausibly written, and anything
 * unrecognised is surfaced as log output rather than dropped. Losing tool
 * annotations to a schema change is survivable; losing the answer is not.
 */
import type { AiEvent } from '../../shared/types'

interface Bag {
  [key: string]: unknown
}

/** First string found among these keys, walking one level into objects. */
function pick(source: Bag, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/**
 * Text out of an event, whatever shape it arrived in.
 *
 * Handles a bare string, `{text}`, an Anthropic-style `content` array of
 * `{type:'text', text}` blocks, and a nested `message`.
 */
function textOf(event: Bag): string {
  const direct = pick(event, ['text', 'content', 'response', 'delta'])
  if (direct) return direct

  const message = event.message as Bag | undefined
  if (message) {
    const nested = pick(message, ['text', 'content'])
    if (nested) return nested
    const blocks = message.content
    if (Array.isArray(blocks)) return joinBlocks(blocks)
  }

  if (Array.isArray(event.content)) return joinBlocks(event.content)
  return ''
}

function joinBlocks(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      if (typeof block === 'string') return block
      const b = block as Bag
      return typeof b.text === 'string' ? b.text : ''
    })
    .filter(Boolean)
    .join('')
}

/**
 * Translates one parsed line into Nova's events.
 *
 * Returns an array because a single line can carry both an answer and the
 * session id, and none because a line can be pure bookkeeping.
 */
export function translateGeminiEvent(
  runId: string,
  raw: unknown,
  /**
   * Whether this run has already streamed an answer.
   *
   * The final `result` line repeats the whole reply in some builds. Emitting it
   * as well gives the caller the answer twice — invisible in a chat bubble, but
   * a streamed document arrives duplicated end to end. So it is treated as a
   * fallback for runs that produced no streaming text at all, exactly as the
   * Claude reader does.
   */
  sawText = false,
): AiEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const event = raw as Bag
  const type = String(event.type ?? '')
  const out: AiEvent[] = []

  const sessionId = pick(event, ['session_id', 'sessionId', 'conversation_id'])
  if (sessionId) out.push({ type: 'session', runId, sessionId })

  switch (type) {
    case 'assistant': {
      const text = textOf(event)
      if (text) out.push({ type: 'assistant-text', runId, text })
      // Some builds nest tool calls inside the assistant turn instead of
      // emitting them as their own line.
      const blocks = (event.message as Bag | undefined)?.content
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          const b = block as Bag
          if (b.type === 'tool_use' || b.type === 'tool_call') {
            out.push({
              type: 'tool-use',
              runId,
              id: String(b.id ?? b.call_id ?? ''),
              name: String(b.name ?? 'tool'),
              input: b.input ?? b.args ?? {},
            })
          }
        }
      }
      return out
    }

    case 'tool_call':
      out.push({
        type: 'tool-use',
        runId,
        id: pick(event, ['id', 'call_id', 'tool_call_id']) || 'tool',
        name: pick(event, ['name', 'tool', 'tool_name']) || 'tool',
        input: event.input ?? event.args ?? event.parameters ?? {},
      })
      return out

    case 'tool_result': {
      const failed = event.is_error === true || event.error !== undefined || event.status === 'error'
      out.push({
        type: 'tool-result',
        runId,
        id: pick(event, ['id', 'call_id', 'tool_call_id']) || 'tool',
        ok: !failed,
        preview: (textOf(event) || JSON.stringify(event.result ?? event.output ?? '')).slice(0, 2000),
      })
      return out
    }

    case 'error':
      out.push({
        type: 'error',
        runId,
        message: pick(event, ['message', 'error', 'text']) || 'The assistant reported an error.',
      })
      return out

    case 'result': {
      // The final line repeats the whole answer in some builds. The caller
      // decides whether to use it, the same way the Claude reader does.
      const text = textOf(event)
      if (text && !sawText) out.push({ type: 'assistant-text', runId, text })
      const cost = event.total_cost_usd ?? event.cost_usd
      out.push({
        type: 'done',
        runId,
        ok: event.is_error !== true && event.subtype !== 'error',
        costUsd: typeof cost === 'number' ? cost : undefined,
      })
      return out
    }

    case 'user':
    case 'system':
      // Bookkeeping: the prompt echoed back, and the session banner. The
      // session id above is the only part worth keeping.
      return out

    default:
      return out
  }
}

/**
 * The arguments for a headless run.
 *
 * `--approval-mode` lines up with Nova's permission modes closely enough to map
 * directly, and `plan` is genuinely read-only — which is what the plan-first
 * workflow depends on.
 */
export function buildGeminiArgs(opts: {
  prompt: string
  model?: string
  permissionMode?: string
  resumeSessionId?: string
}): string[] {
  const args = ['--output-format', 'stream-json']

  const approval =
    opts.permissionMode === 'plan'
      ? 'plan'
      : opts.permissionMode === 'bypassPermissions'
        ? 'yolo'
        : opts.permissionMode === 'acceptEdits'
          ? 'auto_edit'
          : 'default'
  args.push('--approval-mode', approval)

  if (opts.model) args.push('--model', opts.model)
  args.push('--prompt', opts.prompt)
  return args
}
