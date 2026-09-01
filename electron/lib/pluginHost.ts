/**
 * Supervises plugin host processes and answers what plugins ask for.
 *
 * Each plugin gets its own forked host. That costs a process per plugin, and an
 * earlier draft shared one host to avoid it — but sharing quietly destroys the
 * permission model. A plugin runs arbitrary code inside its host, so it can skip
 * the API facade and write directly to the parent's IPC channel. If the parent
 * takes the plugin's identity from a field *in the message*, any plugin can
 * claim to be any other and inherit its grants; a probe confirmed a plugin
 * declaring no permissions could borrow another's `shell` grant and execute
 * commands. Identity therefore has to come from the channel the message arrived
 * on, which means one channel — one process — per plugin.
 *
 * This module is the security boundary. Every `rpc` is checked against the
 * permissions the user approved and, for anything path-shaped, against the
 * workspace root. The host re-checks permissions too, but only this side is
 * authoritative: the host runs the plugin's own code and cannot police it.
 */
import { app } from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveInRoot } from './workspacePath'
import { promisify } from 'node:util'
import type {
  InstalledPlugin,
  PluginLogEvent,
  PluginPermission,
  PluginRuntimeState,
} from '../../shared/plugin'

const exec = promisify(execFile)

/** A plugin's shell command should not be able to hang the host forever. */
const SHELL_TIMEOUT_MS = 2 * 60 * 1000

export interface HostContext {
  broadcast: (channel: string, payload: unknown) => void
  /** Current workspace root, or null. Read live: the user can switch projects. */
  getWorkspaceRoot: () => string | null
  /** Editor state the renderer owns, requested on demand. */
  askRenderer: (question: string, params?: unknown) => Promise<unknown>
}

interface LoadedPlugin {
  plugin: InstalledPlugin
  runtime: PluginRuntimeState
  /** The process running this plugin, and nothing else. */
  child: ChildProcess
}

export class PluginHost {
  private readonly loaded = new Map<string, LoadedPlugin>()
  /**
   * In-flight command calls. The owning plugin is recorded alongside each one:
   * ids are handed out globally, so without this check a plugin could resolve a
   * *different* plugin's pending command with a value of its choosing.
   */
  private readonly pendingCommands = new Map<
    string,
    { pluginId: string; resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private readonly viewHtml = new Map<string, string>()
  private nextCommandId = 1

  constructor(private readonly ctx: HostContext) {}

  /** Loads every enabled plugin, replacing whatever is currently running. */
  async start(plugins: InstalledPlugin[]): Promise<void> {
    await this.stop()
    for (const plugin of plugins.filter((p) => p.enabled)) {
      try {
        await this.load(plugin)
      } catch (err) {
        // One plugin failing to start must not stop the rest from loading.
        this.log(plugin.manifest.id, 'error', err instanceof Error ? err.message : String(err))
      }
    }
  }

  async stop(): Promise<void> {
    for (const id of Array.from(this.loaded.keys())) this.killChild(id)
    this.loaded.clear()
    this.viewHtml.clear()
    for (const { reject } of this.pendingCommands.values()) reject(new Error('Plugin host stopped.'))
    this.pendingCommands.clear()
  }

  private killChild(pluginId: string): void {
    const entry = this.loaded.get(pluginId)
    if (!entry) return
    entry.child.removeAllListeners()
    entry.child.kill()
  }

  runtimeStates(): PluginRuntimeState[] {
    return Array.from(this.loaded.values()).map((l) => l.runtime)
  }

  getViewHtml(pluginId: string, viewId: string): string {
    return this.viewHtml.get(`${pluginId}:${viewId}`) ?? ''
  }

  /** Every command currently registered, namespaced for the palette. */
  commands(): { pluginId: string; commandId: string; title: string; category: string }[] {
    const out: { pluginId: string; commandId: string; title: string; category: string }[] = []
    for (const { plugin, runtime } of this.loaded.values()) {
      for (const c of runtime.commands) {
        out.push({
          pluginId: plugin.manifest.id,
          commandId: c.id,
          title: c.title,
          category: c.category || plugin.manifest.name,
        })
      }
    }
    return out
  }

  async load(plugin: InstalledPlugin): Promise<void> {
    const manifest = plugin.manifest
    // Reloading is the normal path for update and enable/disable.
    if (this.loaded.has(manifest.id)) await this.unload(manifest.id)

    const child = await this.spawnFor(manifest.id)

    this.loaded.set(manifest.id, {
      plugin,
      child,
      runtime: {
        pluginId: manifest.id,
        commands: manifest.contributes?.commands ?? [],
        views: manifest.contributes?.views ?? [],
        statusBar: [],
      },
    })

    child.send({
      t: 'load',
      plugin: {
        id: manifest.id,
        dir: plugin.dir,
        main: manifest.main ? path.join(plugin.dir, manifest.main) : null,
        permissions: plugin.grantedPermissions,
      },
    })
  }

  async unload(pluginId: string): Promise<void> {
    const entry = this.loaded.get(pluginId)
    if (entry) {
      // Give `deactivate` a moment to run, then take the process down. Killing
      // it is what actually frees the plugin's timers, sockets and memory.
      entry.child.send({ t: 'dispose', pluginId })
      await new Promise((r) => setTimeout(r, 100))
      this.killChild(pluginId)
    }
    this.loaded.delete(pluginId)
    for (const key of Array.from(this.viewHtml.keys())) {
      if (key.startsWith(`${pluginId}:`)) this.viewHtml.delete(key)
    }
    this.emitRuntime()
  }

  /** Invokes a plugin command and resolves with whatever the handler returned. */
  invoke(pluginId: string, commandId: string, args?: unknown): Promise<unknown> {
    const entry = this.loaded.get(pluginId)
    if (!entry) return Promise.reject(new Error(`${pluginId} is not loaded.`))

    const id = `c${this.nextCommandId++}`
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { pluginId, resolve, reject })
      entry.child.send({ t: 'command', id, pluginId, commandId, args })
      // A wedged handler should surface as an error rather than a dead promise.
      setTimeout(() => {
        if (this.pendingCommands.delete(id)) reject(new Error(`Command "${commandId}" timed out after 60s.`))
      }, 60_000)
    })
  }

  /**
   * Forks a host dedicated to one plugin.
   *
   * The plugin id is captured here, from the caller, and every message this
   * child sends is attributed to it. Nothing the child says can change that —
   * which is the whole point.
   */
  private spawnFor(pluginId: string): Promise<ChildProcess> {
    return new Promise<ChildProcess>((resolve, reject) => {
      const child = fork(hostScriptPath(), [], {
        // Electron's own binary is the Node runtime; this switch makes it behave
        // as plain Node rather than booting a second app instance.
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NOVA_PLUGIN_HOST: '1',
          NOVA_PLUGIN_ID: pluginId,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        execPath: process.execPath,
      })

      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        if (err) reject(err)
        else resolve(child)
      }

      child.on('message', (msg: unknown) => {
        const message = msg as HostMessage
        if (message?.t === 'ready') return settle()
        void this.onHostMessage(pluginId, child, message)
      })

      // A plugin writing to stdout/stderr is a log line, not a crash.
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (text: string) => this.log(pluginId, 'info', text.trimEnd()))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (text: string) => this.log(pluginId, 'error', text.trimEnd()))

      child.on('error', (err) => {
        this.log(pluginId, 'error', `Host failed to start: ${err.message}`)
        settle(err)
      })

      child.on('exit', (code, signal) => {
        // Only report an unexpected death; unload removes the entry first.
        if (this.loaded.get(pluginId)?.child === child) {
          this.loaded.delete(pluginId)
          this.log(pluginId, 'error', `Plugin host exited unexpectedly (code ${code}, signal ${signal}).`)
          this.emitRuntime()
        }
        settle(new Error('The plugin host exited before it was ready.'))
      })

      setTimeout(() => settle(new Error('Plugin host did not start within 15s.')), 15_000)
    })
  }

  /**
   * Handles one message from a plugin's host.
   *
   * `pluginId` is the identity of the *channel*, not anything the message
   * claims. Any `pluginId` field inside the payload is ignored.
   */
  private async onHostMessage(pluginId: string, child: ChildProcess, msg: HostMessage): Promise<void> {
    switch (msg.t) {
      case 'log':
        this.log(pluginId, msg.level, msg.text)
        break

      case 'loaded':
        this.emitRuntime()
        break

      case 'load-error':
        this.log(pluginId, 'error', msg.error)
        this.ctx.broadcast('plugins:loadError', { pluginId, error: msg.error })
        break

      case 'result': {
        const entry = this.pendingCommands.get(msg.id)
        // Ignore a result for a call this plugin was not the target of.
        if (!entry || entry.pluginId !== pluginId) return
        this.pendingCommands.delete(msg.id)
        if (msg.ok) entry.resolve(msg.value)
        else entry.reject(new Error(msg.error || 'The command failed.'))
        break
      }

      case 'rpc': {
        try {
          const value = await this.handleRpc(pluginId, msg.method, msg.params)
          child.send({ t: 'rpc-result', id: msg.id, ok: true, value: value ?? null })
        } catch (err) {
          child.send({
            t: 'rpc-result',
            id: msg.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        break
      }
    }
  }

  /**
   * Fulfils one plugin API call.
   *
   * Every branch that touches the disk resolves the path against the workspace
   * root first. A plugin granted `workspace:read` is granted it for the open
   * project, not for the user's home directory.
   */
  private async handleRpc(pluginId: string, method: string, params: RpcParams): Promise<unknown> {
    const entry = this.loaded.get(pluginId)
    if (!entry) throw new Error(`${pluginId} is not loaded.`)
    const granted = new Set<PluginPermission>(entry.plugin.grantedPermissions)

    const need = (permission: PluginPermission) => {
      if (!granted.has(permission)) {
        throw new Error(`"${permission}" permission has not been granted to ${pluginId}.`)
      }
    }

    const root = () => {
      const r = this.ctx.getWorkspaceRoot()
      if (!r) throw new Error('No project is open.')
      return r
    }

    switch (method) {
      case 'workspace.root':
        return this.ctx.getWorkspaceRoot()

      case 'workspace.readFile':
        need('workspace:read')
        return fs.readFile(await this.resolveInWorkspace(root(), String(params.file)), 'utf8')

      case 'workspace.writeFile': {
        need('workspace:write')
        const target = await this.resolveInWorkspace(root(), String(params.file))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, String(params.content ?? ''), 'utf8')
        this.ctx.broadcast('fs:changed', { path: target })
        return null
      }

      case 'workspace.list': {
        need('workspace:read')
        const dir = await this.resolveInWorkspace(root(), String(params.dir ?? '.'))
        const entries = await fs.readdir(dir, { withFileTypes: true })
        return entries.map((e) => ({
          name: e.name,
          path: path.join(dir, e.name),
          isDirectory: e.isDirectory(),
        }))
      }

      case 'workspace.findFiles':
      case 'workspace.search':
      case 'editor.activeFile':
      case 'editor.selection':
      case 'editor.applyEdit':
      case 'editor.open':
      case 'ui.showMessage':
      case 'ui.prompt':
      case 'commands.execute':
        // These read or mutate state the renderer owns, so they are forwarded.
        if (method.startsWith('editor.')) need('editor')
        if (method.startsWith('ui.')) need('ui')
        if (method.startsWith('workspace.')) need('workspace:read')
        return this.ctx.askRenderer(method, { pluginId, ...params })

      case 'ui.setViewHtml': {
        need('ui')
        const viewId = String(params.viewId)
        const declared = entry.runtime.views.some((v) => v.id === viewId)
        if (!declared) throw new Error(`View "${viewId}" is not declared in contributes.views.`)
        this.viewHtml.set(`${pluginId}:${viewId}`, String(params.html ?? ''))
        this.ctx.broadcast('plugins:viewHtml', { pluginId, viewId, html: params.html ?? '' })
        return null
      }

      case 'ui.setStatusBarItem': {
        need('ui')
        const id = String(params.id)
        const item = (params.item ?? {}) as { text?: string; tooltip?: string; command?: string }
        const next = entry.runtime.statusBar.filter((s) => s.id !== id)
        if (item.text) next.push({ id, text: item.text, tooltip: item.tooltip, command: item.command })
        entry.runtime.statusBar = next
        this.emitRuntime()
        return null
      }

      case 'git.status': {
        need('git')
        const { stdout } = await exec('git', ['status', '--porcelain=v1', '-b'], { cwd: root() })
        return stdout
      }

      case 'git.log': {
        need('git')
        const limit = Math.min(Number(params.limit) || 50, 500)
        const { stdout } = await exec('git', ['log', `-${limit}`, '--pretty=format:%H%x00%an%x00%ad%x00%s'], {
          cwd: root(),
        })
        return stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash, author, date, subject] = line.split('\0')
            return { hash, author, date, subject }
          })
      }

      case 'shell.exec': {
        need('shell')
        const command = String(params.command ?? '')
        if (!command.trim()) throw new Error('shell.exec needs a command.')
        const options = (params.options ?? {}) as { cwd?: string }
        const cwd = options.cwd ? await this.resolveInWorkspace(root(), options.cwd) : root()
        try {
          const { stdout, stderr } = await exec('/bin/sh', ['-lc', command], {
            cwd,
            timeout: SHELL_TIMEOUT_MS,
            maxBuffer: 16 * 1024 * 1024,
          })
          return { ok: true, stdout, stderr }
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string }
          return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' }
        }
      }

      case 'storage.get':
        return (await this.readStorage(pluginId))[String(params.key)] ?? null

      case 'storage.set': {
        const data = await this.readStorage(pluginId)
        data[String(params.key)] = params.value
        await this.writeStorage(pluginId, data)
        return null
      }

      case 'secrets.get':
        need('secrets')
        return (await this.readStorage(pluginId, 'secrets'))[String(params.key)] ?? null

      case 'secrets.set': {
        need('secrets')
        const data = await this.readStorage(pluginId, 'secrets')
        data[String(params.key)] = params.value
        await this.writeStorage(pluginId, data, 'secrets')
        return null
      }

      default:
        throw new Error(`Unknown plugin API method "${method}".`)
    }
  }

  /**
   * Resolves a plugin-supplied path and refuses anything outside the project.
   *
   * `path.resolve` collapses `..`, but a plugin granted `fs:read` could still
   * point at a symlink and read the machine, so this goes through the shared
   * `realpath` check rather than a string comparison.
   */
  private async resolveInWorkspace(root: string, relative: string): Promise<string> {
    return resolveInRoot(root, relative)
  }

  private storageFile(pluginId: string, kind: 'storage' | 'secrets' = 'storage'): string {
    return path.join(app.getPath('userData'), 'plugin-data', `${pluginId}.${kind}.json`)
  }

  private async readStorage(pluginId: string, kind: 'storage' | 'secrets' = 'storage'): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await fs.readFile(this.storageFile(pluginId, kind), 'utf8'))
    } catch {
      return {}
    }
  }

  private async writeStorage(
    pluginId: string,
    data: Record<string, unknown>,
    kind: 'storage' | 'secrets' = 'storage',
  ): Promise<void> {
    const file = this.storageFile(pluginId, kind)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
    if (kind === 'secrets') await fs.chmod(file, 0o600).catch(() => {})
  }

  private emitRuntime(): void {
    this.ctx.broadcast('plugins:runtime', this.runtimeStates())
  }

  private log(pluginId: string, level: PluginLogEvent['level'], text: string): void {
    if (!text) return
    const event: PluginLogEvent = { pluginId, level, text, at: Date.now() }
    this.ctx.broadcast('plugins:log', event)
  }
}

type RpcParams = Record<string, unknown>

type HostMessage =
  | { t: 'ready' }
  | { t: 'log'; pluginId: string; level: PluginLogEvent['level']; text: string }
  | { t: 'loaded'; pluginId: string; commands: string[] }
  | { t: 'load-error'; pluginId: string; error: string }
  | { t: 'disposed'; pluginId: string }
  | { t: 'result'; id: string; ok: boolean; value?: unknown; error?: string }
  | { t: 'rpc'; id: string; pluginId: string; method: string; params: RpcParams }

/**
 * Locates `host.mjs`.
 *
 * In a packaged app it sits beside the bundled main script; in `vite dev` the
 * bundle is written to `dist-electron` but the source tree is still present, so
 * both are tried before giving up.
 */
function hostScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = process.env.APP_ROOT ?? path.join(here, '..')
  const candidates = [
    path.join(here, 'plugin-host', 'host.mjs'),
    path.join(root, 'dist-electron', 'plugin-host', 'host.mjs'),
    path.join(root, 'electron', 'plugin-host', 'host.mjs'),
  ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}
