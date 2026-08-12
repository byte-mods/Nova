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
  Plus,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { AiEvent, AiProvider } from '@shared/types'
import { useStore, type AiMessage } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import Markdown from '@/components/editor/Markdown'
import ChangeCard from './ChangeCard'

export default function AiConsole() {
  const width = useStore((s) => s.settings.aiWidth)
  const messages = useStore((s) => s.messages)
  const running = useStore((s) => s.aiRunning)
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => s.settings)
  const root = useStore((s) => s.root)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const provider = providers.find((p) => p.id === settings.aiProvider)
  const activeFile = tabs.find((t) => t.id === activeTabId)?.path

  useAiEvents()

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const prompt = input.trim()
    if (!prompt || running || !root) return
    const store = useStore.getState()

    store.addMessage({
      id: `u${Date.now()}`,
      role: 'user',
      parts: [{ kind: 'text', text: prompt }],
      changes: [],
      createdAt: Date.now(),
    })
    setInput('')

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

    const { runId: id } = await window.nova.ai.start({
      provider: settings.aiProvider,
      prompt,
      cwd: root,
      model: settings.aiModel || undefined,
      resumeSessionId: store.aiSessionId[settings.aiProvider],
      attachments,
      permissionMode: settings.aiPermissionMode,
    })
    setRunId(id)
    setAttachments([])
    store.patchMessage(assistantId, (m) => ({ ...m, runId: id }))
    // Tell the main process the message can now receive this run's events.
    await window.nova.ai.ack(id)
  }

  const stop = () => {
    if (runId) void window.nova.ai.cancel(runId)
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
    <div className="ai-console" style={{ width }}>
      <div className="ai-header">
        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>AI Console</span>

        <select
          className="select"
          style={{ marginLeft: 'auto', maxWidth: 130 }}
          value={settings.aiProvider}
          onChange={(e) =>
            useStore.getState().setSettings({ aiProvider: e.target.value as AiProvider })
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
          className="icon-btn"
          title="New conversation"
          onClick={() => useStore.getState().clearConversation()}
        >
          <Plus size={15} />
        </button>
      </div>

      {provider && !provider.available && (
        <div className="ai-warning">
          <TriangleAlert size={13} />
          <span>
            <b>{provider.label} CLI not found.</b> {provider.hint}
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
      </div>

      <div className="ai-composer">
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

          <span style={{ flex: 1 }} />

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

      {message.parts.map((part, i) => {
        if (part.kind === 'text') {
          return (
            <div className="ai-text" key={i}>
              <Markdown content={part.text} />
            </div>
          )
        }
        if (part.kind === 'thinking') return <Collapsible key={i} icon={Brain} title="Thinking" body={part.text} />
        if (part.kind === 'tool')
          return (
            <ToolCall
              key={i}
              name={part.toolName ?? 'tool'}
              input={part.toolInput}
              result={part.toolResult}
              ok={part.toolOk}
            />
          )
        if (part.kind === 'error')
          return (
            <div className="ai-error" key={i}>
              <TriangleAlert size={13} />
              <span>{part.text}</span>
            </div>
          )
        return (
          <Collapsible key={i} icon={Terminal} title="CLI output" body={part.text} muted />
        )
      })}

      {message.changes.length > 0 && (
        <div className="ai-changes">
          <div className="ai-changes-head">
            <b>{message.changes.length} file{message.changes.length === 1 ? '' : 's'} changed</b>
            <button
              className="btn ghost sm"
              onClick={() => message.changes.forEach((c) => openChangeDiff(c, root))}
            >
              Review all
            </button>
          </div>
          {message.changes.map((change) => (
            <ChangeCard key={change.path} change={change} root={root} />
          ))}
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
function useAiEvents() {
  useEffect(() => {
    const unsubscribe = window.nova.ai.onEvent((raw) => {
      const event = raw as AiEvent
      const store = useStore.getState()
      // Events are buffered in the main process until `ai:ack`, by which point
      // the message already carries its runId — so an unmatched event belongs to
      // another consumer (an Explain run) and must not touch the conversation.
      const target = [...store.messages].reverse().find((m) => m.runId === event.runId)
      if (!target) return
      const id = target.id

      switch (event.type) {
        case 'session':
          if (store.settings.aiProvider) store.setSession(store.settings.aiProvider, event.sessionId)
          return
        case 'assistant-text':
          if (id) store.patchMessage(id, (m) => appendText(m, 'text', event.text))
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
        case 'file-change':
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              changes: [...m.changes.filter((c) => c.path !== event.change.path), event.change],
            }))
          void store.refreshGit()
          store.bumpTree()
          return
        case 'done':
          if (id)
            store.patchMessage(id, (m) => ({
              ...m,
              running: false,
              costUsd: event.costUsd ?? m.costUsd,
            }))
          store.setAiRunning(false)
          void store.refreshGit()
          return
      }
    })
    return unsubscribe
  }, [])
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
