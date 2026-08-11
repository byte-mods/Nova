import path from 'node:path'
import { DapClient } from './dapClient'
import { ADAPTERS, adaptersForLanguage, type AdapterSpec } from './debugRegistry'
import { toolEnv, which, whichXcrun } from './env'
import type {
  DebugAdapterStatus,
  DebugScope,
  DebugStackFrame,
  DebugState,
  DebugVariable,
} from '../../shared/types'

export interface LaunchRequest {
  language: string
  /** Executable for compiled languages, entry script otherwise. */
  program: string
  args?: string[]
  cwd: string
  stopOnEntry?: boolean
  env?: Record<string, string>
  adapterId?: string
}

interface Events {
  onState: (state: DebugState) => void
  onOutput: (text: string, category: string) => void
  onStopped: () => void
}

export class DebugSession {
  private client: DapClient | null = null
  private spec: AdapterSpec | null = null
  private available = new Map<string, string>()
  private detected = false

  private capabilities: Record<string, any> = {}
  /** file -> line numbers the user has toggled on. */
  private breakpoints = new Map<string, number[]>()
  private verified = new Map<string, number[]>()

  private configured = false
  private status: DebugState['status'] = 'inactive'
  private threadId: number | null = null
  private frames: DebugStackFrame[] = []
  private currentFrameId: number | null = null
  private stopReason = ''
  private error = ''

  constructor(private events: Events) {}

  async detect(force = false): Promise<DebugAdapterStatus[]> {
    if (!this.detected || force) {
      this.available.clear()
      await Promise.all(
        ADAPTERS.map(async (spec) => {
          const binary =
            (await which(spec.command)) || (spec.xcrun ? await whichXcrun(spec.command) : '')
          if (!binary) return
          // debugpy is a python module, so the interpreter alone is not enough.
          if (spec.id === 'debugpy') {
            const ok = await hasPythonModule(binary, 'debugpy')
            if (!ok) return
          }
          this.available.set(spec.id, binary)
        }),
      )
      this.detected = true
    }
    return ADAPTERS.map((spec) => ({
      id: spec.id,
      label: spec.label,
      languages: spec.languages,
      command: spec.command,
      binary: this.available.get(spec.id) ?? '',
      installed: this.available.has(spec.id),
      install: spec.install,
      programKind: spec.programKind,
    }))
  }

  state(): DebugState {
    return {
      status: this.status,
      adapterId: this.spec?.id ?? '',
      adapterLabel: this.spec?.label ?? '',
      threadId: this.threadId,
      frames: this.frames,
      currentFrameId: this.currentFrameId,
      stopReason: this.stopReason,
      error: this.error,
      breakpoints: [...this.breakpoints.entries()].map(([file, lines]) => ({
        file,
        lines,
        verified: this.verified.get(file) ?? [],
      })),
      supportsStepBack: Boolean(this.capabilities.supportsStepBack),
      supportsRestart: Boolean(this.capabilities.supportsRestartRequest),
    }
  }

  private publish() {
    this.events.onState(this.state())
  }

  /* ---------------- breakpoints ---------------- */

  toggleBreakpoint(file: string, line: number) {
    const lines = this.breakpoints.get(file) ?? []
    const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b)
    if (next.length) this.breakpoints.set(file, next)
    else this.breakpoints.delete(file)
    if (this.client?.running) void this.sendBreakpoints(file)
    this.publish()
  }

  clearBreakpoints() {
    const files = [...this.breakpoints.keys()]
    this.breakpoints.clear()
    this.verified.clear()
    if (this.client?.running) for (const file of files) void this.sendBreakpoints(file)
    this.publish()
  }

  private async sendBreakpoints(file: string) {
    if (!this.client?.running) return
    const lines = this.breakpoints.get(file) ?? []
    try {
      const body = await this.client.request('setBreakpoints', {
        source: { path: file, name: path.basename(file) },
        breakpoints: lines.map((line) => ({ line })),
        lines,
      })
      const verified = (body?.breakpoints ?? [])
        .map((bp: any, i: number) => (bp.verified ? (bp.line ?? lines[i]) : null))
        .filter((l: number | null): l is number => l !== null)
      this.verified.set(file, verified)
      this.publish()
    } catch {
      /* adapter refused; the marker stays unverified */
    }
  }

  /* ---------------- lifecycle ---------------- */

  async launch(request: LaunchRequest) {
    await this.stop()
    if (!this.detected) await this.detect()

    const spec = request.adapterId
      ? ADAPTERS.find((a) => a.id === request.adapterId)
      : adaptersForLanguage(request.language).find((a) => this.available.has(a.id))

    if (!spec || !this.available.has(spec.id)) {
      this.status = 'inactive'
      this.error = spec
        ? `${spec.label} is not installed. ${spec.install}`
        : `No debug adapter for ${request.language}. Install one from Settings › Debuggers.`
      this.publish()
      return
    }

    this.spec = spec
    this.configured = false
    this.status = 'starting'
    this.error = ''
    this.frames = []
    this.threadId = null
    this.publish()

    const binary = this.available.get(spec.id)!
    const client = new DapClient(binary, spec.args, request.cwd, toolEnv(request.env))
    this.client = client

    client.on('stderr', (text: string) => this.events.onOutput(text, 'stderr'))
    client.on('exit', () => {
      this.status = 'inactive'
      this.threadId = null
      this.frames = []
      this.publish()
    })
    client.on('reverseRequest', (_command: string, _args: unknown, respond: (b: unknown) => void) => {
      respond({})
    })
    client.on('event', (event: string, body: any) => void this.onEvent(event, body))

    try {
      client.start()
      this.capabilities = (await client.request('initialize', {
        clientID: 'nova-ide',
        clientName: 'Nova IDE',
        adapterID: spec.id,
        locale: 'en',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: false,
        supportsProgressReporting: true,
      })) ?? {}

      const launchArgs = {
        ...spec.launchDefaults,
        name: 'Nova debug',
        request: 'launch',
        program: request.program,
        args: request.args ?? [],
        cwd: request.cwd,
        stopOnEntry: request.stopOnEntry ?? false,
        env: request.env ?? {},
      }
      // `launch` is sent without awaiting: adapters answer it only after the
      // `initialized` event round-trip completes.
      const launched = client.request('launch', launchArgs, 60_000)
      launched.catch((err: Error) => {
        this.status = 'inactive'
        this.error = err.message
        this.publish()
      })

      // The spec requires an `initialized` event, but some adapters never emit
      // one — configure anyway rather than deadlocking on a missing event.
      setTimeout(() => {
        if (this.client === client && !this.configured) void this.configure()
      }, 1500)

      this.status = 'running'
      this.publish()
    } catch (err) {
      this.status = 'inactive'
      this.error = err instanceof Error ? err.message : String(err)
      this.publish()
    }
  }

  /** Sends breakpoints then `configurationDone`; safe to call more than once. */
  private async configure() {
    const client = this.client
    if (!client?.running || this.configured) return
    this.configured = true
    for (const file of this.breakpoints.keys()) await this.sendBreakpoints(file)
    if (this.capabilities.exceptionBreakpointFilters) {
      await client.request('setExceptionBreakpoints', { filters: [] }).catch(() => undefined)
    }
    if (this.capabilities.supportsConfigurationDoneRequest !== false) {
      await client.request('configurationDone').catch(() => undefined)
    }
  }

  private async onEvent(event: string, body: any) {
    const client = this.client
    if (!client) return

    switch (event) {
      case 'initialized':
        await this.configure()
        return
      case 'stopped': {
        this.status = 'paused'
        this.stopReason = body?.reason ?? 'pause'
        this.threadId = body?.threadId ?? this.threadId
        await this.refreshStack()
        this.events.onStopped()
        this.publish()
        return
      }
      case 'continued':
        this.status = 'running'
        this.frames = []
        this.currentFrameId = null
        this.publish()
        return
      case 'output':
        this.events.onOutput(body?.output ?? '', body?.category ?? 'console')
        return
      case 'terminated':
      case 'exited': {
        this.status = 'inactive'
        this.frames = []
        this.threadId = null
        this.currentFrameId = null
        if (event === 'exited' && typeof body?.exitCode === 'number') {
          this.events.onOutput(`\nProcess exited with code ${body.exitCode}\n`, 'console')
        }
        this.publish()
        return
      }
      default:
        return
    }
  }

  private async refreshStack() {
    const client = this.client
    if (!client?.running) return
    try {
      if (this.threadId === null) {
        const threads = await client.request('threads')
        this.threadId = threads?.threads?.[0]?.id ?? null
      }
      if (this.threadId === null) return
      const body = await client.request('stackTrace', {
        threadId: this.threadId,
        startFrame: 0,
        levels: 50,
      })
      this.frames = (body?.stackFrames ?? []).map((frame: any) => ({
        id: frame.id,
        name: frame.name,
        file: frame.source?.path ?? '',
        line: frame.line ?? 0,
        column: frame.column ?? 1,
      }))
      this.currentFrameId = this.frames[0]?.id ?? null
    } catch {
      this.frames = []
    }
  }

  /* ---------------- inspection ---------------- */

  async scopes(frameId: number): Promise<DebugScope[]> {
    if (!this.client?.running) return []
    try {
      const body = await this.client.request('scopes', { frameId })
      return (body?.scopes ?? []).map((scope: any) => ({
        name: scope.name,
        variablesReference: scope.variablesReference,
        expensive: Boolean(scope.expensive),
      }))
    } catch {
      return []
    }
  }

  async variables(reference: number): Promise<DebugVariable[]> {
    if (!this.client?.running) return []
    try {
      const body = await this.client.request('variables', { variablesReference: reference })
      return (body?.variables ?? []).map((variable: any) => ({
        name: variable.name,
        value: variable.value ?? '',
        type: variable.type ?? '',
        variablesReference: variable.variablesReference ?? 0,
      }))
    } catch {
      return []
    }
  }

  async evaluate(expression: string, frameId?: number, context = 'watch') {
    if (!this.client?.running) return { result: '', variablesReference: 0, error: 'Not running' }
    try {
      const body = await this.client.request('evaluate', {
        expression,
        frameId: frameId ?? this.currentFrameId ?? undefined,
        context,
      })
      return {
        result: body?.result ?? '',
        type: body?.type ?? '',
        variablesReference: body?.variablesReference ?? 0,
        error: '',
      }
    } catch (err) {
      return { result: '', variablesReference: 0, error: (err as Error).message }
    }
  }

  selectFrame(frameId: number) {
    this.currentFrameId = frameId
    this.publish()
  }

  /* ---------------- control ---------------- */

  private async control(command: string, args?: unknown) {
    if (!this.client?.running) return
    try {
      await this.client.request(command, args ?? { threadId: this.threadId })
      if (command !== 'pause') {
        this.status = 'running'
        this.publish()
      }
    } catch (err) {
      this.events.onOutput(`${command}: ${(err as Error).message}\n`, 'stderr')
    }
  }

  continue_() {
    return this.control('continue')
  }
  next() {
    return this.control('next')
  }
  stepIn() {
    return this.control('stepIn')
  }
  stepOut() {
    return this.control('stepOut')
  }
  pause() {
    return this.control('pause')
  }
  stepBack() {
    return this.control('stepBack')
  }

  async restart() {
    if (!this.client?.running) return
    await this.client.request('restart').catch(() => undefined)
  }

  async stop() {
    const client = this.client
    if (!client) return
    this.client = null
    try {
      await client.request('disconnect', { terminateDebuggee: true }, 3000)
    } catch {
      /* already gone */
    }
    client.kill()
    this.status = 'inactive'
    this.frames = []
    this.threadId = null
    this.currentFrameId = null
    this.publish()
  }
}

async function hasPythonModule(python: string, moduleName: string) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  try {
    await promisify(execFile)(python, ['-c', `import ${moduleName}`], { env: toolEnv() })
    return true
  } catch {
    return false
  }
}
