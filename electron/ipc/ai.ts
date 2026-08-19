import { app, ipcMain } from 'electron'
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  AiEvent,
  AiProvider,
  AiStartRequest,
  FileChange,
  ProviderInfo,
} from '../../shared/types'
import { codexMcpArgs, writeClaudeMcpConfig, type ResolvedMcpServer } from '../lib/pluginMcp'
import { buildOpencodeArgs, ollamaModels, translateOpencodeEvent } from '../lib/opencode'
import { compatibleProviders, providerSpec } from '../../shared/aiProviders'
import { readAiKey, storedAiKeys, writeAiKey } from '../lib/aiCredentials'

const exec = promisify(execFile)

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
  /**
   * Plugin-contributed MCP servers, resolved per run. Optional so the AI
   * console still works in tests that register it without a plugin host.
   */
  mcpServers?: () => Promise<ResolvedMcpServer[]>
}

/** GUI apps do not inherit a login shell PATH, so rebuild the usual dev locations. */
function enrichedEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const merged = [...new Set([...current, ...extra])].join(path.delimiter)
  return { ...process.env, PATH: merged, FORCE_COLOR: '0', NO_COLOR: '1' }
}

/**
 * The environment a run's child process gets.
 *
 * For a vendor endpoint this is the whole integration: the Claude CLI is
 * pointed at a different host and handed a different credential, and everything
 * downstream — arguments, streaming, tool events, file-change detection — is
 * unchanged.
 *
 * The isolated config directory is the part that matters, and it was not
 * obvious. Setting `ANTHROPIC_AUTH_TOKEN` alone does *not* override a
 * logged-in session: the CLI prefers its stored OAuth credentials, so a run the
 * user asked DeepSeek to do went out with their personal Anthropic token in the
 * `Authorization` header — to DeepSeek's servers. Pointing `CLAUDE_CONFIG_DIR`
 * at a per-provider directory means there is no stored session to prefer, so
 * the vendor key is the only credential available and the personal one cannot
 * leave the machine. Verified against a stub endpoint; the check lives in
 * tests/verify-agent.mjs so it cannot regress silently.
 */
async function vendorEnv(
  provider: AiProvider,
  spec: { compatible?: { baseUrlEnv: string; tokenEnv: string; defaultBaseUrl: string } },
  key: string,
  baseUrlOverride?: string,
): Promise<NodeJS.ProcessEnv> {
  const env = enrichedEnv()
  if (!spec.compatible) return env

  const configDir = path.join(app.getPath('userData'), 'vendor-cli', provider)
  await fs.mkdir(configDir, { recursive: true }).catch(() => undefined)

  return {
    ...env,
    CLAUDE_CONFIG_DIR: configDir,
    [spec.compatible.baseUrlEnv]: baseUrlOverride?.trim() || spec.compatible.defaultBaseUrl,
    [spec.compatible.tokenEnv]: key,
    // Both are set because the CLI accepts either, and leaving the other
    // inherited from the user's shell would reintroduce exactly the problem the
    // config directory is here to prevent.
    ANTHROPIC_API_KEY: key,
  }
}

async function which(binary: string): Promise<string> {
  try {
    const { stdout } = await exec('/bin/sh', ['-lc', `command -v ${binary}`], {
      env: enrichedEnv(),
    })
    return stdout.trim().split('\n')[0] ?? ''
  } catch {
    return ''
  }
}

async function version(binary: string): Promise<string> {
  try {
    const { stdout } = await exec(binary, ['--version'], { env: enrichedEnv(), timeout: 8000 })
    return stdout.trim().split('\n')[0] ?? ''
  } catch {
    return ''
  }
}

interface Run {
  id: string
  child: AiChild
  provider: AiProvider
  cwd: string
  cancelled: boolean
  /** path -> content before this turn touched it (null when the file did not exist). */
  before: Map<string, string | null>
  /** Paths already reported as changed, so we do not emit duplicates. */
  reported: Set<string>
  /** Tool-use id -> file path, so a tool_result can be paired with its edit. */
  pendingEdits: Map<string, string>
  preStatus: Set<string>
  /** Set when the CLI reported 401/403, so the exit can explain itself. */
  authFailed?: boolean
  /**
   * Whether any streamed assistant text has been emitted for this run.
   *
   * Claude's final `result` event repeats the whole answer in `result`. Emitting
   * both gives the caller the answer twice — invisible in a chat bubble, but a
   * streamed document arrives duplicated end to end. So `result` is treated as a
   * fallback for the runs that produced no streaming text at all.
   */
  sawAssistantText?: boolean
  /** OpenCode repeats its sessionID on every event; report it only once. */
  reportedSession?: boolean
  /**
   * Events produced before the renderer has associated `runId` with a message.
   * They are held here and flushed on `ai:ack` so nothing is dropped when a
   * fast CLI answers before the IPC call returns.
   */
  buffer: AiEvent[]
  acked: boolean
}

/** stdin is `ignore`, so the child exposes only stdout and stderr. */
type AiChild = ChildProcessByStdio<null, Readable, Readable>

const runs = new Map<string, Run>()
/** Runs awaiting the renderer's acknowledgement. */
const pending = new Map<string, Run>()
/** Events for runs that never started a process (e.g. missing CLI). */
const unstarted = new Map<string, AiEvent[]>()

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'str_replace_editor'])

function countLineDelta(before: string, after: string) {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const setA = new Map<string, number>()
  for (const line of a) setA.set(line, (setA.get(line) ?? 0) + 1)
  let additions = 0
  for (const line of b) {
    const n = setA.get(line) ?? 0
    if (n > 0) setA.set(line, n - 1)
    else additions++
  }
  let deletions = 0
  for (const n of setA.values()) deletions += n
  return { additions, deletions }
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function gitChangedPaths(cwd: string): Promise<Set<string>> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd,
      env: enrichedEnv(),
      maxBuffer: 16 * 1024 * 1024,
    })
    return new Set(
      stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => path.join(cwd, line.slice(3).split(' -> ').pop()!.trim())),
    )
  } catch {
    return new Set()
  }
}

async function gitHeadContent(cwd: string, file: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['show', `HEAD:${path.relative(cwd, file)}`], {
      cwd,
      env: enrichedEnv(),
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch {
    return null
  }
}

function queueUnstarted(runId: string, events: AiEvent[]) {
  unstarted.set(runId, events)
}

export function registerAiHandlers(ctx: Ctx) {
  const emit = (event: AiEvent) => ctx.broadcast('ai:event', event)

  /** Emits, or buffers when the renderer has not acknowledged the run yet. */
  const emitFor = (run: Run, event: AiEvent) => {
    if (run.acked) emit(event)
    else run.buffer.push(event)
  }

  async function captureBefore(run: Run, file: string) {
    if (run.before.has(file)) return
    run.before.set(file, await readOrNull(file))
  }

  async function emitChange(run: Run, file: string) {
    const before = run.before.get(file) ?? null
    const after = await readOrNull(file)
    if (before === after) return
    const key = file
    if (run.reported.has(key) && before === null) return
    run.reported.add(key)
    const kind: FileChange['kind'] =
      before === null ? 'create' : after === null ? 'delete' : 'modify'
    const { additions, deletions } = countLineDelta(before ?? '', after ?? '')
    emitFor(run, {
      type: 'file-change',
      runId: run.id,
      change: {
        path: file,
        before: before ?? '',
        after: after ?? '',
        kind,
        additions,
        deletions,
      },
    })
  }

  ipcMain.handle('ai:providers', async (): Promise<ProviderInfo[]> => {
    const [claudeBin, codexBin, opencodeBin] = await Promise.all([
      which('claude'),
      which('codex'),
      which('opencode'),
    ])
    const [claudeVer, codexVer, opencodeVer] = await Promise.all([
      claudeBin ? version(claudeBin) : Promise.resolve(''),
      codexBin ? version(codexBin) : Promise.resolve(''),
      opencodeBin ? version(opencodeBin) : Promise.resolve(''),
    ])
    // Only meaningful for opencode, and only worth reporting when it is present.
    const ollama = opencodeBin ? await ollamaModels() : []
    return [
      {
        id: 'claude',
        label: 'Claude Code',
        available: Boolean(claudeBin),
        binary: claudeBin,
        version: claudeVer,
        hint: claudeBin
          ? 'Streaming via `claude -p --output-format stream-json`'
          : 'Install with: npm i -g @anthropic-ai/claude-code',
      },
      {
        id: 'codex',
        label: 'Codex',
        available: Boolean(codexBin),
        binary: codexBin,
        version: codexVer,
        hint: codexBin
          ? 'Streaming via `codex exec --json`'
          : 'Install with: npm i -g @openai/codex',
      },
      {
        id: 'opencode',
        label: 'OpenCode (local)',
        available: Boolean(opencodeBin),
        binary: opencodeBin,
        version: opencodeVer,
        hint: !opencodeBin
          ? 'Install with: npm i -g opencode-ai — then a local model runs through Ollama'
          : ollama.length > 0
            ? `Local models: ${ollama.slice(0, 4).join(', ')}${ollama.length > 4 ? `, +${ollama.length - 4}` : ''}`
            : 'No Ollama models found — pull one, e.g. `ollama pull qwen2.5-coder:0.5b`',
      },
      // Vendor endpoints driven through the Claude CLI. "Available" means both
      // halves are present: the binary that will run, and the key without which
      // it would fail on the first request with an authentication error the
      // user would have to go and interpret.
      ...(await Promise.all(
        compatibleProviders().map(async (spec) => {
          const key = await readAiKey(spec.id)
          return {
            id: spec.id,
            label: spec.label,
            available: Boolean(claudeBin && key),
            binary: claudeBin,
            version: claudeVer,
            hint: !claudeBin
              ? `Needs the Claude Code CLI, which runs this endpoint: npm i -g @anthropic-ai/claude-code`
              : !key
                ? `Add an API key in Settings › AI — get one at ${spec.compatible!.console}`
                : `Claude Code CLI against ${spec.compatible!.defaultBaseUrl}`,
          }
        }),
      )),
    ]
  })

  /** Which providers have a key stored. Never the keys themselves. */
  ipcMain.handle('ai:storedKeys', () => storedAiKeys())

  ipcMain.handle('ai:setKey', (_e, provider: AiProvider, key: string | null) =>
    writeAiKey(provider, key),
  )

  /** The models Ollama has locally, as `ollama/<name>` for opencode's `-m`. */
  ipcMain.handle('ai:localModels', () => ollamaModels())

  ipcMain.handle('ai:start', async (_e, req: AiStartRequest) => {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // A vendor endpoint runs through another vendor's CLI, so what has to be on
    // PATH is that binary rather than something named after the provider.
    const spec = providerSpec(req.provider)
    const binary = await which(spec.binary)
    if (!binary) {
      // No run exists yet, so these go out once the renderer acknowledges.
      const message = `\`${spec.binary}\` CLI was not found on PATH. ${spec.install}`
      queueUnstarted(runId, [
        { type: 'error', runId, message },
        { type: 'done', runId, ok: false },
      ])
      return { runId }
    }

    // Without a key the CLI would reach the vendor and come back with a raw
    // authentication error, which is a worse way to learn the key is missing.
    const vendorKey = spec.compatible ? await readAiKey(req.provider) : ''
    if (spec.compatible && !vendorKey) {
      const message = `No API key for ${spec.label}. Add one in Settings › AI — keys come from ${spec.compatible.console}.`
      queueUnstarted(runId, [
        { type: 'error', runId, message },
        { type: 'done', runId, ok: false },
      ])
      return { runId }
    }

    let prompt = req.prompt
    if (req.attachments?.length) {
      const list = req.attachments.map((a) => `- ${path.relative(req.cwd, a) || a}`).join('\n')
      prompt = `${prompt}\n\nRelevant files in this project:\n${list}`
    }

    // Enabled plugins can hand the assistant extra tools. Resolved per run so
    // that enabling a plugin takes effect on the very next prompt.
    const mcp = (await ctx.mcpServers?.()) ?? []
    // Dialect, not provider id: every Anthropic-compatible vendor speaks the
    // Claude CLI's argument and event format, which is the entire reason they
    // need no adapter of their own.
    const args =
      spec.dialect === 'claude'
        ? buildClaudeArgs(req, prompt, await writeClaudeMcpConfig(mcp))
        : spec.dialect === 'opencode'
          ? buildOpencodeArgs(req, prompt)
          : buildCodexArgs(req, prompt, codexMcpArgs(mcp))

    // The prompt is passed as an argument, so the child must not wait on stdin —
    // `claude -p` otherwise stalls for seconds looking for piped input.
    const child = spawn(binary, args, {
      cwd: req.cwd,
      env: await vendorEnv(req.provider, spec, vendorKey, req.baseUrl),
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as AiChild

    const run: Run = {
      id: runId,
      child,
      provider: req.provider,
      cwd: req.cwd,
      cancelled: false,
      before: new Map(),
      reported: new Set(),
      pendingEdits: new Map(),
      preStatus: await gitChangedPaths(req.cwd),
      authFailed: false,
      buffer: [],
      acked: false,
    }
    runs.set(runId, run)
    pending.set(runId, run)

    emitFor(run, { type: 'log', runId, text: `$ ${req.provider} ${args.join(' ')}` })

    let stdoutBuf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let idx: number
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim()
        stdoutBuf = stdoutBuf.slice(idx + 1)
        if (line) void handleLine(run, line)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) emitFor(run, { type: 'log', runId, text })
    })

    child.on('error', (err) => {
      emitFor(run, { type: 'error', runId, message: err.message })
    })

    child.on('close', async (code) => {
      if (stdoutBuf.trim()) await handleLine(run, stdoutBuf.trim())
      await reconcileGitChanges(run)
      if (run.authFailed) {
        emitFor(run, {
          type: 'error',
          runId,
          message:
            `${req.provider} could not authenticate. Run \`${req.provider} ${req.provider === 'claude' ? 'auth' : 'login'}\` in a terminal, then try again.`,
        })
      }
      // OpenCode reports a missing or unreachable model as "Unexpected server
      // error", which tells the user nothing. The overwhelmingly common cause is
      // that Ollama has no models pulled, so check and say so.
      if (req.provider === 'opencode' && code !== 0 && !run.cancelled) {
        const models = await ollamaModels()
        emitFor(run, {
          type: 'error',
          runId,
          message:
            models.length === 0
              ? 'No local models are available. Start Ollama and pull one — a small one is enough to begin: `ollama pull qwen2.5-coder:0.5b`.'
              : `OpenCode failed with a local model. Available: ${models.join(', ')}. Check the model name in Settings › AI console.`,
        })
      }
      emitFor(run, { type: 'done', runId, ok: code === 0 && !run.cancelled && !run.authFailed })
      runs.delete(runId)
      pending.delete(runId)
    })

    return { runId }
  })

  /** The renderer calls this once it can attribute events to a message. */
  ipcMain.handle('ai:ack', (_e, runId: string) => {
    const early = unstarted.get(runId)
    if (early) {
      unstarted.delete(runId)
      for (const event of early) emit(event)
      return
    }
    const run = pending.get(runId)
    if (!run) return
    run.acked = true
    pending.delete(runId)
    for (const event of run.buffer) emit(event)
    run.buffer = []
  })

  ipcMain.handle('ai:cancel', (_e, runId: string) => {
    const run = runs.get(runId)
    if (!run) return
    run.cancelled = true
    run.child.kill('SIGTERM')
    setTimeout(() => {
      if (runs.has(runId)) run.child.kill('SIGKILL')
    }, 2500)
  })

  /** Any file git reports as newly dirty is surfaced even if no tool event named it. */
  async function reconcileGitChanges(run: Run) {
    const post = await gitChangedPaths(run.cwd)
    for (const file of post) {
      if (run.preStatus.has(file) || run.reported.has(file)) continue
      if (!run.before.has(file)) {
        run.before.set(file, await gitHeadContent(run.cwd, file))
      }
      await emitChange(run, file)
    }
  }

  async function handleLine(run: Run, line: string) {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      emitFor(run, { type: 'log', runId: run.id, text: line })
      return
    }
    const dialect = providerSpec(run.provider).dialect
    if (dialect === 'claude') await handleClaudeEvent(run, event)
    else if (dialect === 'opencode') await handleOpencodeEvent(run, event)
    else await handleCodexEvent(run, event)
  }

  /**
   * Applies the translated OpenCode events.
   *
   * Note what this deliberately does *not* do: capture a before-image per tool
   * call, the way the Claude path does. OpenCode emits a tool part only once it
   * has **completed**, so by the time the edit is visible here the file on disk
   * already contains the change — snapshotting then would record the *result* as
   * the "before", and every diff would come out empty.
   *
   * Change cards for this provider therefore come from `reconcileGitChanges` at
   * the end of the run, which reads the pre-run content out of git HEAD. The
   * consequence is worth stating: in a project that is not a git repository,
   * an OpenCode run reports its edits in the transcript but produces no
   * reviewable change cards.
   */
  async function handleOpencodeEvent(run: Run, event: Record<string, any>) {
    const { events, sawText } = translateOpencodeEvent(event, run.id, run.reportedSession ?? false)
    if (events.some((e) => e.type === 'session')) run.reportedSession = true
    if (sawText) run.sawAssistantText = true
    for (const emitted of events) emitFor(run, emitted)
  }

  async function handleClaudeEvent(run: Run, event: Record<string, any>) {
    switch (event.type) {
      case 'system': {
        if (event.subtype === 'init' && event.session_id) {
          emitFor(run, { type: 'session', runId: run.id, sessionId: String(event.session_id) })
          return
        }
        // The CLI retries a failing API call up to 10 times with backoff. Without
        // surfacing this the console just spins for minutes with no explanation.
        if (event.subtype === 'api_retry') {
          const status = event.error_status ? ` (HTTP ${event.error_status})` : ''
          const reason = event.error ? `: ${event.error}` : ''
          emitFor(run, {
            type: 'log',
            runId: run.id,
            text: `Request failed${status}${reason} — retrying ${event.attempt}/${event.max_retries}…`,
          })
          if (event.error_status === 401 || event.error_status === 403) {
            run.authFailed = true
          }
          return
        }
        return
      }
      case 'assistant': {
        const content = event.message?.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            run.sawAssistantText = true
            emitFor(run, { type: 'assistant-text', runId: run.id, text: block.text })
          } else if (block.type === 'thinking' && block.thinking) {
            emitFor(run, { type: 'thinking', runId: run.id, text: block.thinking })
          } else if (block.type === 'tool_use') {
            emitFor(run, {
              type: 'tool-use',
              runId: run.id,
              id: String(block.id),
              name: String(block.name),
              input: block.input,
            })
            const file = block.input?.file_path ?? block.input?.path ?? block.input?.notebook_path
            if (EDIT_TOOLS.has(block.name) && typeof file === 'string') {
              run.pendingEdits.set(String(block.id), file)
              await captureBefore(run, file)
            }
          }
        }
        return
      }
      case 'user': {
        const content = event.message?.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const id = String(block.tool_use_id)
          const preview =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((c: any) => (typeof c === 'string' ? c : (c?.text ?? '')))
                    .join('\n')
                : ''
          emitFor(run, {
            type: 'tool-result',
            runId: run.id,
            id,
            ok: !block.is_error,
            preview: preview.slice(0, 4000),
          })
          const file = run.pendingEdits.get(id)
          if (file) {
            run.pendingEdits.delete(id)
            await emitChange(run, file)
          }
        }
        return
      }
      case 'result': {
        if (event.subtype !== 'success' && event.result) {
          emitFor(run, { type: 'error', runId: run.id, message: String(event.result) })
        } else if (
          !run.sawAssistantText &&
          typeof event.result === 'string' &&
          event.result.trim()
        ) {
          // Only when nothing streamed: otherwise this repeats the whole answer.
          emitFor(run, { type: 'assistant-text', runId: run.id, text: event.result })
        }
        emitFor(run, {
          type: 'done',
          runId: run.id,
          ok: event.subtype === 'success',
          costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined,
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
        })
        return
      }
      default:
        return
    }
  }

  /**
   * Codex's JSONL schema (0.14x) is item-based: a thread emits `item.started` /
   * `item.completed` envelopes wrapping typed items. Older releases used a flat
   * `msg.type` shape, so both are handled.
   */
  async function handleCodexEvent(run: Run, event: Record<string, any>) {
    const kind = String(event.type ?? '')

    switch (kind) {
      case 'thread.started':
        if (event.thread_id) {
          emitFor(run, { type: 'session', runId: run.id, sessionId: String(event.thread_id) })
        }
        return
      case 'turn.started':
        return
      case 'turn.completed':
        emitFor(run, { type: 'done', runId: run.id, ok: true })
        return
      case 'turn.failed':
      case 'error':
        emitFor(run, {
          type: 'error',
          runId: run.id,
          message: String(event.error?.message ?? event.message ?? 'Codex turn failed'),
        })
        return
      case 'item.started':
      case 'item.completed': {
        await handleCodexItem(run, event.item ?? {}, kind === 'item.completed')
        return
      }
      default:
        // Fall through to the legacy `msg`-shaped schema.
        break
    }

    const msg = event.msg ?? event
    const legacy = String(msg.type ?? '')
    if (legacy === 'agent_message' || legacy === 'agent_message_delta') {
      const text = msg.message ?? msg.delta ?? msg.text ?? ''
      if (text) emitFor(run, { type: 'assistant-text', runId: run.id, text: String(text) })
      return
    }
    if (legacy === 'agent_reasoning' || legacy === 'agent_reasoning_delta') {
      const text = msg.text ?? msg.delta ?? ''
      if (text) emitFor(run, { type: 'thinking', runId: run.id, text: String(text) })
      return
    }
    if (legacy === 'token_count' || legacy === 'task_started' || legacy === 'session_configured') return
    emitFor(run, { type: 'log', runId: run.id, text: JSON.stringify(event).slice(0, 800) })
  }

  async function handleCodexItem(run: Run, item: Record<string, any>, completed: boolean) {
    const id = String(item.id ?? Math.random())
    switch (String(item.type ?? '')) {
      case 'agent_message': {
        if (completed && item.text) {
          emitFor(run, { type: 'assistant-text', runId: run.id, text: String(item.text) })
        }
        return
      }
      case 'reasoning': {
        if (completed && item.text) {
          emitFor(run, { type: 'thinking', runId: run.id, text: String(item.text) })
        }
        return
      }
      case 'command_execution': {
        if (!completed) {
          emitFor(run, {
            type: 'tool-use',
            runId: run.id,
            id,
            name: 'Bash',
            input: { command: String(item.command ?? '') },
          })
        } else {
          emitFor(run, {
            type: 'tool-result',
            runId: run.id,
            id,
            ok: (item.exit_code ?? 0) === 0,
            preview: String(item.aggregated_output ?? '').slice(0, 4000),
          })
        }
        return
      }
      case 'file_change': {
        const changes: { path: string; kind?: string }[] = item.changes ?? []
        if (!completed) {
          // Snapshot before the patch lands so the diff is accurate.
          for (const change of changes) await captureBefore(run, change.path)
          emitFor(run, {
            type: 'tool-use',
            runId: run.id,
            id,
            name: 'ApplyPatch',
            input: { files: changes.map((c) => c.path) },
          })
        } else {
          for (const change of changes) await emitChange(run, change.path)
          emitFor(run, {
            type: 'tool-result',
            runId: run.id,
            id,
            ok: item.status !== 'failed',
            preview: changes.map((c) => `${c.kind ?? 'update'} ${c.path}`).join('\n'),
          })
        }
        return
      }
      case 'todo_list':
      case 'web_search':
        return
      default: {
        if (completed) {
          emitFor(run, { type: 'log', runId: run.id, text: JSON.stringify(item).slice(0, 500) })
        }
      }
    }
  }
}

function buildClaudeArgs(req: AiStartRequest, prompt: string, mcpConfig: string | null): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    req.permissionMode ?? 'acceptEdits',
  ]
  if (req.model) args.push('--model', req.model)
  if (req.resumeSessionId) args.push('--resume', req.resumeSessionId)
  // Merged with, not substituted for, the user's own MCP config.
  if (mcpConfig) args.push('--mcp-config', mcpConfig)
  // `--` terminates option parsing, so the prompt is always the positional
  // argument and never a value.
  //
  // Without it a *variadic* option immediately before the prompt eats it:
  // `--mcp-config <configs...>` takes space-separated paths, so
  // `--mcp-config cfg.json "You are writing…"` reads the whole prompt as a
  // second config file and the run dies with `ENAMETOOLONG` before the model
  // is ever called. It also stops a prompt that happens to begin with `-`
  // from being read as a flag.
  args.push('--', prompt)
  return args
}

function buildCodexArgs(req: AiStartRequest, prompt: string, mcpArgs: string[]): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', req.cwd]
  if (req.model) args.push('-m', req.model)
  args.push(...mcpArgs)

  // `codex exec` takes a sandbox policy, not a permission mode. `plan` maps to
  // read-only so the model can look but not touch.
  switch (req.permissionMode) {
    case 'bypassPermissions':
      args.push('--dangerously-bypass-approvals-and-sandbox')
      break
    case 'plan':
      args.push('--sandbox', 'read-only')
      break
    default:
      args.push('--sandbox', 'workspace-write')
  }

  // Same reasoning as the Claude builder: the prompt is data, not an option.
  args.push('--', prompt)
  return args
}
