import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileCode2,
  Loader2,
  Paperclip,
  ListChecks,
  MessagesSquare,
  Plus,
  Repeat,
  Trash2,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { AiEvent, AiProvider } from '@shared/types'
import type { Plan } from '@shared/chat'
import { useStore, type AiMessage, type AiMessagePart } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import Markdown from '@/components/editor/Markdown'
import PlanCard from './PlanCard'
import PlanHistory from './PlanHistory'
import { ChangeLine, CommandGroup } from './Activity'
import { buildContextBlock } from '@/lib/aiContext'
import { applyProgress, buildExecutePrompt, buildPlanPrompt, needsPlan, parsePlan } from '@/lib/planning'
import { MODEL_TIERS, providerSpec, providerState } from '@shared/aiProviders'
import {
  advance,
  beginAutoRun,
  decideNext,
  openingPrompt,
  type AutoRunState,
} from '@/lib/autoRun'

export default function AiConsole() {
  const messages = useStore((s) => s.messages)
  const running = useStore((s) => s.aiRunning)
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => s.settings)
  const root = useStore((s) => s.root)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const chats = useStore((s) => s.chats)
  const plans = useStore((s) => s.plans)
  const activeChatId = useStore((s) => s.activeChatId)
  const plan = useStore((s) => s.plan)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [planningEnabled, setPlanningEnabled] = useState(true)
  const autoRun = useStore((s) => s.autoRun)
  const [showChats, setShowChats] = useState(false)
  const [showPlans, setShowPlans] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])
  /**
   * What the in-flight run is for, so its output can be routed on completion.
   * Refs, not state: the event subscription is created once and would close
   * over a stale value.
   */
  const modeRef = useRef<'chat' | 'plan' | 'execute'>('chat')
  const requestRef = useRef('')
  /**
   * The automatic run in flight, and the door back into `startRun`.
   *
   * Refs for the same reason the two above are: the event subscription is
   * created once, and a value captured in it would be the one from the render
   * that made it. `continueRef` is filled in below, after `startRun` exists.
   */
  const autoRef = useRef<AutoRunState | null>(null)
  const continueRef = useRef<((prompt: string) => Promise<void>) | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const provider = providers.find((p) => p.id === settings.aiProvider)
  const spec = providerSpec(settings.aiProvider)
  const activeFile = tabs.find((t) => t.id === activeTabId)?.path

  useAiEvents(modeRef, requestRef, autoRef, continueRef)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // OpenCode's models are whatever Ollama has pulled, which changes outside
  // Nova — so they are asked for rather than remembered.
  useEffect(() => {
    if (settings.aiProvider !== 'opencode') return
    void window.nova.ai.localModels().then(setLocalModels).catch(() => setLocalModels([]))
  }, [settings.aiProvider])

  /**
   * Starts a run.
   *
   * `mode` decides what happens: a normal turn, a read-only planning turn, or
   * the execution of an already-approved plan. They share everything except the
   * prompt and the permission mode, so they share this function.
   */
  const startRun = async (
    prompt: string,
    mode: 'chat' | 'plan' | 'execute',
    displayText?: string,
  ) => {
    if (!root) return
    const store = useStore.getState()

    if (displayText) {
      store.addMessage({
        id: `u${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'text', text: displayText }],
        changes: [],
        createdAt: Date.now(),
      })
    }

    const assistantId = `a${Date.now()}`
    store.addMessage({
      id: assistantId,
      role: 'assistant',
      parts: [],
      changes: [],
      provider: settings.aiProvider,
      running: true,
      createdAt: Date.now(),
    })
    store.setAiRunning(true)
    modeRef.current = mode
    if (displayText) requestRef.current = displayText

    // Remember a model the moment it is actually used, so the next run offers
    // it. Only on use: typing into the field should not fill the list with
    // half-finished names.
    if (settings.aiModel) {
      const seen = settings.aiRecentModels?.[settings.aiProvider] ?? []
      if (!seen.includes(settings.aiModel)) {
        store.setSettings({
          aiRecentModels: {
            ...(settings.aiRecentModels ?? {}),
            [settings.aiProvider]: [settings.aiModel, ...seen].slice(0, 8),
          },
        })
      }
    }

    const { runId: id } = await window.nova.ai.start({
      provider: settings.aiProvider,
      // The context block orients the agent on what the user is looking at;
      // it cannot discover that from the filesystem.
      prompt: buildContextBlock({ includeSelection: mode !== 'execute' }) + prompt,
      cwd: root,
      model: settings.aiModel || undefined,
      resumeSessionId: store.aiSessionId[settings.aiProvider],
      attachments,
      // A planning turn must not be able to write, whatever the user's usual
      // permission setting is. That is the guarantee the approval gate rests on.
      permissionMode: mode === 'plan' ? 'plan' : settings.aiPermissionMode,
      // Only meaningful for the vendor providers; ignored for the rest.
      baseUrl: settings.aiBaseUrls?.[settings.aiProvider],
      effort: settings.aiEffort || undefined,
    })
    setRunId(id)
    useStore.setState({ activeRunId: id })
    setAttachments([])
    store.patchMessage(assistantId, (m) => ({ ...m, runId: id }))
    // Tell the main process the message can now receive this run's events.
    await window.nova.ai.ack(id)
  }

  // The event hook drives continuations through this, so an automatic run's
  // next turn is started by exactly the same path as a typed one.
  continueRef.current = async (prompt: string) => {
    await startRun(prompt, 'chat')
  }

  /**
   * Takes images off the clipboard and attaches them.
   *
   * A screenshot is the fastest way to describe a layout bug, and until now the
   * only way to show one was to save it somewhere by hand and then type the
   * path. The assistants read images from paths rather than from bytes, so the
   * paste is written into the project and attached like any other file.
   *
   * Text pastes are left completely alone — `preventDefault` is called only
   * when there is at least one image, so pasting a stack trace still behaves
   * the way pasting a stack trace should.
   */
  const pasteImages = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!root) return
    const files = Array.from(event.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return

    event.preventDefault()
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      }).catch(() => '')
      if (!dataUrl) continue

      const saved = await window.nova.ai.attachImage(root, dataUrl)
      if (saved) setAttachments((a) => (a.includes(saved) ? a : [...a, saved]))
    }
  }

  const send = async () => {
    const prompt = input.trim()
    if (!prompt || running || !root) return
    setInput('')

    /*
     * An automatic run takes precedence over planning.
     *
     * Both exist to stop the agent halting halfway, and running them together
     * would mean a plan the loop then has to approve on the user's behalf —
     * which is an approval gate that approves itself, and worse than not having
     * one. The loop's own test gate is the check here.
     */
    if (settings.aiAutoRun) {
      // A previous run that was stopped left this set; a new one starts clean,
      // or its very first turn would be read as cancelled and go nowhere.
      useStore.getState().setAiAutoCancelled(false)
      autoRef.current = beginAutoRun(prompt, settings.aiAutoMaxIterations ?? 0)
      useStore.getState().setAutoRun(autoRef.current)
      await startRun(openingPrompt(prompt), 'chat', prompt)
      return
    }

    // A request that will change files gets planned first. A question does not:
    // forcing a plan on "what does this do" doubles the wait for nothing.
    if (planningEnabled && needsPlan(prompt)) {
      await startRun(buildPlanPrompt(prompt), 'plan', prompt)
      return
    }
    await startRun(prompt, 'chat', prompt)
  }

  const approvePlan = async () => {
    if (!plan) return
    const approved: Plan = {
      ...plan,
      status: 'executing',
      approvedAt: Date.now(),
      steps: plan.steps.map((s) => (s.status === 'skipped' ? s : { ...s, status: 'pending' })),
    }
    useStore.getState().setPlan(approved)
    await startRun(buildExecutePrompt(approved), 'execute')
  }

  const stop = () => {
    if (runId) void window.nova.ai.cancel(runId)
    /*
     * Stop has to end the *run*, not the turn.
     *
     * Killing the child still produces a `done`, and the loop would read that
     * as a turn that finished and start another one — so pressing Stop on an
     * automatic run would look like it did nothing. The flag is what the loop
     * checks before deciding anything; it is cleared there.
     */
    if (autoRef.current) {
      autoRef.current = null
      useStore.getState().setAiAutoCancelled(true)
      useStore.getState().setAutoRun(null)
    }
    // Release the console even if the process has already gone away. Cancel is
    // best-effort; leaving the composer disabled because a `done` never came
    // back is the failure this is here to prevent.
    useStore.setState({ activeRunId: null, aiRunning: false })
  }

  const suggestions = useMemo(
    () => [
      activeFile
        ? `Explain what ${basename(activeFile)} does and where it is used.`
        : 'Give me a tour of this codebase — entry points, key modules, data flow.',
      'Add a new module for <feature>. Wire it into the existing app and keep the current code style.',
      activeFile
        ? `Write unit tests for ${basename(activeFile)}.`
        : 'Find the riskiest parts of this codebase and suggest concrete fixes.',
    ],
    [activeFile],
  )

  return (
    <div className="ai-console">
      <div className="ai-header">
        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>AI Console</span>

        <select
          className="select"
          style={{ marginLeft: 'auto', maxWidth: 120 }}
          title="Which assistant runs this conversation"
          value={settings.aiProvider}
          onChange={(e) =>
            // The model belongs to the provider, so a stale one must not
            // survive the switch — asking Gemini for "opus" fails at the CLI.
            useStore.getState().setSettings({
              aiProvider: e.target.value as AiProvider,
              aiModel: '',
            })
          }
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.available ? '' : ' ⚠'}
            </option>
          ))}
        </select>

        <button
          className={`icon-btn ${showPlans ? 'active' : ''}`}
          title="Plans this conversation has produced, and what changed between attempts"
          onClick={() => {
            setShowPlans((v) => !v)
            setShowChats(false)
          }}
        >
          <ListChecks size={15} />
        </button>

        <button
          className={`icon-btn ${showChats ? 'active' : ''}`}
          title="Previous conversations"
          onClick={() => {
            setShowChats((v) => !v)
            setShowPlans(false)
          }}
        >
          <MessagesSquare size={15} />
        </button>

        <button
          className="icon-btn"
          title="New chat"
          onClick={() => void useStore.getState().newChat()}
        >
          <Plus size={15} />
        </button>
      </div>

      {/*
        Model and effort live below the header rather than in it.
        The console is a side panel, and three dropdowns plus four icon buttons
        on one line pushed the buttons off the edge and clipped the last select
        — the same "present but unreachable" failure as a tab strip that
        overflows. A second row costs 26 pixels and keeps everything legible at
        the narrowest width the panel can be dragged to.
      */}
      <div className="ai-model-row">
        {/*
          A combobox, not a list.

          A fixed dropdown of models is stale the week after it is written —
          vendors ship new ones constantly, and being unable to select one
          because Nova has not heard of it yet is a wall. The suggestions are
          the common choices, labelled by the trade they make; anything else can
          simply be typed. The suggested ids are aliases where the vendor offers
          them (`opus`, `sonnet`), since those follow the latest model rather
          than pinning a version that expires.
        */}
        <input
          className="ai-model-input"
          list="nova-model-suggestions"
          spellCheck={false}
          placeholder="Default model"
          title="Which model to use. Pick a suggestion or type any model this CLI accepts."
          value={settings.aiModel}
          onChange={(e) => useStore.getState().setSettings({ aiModel: e.target.value })}
        />
        <datalist id="nova-model-suggestions">
          {/* What this machine has actually used comes first: it is the only
              part of this list that cannot be out of date. */}
          {(settings.aiRecentModels?.[settings.aiProvider] ?? []).map((m) => (
            <option key={`recent-${m}`} value={m} />
          ))}
          {(spec.models ?? [])
            .filter((m) => !(settings.aiRecentModels?.[settings.aiProvider] ?? []).includes(m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {MODEL_TIERS.find((t) => t.id === m.tier)?.label}
              </option>
            ))}
          {localModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        {spec.efforts && (
          <select
            className="select"
            style={{ maxWidth: 96 }}
            title="How long the model is allowed to reason before answering"
            value={settings.aiEffort ?? ''}
            onChange={(e) => useStore.getState().setSettings({ aiEffort: e.target.value })}
          >
            <option value="">Effort: auto</option>
            {spec.efforts.map((level) => (
              <option key={level} value={level}>
                Effort: {level}
              </option>
            ))}
          </select>
        )}

      </div>

      {showPlans && (
        <div className="chat-list">
          <PlanHistory
            plans={plans}
            activeId={plan?.id}
            onOpen={(chosen) => {
              useStore.getState().setPlan(chosen)
              setShowPlans(false)
            }}
          />
        </div>
      )}

      {showChats && (
        <div className="chat-list">
          {!chats.length && (
            <p className="faint" style={{ padding: 8, fontSize: 11 }}>
              No saved conversations yet.
            </p>
          )}
          {chats.map((chat) => (
            <div key={chat.id} className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}>
              <button
                className="chat-open"
                onClick={() => {
                  void useStore.getState().switchChat(chat.id)
                  setShowChats(false)
                }}
              >
                <span className="chat-title">{chat.title}</span>
                <span className="faint chat-meta">{chat.messageCount} msg</span>
              </button>
              <button
                className="icon-btn"
                title="Delete this conversation"
                onClick={() => void useStore.getState().deleteChat(chat.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {provider && !provider.available && (
        <div className="ai-warning">
          <TriangleAlert size={13} />
          <span>
            <b>
              {providerState(provider) === 'needs-key'
                ? `${provider.label} needs an API key.`
                : `${provider.label} CLI not found.`}
            </b>{' '}
            {provider.hint}
          </span>
        </div>
      )}

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <Bot size={26} className="faint" />
            <p className="faint">
              The assistant runs <code>{settings.aiProvider}</code> in{' '}
              <b>{root ? basename(root) : 'no folder'}</b> with full project access. Edits it makes
              appear here as reviewable diffs.
            </p>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                className="ai-suggestion"
                onClick={() => {
                  setInput(suggestion)
                  inputRef.current?.focus()
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}

        {plan && plan.status !== 'rejected' && (
          <PlanCard
            plan={plan}
            running={running}
            onApprove={() => void approvePlan()}
            onReject={() => useStore.getState().discardPlan()}
            onToggleStep={(id) =>
              useStore.getState().setPlan({
                ...plan,
                steps: plan.steps.map((step) =>
                  step.id === id
                    ? { ...step, status: step.status === 'skipped' ? 'pending' : 'skipped' }
                    : step,
                ),
              })
            }
          />
        )}
      </div>

      <div className="ai-composer">
        {autoRun && <AutoRunStrip run={autoRun} />}
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((file) => (
              <span key={file} className="chip">
                <FileCode2 size={11} />
                {basename(file)}
                <button onClick={() => setAttachments((a) => a.filter((f) => f !== file))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          value={input}
          rows={3}
          placeholder={
            root
              ? `Ask ${provider?.label ?? 'the assistant'} to build, explain or refactor…`
              : 'Open a folder to start'
          }
          disabled={!root}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          onPaste={(e) => void pasteImages(e)}
        />

        <div className="ai-composer-actions">
          <button
            className="btn ghost sm"
            title="Attach the active file as context"
            disabled={!activeFile}
            onClick={() =>
              activeFile &&
              setAttachments((a) => (a.includes(activeFile) ? a : [...a, activeFile]))
            }
          >
            <Paperclip size={12} />
            {activeFile ? basename(activeFile) : 'No file'}
          </button>

          <select
            className="select"
            style={{ maxWidth: 132 }}
            value={settings.aiPermissionMode}
            onChange={(e) =>
              useStore.getState().setSettings({
                aiPermissionMode: e.target.value as typeof settings.aiPermissionMode,
              })
            }
            title="How much the assistant may change on its own"
          >
            <option value="acceptEdits">Auto-edit</option>
            <option value="plan">Plan only</option>
            <option value="default">Ask first</option>
            <option value="bypassPermissions">Full access</option>
          </select>

          <label
            className={`ai-plan-toggle ${planningEnabled ? 'on' : ''}`}
            title="Produce a plan for approval before changing any files"
          >
            <input
              type="checkbox"
              checked={planningEnabled}
              onChange={(e) => setPlanningEnabled(e.target.checked)}
              disabled={settings.aiAutoRun}
            />
            Plan first
          </label>

          <label
            className={`ai-plan-toggle ${settings.aiAutoRun ? 'on' : ''}`}
            title={
              'Keep working without stopping between turns — until the tests pass, ' +
              'or something genuinely needs you. This spends tokens unattended; ' +
              'Stop ends it at any point.'
            }
          >
            <input
              type="checkbox"
              checked={settings.aiAutoRun === true}
              onChange={(e) => useStore.getState().setSettings({ aiAutoRun: e.target.checked })}
            />
            Keep going
          </label>

          {/* Send and Stop are pushed right by `margin-left: auto` in the
              stylesheet rather than by a flexible spacer — a spacer competes
              with wrapping and strands the button on a line of its own. */}
          {running ? (
            <button className="btn sm" onClick={stop}>
              <CircleStop size={12} /> Stop
            </button>
          ) : (
            <button
              className="btn primary sm"
              onClick={() => void send()}
              disabled={!input.trim() || !root}
            >
              <ArrowUp size={12} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * What an unattended run looks like while it is running.
 *
 * The whole point of the mode is that nobody is watching each turn, so the one
 * thing this has to answer at a glance is "is it still getting anywhere" — the
 * turn count, the stage, and how close the stall guard is to ending it. A
 * spinner would say none of that.
 */
function AutoRunStrip({ run }: { run: AutoRunState }) {
  const stage =
    run.stage === 'verifying'
      ? 'running the tests'
      : run.stage === 'manual'
        ? 'writing the manual checks'
        : 'working'

  return (
    <div className="ai-auto-strip">
      <Repeat size={11} />
      <span className="ai-auto-stage">
        Turn {run.iteration + 1}
        {run.maxIterations > 0 && ` of ${run.maxIterations}`} — {stage}
      </span>
      {run.verification?.state === 'failed' && (
        <span className="ai-auto-warn">
          {run.verification.failed} failing
        </span>
      )}
      {run.idleTurns > 0 && (
        <span className="ai-auto-warn">
          {run.idleTurns} turn{run.idleTurns === 1 ? '' : 's'} with no changes
        </span>
      )}
    </div>
  )
}

function MessageView({ message }: { message: AiMessage }) {
  const root = useStore((s) => s.root) ?? ''

  if (message.role === 'user') {
    return (
      <div className="ai-msg user">
        <div className="ai-bubble">{message.parts.map((p) => p.text).join('\n')}</div>
      </div>
    )
  }

  return (
    <div className="ai-msg assistant fade-in">
      <div className="ai-msg-head">
        <Bot size={13} style={{ color: 'var(--accent)' }} />
        <span className="faint" style={{ fontSize: 11 }}>
          {message.provider === 'codex' ? 'Codex' : 'Claude'}
        </span>
        {message.running && <Loader2 size={12} className="spin" style={{ color: 'var(--accent)' }} />}
        {typeof message.costUsd === 'number' && message.costUsd > 0 && (
          <span className="chip" style={{ marginLeft: 'auto' }}>
            ${message.costUsd.toFixed(4)}
          </span>
        )}
      </div>

      {groupParts(message.parts).map((group, i) => {
        if (group.kind === 'text') {
          return (
            <div className="ai-text" key={i}>
              <Markdown content={group.parts.map((p) => p.text).join('')} />
            </div>
          )
        }
        if (group.kind === 'thinking') {
          return (
            <Collapsible
              key={i}
              icon={Brain}
              title="Thinking"
              body={group.parts.map((p) => p.text).join('\n')}
            />
          )
        }
        if (group.kind === 'tool') return <CommandGroup key={i} parts={group.parts} />
        if (group.kind === 'error') {
          return (
            <div className="ai-error" key={i}>
              <TriangleAlert size={13} />
              <span>{group.parts.map((p) => p.text).join('\n')}</span>
            </div>
          )
        }
        return (
          <Collapsible
            key={i}
            icon={Terminal}
            title="CLI output"
            body={group.parts.map((p) => p.text).join('\n')}
            muted
          />
        )
      })}

      {message.changes.length > 0 && (
        <div className="ai-changes">
          {/*
            One line per file with its own +/- counts. The full diff cards are
            behind "Review all" — when six files change, six expanded cards is a
            wall, and the counts are what tells you which one to open.
          */}
          {message.changes.map((change) => (
            <ChangeLine key={change.path} change={change} root={root} />
          ))}
          {message.changes.length > 1 && (
            <button
              className="ai-review-all"
              onClick={() => message.changes.forEach((c) => openChangeDiff(c, root))}
            >
              Review all {message.changes.length} files
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function openChangeDiff(
  change: { path: string; before: string; after: string },
  root: string,
) {
  import('@/lib/language').then(({ languageForPath }) => {
    useStore.getState().openTab({
      id: `diff:ai:${change.path}`,
      kind: 'diff',
      title: `${basename(change.path)} (AI)`,
      subtitle: relative(root, change.path),
      path: change.path,
      diff: {
        before: change.before,
        after: change.after,
        language: languageForPath(change.path),
        targetPath: change.path,
      },
    })
  })
}

function Collapsible({
  icon: Icon,
  title,
  body,
  muted,
}: {
  icon: typeof Brain
  title: string
  body: string
  muted?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`ai-collapsible ${muted ? 'muted-block' : ''}`}>
      <button onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        {title}
      </button>
      {open && <pre className="mono">{body}</pre>}
    </div>
  )
}

function ToolCall({
  name,
  input,
  result,
  ok,
}: {
  name: string
  input: unknown
  result?: string
  ok?: boolean
}) {
  const [open, setOpen] = useState(false)
  const summary = summariseToolInput(name, input)

  return (
    <div className={`ai-tool ${ok === false ? 'failed' : ''}`}>
      <button onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="ai-tool-name">{name}</span>
        <span className="ai-tool-summary mono">{summary}</span>
        {result === undefined && <Loader2 size={11} className="spin faint" />}
      </button>
      {open && (
        <div className="ai-tool-detail">
          <pre className="mono">{JSON.stringify(input, null, 2)}</pre>
          {result && <pre className="mono result">{result.slice(0, 4000)}</pre>}
        </div>
      )}
    </div>
  )
}

function summariseToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  if (typeof record.command === 'string') return record.command.slice(0, 90)
  if (typeof record.file_path === 'string') return basename(record.file_path)
  if (typeof record.path === 'string') return basename(record.path)
  if (typeof record.pattern === 'string') return String(record.pattern).slice(0, 60)
  if (typeof record.description === 'string') return String(record.description).slice(0, 70)
  if (Array.isArray(record.files)) return record.files.map((f) => basename(String(f))).join(', ')
  return ''
}

/** Bridges main-process AI stream events into the message list. */
/**
 * Runs the project's suite and writes the result onto a plan.
 *
 * Looked up by id rather than captured, because the user may have moved on to
 * another plan by the time the suite finishes, and writing this result onto
 * whatever is on screen would attribute one plan's tests to another.
 */
async function runVerification(planId: string, root: string) {
  const patch = (verification: Plan['verification']) =>
    useStore.getState().patchPlan(planId, (plan) => ({ ...plan, verification }))

  patch({
    state: 'running',
    framework: '',
    passed: 0,
    failed: 0,
    total: 0,
    failures: [],
    durationMs: 0,
    ranAt: Date.now(),
  })

  const { verifyPlan } = await import('@/lib/planVerify')
  patch(await verifyPlan(root))
}

function useAiEvents(
  modeRef: { current: 'chat' | 'plan' | 'execute' },
  requestRef: { current: string },
  autoRef: { current: AutoRunState | null },
  continueRef: { current: ((prompt: string) => Promise<void>) | null },
) {
  // Reset at the start of each turn by the auto-run branch below.
  const changedRef = useRef(0)

  useEffect(() => {
    const unsubscribe = window.nova.ai.onEvent((raw) => {
      const event = raw as AiEvent
      const store = useStore.getState()
      // Events are buffered in the main process until `ai:ack`, by which point
      // the message already carries its runId — so an unmatched event belongs to
      // another consumer (an Explain run) and must not touch the conversation.
      /*
       * Release the composer first, before anything can decide not to handle
       * this event.
       *
       * The message a run belongs to is not guaranteed to still be there when
       * the run ends — switching chats replaces the whole list — and the
       * `done` was previously dropped along with it, leaving `aiRunning` true
       * for the rest of the session. Every prompt after that was silently
       * discarded by the guard in `send`, which looks exactly like the
       * assistant having stopped answering. Only this console's own run counts,
       * so an Explain or Tutorial run finishing cannot release a chat turn that
       * is still going.
       */
      if (event.type === 'done' && event.runId === store.activeRunId) {
        useStore.setState({ activeRunId: null, aiRunning: false })
      }

      const target = [...store.messages].reverse().find((m) => m.runId === event.runId)
      if (!target) return
      const id = target.id

      switch (event.type) {
        case 'session':
          if (store.settings.aiProvider) store.setSession(store.settings.aiProvider, event.sessionId)
          return
        case 'assistant-text':
          if (id) store.patchMessage(id, (m) => appendText(m, 'text', event.text))
          // While executing, the agent's own `STEP n DONE` markers drive the
          // checklist, so the card updates as work lands rather than at the end.
          if (modeRef.current === 'execute' && store.plan) {
            const advanced = applyProgress(store.plan, event.text)
            if (advanced !== store.plan) store.setPlan(advanced)
          }
          return
        case 'thinking':
          if (id) store.patchMessage(id, (m) => appendText(m, 'thinking', event.text))
          return
        case 'log':
          if (id) store.patchMessage(id, (m) => appendText(m, 'log', event.text))
          return
        case 'error':
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              parts: [...m.parts, { kind: 'error', text: event.message }],
            }))
          return
        case 'tool-use':
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              parts: [
                ...m.parts,
                { kind: 'tool', text: '', id: event.id, toolName: event.name, toolInput: event.input },
              ],
            }))
          return
        case 'tool-result':
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              parts: m.parts.map((p) =>
                p.kind === 'tool' && p.id === event.id
                  ? { ...p, toolResult: event.preview, toolOk: event.ok }
                  : p,
              ),
            }))
          return
        case 'file-change': {
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              changes: [...m.changes.filter((c) => c.path !== event.change.path), event.change],
            }))

          // Attach it to the plan being executed as well as to the message. The
          // message is the narrative and scrolls away; the plan is the record
          // someone reads later to see what carrying it out actually cost.
          const running = store.plan
          if (modeRef.current === 'execute' && running) {
            const { path, additions, deletions, kind } = event.change
            store.setPlan({
              ...running,
              edits: [
                ...(running.edits ?? []).filter((e) => e.path !== path),
                { path, additions, deletions, kind },
              ],
            })
          }

          /*
           * Open what the agent just touched, so the developer watches the code
           * change rather than reading a summary of it afterwards.
           *
           * Two deliberate limits. A deleted file is skipped — opening a tab on
           * something that no longer exists is a broken tab. And the tab is
           * opened in the background: stealing focus mid-turn would move the
           * editor out from under someone who is reading, and a five-file edit
           * would yank them through five files in as many seconds. The tab
           * appears, the newest is revealed, and the choice of where to look
           * stays with the person.
           */
          if (store.settings.aiFollowEdits !== false && event.change.kind !== 'delete') {
            void store.openFile(event.change.path, { background: true })
          }

          // What the stall guard counts. Tracked per run rather than read back
          // off the message, because a turn that edits and then reverts a file
          // still moved, and the transcript would not show it.
          changedRef.current += 1

          void store.refreshGit()
          store.bumpTree()
          return
        }
        case 'done': {
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              running: false,
              costUsd: event.costUsd ?? m.costUsd,
            }))
          store.setAiRunning(false)
          void store.refreshGit()

          const finished = useStore.getState().messages.find((m) => m.id === id)
          const text = finished?.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n') ?? ''

          if (modeRef.current === 'plan') {
            // A plan that cannot be parsed is not turned into an approval gate:
            // showing an empty checklist would be worse than showing the prose
            // the agent actually wrote, which is already in the transcript.
            const parsed = parsePlan(text, requestRef.current)
            if (parsed) {
              // Record what this one replaced, so the history can show a second
              // attempt as a revision rather than as an unrelated plan.
              const previous = store.plans[store.plans.length - 1]
              store.setPlan(
                previous && previous.id !== parsed.id
                  ? { ...parsed, supersedes: previous.id }
                  : parsed,
              )
            }
          } else if (modeRef.current === 'execute' && store.plan) {
            const advanced = applyProgress(store.plan, text)
            const settled = {
              ...advanced,
              steps: advanced.steps.map((step) =>
                step.status === 'running' ? { ...step, status: 'done' as const } : step,
              ),
            }
            const complete = settled.steps.every((x) => x.status !== 'pending')
            const executed = {
              ...settled,
              status: (complete ? 'complete' : settled.status) as Plan['status'],
            }
            store.setPlan(executed)

            // The agent has said it is finished; the suite is what decides
            // whether that is true. Fire and forget — the card fills in when the
            // run lands, and the transcript is not held up waiting for it.
            if (complete && store.root) void runVerification(executed.id, store.root)
          }

          modeRef.current = 'chat'
          // The conversation is only worth saving once a turn has completed.
          void store.persistChat()

          if (autoRef.current) void driveAutoRun(text)
          return
        }
      }
    })

    /**
     * One step of the automatic run.
     *
     * Everything that decides *what* happens next is in `@/lib/autoRun` and
     * tested there; this is only the part that cannot be pure — running the
     * suite, writing to the transcript, and starting the next turn.
     */
    async function driveAutoRun(text: string) {
      const state = autoRef.current
      if (!state) return

      const store = useStore.getState()
      const filesChanged = changedRef.current
      changedRef.current = 0

      // A turn the user cancelled is not a turn the loop should react to —
      // pressing Stop has to mean stopped, not "stopped for one turn".
      if (store.aiAutoCancelled) {
        autoRef.current = null
        store.setAiAutoCancelled(false)
        store.setAutoRun(null)
        return
      }

      // The verification step resolves a claim rather than consuming an agent
      // turn, so it must not be counted as one.
      const resolvingSuite = state.stage === 'verifying'

      let verification
      if (resolvingSuite) {
        const { verifyPlan } = await import('@/lib/planVerify')
        verification = store.root ? await verifyPlan(store.root) : undefined

        // A suite can run for minutes, and Stop during it must still mean
        // stopped. Without re-checking, the assignment below would put the run
        // back on its feet after the user had already ended it.
        if (!autoRef.current || useStore.getState().aiAutoCancelled) {
          autoRef.current = null
          useStore.getState().setAiAutoCancelled(false)
          useStore.getState().setAutoRun(null)
          return
        }
      }

      const decision = decideNext(state, { text, filesChanged, verification })
      const next = advance(state, decision, { filesChanged, verification }, !resolvingSuite)
      autoRef.current = next
      store.setAutoRun(next)

      if (decision.kind === 'verify') {
        // Verification needs a turn of its own so the suite result is what the
        // next decision sees. Re-enter with no new agent turn in between.
        await driveAutoRun('')
        return
      }

      if (decision.kind === 'stop') {
        autoRef.current = null
        store.addMessage({
          id: `s${Date.now()}`,
          role: 'assistant',
          parts: [{ kind: 'text', text: summariseStop(next) }],
          changes: [],
          createdAt: Date.now(),
        })
        void store.persistChat()
        return
      }

      await continueRef.current?.(decision.prompt)
    }

    return unsubscribe
  }, [])
}

/** What the transcript says when an automatic run ends. */
function summariseStop(state: AutoRunState): string {
  const turns = `${state.iteration} turn${state.iteration === 1 ? '' : 's'}`
  if (state.stage === 'complete') {
    const suite =
      state.verification?.state === 'passed'
        ? ` The suite passed (${state.verification.passed}/${state.verification.total}).`
        : state.verification?.state === 'unavailable'
          ? ' There was no automated suite to run.'
          : ''
    return `**Finished** after ${turns}.${suite} The manual checks are in the turn above.`
  }
  if (state.stage === 'blocked') {
    return `**Stopped after ${turns} — this needs you.**

${state.reason ?? ''}`
  }
  return `**Stopped after ${turns}.**

${state.reason ?? ''}`
}

/**
 * Collapses consecutive parts of the same kind into one group.
 *
 * Streaming produces many small parts; rendering each separately gives a
 * stuttering wall of one-line blocks. Grouping by adjacency keeps the order the
 * agent actually worked in while making the feed readable.
 */
function groupParts(parts: AiMessagePart[]): { kind: AiMessagePart['kind']; parts: AiMessagePart[] }[] {
  const groups: { kind: AiMessagePart['kind']; parts: AiMessagePart[] }[] = []
  for (const part of parts) {
    const last = groups[groups.length - 1]
    if (last && last.kind === part.kind) last.parts.push(part)
    else groups.push({ kind: part.kind, parts: [part] })
  }
  return groups
}

function appendText(message: AiMessage, kind: 'text' | 'thinking' | 'log', text: string): AiMessage {
  const last = message.parts[message.parts.length - 1]
  // Streaming deltas of the same kind merge into one block.
  if (last && last.kind === kind) {
    const parts = [...message.parts]
    parts[parts.length - 1] = { ...last, text: `${last.text}${kind === 'text' ? '' : '\n'}${text}` }
    return { ...message, parts }
  }
  return { ...message, parts: [...message.parts, { kind, text }] }
}
