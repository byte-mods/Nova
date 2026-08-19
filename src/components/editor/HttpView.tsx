/**
 * The request client: run the requests in a `.http` file and read what comes
 * back.
 *
 * Requests sit on the left, the selected one's result on the right. The result
 * pane changes shape with the protocol, because the protocols genuinely differ:
 * a REST call has one response, a WebSocket has a conversation, and a gRPC
 * service has to be discovered before it can be called. What does not change is
 * that results are kept per request for the life of the tab, so you can flip
 * between two requests and compare — which is most of what this tool is used
 * for in practice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Cookie,
  History,
  Loader2,
  FlaskConical,
  Play,
  Plug,
  Send,
  Server,
  Square,
  Trash2,
} from 'lucide-react'
import { useStore } from '@/state/store'
import type {
  GraphqlSchema,
  GrpcServices,
  HistoryEntry,
  MockStatus,
  RunResult,
  RunStep,
  HttpEnvironments,
  HttpFile,
  HttpRequest,
  HttpResponse,
  StoredCookie,
  StreamMessage,
  StreamStatus,
} from '@shared/http'

/** A live or finished stream, with everything it has said so far. */
interface StreamView {
  status: StreamStatus
  messages: StreamMessage[]
}

type SidePanel = 'result' | 'schema' | 'methods' | 'history' | 'cookies' | 'tests'

export default function HttpView({ path: file }: { path: string }) {
  const buffer = useStore((s) => s.buffers[file])
  const [parsed, setParsed] = useState<HttpFile | null>(null)
  const [environments, setEnvironments] = useState<HttpEnvironments>({})
  const [environment, setEnvironment] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, HttpResponse>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [panel, setPanel] = useState<SidePanel>('result')

  const [streams, setStreams] = useState<Record<string, StreamView>>({})
  /** The stream each request most recently opened, so the pane can find it. */
  const [streamOf, setStreamOf] = useState<Record<string, string>>({})
  const [schemas, setSchemas] = useState<Record<string, GraphqlSchema>>({})
  const [services, setServices] = useState<Record<string, GrpcServices>>({})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [cookies, setCookies] = useState<StoredCookie[]>([])
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  /** Steps arrive as the suite goes, so a long run fills in rather than waits. */
  const [liveSteps, setLiveSteps] = useState<RunStep[]>([])
  const [suiteRunning, setSuiteRunning] = useState(false)
  const [mock, setMock] = useState<MockStatus | null>(null)

  // Reparse whenever the buffer changes, so editing the file updates the list
  // without a save. The parse is cheap and purely textual.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.nova.http.parse(file)
      if (!cancelled) {
        setParsed(result)
        setSelected((current) => current ?? result.requests[0]?.id ?? null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, buffer?.savedContent])

  useEffect(() => {
    void (async () => {
      const envs = await window.nova.http.environments(file)
      setEnvironments(envs)
      setEnvironment((current) => current ?? Object.keys(envs)[0] ?? null)
    })()
  }, [file])

  // Streams are owned by the main process and push as they go, so the panel
  // subscribes once rather than polling. Messages append; status replaces.
  useEffect(() => {
    const offMessage = window.nova.http.onStreamMessage((message) => {
      setStreams((current) => {
        const existing = current[message.streamId]
        if (!existing) return current
        return {
          ...current,
          [message.streamId]: { ...existing, messages: [...existing.messages, message] },
        }
      })
    })
    const offStatus = window.nova.http.onStreamStatus((status) => {
      setStreams((current) => ({
        ...current,
        [status.streamId]: { status, messages: current[status.streamId]?.messages ?? [] },
      }))
    })
    return () => {
      offMessage()
      offStatus()
    }
  }, [])

  useEffect(() => {
    const offStep = window.nova.http.onRunStep((event) => {
      if (event.file !== file) return
      setLiveSteps((current) => [...current, event.step])
    })
    return offStep
  }, [file])

  useEffect(() => {
    void window.nova.http.mockStatus().then(setMock)
  }, [])

  const request = useMemo(
    () => parsed?.requests.find((r) => r.id === selected) ?? null,
    [parsed, selected],
  )

  const runOne = useCallback(
    async (target: HttpRequest) => {
      setSelected(target.id)
      setPanel('result')
      setRunning(target.id)
      try {
        if (target.protocol === 'websocket' || target.protocol === 'sse') {
          const streamId = await window.nova.http.openStream(file, target.id, environment)
          setStreamOf((current) => ({ ...current, [target.id]: streamId }))
        } else if (target.protocol === 'grpc') {
          const streamId = await window.nova.http.grpcCall(file, target.id, environment)
          setStreamOf((current) => ({ ...current, [target.id]: streamId }))
        } else {
          const response = await window.nova.http.send(file, target.id, environment)
          setResponses((current) => ({ ...current, [target.id]: response }))
        }
      } catch (err) {
        useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
      } finally {
        setRunning(null)
      }
    },
    [file, environment],
  )

  const loadSchema = useCallback(async () => {
    if (!request) return
    setPanel('schema')
    setSchemas((current) => ({ ...current, [request.id]: { types: [], error: undefined } }))
    const schema = await window.nova.http.graphqlSchema(file, request.id, environment)
    setSchemas((current) => ({ ...current, [request.id]: schema }))
  }, [file, request, environment])

  const loadServices = useCallback(async () => {
    if (!request) return
    setPanel('methods')
    const found = await window.nova.http.grpcServices(file, request.id, environment)
    setServices((current) => ({ ...current, [request.id]: found }))
  }, [file, request, environment])

  const openHistory = useCallback(async () => {
    setPanel('history')
    setHistory(await window.nova.http.history(file))
  }, [file])

  const openCookies = useCallback(async () => {
    setPanel('cookies')
    setCookies(await window.nova.http.cookies())
  }, [])

  const runSuite = useCallback(async () => {
    setPanel('tests')
    setSuiteRunning(true)
    setLiveSteps([])
    setRunResult(null)
    try {
      setRunResult(await window.nova.http.run(file, environment))
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSuiteRunning(false)
    }
  }, [file, environment])

  const toggleMock = useCallback(async () => {
    if (mock?.running) {
      setMock(await window.nova.http.mockStop())
      return
    }
    const spec = await window.nova.app.openFileDialog({
      filters: [{ name: 'OpenAPI spec', extensions: ['yaml', 'yml', 'json'] }],
    })
    if (!spec) return
    const status = await window.nova.http.mockStart(spec)
    setMock(status)
    if (status.error) useStore.getState().notify(status.error, 'error')
    else useStore.getState().notify(`Mock serving ${status.url}`, 'info')
  }, [mock])

  const environmentNames = useMemo(() => Object.keys(environments), [environments])
  const stream = selected ? streams[streamOf[selected] ?? ''] : undefined
  const response = selected ? responses[selected] : undefined

  if (!parsed) {
    return (
      <div className="empty-state">
        <Loader2 size={16} className="spin faint" />
      </div>
    )
  }

  return (
    <div className="http-view">
      <div className="http-toolbar">
        <Send size={13} className="faint" />
        <span className="faint" style={{ fontSize: 11.5 }}>
          {parsed.requests.length} request{parsed.requests.length === 1 ? '' : 's'}
        </span>

        {environmentNames.length > 0 && (
          <label className="http-env">
            Environment
            <select value={environment ?? ''} onChange={(e) => setEnvironment(e.target.value || null)}>
              <option value="">none</option>
              {environmentNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <span style={{ flex: 1 }} />

        {request?.protocol === 'graphql' && (
          <button
            className="link-btn"
            title="Ask this GraphQL server to describe its schema"
            onClick={() => void loadSchema()}
          >
            Schema
          </button>
        )}
        {request?.protocol === 'grpc' && (
          <button
            className="link-btn"
            title="List the gRPC methods this server offers"
            onClick={() => void loadServices()}
          >
            Methods
          </button>
        )}
        <button
          className="link-btn"
          title="Send every request in this file in order, and check its assertions"
          onClick={() => void runSuite()}
          disabled={suiteRunning}
        >
          {suiteRunning ? <Loader2 size={11} className="spin" /> : <FlaskConical size={11} />} Run all
        </button>
        <button
          className={`link-btn ${mock?.running ? 'active' : ''}`}
          title={
            mock?.running
              ? `Stop the mock server on port ${mock.port}`
              : 'Serve an OpenAPI spec locally, so a client can be built before the backend is'
          }
          onClick={() => void toggleMock()}
        >
          <Server size={11} /> {mock?.running ? `Mock :${mock.port}` : 'Mock'}
        </button>
        <button
          className="link-btn"
          title="Every request run for this file, newest first"
          onClick={() => void openHistory()}
        >
          <History size={11} /> History
        </button>
        <button
          className="link-btn"
          title="What the cookie jar is holding for this project"
          onClick={() => void openCookies()}
        >
          <Cookie size={11} /> Cookies
        </button>
      </div>

      {parsed.errors.length > 0 && (
        <div className="http-errors">
          <AlertTriangle size={12} />
          <div>
            {parsed.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        </div>
      )}

      <div className="http-body">
        <div className="http-list">
          {!parsed.requests.length && <EmptyHint />}
          {parsed.requests.map((item) => (
            <RequestRow
              key={item.id}
              request={item}
              active={selected === item.id}
              busy={running === item.id}
              response={responses[item.id]}
              stream={streams[streamOf[item.id] ?? '']?.status}
              onSelect={() => {
                setSelected(item.id)
                setPanel('result')
              }}
              onRun={() => void runOne(item)}
            />
          ))}
        </div>

        <div className="http-response">
          {panel === 'history' && (
            <HistoryPanel
              entries={history}
              onClear={async () => {
                await window.nova.http.historyClear()
                setHistory([])
              }}
              onOpen={async (entry) => {
                const body = await window.nova.http.historyBody(entry.id)
                if (!body) {
                  useStore.getState().notify('That response has been trimmed from history.', 'info')
                  return
                }
                setResponses((current) => ({ ...current, [entry.requestId]: body }))
                setSelected(entry.requestId)
                setPanel('result')
              }}
            />
          )}

          {panel === 'cookies' && (
            <CookiePanel
              cookies={cookies}
              onClear={async () => {
                await window.nova.http.clearCookies()
                setCookies([])
              }}
            />
          )}

          {panel === 'tests' && (
            <RunPanel
              result={runResult}
              live={liveSteps}
              running={suiteRunning}
              onOpen={(step) => {
                setSelected(step.requestId)
                setPanel('result')
              }}
            />
          )}

          {panel === 'schema' && request && <SchemaPanel schema={schemas[request.id]} />}

          {panel === 'methods' && request && <MethodsPanel services={services[request.id]} />}

          {panel === 'result' && (
            <>
              {request && isStreaming(request) ? (
                <StreamPanel
                  request={request}
                  stream={stream}
                  onSend={(data) => stream && void window.nova.http.sendStream(stream.status.streamId, data)}
                  onEnd={() => stream && void window.nova.http.closeStream(stream.status.streamId)}
                  onCancel={() => stream && void window.nova.http.cancelStream(stream.status.streamId)}
                />
              ) : response ? (
                <ResponseView response={response} />
              ) : (
                <div className="empty-state">
                  <span className="faint">Run a request to see its response.</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** WebSocket, SSE and gRPC all produce a message log rather than one body. */
function isStreaming(request: HttpRequest): boolean {
  return request.protocol === 'websocket' || request.protocol === 'sse' || request.protocol === 'grpc'
}

function EmptyHint() {
  return (
    <p className="faint" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.7 }}>
      No requests found. Write one like:
      <br />
      <code className="mono">GET https://api.example.com/users</code>
      <br />
      <br />
      Other protocols use their own verb:
      <br />
      <code className="mono">GRAPHQL https://api.example.com/graphql</code>
      <br />
      <code className="mono">WEBSOCKET wss://api.example.com/socket</code>
      <br />
      <code className="mono">SSE https://api.example.com/events</code>
      <br />
      <code className="mono">GRPC localhost:50051 pkg.Service/Method</code>
    </p>
  )
}

function RequestRow({
  request,
  active,
  busy,
  response,
  stream,
  onSelect,
  onRun,
}: {
  request: HttpRequest
  active: boolean
  busy: boolean
  response?: HttpResponse
  stream?: StreamStatus
  onSelect: () => void
  onRun: () => void
}) {
  return (
    <button className={`http-item ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className={`http-method m-${request.method.toLowerCase()} p-${request.protocol}`}>
        {request.method}
      </span>
      <span className="http-item-body">
        <span className="http-name">{request.name}</span>
        <span className="http-url mono">
          {request.url}
          {request.grpcMethod ? ` ${request.grpcMethod}` : ''}
        </span>
      </span>

      {stream && <span className={`http-status ${streamTone(stream)}`}>{stream.state}</span>}
      {!stream && response && (
        <span className={`http-status ${statusTone(response)}`}>
          {response.error ? '!' : response.status}
        </span>
      )}

      <span
        className="icon-btn"
        title={`Run (line ${request.line})`}
        onClick={(e) => {
          e.stopPropagation()
          onRun()
        }}
      >
        {busy ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
      </span>
    </button>
  )
}

/* ---------------- one-shot responses ---------------- */

function ResponseView({ response }: { response: HttpResponse }) {
  const [showHeaders, setShowHeaders] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const pretty = useMemo(() => prettify(response), [response])

  if (response.error) {
    return (
      <div className="http-response-inner">
        <div className="http-response-head error">
          <AlertTriangle size={13} />
          <span>Request failed</span>
          <span className="faint">{response.durationMs} ms</span>
        </div>
        <pre className="http-payload error">{response.error}</pre>
      </div>
    )
  }

  return (
    <div className="http-response-inner">
      <div className={`http-response-head ${statusTone(response)}`}>
        <strong>
          {response.status} {response.statusText}
        </strong>
        <span className="faint">
          <Clock size={10} /> {response.durationMs} ms
        </span>
        <span className="faint">{formatBytes(response.size)}</span>
        <button
          className="link-btn"
          title="Show the response headers and any redirects it went through"
          onClick={() => setShowHeaders((v) => !v)}
        >
          <ChevronDown size={10} /> {Object.keys(response.headers).length} headers
        </button>
        {response.sent && (
          <button
            className="link-btn"
            title="Show the request as it was actually sent, with credentials redacted"
            onClick={() => setShowRequest((v) => !v)}
          >
            <ChevronDown size={10} /> request
          </button>
        )}
        {response.redirects.length > 0 && (
          <span className="faint">
            {response.redirects.length} redirect{response.redirects.length === 1 ? '' : 's'}
          </span>
        )}
        {response.cookies.length > 0 && (
          <span className="faint">
            <Cookie size={10} /> {response.cookies.length}
          </span>
        )}
      </div>

      {/* A GraphQL failure comes back as a 200 with errors, so it needs saying
          loudly — the status line above says the request succeeded. */}
      {response.graphqlErrors?.length ? (
        <div className="http-errors">
          <AlertTriangle size={12} />
          <div>
            {response.graphqlErrors.map((error, index) => (
              <div key={`${error}-${index}`}>{error}</div>
            ))}
          </div>
        </div>
      ) : null}

      {showRequest && response.sent && (
        <div className="http-headers mono">
          <div>
            <span className="http-header-name">{response.sent.method}</span> {response.sent.url}
          </div>
          {Object.entries(response.sent.headers).map(([name, value]) => (
            <div key={name}>
              <span className="http-header-name">{name}</span>: {value}
            </div>
          ))}
          {response.sent.body && <div style={{ whiteSpace: 'pre-wrap' }}>{response.sent.body}</div>}
        </div>
      )}

      {showHeaders && (
        <div className="http-headers mono">
          {response.redirects.map((hop) => (
            <div key={`${hop.from}-${hop.to}`}>
              <span className="http-header-name">{hop.status}</span> → {hop.to}
            </div>
          ))}
          {Object.entries(response.headers).map(([name, value]) => (
            <div key={name}>
              <span className="http-header-name">{name}</span>: {value}
            </div>
          ))}
        </div>
      )}

      <pre className="http-payload mono">{pretty}</pre>
    </div>
  )
}

/* ---------------- streams ---------------- */

function StreamPanel({
  request,
  stream,
  onSend,
  onEnd,
  onCancel,
}: {
  request: HttpRequest
  stream?: StreamView
  onSend: (data: string) => void
  onEnd: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)

  // A stream that is being watched should stay pinned to its newest message.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [stream?.messages.length])

  if (!stream) {
    return (
      <div className="empty-state">
        <span className="faint">
          Run this {request.protocol === 'grpc' ? 'call' : 'connection'} to start it.
        </span>
      </div>
    )
  }

  const open = stream.status.state === 'open'
  // Only a socket and a client-streaming gRPC call accept typed input; SSE is
  // one-directional and there is nowhere for the text to go.
  const canSend = open && request.protocol !== 'sse'

  return (
    <div className="http-response-inner">
      <div className={`http-response-head ${streamTone(stream.status)}`}>
        <Plug size={12} />
        <strong>{stream.status.state}</strong>
        <span className="faint mono">{stream.status.url}</span>
        <span className="faint">
          ↓ {stream.status.received} ↑ {stream.status.sent}
        </span>
        <span style={{ flex: 1 }} />
        {open && (
          <>
            <button
              className="link-btn"
              title="Stop sending, and wait for whatever the other side still has"
              onClick={onEnd}
            >
              End send
            </button>
            <button className="link-btn" title="Close this connection now" onClick={onCancel}>
              <Square size={10} /> Stop
            </button>
          </>
        )}
      </div>

      {stream.status.error && <pre className="http-payload error">{stream.status.error}</pre>}

      <div className="http-stream-log" ref={log}>
        {stream.messages.map((message, index) => (
          <div key={`${message.at}-${index}`} className={`http-stream-line d-${message.direction}`}>
            <span className="http-stream-mark">
              {message.direction === 'in' ? '←' : message.direction === 'out' ? '→' : '•'}
            </span>
            <div className="http-stream-body">
              {message.event && <span className="http-stream-event">{message.event}</span>}
              <pre className="mono">{message.data}</pre>
            </div>
            <span className="http-stream-time">{new Date(message.at).toLocaleTimeString()}</span>
          </div>
        ))}
        {!stream.messages.length && <span className="faint">No messages yet.</span>}
      </div>

      {canSend && (
        <form
          className="http-stream-compose"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            onSend(draft)
            setDraft('')
          }}
        >
          <textarea
            className="mono"
            rows={2}
            value={draft}
            placeholder={request.protocol === 'grpc' ? '{ "field": "value" }' : 'Message to send'}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn">
            <Send size={11} /> Send
          </button>
        </form>
      )}
    </div>
  )
}

/* ---------------- side panels ---------------- */

/**
 * A run's results: one row per request, with its assertions beneath it.
 *
 * Live steps are shown while the run is going and the finished result replaces
 * them, so a suite that takes thirty seconds is legible for all thirty rather
 * than blank and then complete.
 */
function RunPanel({
  result,
  live,
  running,
  onOpen,
}: {
  result: RunResult | null
  live: RunStep[]
  running: boolean
  onOpen: (step: RunStep) => void
}) {
  const steps = result?.steps ?? live
  const passed = result?.passed ?? live.reduce((n, s) => n + s.tests.filter((t) => t.passed).length, 0)
  const failed = result?.failed ?? live.reduce((n, s) => n + s.tests.filter((t) => !t.passed).length, 0)
  const broken = steps.filter((step) => step.error).length

  return (
    <div className="http-response-inner">
      <div className={`http-response-head ${failed || broken ? 'error' : passed ? 'ok' : ''}`}>
        {running ? <Loader2 size={12} className="spin" /> : <FlaskConical size={12} />}
        <strong>
          {passed} passed, {failed} failed
        </strong>
        {broken > 0 && <span className="faint">{broken} could not run</span>}
        {result && <span className="faint">{(result.durationMs / 1000).toFixed(2)}s</span>}
      </div>

      {result?.error && <pre className="http-payload error">{result.error}</pre>}

      <div className="http-schema">
        {!steps.length && !running && (
          <span className="faint">Nothing has run yet — “Run all” sends every request in order.</span>
        )}

        {steps.map((step, index) => (
          <div key={`${step.requestId}-${step.dataRow ?? 0}-${index}`} className="http-run-step">
            <button className="http-run-head" onClick={() => onOpen(step)}>
              <span className={`http-status ${stepTone(step)}`}>{step.error ? '!' : step.status || '—'}</span>
              <span className="http-item-body">
                <span className="http-name">
                  {step.name}
                  {step.dataRow !== undefined && <span className="http-badge">row {step.dataRow + 1}</span>}
                </span>
                <span className="http-url mono">{step.url}</span>
              </span>
              <span className="faint" style={{ fontSize: 10 }}>
                {step.durationMs} ms
              </span>
            </button>

            {step.error && <div className="http-run-error">{step.error}</div>}

            {step.tests.map((test, at) => (
              <div key={`${test.name}-${at}`} className={`http-run-test ${test.passed ? 'ok' : 'bad'}`}>
                <span>{test.passed ? '✓' : '✗'}</span>
                <span>{test.name}</span>
                {!test.passed && test.message && <span className="http-run-why">{test.message}</span>}
              </div>
            ))}

            {step.logs.map((line, at) => (
              <div key={`log-${at}`} className="http-run-log mono">
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>

      {result && Object.keys(result.variables).length > 0 && (
        <div className="http-headers mono">
          <div className="faint">Captured by scripts, and available to later requests:</div>
          {Object.entries(result.variables).map(([name, value]) => (
            <div key={name}>
              <span className="http-header-name">{name}</span>: {value.length > 80 ? `${value.slice(0, 80)}…` : value}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function stepTone(step: RunStep): string {
  if (step.error) return 'error'
  if (step.tests.some((test) => !test.passed)) return 'error'
  if (step.status >= 400) return 'warn'
  if (step.status >= 200 && step.status < 300) return 'ok'
  return ''
}

function SchemaPanel({ schema }: { schema?: GraphqlSchema }) {
  const [filter, setFilter] = useState('')

  if (!schema) {
    return (
      <div className="empty-state">
        <Loader2 size={14} className="spin faint" />
      </div>
    )
  }
  if (schema.error) {
    return <pre className="http-payload error">{schema.error}</pre>
  }

  const needle = filter.trim().toLowerCase()
  const types = needle
    ? schema.types.filter(
        (type) =>
          type.name.toLowerCase().includes(needle) ||
          type.fields.some((field) => field.name.toLowerCase().includes(needle)),
      )
    : schema.types

  return (
    <div className="http-response-inner">
      <div className="http-response-head">
        <strong>Schema</strong>
        <span className="faint">{schema.types.length} types</span>
        <input
          className="http-filter"
          value={filter}
          placeholder="Filter types and fields"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="http-schema">
        {types.map((type) => (
          <div key={type.name} className="http-schema-type">
            <div className="http-schema-name">
              <span className="faint">{type.kind.toLowerCase()}</span> {type.name}
              {type.name === schema.queryType && <span className="http-badge">query root</span>}
              {type.name === schema.mutationType && <span className="http-badge">mutation root</span>}
            </div>
            {type.fields.map((field) => (
              <div key={field.name} className="http-schema-field mono">
                {field.name}
                {field.args.length > 0 && (
                  <span className="faint">
                    ({field.args.map((arg) => `${arg.name}: ${arg.type}`).join(', ')})
                  </span>
                )}
                <span className="http-schema-fieldtype">: {field.type}</span>
              </div>
            ))}
          </div>
        ))}
        {!types.length && <span className="faint">Nothing matches “{filter}”.</span>}
      </div>
    </div>
  )
}

function MethodsPanel({ services }: { services?: GrpcServices }) {
  if (!services) {
    return (
      <div className="empty-state">
        <Loader2 size={14} className="spin faint" />
      </div>
    )
  }
  if (services.error) return <pre className="http-payload error">{services.error}</pre>

  return (
    <div className="http-response-inner">
      <div className="http-response-head">
        <strong>Methods</strong>
        <span className="faint">
          {services.methods.length} via {services.source}
        </span>
      </div>
      <div className="http-schema">
        {services.methods.map((method) => (
          <div key={method.path} className="http-schema-type">
            <div className="http-schema-name mono">
              {method.path}
              {method.clientStreaming && <span className="http-badge">client stream</span>}
              {method.serverStreaming && <span className="http-badge">server stream</span>}
            </div>
            <pre className="http-schema-field mono">{method.template}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryPanel({
  entries,
  onOpen,
  onClear,
}: {
  entries: HistoryEntry[]
  onOpen: (entry: HistoryEntry) => void
  onClear: () => void
}) {
  return (
    <div className="http-response-inner">
      <div className="http-response-head">
        <strong>History</strong>
        <span className="faint">{entries.length}</span>
        <span style={{ flex: 1 }} />
        <button className="link-btn" title="Forget every recorded run" onClick={onClear}>
          <Trash2 size={10} /> Clear
        </button>
      </div>
      <div className="http-schema">
        {!entries.length && <span className="faint">Nothing has been run for this file yet.</span>}
        {entries.map((entry) => (
          <button key={entry.id} className="http-history-row" onClick={() => onOpen(entry)}>
            <span className={`http-status ${entry.error || entry.status >= 400 ? 'error' : 'ok'}`}>
              {entry.error ? '!' : entry.status}
            </span>
            <span className="http-item-body">
              <span className="http-name">{entry.name}</span>
              <span className="http-url mono">{entry.url}</span>
            </span>
            <span className="faint" style={{ fontSize: 10 }}>
              {new Date(entry.at).toLocaleTimeString()} · {entry.durationMs} ms
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CookiePanel({ cookies, onClear }: { cookies: StoredCookie[]; onClear: () => void }) {
  return (
    <div className="http-response-inner">
      <div className="http-response-head">
        <strong>Cookies</strong>
        <span className="faint">{cookies.length}</span>
        <span style={{ flex: 1 }} />
        <button
          className="link-btn"
          title="Empty the jar — the next request starts with no session"
          onClick={onClear}
        >
          <Trash2 size={10} /> Clear all
        </button>
      </div>
      <div className="http-schema">
        {!cookies.length && <span className="faint">The jar is empty.</span>}
        {cookies.map((cookie) => (
          <div key={`${cookie.domain}${cookie.path}${cookie.name}`} className="http-schema-field mono">
            <span className="http-header-name">{cookie.name}</span>={cookie.value}
            <span className="faint">
              {' '}
              — {cookie.domain}
              {cookie.path}
              {cookie.secure ? ' · secure' : ''}
              {cookie.httpOnly ? ' · httpOnly' : ''}
              {cookie.expires ? ` · until ${new Date(cookie.expires).toLocaleString()}` : ' · session'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- formatting ---------------- */

/** JSON responses are far easier to read indented; everything else is verbatim. */
function prettify(response: HttpResponse): string {
  if (!response.contentType.includes('json')) return response.body
  try {
    return JSON.stringify(JSON.parse(response.body), null, 2)
  } catch {
    return response.body
  }
}

function statusTone(response: HttpResponse): string {
  if (response.error || response.status === 0) return 'error'
  if (response.status >= 500) return 'error'
  if (response.status >= 400) return 'warn'
  if (response.status >= 200 && response.status < 300) return 'ok'
  return ''
}

function streamTone(status: StreamStatus): string {
  if (status.state === 'error') return 'error'
  if (status.state === 'open') return 'ok'
  return ''
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
