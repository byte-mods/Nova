import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Minimal LSP client: JSON-RPC 2.0 over `Content-Length`-framed stdio.
 *
 * Emits:
 *  - `notification` (method, params) for server -> client notifications
 *  - `request` (method, params, respond) for server -> client requests
 *  - `exit` (code) when the process ends
 *  - `stderr` (text)
 */
export class LspClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private stopped = false

  constructor(
    readonly id: string,
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
      this.failAll(new Error(`${this.id} exited (${code})`))
      this.emit('exit', code)
    })
  }

  /** Frames and parses the `Content-Length` stream. */
  private consume(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        // Unparseable header; drop it rather than stalling forever.
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try {
        this.dispatch(JSON.parse(body) as RpcMessage)
      } catch {
        /* a malformed payload must not kill the connection */
      }
    }
  }

  private dispatch(message: RpcMessage) {
    // Response to one of our requests.
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id as number)
      if (!pending) return
      this.pending.delete(message.id as number)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }

    // Request from the server — it blocks until we answer.
    if (message.id !== undefined && message.method) {
      const respond = (result: unknown, error?: { code: number; message: string }) => {
        this.write({ jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) })
      }
      this.emit('request', message.method, message.params, respond)
      return
    }

    if (message.method) this.emit('notification', message.method, message.params)
  }

  private write(message: RpcMessage) {
    if (!this.child || this.stopped) return
    const json = JSON.stringify(message)
    const payload = Buffer.from(json, 'utf8')
    this.child.stdin.write(`Content-Length: ${payload.byteLength}\r\n\r\n`)
    this.child.stdin.write(payload)
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 20_000): Promise<T> {
    if (!this.running) return Promise.reject(new Error(`${this.id} is not running`))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.id}: ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: unknown) {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private failAll(error: Error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  async stop() {
    if (!this.child || this.stopped) return
    try {
      await this.request('shutdown', null, 2500)
      this.notify('exit')
    } catch {
      /* server already gone */
    }
    this.stopped = true
    const child = this.child
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 1500)
    child.kill('SIGTERM')
  }
}
