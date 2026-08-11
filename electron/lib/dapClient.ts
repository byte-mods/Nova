import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  arguments?: unknown
  body?: any
  request_seq?: number
  success?: boolean
  message?: string
}

/**
 * Debug Adapter Protocol client. The wire format is the same
 * `Content-Length`-framed JSON as LSP, but the envelope is DAP's
 * request/response/event triple rather than JSON-RPC.
 *
 * Emits: `event` (name, body), `exit` (code), `stderr` (text).
 */
export class DapClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private seq = 1
  private pending = new Map<
    number,
    { resolve: (body: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private stopped = false

  constructor(
    private command: string,
    private args: string[],
    private cwd: string,
    private env: NodeJS.ProcessEnv,
  ) {
    super()
  }

  get running() {
    return this.child !== null && !this.stopped
  }

  start() {
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams

    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (text: string) => this.emit('stderr', text))
    this.child.on('error', (err) => {
      this.emit('stderr', `${this.command}: ${err.message}\n`)
      this.failAll(new Error(err.message))
    })
    this.child.on('exit', (code) => {
      this.stopped = true
      this.failAll(new Error(`debug adapter exited (${code})`))
      this.emit('exit', code)
    })
  }

  private consume(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try {
        this.dispatch(JSON.parse(body) as DapMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  private dispatch(message: DapMessage) {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq!)
      if (!pending) return
      this.pending.delete(message.request_seq!)
      clearTimeout(pending.timer)
      if (message.success === false) {
        pending.reject(new Error(message.message || `${message.command} failed`))
      } else {
        pending.resolve(message.body)
      }
      return
    }
    if (message.type === 'event') {
      this.emit('event', message.event, message.body)
      return
    }
    // Reverse requests (runInTerminal, startDebugging) — acknowledge so the
    // adapter is not left waiting.
    if (message.type === 'request') {
      this.emit('reverseRequest', message.command, message.arguments, (body: unknown) =>
        this.write({
          seq: this.seq++,
          type: 'response',
          request_seq: message.seq,
          success: true,
          command: message.command,
          body,
        } as DapMessage),
      )
    }
  }

  private write(message: DapMessage) {
    if (!this.child || this.stopped) return
    const payload = Buffer.from(JSON.stringify(message), 'utf8')
    this.child.stdin.write(`Content-Length: ${payload.byteLength}\r\n\r\n`)
    this.child.stdin.write(payload)
  }

  request<T = any>(command: string, args?: unknown, timeoutMs = 15_000): Promise<T> {
    if (!this.running) return Promise.reject(new Error('debug adapter is not running'))
    const seq = this.seq++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`${command} timed out`))
      }, timeoutMs)
      this.pending.set(seq, { resolve, reject, timer })
      this.write({ seq, type: 'request', command, arguments: args ?? {} })
    })
  }

  private failAll(error: Error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  kill() {
    this.stopped = true
    this.child?.kill('SIGKILL')
  }
}
