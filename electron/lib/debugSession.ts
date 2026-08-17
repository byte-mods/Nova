import { app } from 'electron'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DapClient } from './dapClient'
import { ADAPTERS, adaptersForLanguage, type AdapterSpec } from './debugRegistry'
import { toolEnv, which, whichXcrun } from './env'
import type {
  DataBreakpoint,
  DebugAdapterStatus,
  DebugBreakpoint,
  DebugScope,
  DebugStackFrame,
  DebugState,
  DebugVariable,
  ExceptionFilter,
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
  /** file -> the breakpoints the user has set, ordered by line. */
  private breakpoints = new Map<string, DebugBreakpoint[]>()
  private verified = new Map<string, number[]>()
  /**
   * Break-on-exception categories.
   *
   * The adapter decides which categories exist (`raised`, `uncaught`, `assert`
   * …) and Nova decides which are on. Selection is kept by filter id rather
   * than by index, because the list is per adapter and a project may be
   * debugged with more than one.
   */
  private exceptionFilters: ExceptionFilter[] = []
  private exceptionChoice = new Map<string, { enabled: boolean; condition: string }>()
  /** Field/data watchpoints, keyed by the adapter's opaque dataId. */
  private dataBreakpoints: DataBreakpoint[] = []
  /**
   * The Run to Cursor target, armed as a one-shot breakpoint the adapter never
   * learns is temporary — it is withdrawn as soon as the program stops.
   */
  private runToCursor: { file: string; line: number } | null = null
  /** The open project, used to scope persisted breakpoints. */
  private projectRoot = ''

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
      breakpoints: [...this.breakpoints.entries()].map(([file, items]) => ({
        file,
        lines: items.map((b) => b.line),
        verified: this.verified.get(file) ?? [],
        items,
      })),
      exceptionFilters: this.exceptionFilters.map((filter) => ({
        ...filter,
        ...(this.exceptionChoice.get(filter.filter) ?? {
          enabled: filter.default,
          condition: '',
        }),
      })),
      dataBreakpoints: this.dataBreakpoints,
      supportsStepBack: Boolean(this.capabilities.supportsStepBack),
      supportsRestart: Boolean(this.capabilities.supportsRestartRequest),
      supportsDropFrame: Boolean(this.capabilities.supportsRestartFrame),
      supportsSetVariable: Boolean(this.capabilities.supportsSetVariable),
      supportsDataBreakpoints: Boolean(this.capabilities.supportsDataBreakpoints),
      runningToCursor: this.runToCursor !== null,
    }
  }

  private publish() {
    this.events.onState(this.state())
  }

  /* ---------------- breakpoints ---------------- */

  toggleBreakpoint(file: string, line: number) {
    const items = this.breakpoints.get(file) ?? []
    const next = items.some((b) => b.line === line)
      ? items.filter((b) => b.line !== line)
      : [...items, { line, enabled: true }].sort((a, b) => a.line - b.line)
    if (next.length) this.breakpoints.set(file, next)
    else this.breakpoints.delete(file)
    if (this.client?.running) void this.sendBreakpoints(file)
    void this.persist()
    this.publish()
  }

  /**
   * Edits an existing breakpoint — condition, hit count, log message or the
   * enabled flag. Creates one when the line has none yet, so the properties
   * dialog can be opened straight from the gutter.
   */
  updateBreakpoint(file: string, line: number, patch: Partial<DebugBreakpoint>) {
    const items = this.breakpoints.get(file) ?? []
    const existing = items.find((b) => b.line === line)
    const next = existing
      ? items.map((b) => (b.line === line ? { ...b, ...patch, line } : b))
      : [...items, { line, enabled: true, ...patch }].sort((a, b) => a.line - b.line)
    this.breakpoints.set(file, next)
    if (this.client?.running) void this.sendBreakpoints(file)
    void this.persist()
    this.publish()
  }

  clearBreakpoints() {
    const files = [...this.breakpoints.keys()]
    this.breakpoints.clear()
    this.verified.clear()
    if (this.client?.running) for (const file of files) void this.sendBreakpoints(file)
    void this.persist()
    this.publish()
  }

  private async sendBreakpoints(file: string) {
    if (!this.client?.running) return
    // A disabled breakpoint stays in the gutter but is not sent, which is how
    // it can be muted without losing its condition.
    const items = (this.breakpoints.get(file) ?? []).filter((b) => b.enabled)
    // The Run to Cursor target rides along with the file's real breakpoints so
    // the adapter only ever sees one `setBreakpoints` per source.
    if (this.runToCursor?.file === file && !items.some((b) => b.line === this.runToCursor!.line)) {
      items.push({ line: this.runToCursor.line, enabled: true })
      items.sort((a, b) => a.line - b.line)
    }
    try {
      const body = await this.client.request('setBreakpoints', {
        source: { path: file, name: path.basename(file) },
        breakpoints: items.map((b) => ({
          line: b.line,
          ...(b.condition ? { condition: b.condition } : {}),
          ...(b.hitCondition ? { hitCondition: b.hitCondition } : {}),
          ...(b.logMessage ? { logMessage: b.logMessage } : {}),
        })),
        lines: items.map((b) => b.line),
      })
      const verified = (body?.breakpoints ?? [])
        .map((bp: any, i: number) => (bp.verified ? (bp.line ?? items[i]?.line) : null))
        .filter((l: number | null): l is number => l !== null)
      this.verified.set(file, verified)
      this.publish()
    } catch {
      /* adapter refused; the marker stays unverified */
    }
  }

  /* ---------------- persistence ---------------- */

  private storePath() {
    return path.join(
      app.getPath('userData'),
      'breakpoints',
      `${crypto.createHash('sha1').update(this.projectRoot).digest('hex').slice(0, 16)}.json`,
    )
  }

  /**
   * Breakpoints survive a restart, which is the whole point of setting one in a
   * place you are still investigating.
   */
  async setProjectRoot(root: string) {
    if (root === this.projectRoot) return
    this.projectRoot = root
    this.breakpoints.clear()
    this.verified.clear()
    if (!root) {
      this.publish()
      return
    }
    this.exceptionChoice.clear()
    try {
      const raw = JSON.parse(await fsp.readFile(this.storePath(), 'utf8')) as
        | Record<string, DebugBreakpoint[]>
        | { files: Record<string, DebugBreakpoint[]>; exceptions?: Record<string, { enabled: boolean; condition: string }> }
      // Older stores were a bare file->breakpoints map; read both shapes.
      const files = 'files' in raw && raw.files ? raw.files : (raw as Record<string, DebugBreakpoint[]>)
      for (const [file, items] of Object.entries(files)) {
        if (!Array.isArray(items)) continue
        const clean = items.filter((b) => Number.isFinite(b?.line))
        if (clean.length) this.breakpoints.set(file, clean)
      }
      const exceptions = 'files' in raw ? raw.exceptions : undefined
      for (const [filter, choice] of Object.entries(exceptions ?? {})) {
        this.exceptionChoice.set(filter, {
          enabled: Boolean(choice?.enabled),
          condition: String(choice?.condition ?? ''),
        })
      }
    } catch {
      /* nothing saved for this project yet */
    }
    this.publish()
  }

  private async persist() {
    if (!this.projectRoot) return
    const target = this.storePath()
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(
        target,
        JSON.stringify(
          {
            files: Object.fromEntries(this.breakpoints),
            exceptions: Object.fromEntries(this.exceptionChoice),
          },
          null,
          2,
        ),
      )
    } catch {
      /* a lost breakpoint file is not worth surfacing */
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
      this.adoptExceptionFilters()

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
    await this.sendExceptionBreakpoints()
    if (this.capabilities.supportsConfigurationDoneRequest !== false) {
      await client.request('configurationDone').catch(() => undefined)
    }
  }

  /* ---------------- exception breakpoints ---------------- */

  /**
   * Reads the adapter's categories out of its capabilities and reconciles them
   * with what the user chose last time.
   *
   * This is what makes break-on-throw actually work: the filters have to be
   * sent by id, and the ids only exist once `initialize` has answered.
   */
  private adoptExceptionFilters() {
    const raw = (this.capabilities.exceptionBreakpointFilters ?? []) as any[]
    this.exceptionFilters = raw.map((entry) => ({
      filter: String(entry.filter),
      label: String(entry.label ?? entry.filter),
      description: String(entry.description ?? ''),
      default: Boolean(entry.default),
      supportsCondition: Boolean(entry.supportsCondition),
      conditionDescription: String(entry.conditionDescription ?? ''),
      enabled: Boolean(entry.default),
      condition: '',
    }))
    for (const filter of this.exceptionFilters) {
      if (!this.exceptionChoice.has(filter.filter)) {
        this.exceptionChoice.set(filter.filter, { enabled: filter.default, condition: '' })
      }
    }
  }

  private async sendExceptionBreakpoints() {
    const client = this.client
    if (!client?.running || this.exceptionFilters.length === 0) return
    const chosen = this.exceptionFilters.filter(
      (filter) => (this.exceptionChoice.get(filter.filter)?.enabled ?? filter.default),
    )
    const conditions = chosen
      .filter((filter) => filter.supportsCondition && this.exceptionChoice.get(filter.filter)?.condition)
      .map((filter) => ({
        filterId: filter.filter,
        condition: this.exceptionChoice.get(filter.filter)!.condition,
      }))

    await client
      .request('setExceptionBreakpoints', {
        filters: chosen.map((filter) => filter.filter),
        ...(conditions.length && this.capabilities.supportsExceptionFilterOptions
          ? { filterOptions: conditions.map((c) => ({ filterId: c.filterId, condition: c.condition })) }
          : {}),
      })
      .catch(() => undefined)
  }

  async setExceptionBreakpoint(filter: string, patch: { enabled?: boolean; condition?: string }) {
    const current = this.exceptionChoice.get(filter) ?? { enabled: false, condition: '' }
    this.exceptionChoice.set(filter, { ...current, ...patch })
    await this.sendExceptionBreakpoints()
    void this.persist()
    this.publish()
  }

  /* ---------------- data (field) watchpoints ---------------- */

  /**
   * Adds a watchpoint on a variable: break when the program writes to it.
   *
   * The adapter turns a (name, container) pair into an opaque `dataId` first —
   * the id is only valid for the current session, so watchpoints are not
   * persisted the way line breakpoints are.
   */
  async addDataBreakpoint(
    name: string,
    variablesReference: number,
    accessType: DataBreakpoint['accessType'] = 'write',
  ): Promise<{ ok: boolean; message: string }> {
    const client = this.client
    if (!client?.running) return { ok: false, message: 'Start a debug session first.' }
    if (!this.capabilities.supportsDataBreakpoints) {
      return { ok: false, message: `${this.spec?.label ?? 'This adapter'} does not support watchpoints.` }
    }
    try {
      const info = await client.request('dataBreakpointInfo', {
        name,
        ...(variablesReference ? { variablesReference } : {}),
        ...(this.currentFrameId !== null ? { frameId: this.currentFrameId } : {}),
      })
      if (!info?.dataId) {
        return { ok: false, message: info?.description || `\`${name}\` cannot be watched here.` }
      }
      const supported: string[] = info.accessTypes ?? ['write']
      const chosen = supported.includes(accessType) ? accessType : (supported[0] as DataBreakpoint['accessType'])
      this.dataBreakpoints = [
        ...this.dataBreakpoints.filter((b) => b.dataId !== info.dataId),
        {
          dataId: info.dataId,
          label: info.description || name,
          accessType: chosen,
          enabled: true,
        },
      ]
      await this.sendDataBreakpoints()
      this.publish()
      return { ok: true, message: `Watching ${info.description || name}` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async removeDataBreakpoint(dataId: string) {
    this.dataBreakpoints = this.dataBreakpoints.filter((b) => b.dataId !== dataId)
    await this.sendDataBreakpoints()
    this.publish()
  }

  private async sendDataBreakpoints() {
    const client = this.client
    if (!client?.running || !this.capabilities.supportsDataBreakpoints) return
    await client
      .request('setDataBreakpoints', {
        breakpoints: this.dataBreakpoints
          .filter((b) => b.enabled)
          .map((b) => ({
            dataId: b.dataId,
            accessType: b.accessType,
            ...(b.condition ? { condition: b.condition } : {}),
            ...(b.hitCondition ? { hitCondition: b.hitCondition } : {}),
          })),
      })
      .catch(() => undefined)
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
        // Whatever stopped us, the Run to Cursor target has served its purpose.
        await this.clearRunToCursor()
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

  /**
   * Writes a new value into a variable while paused.
   *
   * `setVariable` is the container-scoped form and works for locals and object
   * members; `setExpression` handles everything addressable by an expression.
   * Adapters implement one, the other, or both, so both are tried.
   */
  async setVariable(
    variablesReference: number,
    name: string,
    value: string,
  ): Promise<{ ok: boolean; value: string; error: string }> {
    const client = this.client
    if (!client?.running) return { ok: false, value: '', error: 'Not running' }
    if (this.capabilities.supportsSetVariable && variablesReference) {
      try {
        const body = await client.request('setVariable', { variablesReference, name, value })
        this.publish()
        return { ok: true, value: body?.value ?? value, error: '' }
      } catch (err) {
        if (!this.capabilities.supportsSetExpression) {
          return { ok: false, value: '', error: (err as Error).message }
        }
      }
    }
    if (!this.capabilities.supportsSetExpression) {
      return {
        ok: false,
        value: '',
        error: `${this.spec?.label ?? 'This adapter'} cannot change variables.`,
      }
    }
    try {
      const body = await client.request('setExpression', {
        expression: name,
        value,
        frameId: this.currentFrameId ?? undefined,
      })
      this.publish()
      return { ok: true, value: body?.value ?? value, error: '' }
    } catch (err) {
      return { ok: false, value: '', error: (err as Error).message }
    }
  }

  /**
   * Run to Cursor: continue, but stop at `line` even without a breakpoint
   * there.
   *
   * Implemented as a one-shot breakpoint rather than DAP's `goto`, because
   * `goto` *skips* the intervening code — which is a different feature, and not
   * the one anybody means by Run to Cursor.
   */
  async runToLine(file: string, line: number) {
    if (!this.client?.running) return
    this.runToCursor = { file, line }
    await this.sendBreakpoints(file)
    this.publish()
    await this.control('continue')
  }

  /** Withdraws the temporary breakpoint once the program has stopped. */
  private async clearRunToCursor() {
    const target = this.runToCursor
    if (!target) return
    this.runToCursor = null
    await this.sendBreakpoints(target.file)
  }

  /** IntelliJ's Drop Frame: re-enter the selected frame from its first line. */
  async dropFrame(frameId?: number) {
    const client = this.client
    if (!client?.running) return { ok: false, error: 'Not running' }
    if (!this.capabilities.supportsRestartFrame) {
      return { ok: false, error: `${this.spec?.label ?? 'This adapter'} cannot drop frames.` }
    }
    const target = frameId ?? this.currentFrameId
    if (target === null || target === undefined) return { ok: false, error: 'No frame selected' }
    try {
      await client.request('restartFrame', { frameId: target })
      return { ok: true, error: '' }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
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
    this.runToCursor = null
    // Watchpoint ids belong to the process that just died.
    this.dataBreakpoints = []
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
