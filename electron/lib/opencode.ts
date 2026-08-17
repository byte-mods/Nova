/**
 * The OpenCode provider: local models, through Ollama.
 *
 * OpenCode is an agent CLI like `claude` and `codex`, but it points at whatever
 * model you configure — including one running locally under Ollama. That is the
 * whole reason it is here: a project can be worked on with no network, no
 * account and no per-token cost, using the same console, Explain and Tutorial
 * features as the hosted providers.
 *
 * This module is deliberately free of any `electron` import so it can be bundled
 * and unit-tested on its own. The argv builder and the stream translator are the
 * two parts that fail *silently* when they are wrong — a bad flag produces a CLI
 * that ignores it, a bad translation produces an empty console — so they live
 * here, pure, with their own suite.
 *
 * Schema reference: `packages/opencode/src/cli/cmd/run.ts` upstream, which emits
 * `{ type, timestamp, sessionID, ...data }` per line under `--format json`.
 */
import type { AiEvent, AiStartRequest } from '../../shared/types'

/**
 * The models Ollama has pulled locally.
 *
 * Asked over Ollama's HTTP API rather than by shelling out to `ollama list`,
 * because the API answers only when the server is actually up — which is the
 * thing that has to be true for a local run to work at all. A missing binary and
 * a stopped server are the same failure from the user's point of view, and both
 * come back here as an empty list.
 */
export async function ollamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return []
    const body = (await response.json()) as { models?: { name?: string }[] }
    return (body.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * `opencode run` in headless mode.
 *
 * Permission mapping is the part worth reading. OpenCode asks before anything
 * destructive and **auto-rejects** when it cannot ask — which is precisely what
 * plan mode wants, so plan mode is the *absence* of `--auto`, plus the built-in
 * read-only `plan` agent. Every other mode passes `--auto`, because without it
 * an agent asked to edit files fails every single write.
 */
export function buildOpencodeArgs(req: AiStartRequest, prompt: string): string[] {
  const args = ['run', '--format', 'json', '--thinking', '--dir', req.cwd]

  // `provider/model`, e.g. `ollama/qwen2.5-coder:0.5b`. A bare name is taken to
  // be an Ollama model, which is the only reason most people reach for this.
  if (req.model) args.push('-m', req.model.includes('/') ? req.model : `ollama/${req.model}`)

  if (req.permissionMode === 'plan') args.push('--agent', 'plan')
  else args.push('--auto')

  if (req.resumeSessionId) args.push('--session', req.resumeSessionId)
  for (const file of req.attachments ?? []) args.push('-f', file)

  // The prompt is data, not an option — the same terminator the other two
  // builders use, for the same reason.
  args.push('--', prompt)
  return args
}

/** The file an edit-shaped tool call is about, whatever the tool calls the key. */
export function filePathFrom(input: Record<string, any>): string | null {
  const candidate = input?.filePath ?? input?.file_path ?? input?.path ?? input?.file
  return typeof candidate === 'string' && candidate ? candidate : null
}

/**
 * Translates one line of OpenCode's JSON stream into console events.
 *
 * The types that carry content wrap a message *part* — `text`, `reasoning`,
 * `tool_use`, `step_start`, `step_finish` — while `error` carries a bare error
 * object instead.
 *
 * Two consequences worth knowing:
 *   - Parts arrive **completed**, not token by token, so a long answer lands in
 *     a single event. The console renders it the way it renders Codex.
 *   - There is no terminating event. The CLI breaks its loop when the session
 *     goes idle and exits, so `done` comes from the process close handler.
 */
export function translateOpencodeEvent(
  event: Record<string, any>,
  runId: string,
  sessionReported: boolean,
): { events: AiEvent[]; file: string | null; sawText: boolean } {
  const events: AiEvent[] = []
  let file: string | null = null
  let sawText = false

  if (event.sessionID && !sessionReported) {
    events.push({ type: 'session', runId, sessionId: String(event.sessionID) })
  }

  const part = event.part ?? {}
  switch (String(event.type ?? '')) {
    case 'text': {
      const text = String(part.text ?? '')
      if (text.trim()) {
        sawText = true
        events.push({ type: 'assistant-text', runId, text })
      }
      break
    }
    case 'reasoning': {
      const text = String(part.text ?? '')
      if (text.trim()) events.push({ type: 'thinking', runId, text })
      break
    }
    case 'tool_use': {
      const id = String(part.id ?? part.callID ?? '')
      const name = String(part.tool ?? 'tool')
      const state = part.state ?? {}
      const input = state.input ?? {}
      file = filePathFrom(input)

      // Completed on arrival, so the call and its result are reported back to
      // back rather than as a pending pair the renderer has to match up.
      events.push({ type: 'tool-use', runId, id, name, input })
      const ok = state.status !== 'error'
      const preview = String(ok ? (state.output ?? state.title ?? '') : (state.error ?? 'failed'))
      events.push({ type: 'tool-result', runId, id, ok, preview: preview.slice(0, 4000) })
      break
    }
    case 'error': {
      const error = event.error ?? {}
      const message =
        error?.data?.message ?? error?.message ?? error?.name ?? JSON.stringify(error).slice(0, 400)
      events.push({ type: 'error', runId, message: String(message) })
      break
    }
    // Turn boundaries; the console has no use for them on their own.
    case 'step_start':
    case 'step_finish':
    default:
      break
  }

  return { events, file, sawText }
}
