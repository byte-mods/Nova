/**
 * IPC surface for the plugin system.
 *
 * The renderer drives installs and lifecycle from here, and the host reaches
 * back through `askRenderer` for the handful of things only the renderer knows
 * (the active file, the current selection, what a toast should say).
 */
import { ipcMain, BrowserWindow } from 'electron'
import type {
  InstalledPlugin,
  PluginInstallProgress,
  PluginPermission,
} from '../../shared/plugin'
import { PluginHost } from '../lib/pluginHost'
import {
  getPlugin,
  grantPermissions,
  installFromGit,
  listPlugins,
  markError,
  pluginsDir,
  setEnabled,
  uninstall,
  updatePlugin,
} from '../lib/pluginStore'
import { collectMcpServers, type ResolvedMcpServer } from '../lib/pluginMcp'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

/** Renderer questions in flight, keyed by request id. */
const rendererCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let nextAsk = 1

export function registerPluginHandlers(ctx: Ctx) {
  // The renderer publishes the open project here; the host reads it per call so
  // switching projects does not require restarting plugins.
  let workspaceRoot: string | null = null

  const host = new PluginHost({
    broadcast: ctx.broadcast,
    getWorkspaceRoot: () => workspaceRoot,
    askRenderer,
  })

  /**
   * Asks the renderer something on a plugin's behalf.
   *
   * Rejects rather than hanging when no window is available — a plugin calling
   * `editor.activeFile()` during shutdown should get an error it can handle.
   */
  function askRenderer(question: string, params?: unknown): Promise<unknown> {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win) return Promise.reject(new Error('No editor window is open.'))

    const id = `ask${nextAsk++}`
    return new Promise((resolve, reject) => {
      rendererCalls.set(id, { resolve, reject })
      win.webContents.send('plugins:ask', { id, question, params })
      setTimeout(() => {
        if (rendererCalls.delete(id)) reject(new Error(`The editor did not answer "${question}" in time.`))
      }, 20_000)
    })
  }

  ipcMain.on('plugins:answer', (_e, payload: { id: string; ok: boolean; value?: unknown; error?: string }) => {
    const entry = rendererCalls.get(payload.id)
    if (!entry) return
    rendererCalls.delete(payload.id)
    if (payload.ok) entry.resolve(payload.value)
    else entry.reject(new Error(payload.error || 'The editor rejected the request.'))
  })

  ipcMain.handle('plugins:setRoot', (_e, root: string | null) => {
    workspaceRoot = root
  })

  ipcMain.handle('plugins:list', () => listPlugins())

  ipcMain.handle('plugins:dir', () => pluginsDir())

  ipcMain.handle(
    'plugins:install',
    async (
      _e,
      url: string,
      options?: {
        ref?: string
        permissions?: PluginPermission[]
        force?: boolean
        allowBuild?: boolean
      },
    ) => {
      const onProgress = (p: PluginInstallProgress) => ctx.broadcast('plugins:install-progress', p)
      const plugin = await installFromGit({
        url,
        ref: options?.ref,
        grantedPermissions: options?.permissions,
        force: options?.force,
        allowBuild: options?.allowBuild,
        onProgress,
      })

      try {
        onProgress({ url, stage: 'loading', message: 'Activating…', pluginId: plugin.manifest.id })
        await host.load(plugin)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await markError(plugin.manifest.id, message)
        onProgress({ url, stage: 'error', message, pluginId: plugin.manifest.id })
      }

      await pushList()
      return plugin
    },
  )

  ipcMain.handle('plugins:update', async (_e, id: string) => {
    const plugin = await updatePlugin(id, (p) => ctx.broadcast('plugins:install-progress', p))
    await host.unload(id)
    if (plugin.enabled) await host.load(plugin)
    await pushList()
    return plugin
  })

  ipcMain.handle('plugins:setEnabled', async (_e, id: string, enabled: boolean) => {
    const plugin = await setEnabled(id, enabled)
    if (!plugin) return null
    if (enabled) await host.load(plugin)
    else await host.unload(id)
    await pushList()
    return plugin
  })

  ipcMain.handle('plugins:uninstall', async (_e, id: string) => {
    await host.unload(id)
    await uninstall(id)
    await pushList()
  })

  ipcMain.handle('plugins:grant', async (_e, id: string, permissions: PluginPermission[]) => {
    await grantPermissions(id, permissions)
    // Permissions are captured at load time, so reload to apply the new grant.
    const plugin = await getPlugin(id)
    if (plugin?.enabled) {
      await host.unload(id)
      await host.load(plugin)
    }
    await pushList()
    return plugin ?? null
  })

  ipcMain.handle('plugins:invoke', (_e, pluginId: string, commandId: string, args?: unknown) =>
    host.invoke(pluginId, commandId, args),
  )

  ipcMain.handle('plugins:runtime', () => host.runtimeStates())

  ipcMain.handle('plugins:viewHtml', (_e, pluginId: string, viewId: string) =>
    host.getViewHtml(pluginId, viewId),
  )

  ipcMain.handle('plugins:commands', () => host.commands())

  ipcMain.handle('plugins:mcpServers', async () => {
    const servers = collectMcpServers(await listPlugins())
    return servers.map((s) => ({
      key: s.key,
      pluginId: s.pluginId,
      pluginName: s.pluginName,
      name: s.contribution.name,
      description: s.contribution.description ?? '',
      command: s.command,
      args: s.args,
    }))
  })

  async function pushList() {
    ctx.broadcast('plugins:list', await listPlugins())
  }

  /** Boots every enabled plugin. Called once the app is ready. */
  async function start() {
    try {
      await host.start(await listPlugins())
      await pushList()
    } catch (err) {
      ctx.broadcast('plugins:log', {
        pluginId: 'host',
        level: 'error',
        text: err instanceof Error ? err.message : String(err),
        at: Date.now(),
      })
    }
  }

  return {
    start,
    dispose: () => host.stop(),
    /** Used by the AI console to attach plugin MCP servers to a run. */
    mcpServers: async (): Promise<ResolvedMcpServer[]> => collectMcpServers(await listPlugins()),
    listPlugins,
  }
}

export type PluginIpc = ReturnType<typeof registerPluginHandlers>

export type { InstalledPlugin }
