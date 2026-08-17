/**
 * The HTTP client: run the requests in a `.http` file and read the responses.
 *
 * Requests sit on the left, the selected response on the right. Responses are
 * kept per request for the life of the tab so you can flip between two requests
 * and compare, which is most of what this tool is used for in practice.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Clock, Loader2, Play, Send } from 'lucide-react'
import { useStore } from '@/state/store'
import type { HttpEnvironments, HttpFile, HttpResponse } from '@shared/http'

export default function HttpView({ path: file }: { path: string }) {
  const buffer = useStore((s) => s.buffers[file])
  const [parsed, setParsed] = useState<HttpFile | null>(null)
  const [environments, setEnvironments] = useState<HttpEnvironments>({})
  const [environment, setEnvironment] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, HttpResponse>>({})
  const [running, setRunning] = useState<string | null>(null)

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

  const send = useCallback(
    async (requestId: string) => {
      setRunning(requestId)
      try {
        const response = await window.nova.http.send(file, requestId, environment)
        setResponses((r) => ({ ...r, [requestId]: response }))
        setSelected(requestId)
      } catch (err) {
        useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
      } finally {
        setRunning(null)
      }
    },
    [file, environment],
  )

  const environmentNames = useMemo(() => Object.keys(environments), [environments])
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
        {Object.keys(parsed.variables).length > 0 && (
          <span className="faint mono" style={{ fontSize: 10 }}>
            {Object.keys(parsed.variables).length} variable(s)
          </span>
        )}
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
          {!parsed.requests.length && (
            <p className="faint" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.6 }}>
              No requests found. Write one like:
              <br />
              <code className="mono">GET https://api.example.com/users</code>
            </p>
          )}
          {parsed.requests.map((request) => {
            const result = responses[request.id]
            return (
              <button
                key={request.id}
                className={`http-item ${selected === request.id ? 'active' : ''}`}
                onClick={() => setSelected(request.id)}
              >
                <span className={`http-method m-${request.method.toLowerCase()}`}>{request.method}</span>
                <span className="http-item-body">
                  <span className="http-name">{request.name}</span>
                  <span className="http-url mono">{request.url}</span>
                </span>
                {result && (
                  <span className={`http-status ${statusTone(result)}`}>
                    {result.error ? '!' : result.status}
                  </span>
                )}
                <span
                  className="icon-btn"
                  title={`Run (line ${request.line})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void send(request.id)
                  }}
                >
                  {running === request.id ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
                </span>
              </button>
            )
          })}
        </div>

        <div className="http-response">
          {!response && (
            <div className="empty-state">
              <span className="faint">Run a request to see its response.</span>
            </div>
          )}
          {response && <ResponseView response={response} />}
        </div>
      </div>
    </div>
  )
}

function ResponseView({ response }: { response: HttpResponse }) {
  const [showHeaders, setShowHeaders] = useState(false)
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
        <button className="link-btn" onClick={() => setShowHeaders((v) => !v)}>
          <ChevronDown size={10} /> {Object.keys(response.headers).length} headers
        </button>
      </div>

      {showHeaders && (
        <div className="http-headers mono">
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
