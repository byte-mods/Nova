/**
 * Long-lived connections: WebSocket and Server-Sent Events.
 *
 * These differ from a request/response in the one way that shapes the whole
 * design — there is no single moment when the answer is complete. A stream is
 * opened, produces messages for as long as it lives, and is closed by the user
 * or the server. So instead of resolving a promise with a response, each stream
 * gets an id and pushes messages to the renderer as they arrive.
 *
 * Everything runs in the main process. That is not only about CORS: a stream
 * has to survive the renderer re-rendering the panel it is displayed in.
 */
import type { HttpRequest, StreamMessage, StreamStatus } from '../../shared/http'
import { applyAuth } from './httpAuth'
import type { CookieJar } from './cookieJar'

export interface StreamEvents {
  onMessage: (message: StreamMessage) => void
  onStatus: (status: StreamStatus) => void
}

interface Stream {
  status: StreamStatus
  close: () => void
  send?: (data: string) => void
}

export class StreamManager {
  private streams = new Map<string, Stream>()
  private counter = 0

  constructor(private readonly events: StreamEvents) {}

  /** Opens a WebSocket or SSE connection and returns its id immediately. */
  open(request: HttpRequest, jar: CookieJar): string {
    const streamId = `stream-${++this.counter}`
    const status: StreamStatus = {
      streamId,
      requestId: request.id,
      protocol: request.protocol,
      state: 'connecting',
      url: request.url,
      received: 0,
      sent: 0,
    }

    const stream: Stream = { status, close: () => {} }
    this.streams.set(streamId, stream)
    this.events.onStatus(status)

    if (request.protocol === 'websocket') void this.openWebSocket(stream, request, jar)
    else void this.openEventSource(stream, request, jar)

    return streamId
  }

  send(streamId: string, data: string): boolean {
    const stream = this.streams.get(streamId)
    if (!stream?.send || stream.status.state !== 'open') return false
    stream.send(data)
    stream.status.sent++
    this.emit(stream, { direction: 'out', data })
    this.events.onStatus({ ...stream.status })
    return true
  }

  close(streamId: string) {
    this.streams.get(streamId)?.close()
  }

  closeAll() {
    for (const stream of this.streams.values()) stream.close()
    this.streams.clear()
  }

  list(): StreamStatus[] {
    return [...this.streams.values()].map((s) => ({ ...s.status }))
  }

  /* ---------------- WebSocket ---------------- */

  private async openWebSocket(stream: Stream, request: HttpRequest, jar: CookieJar) {
    const auth = await applyAuth(request.auth)
    if (auth.error) return this.fail(stream, auth.error)

    // The WHATWG WebSocket constructor takes no headers, so anything that has
    // to be sent at the handshake — auth, cookies — goes in the URL or in the
    // subprotocol list, which is what the browser API leaves available.
    let url: string
    try {
      const parsed = new URL(request.url)
      for (const [name, value] of Object.entries(auth.query)) parsed.searchParams.set(name, value)
      url = parsed.toString()
    } catch {
      return this.fail(stream, `Not a valid WebSocket URL: ${request.url}`)
    }

    const protocols = request.headers
      .filter((h) => h.name.toLowerCase() === 'sec-websocket-protocol')
      .flatMap((h) => h.value.split(',').map((v) => v.trim()))
      .filter(Boolean)

    let socket: WebSocket
    try {
      socket = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url)
    } catch (err) {
      return this.fail(stream, (err as Error).message)
    }

    stream.close = () => socket.close()
    stream.send = (data) => socket.send(data)

    socket.addEventListener('open', () => {
      stream.status.state = 'open'
      this.emit(stream, { direction: 'system', data: `Connected to ${url}` })
      this.events.onStatus({ ...stream.status })
      for (const message of request.initialMessages) this.send(stream.status.streamId, message)
    })

    socket.addEventListener('message', (event: MessageEvent) => {
      stream.status.received++
      this.emit(stream, { direction: 'in', data: stringify(event.data) })
      this.events.onStatus({ ...stream.status })
    })

    let opened = false
    socket.addEventListener('open', () => {
      opened = true
    })

    socket.addEventListener('error', () => {
      // The browser error event carries no detail by design; the close event
      // that follows has the code worth reporting.
      this.emit(stream, { direction: 'system', data: 'Socket error' })
    })

    socket.addEventListener('close', (event: CloseEvent) => {
      const detail = event.code
        ? ` (${event.code}${event.reason ? `: ${event.reason}` : ''})`
        : ''
      // A socket that closes without ever having opened did not finish — it
      // failed to connect, and reporting that as a tidy close would hide the
      // most common thing that goes wrong with a WebSocket URL.
      if (!opened) {
        this.fail(stream, `Could not connect to ${url}${detail}`)
        return
      }
      stream.status.state = 'closed'
      this.emit(stream, { direction: 'system', data: `Closed${detail}` })
      this.events.onStatus({ ...stream.status })
      this.streams.delete(stream.status.streamId)
    })

    void jar
  }

  /* ---------------- Server-Sent Events ---------------- */

  /**
   * SSE is read with `fetch` rather than `EventSource` because EventSource
   * cannot set headers, and an events endpoint almost always needs auth.
   */
  private async openEventSource(stream: Stream, request: HttpRequest, jar: CookieJar) {
    const auth = await applyAuth(request.auth)
    if (auth.error) return this.fail(stream, auth.error)

    const controller = new AbortController()
    stream.close = () => controller.abort()

    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    for (const header of request.headers) headers[header.name] = header.value
    Object.assign(headers, auth.headers)
    if (request.useCookies) {
      const cookie = jar.header(request.url)
      if (cookie) headers.Cookie = cookie
    }

    let response: Response
    try {
      let url = request.url
      if (Object.keys(auth.query).length) {
        const parsed = new URL(url)
        for (const [name, value] of Object.entries(auth.query)) parsed.searchParams.set(name, value)
        url = parsed.toString()
      }
      response = await fetch(url, { headers, signal: controller.signal })
    } catch (err) {
      const error = err as Error
      if (error.name === 'AbortError') return this.finish(stream, 'Closed')
      return this.fail(stream, error.message)
    }

    if (!response.ok) {
      return this.fail(stream, `Stream refused: ${response.status} ${response.statusText}`)
    }
    if (!response.body) return this.fail(stream, 'The response had no body to stream.')

    stream.status.state = 'open'
    this.emit(stream, { direction: 'system', data: `Streaming from ${request.url}` })
    this.events.onStatus({ ...stream.status })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Events are separated by a blank line; anything after the last one is
        // a partial event and stays in the buffer until the rest arrives.
        let split: number
        while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const chunk = buffer.slice(0, split)
          buffer = buffer.slice(split + (buffer[split] === '\r' ? 4 : 2))
          const event = parseEvent(chunk)
          if (!event) continue
          stream.status.received++
          this.emit(stream, { direction: 'in', event: event.name, data: event.data })
          this.events.onStatus({ ...stream.status })
        }
      }
      this.finish(stream, 'Stream ended')
    } catch (err) {
      const error = err as Error
      if (error.name === 'AbortError') this.finish(stream, 'Closed')
      else this.fail(stream, error.message)
    }
  }

  /* ---------------- shared ---------------- */

  private emit(stream: Stream, message: Omit<StreamMessage, 'streamId' | 'at'>) {
    this.events.onMessage({ ...message, streamId: stream.status.streamId, at: Date.now() })
  }

  private fail(stream: Stream, error: string) {
    stream.status.state = 'error'
    stream.status.error = error
    this.emit(stream, { direction: 'system', data: error })
    this.events.onStatus({ ...stream.status })
    this.streams.delete(stream.status.streamId)
  }

  private finish(stream: Stream, note: string) {
    stream.status.state = 'closed'
    this.emit(stream, { direction: 'system', data: note })
    this.events.onStatus({ ...stream.status })
    this.streams.delete(stream.status.streamId)
  }
}

/**
 * One SSE event. `data:` may appear on several lines, which are joined with
 * newlines — that is how a JSON payload spanning lines is sent.
 */
function parseEvent(chunk: string): { name?: string; data: string } | null {
  const dataLines: string[] = []
  let name: string | undefined

  for (const line of chunk.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // A single leading space after the colon is part of the syntax, not data.
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')

    if (field === 'data') dataLines.push(value)
    else if (field === 'event') name = value
  }

  if (!dataLines.length && !name) return null
  return { name, data: dataLines.join('\n') }
}

function stringify(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return String(data)
}
